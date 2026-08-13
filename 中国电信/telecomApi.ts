// telecomApi.ts（中国电信 / CT）
// 模块分类 · 数据获取（网络层 + 缓存 + 鉴权）
// 模块分类 · 设计要点
// - API 原始响应：固定单文件缓存（ct_api.json），Storage 仅存 meta（updatedAt/keyFp/fileName/baseDir）
// - 登录态：token/province/city 存 Storage（TELECOM_AUTH_KEY）
// - 超时：withTimeout 包一层，避免预览/桌面“挂死”
// - 策略：cache_disabled / cache_only / network_only / auto（与 cacheSection 语义对齐）
// - 注入：返回 data 时注入 __cacheMeta（方便 widget 一行排障）
// - 注意：widget.tsx 还会把“聚合后的 CarrierData”再落一个 ct_data.json（两层缓存：原始+聚合）

import { fetch } from "scripting"
import JSEncrypt from "./module/jsencrypt"

import {
  type ChinaTelecomSettings,
  defaultChinaTelecomSettings,
  loadChinaTelecomSettings,
  SETTINGS_KEY,
} from "./settings"

import type { CacheConfig, CacheMode } from "./shared/ui-kit/cacheSection"
import { safeGetObject, safeSet, safeSetObject } from "./shared/utils/storage"
import { readJsonFromSingleFile, writeJsonToSingleFileAtomic } from "./shared/utils/fileCache"
import { kv, errToString } from "./shared/utils/widgetKit"

// =====================================================================
// 模块分类 · Keys
// =====================================================================
// API 原始数据缓存 meta（单文件）
const TELECOM_API_CACHE_KEY = `${SETTINGS_KEY}:cache:apiData`
// 登录态缓存（token/province/city）
const TELECOM_AUTH_KEY = `${SETTINGS_KEY}:auth`

type TelecomAuth = {
  token: string
  provinceCode: string
  cityCode: string
  updatedAt: number
}

// =====================================================================
// 模块分类 · 单文件缓存（API 原始响应）
// =====================================================================
type TelecomApiBoxMeta = {
  updatedAt: number
  keyFp: string
  dataFileName: string
  baseDir: "documents" | "library" | "temporary"
}

const CT_API_FILE = "ct_api.json"
const CT_API_BAK = "ct_api.bak.json"

// =====================================================================
// 模块分类 · Cache helpers（对齐联通风格）
// =====================================================================
type TelecomCacheHit = {
  updatedAt: number
  data: any
  keyMatched: boolean
  meta: TelecomApiBoxMeta
}

const MIN_CACHE_MS = 4 * 60 * 60 * 1000
const DEFAULT_MAX_STALE_MS = 24 * 60 * 60 * 1000

function fingerprint(raw: string): string {
  const s = String(raw ?? "")
  let hash = 5381
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) + hash) ^ s.charCodeAt(i)
  return `djb2:${(hash >>> 0).toString(36)}`
}

function toMin(ms: number) {
  return Math.round(ms / 60000)
}

function clampRefreshMinutes(v: any): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return 180
  return Math.max(60, Math.floor(n))
}

function isFresh(updatedAt: number, ttlMs: number) {
  return Date.now() - updatedAt <= ttlMs
}

function isWithinStale(updatedAt: number, maxStaleMs: number) {
  return Date.now() - updatedAt <= maxStaleMs
}

function ttlFromCacheSettings(cache: CacheConfig, refreshIntervalMinutes?: number): number {
  const refreshMs =
    typeof refreshIntervalMinutes === "number" && Number.isFinite(refreshIntervalMinutes)
      ? Math.max(0, refreshIntervalMinutes) * 60 * 1000
      : 0

  const fixedMs =
    typeof cache.ttlMinutesFixed === "number" && Number.isFinite(cache.ttlMinutesFixed)
      ? Math.max(0, cache.ttlMinutesFixed) * 60 * 1000
      : 0

  const base = cache.ttlPolicy === "fixed" ? fixedMs : refreshMs
  return Math.max(MIN_CACHE_MS, base)
}

function readCache(boundKey: string, allowKeyMismatch: boolean): TelecomCacheHit | null {
  const meta = safeGetObject<TelecomApiBoxMeta | null>(TELECOM_API_CACHE_KEY, null)
  if (!meta) return null

  if (typeof meta.updatedAt !== "number" || !Number.isFinite(meta.updatedAt)) return null
  if (typeof meta.dataFileName !== "string" || !meta.dataFileName) return null
  if (meta.baseDir !== "documents" && meta.baseDir !== "library" && meta.baseDir !== "temporary") return null
  if (typeof meta.keyFp !== "string" || !meta.keyFp) return null

  const want = fingerprint(boundKey)
  const keyMatched = meta.keyFp === want
  if (!keyMatched && !allowKeyMismatch) return null

  const hit = readJsonFromSingleFile<any>({
    dataFileName: meta.dataFileName,
    baseDir: meta.baseDir,
    backupFileName: CT_API_BAK,
  })
  if (!hit?.data) return null

  return { updatedAt: meta.updatedAt, data: hit.data, keyMatched, meta }
}

function writeCache(data: any, boundKey: string): number {
  const ok = writeJsonToSingleFileAtomic({
    dataFileName: CT_API_FILE,
    backupFileName: CT_API_BAK,
    baseDir: "documents",
    data,
  })
  if (!ok) throw new Error("writeJsonToSingleFileAtomic failed")

  const now = Date.now()
  const meta: TelecomApiBoxMeta = {
    updatedAt: now,
    keyFp: fingerprint(boundKey),
    dataFileName: CT_API_FILE,
    baseDir: "documents",
  }
  safeSetObject(TELECOM_API_CACHE_KEY, meta)
  return now
}

// =====================================================================
// 模块分类 · Timeout
// =====================================================================
function withTimeout<T>(p: Promise<T>, ms: number, tag: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${tag} timeout after ${ms}ms`)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

// =====================================================================
// 模块分类 · Telecom client（网络层）
// =====================================================================
class TelecomClient {
  private client_type = "#12.2.0#channel50#iPhone 14 Pro#"
  private headers = { "Content-Type": "application/json; charset=UTF-8" }

  private mobile = ""
  private password = ""
  private deviceID = ""

  private token = ""
  private provinceCode = ""
  private cityCode = ""

  constructor(settings: ChinaTelecomSettings) {
    this.mobile = String((settings as any).mobile ?? "").trim()
    this.password = String((settings as any).password ?? "").trim()
    this.deviceID = String((settings as any).deviceID ?? "").trim()

    const auth = safeGetObject<TelecomAuth | null>(TELECOM_AUTH_KEY, null)
    if (auth) {
      this.token = String(auth.token ?? "")
      this.provinceCode = String(auth.provinceCode ?? "")
      this.cityCode = String(auth.cityCode ?? "")
    }
  }

  private saveAuth() {
    const next: TelecomAuth = {
      token: this.token,
      provinceCode: this.provinceCode,
      cityCode: this.cityCode,
      updatedAt: Date.now(),
    }
    safeSet(TELECOM_AUTH_KEY, next as any)
  }

  private getBeijingTimestamp() {
    const bjDate = new Date(Date.now() + 8 * 3600 * 1000)
    const yyyy = String(bjDate.getFullYear())
    const MM = String(bjDate.getMonth() + 1).padStart(2, "0")
    const dd = String(bjDate.getDate()).padStart(2, "0")
    const HH = String(bjDate.getHours()).padStart(2, "0")
    const mm = String(bjDate.getMinutes()).padStart(2, "0")
    const ss = String(bjDate.getSeconds()).padStart(2, "0")
    return `${yyyy}${MM}${dd}${HH}${mm}${ss}`
  }

  private transNumber(str: string, encode = true) {
    return [...String(str ?? "")]
      .map((c) => String.fromCharCode((c.charCodeAt(0) + (encode ? 2 : -2)) & 0xffff))
      .join("")
  }

  private encrypt(str: string) {
    const encryptor = new JSEncrypt()
    encryptor.setPublicKey(
      `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDBkLT15ThVgz6/NOl6s8GNPofd
WzWbCkWnkaAm7O2LjkM1H7dMvzkiqdxU02jamGRHLX/ZNMCXHnPcW/sDhiFCBN18
qFvy8g6VYb9QtroI09e176s+ZCtiv7hbin2cCTj99iUpnEloZm19lwHyo69u5UMi
PMpq0/XKBO8lYhN/gwIDAQAB
-----END PUBLIC KEY-----`,
    )
    return encryptor.encrypt(str)
  }

  private async postJson(url: string, body: any, tag: string): Promise<any | null> {
    const TIMEOUT_MS = 6500
    try {
      console.log(`🌐 CT 请求 | ${tag}`)
      const resp = await withTimeout(
        fetch(url, {
          method: "POST",
          headers: this.headers,
          body: JSON.stringify(body),
        }),
        TIMEOUT_MS,
        tag,
      )

      if (!resp) return null
      if (!resp.ok) {
        console.warn(`⚠️ CT 响应失败 | ${tag} status=${(resp as any).status}`)
        return null
      }

      const text = await resp.text()
      const json = JSON.parse(text || "{}")
      return json ?? null
    } catch (e) {
      console.warn(`⚠️ CT 请求失败/超时 | ${tag} | ${errToString(e)}`)
      return null
    }
  }

  private async login(): Promise<boolean> {
    const uuid = String(Math.floor(Math.random() * 9e15 + 1e15))
    const ts = this.getBeijingTimestamp()

    const loginBody = {
      content: {
        fieldData: {
          accountType: "",
          authentication: this.transNumber(this.password),
          deviceUid: uuid.slice(0, 16),
          androidId: this.deviceID ? this.transNumber(this.deviceID) : "",
          isChinatelecom: "",
          loginAuthCipherAsymmertric: this.encrypt(
            `iPhone 14 15.4.0${this.deviceID ? this.deviceID : uuid.slice(0, 12)}${this.mobile}${ts}${this.password}0$$$0.`,
          ),
          loginType: "4",
          phoneNum: this.transNumber(this.mobile),
          systemVersion: "15.4.0",
        },
        attach: "iPhone",
      },
      headerInfos: {
        code: "userLoginNormal",
        clientType: this.client_type,
        timestamp: ts,
        shopId: "20002",
        source: "110003",
        sourcePassword: "Sid98s",
        userLoginName: this.transNumber(this.mobile),
      },
    }

    const data = await this.postJson(
      "https://appgologin.189.cn:9031/login/client/userLoginNormal",
      loginBody,
      "login",
    )

    const code = data?.responseData?.resultCode
    if (code !== "0000") {
      const msg = data?.responseData?.resultDesc || "登录失败"
      console.warn(`❌ CT 登录失败 | ${msg}`)
      return false
    }

    const r = data?.responseData?.data?.loginSuccessResult
    this.token = String(r?.token ?? "")
    this.cityCode = String(r?.cityCode ?? "")
    this.provinceCode = String(r?.provinceCode ?? "")

    if (!this.token) {
      console.warn("❌ CT 登录成功但 token 为空")
      return false
    }

    this.saveAuth()
    return true
  }

  private async fetchImportantData(): Promise<any | null> {
    const ts = this.getBeijingTimestamp()

    const queryBody = {
      content: {
        fieldData: {
          provinceCode: this.provinceCode,
          cityCode: this.cityCode,
          shopId: "20002",
          isChinatelecom: "0",
          account: this.transNumber(this.mobile),
        },
        attach: "test",
      },
      headerInfos: {
        code: "qryImportantData",
        clientType: this.client_type,
        timestamp: ts,
        shopId: "20002",
        source: "110003",
        sourcePassword: "Sid98s",
        userLoginName: this.transNumber(this.mobile),
        token: this.token,
      },
    }

    return await this.postJson(
      "https://appfuwu.189.cn:9021/query/qryImportantData",
      queryBody,
      "qryImportantData",
    )
  }

  async fetchImportantDataWithRelogin(): Promise<any | null> {
    let body = await this.fetchImportantData()
    const code1 = body?.responseData?.resultCode
    const ok1 = code1 === "0000" && !!body?.responseData?.data
    if (ok1) return body

    const okLogin = await this.login()
    if (!okLogin) return null

    body = await this.fetchImportantData()
    const code2 = body?.responseData?.resultCode
    const ok2 = code2 === "0000" && !!body?.responseData?.data
    return ok2 ? body : null
  }
}

// =====================================================================
// 模块分类 · 对外：带缓存的数据获取（对齐联通/国网语义）
// =====================================================================
export type FetchTelecomCachedOptions = {
  forceRefresh?: boolean
  cacheKey?: string
  refreshIntervalMinutes?: number
  cache?: CacheConfig
}

export type FetchTelecomCachedResult = {
  data: any
  fromCache: boolean
  ttlMs: number
  mode:
  | "cache_fresh"
  | "network_fresh"
  | "cache_stale_fallback"
  | "none"
  | "cache_only_hit"
  | "cache_only_miss"
  | "network_only"
  | "cache_disabled"
  fetchedAt: number
  cacheUpdatedAt?: number
  meta?: any
}

export async function getTelecomImportantData(
  options: FetchTelecomCachedOptions = {},
): Promise<FetchTelecomCachedResult> {
  const settings = loadChinaTelecomSettings()
  const now = Date.now()

  const boundKey =
    (typeof options.cacheKey === "string" && options.cacheKey.trim()
      ? options.cacheKey.trim()
      : typeof (settings as any).cacheScopeKey === "string" && String((settings as any).cacheScopeKey).trim()
        ? String((settings as any).cacheScopeKey).trim()
        : SETTINGS_KEY)

  const refreshMinutes =
    typeof options.refreshIntervalMinutes === "number" && Number.isFinite(options.refreshIntervalMinutes)
      ? Math.max(0, options.refreshIntervalMinutes)
      : clampRefreshMinutes((settings as any)?.refreshInterval)

  const cacheSettings: CacheConfig =
    options.cache ??
    (settings as any).cache ??
    (defaultChinaTelecomSettings as any).cache

  const cacheEnabled = cacheSettings.enabled !== false
  const cacheMode: CacheMode = (cacheSettings.mode ?? "auto") as CacheMode
  const allowStaleOnError = cacheSettings.allowStaleOnError !== false
  const allowKeyMismatch = (cacheSettings as any).allowStaleOnKeyMismatch !== false

  const ttlMs = ttlFromCacheSettings(cacheSettings, refreshMinutes)

  const maxStaleMs =
    typeof cacheSettings.maxStaleMinutes === "number" && Number.isFinite(cacheSettings.maxStaleMinutes)
      ? Math.max(0, cacheSettings.maxStaleMinutes) * 60 * 1000
      : DEFAULT_MAX_STALE_MS

  const forceRefresh = options.forceRefresh === true

  const cacheHit = cacheEnabled ? readCache(boundKey, allowKeyMismatch) : null
  const cacheAgeMin = cacheHit ? toMin(Date.now() - cacheHit.updatedAt) : undefined
  const keyMatched = cacheHit ? (cacheHit.keyMatched === true) : undefined

  console.log(
    `🧠 CT Cache 设置消费：enabled=${cacheEnabled ? "Y" : "N"} | mode=${cacheMode} | ttlPolicy=${cacheSettings.ttlPolicy} | ttl=${toMin(ttlMs)}min | allowStale=${allowStaleOnError ? "Y" : "N"} | maxStale=${toMin(maxStaleMs)}min | allowKeyMismatch=${allowKeyMismatch ? "Y" : "N"} | refresh=${refreshMinutes}min | force=${forceRefresh ? "Y" : "N"} | keyMatched=${keyMatched === undefined ? "-" : keyMatched ? "Y" : "N"} | boundKey=${fingerprint(boundKey).slice(0, 12)}`,
  )

  const client = new TelecomClient(settings)

  // cache_disabled：不读缓存，但网络成功仍写缓存
  if (!cacheEnabled) {
    const body = await client.fetchImportantDataWithRelogin()
    const ok = body?.responseData?.resultCode === "0000" && !!body?.responseData?.data

    let cacheUpdatedAt: number | undefined
    if (ok) {
      try {
        cacheUpdatedAt = writeCache(body, boundKey)
      } catch (e) {
        console.warn(`⚠️ CT cache_disabled 写缓存失败 | ${errToString(e)}`)
      }
    }

    return {
      data: ok ? body : null,
      fromCache: false,
      ttlMs,
      mode: ok ? "cache_disabled" : "none",
      fetchedAt: now,
      cacheUpdatedAt,
      meta: {
        cacheEnabled: false,
        cacheMode,
        ttlPolicy: cacheSettings.ttlPolicy,
        ttlMinutes: toMin(ttlMs),
        allowStaleOnError,
        maxStaleMinutes: toMin(maxStaleMs),
        allowStaleOnKeyMismatch: allowKeyMismatch,
        keyMatched: undefined,
        cacheAgeMinutes: cacheAgeMin,
        forceRefresh,
        decision: ok
          ? "cache_disabled(read_off) -> network_ok -> cache_written"
          : "cache_disabled(read_off) -> network_fail",
      },
    }
  }

  // cache_only
  if (cacheMode === "cache_only") {
    if (cacheHit) {
      return {
        data: cacheHit.data,
        fromCache: true,
        ttlMs,
        mode: "cache_only_hit",
        fetchedAt: now,
        cacheUpdatedAt: cacheHit.updatedAt,
        meta: {
          cacheEnabled: true,
          cacheMode,
          ttlPolicy: cacheSettings.ttlPolicy,
          ttlMinutes: toMin(ttlMs),
          allowStaleOnError,
          maxStaleMinutes: toMin(maxStaleMs),
          allowStaleOnKeyMismatch: allowKeyMismatch,
          keyMatched,
          cacheAgeMinutes: cacheAgeMin,
          forceRefresh,
          decision: cacheHit.keyMatched ? "cache_only -> hit" : "cache_only -> hit(key_mismatch_reuse)",
        },
      }
    }

    return {
      data: null,
      fromCache: false,
      ttlMs,
      mode: "cache_only_miss",
      fetchedAt: now,
      meta: {
        cacheEnabled: true,
        cacheMode,
        ttlPolicy: cacheSettings.ttlPolicy,
        ttlMinutes: toMin(ttlMs),
        allowStaleOnError,
        maxStaleMinutes: toMin(maxStaleMs),
        allowStaleOnKeyMismatch: allowKeyMismatch,
        keyMatched,
        forceRefresh,
        decision: "cache_only -> miss",
      },
    }
  }

  // network_only
  if (cacheMode === "network_only") {
    const body = await client.fetchImportantDataWithRelogin()
    const ok = body?.responseData?.resultCode === "0000" && !!body?.responseData?.data
    if (ok) {
      const cacheUpdatedAt = writeCache(body, boundKey)
      return {
        data: body,
        fromCache: false,
        ttlMs,
        mode: "network_only",
        fetchedAt: now,
        cacheUpdatedAt,
        meta: {
          cacheEnabled: true,
          cacheMode,
          ttlPolicy: cacheSettings.ttlPolicy,
          ttlMinutes: toMin(ttlMs),
          allowStaleOnError,
          maxStaleMinutes: toMin(maxStaleMs),
          allowStaleOnKeyMismatch: allowKeyMismatch,
          keyMatched,
          forceRefresh,
          decision: "network_only -> network_ok -> cache_written",
        },
      }
    }

    return {
      data: null,
      fromCache: false,
      ttlMs,
      mode: "none",
      fetchedAt: now,
      meta: {
        cacheEnabled: true,
        cacheMode,
        ttlPolicy: cacheSettings.ttlPolicy,
        ttlMinutes: toMin(ttlMs),
        allowStaleOnError,
        maxStaleMinutes: toMin(maxStaleMs),
        allowStaleOnKeyMismatch: allowKeyMismatch,
        keyMatched,
        forceRefresh,
        decision: "network_only -> network_fail",
      },
    }
  }

  // auto：优先 fresh cache
  if (cacheHit && !forceRefresh && isFresh(cacheHit.updatedAt, ttlMs)) {
    return {
      data: cacheHit.data,
      fromCache: true,
      ttlMs,
      mode: "cache_fresh",
      fetchedAt: now,
      cacheUpdatedAt: cacheHit.updatedAt,
      meta: {
        cacheEnabled: true,
        cacheMode,
        ttlPolicy: cacheSettings.ttlPolicy,
        ttlMinutes: toMin(ttlMs),
        allowStaleOnError,
        maxStaleMinutes: toMin(maxStaleMs),
        allowStaleOnKeyMismatch: allowKeyMismatch,
        keyMatched,
        cacheAgeMinutes: cacheAgeMin,
        forceRefresh,
        decision: cacheHit.keyMatched ? "auto -> cache_fresh" : "auto -> cache_fresh(key_mismatch_reuse)",
      },
    }
  }

  // auto：走网络刷新
  const fresh = await client.fetchImportantDataWithRelogin()
  const okFresh = fresh?.responseData?.resultCode === "0000" && !!fresh?.responseData?.data
  if (okFresh) {
    const cacheUpdatedAt = writeCache(fresh, boundKey)
    return {
      data: fresh,
      fromCache: false,
      ttlMs,
      mode: "network_fresh",
      fetchedAt: now,
      cacheUpdatedAt,
      meta: {
        cacheEnabled: true,
        cacheMode,
        ttlPolicy: cacheSettings.ttlPolicy,
        ttlMinutes: toMin(ttlMs),
        allowStaleOnError,
        maxStaleMinutes: toMin(maxStaleMs),
        allowStaleOnKeyMismatch: allowKeyMismatch,
        keyMatched,
        forceRefresh,
        decision: "auto -> network_ok -> cache_written",
      },
    }
  }

  // auto：网络失败 → stale fallback
  if (allowStaleOnError && cacheHit && isWithinStale(cacheHit.updatedAt, maxStaleMs)) {
    return {
      data: cacheHit.data,
      fromCache: true,
      ttlMs,
      mode: "cache_stale_fallback",
      fetchedAt: now,
      cacheUpdatedAt: cacheHit.updatedAt,
      meta: {
        cacheEnabled: true,
        cacheMode,
        ttlPolicy: cacheSettings.ttlPolicy,
        ttlMinutes: toMin(ttlMs),
        allowStaleOnError,
        maxStaleMinutes: toMin(maxStaleMs),
        allowStaleOnKeyMismatch: allowKeyMismatch,
        keyMatched,
        cacheAgeMinutes: cacheAgeMin,
        forceRefresh,
        decision: cacheHit.keyMatched
          ? "auto -> network_fail -> stale_fallback"
          : "auto -> network_fail -> stale_fallback(key_mismatch_reuse)",
      },
    }
  }

  return {
    data: null,
    fromCache: false,
    ttlMs,
    mode: "none",
    fetchedAt: now,
    cacheUpdatedAt: cacheHit ? cacheHit.updatedAt : undefined,
    meta: {
      cacheEnabled: true,
      cacheMode,
      ttlPolicy: cacheSettings.ttlPolicy,
      ttlMinutes: toMin(ttlMs),
      allowStaleOnError,
      maxStaleMinutes: toMin(maxStaleMs),
      allowStaleOnKeyMismatch: allowKeyMismatch,
      keyMatched,
      cacheAgeMinutes: cacheAgeMin,
      forceRefresh,
      decision: "auto -> network_fail -> no_cache",
    },
  }
}

// =====================================================================
// 模块分类 · 对外导出（给 widget 用）
// =====================================================================
export function getSettings(): ChinaTelecomSettings | null {
  return loadChinaTelecomSettings()
}

// queryImportantData：返回 responseData.data（优先），并注入 __cacheMeta（对齐国网/联通）
// - forceRefresh：由 widget 传入（network_only 也会传 true）
export async function queryImportantData(forceRefresh = false): Promise<any> {
  const settings = loadChinaTelecomSettings()

  if (!settings?.mobile) throw new Error("未配置手机号(mobile)，请在设置中配置")
  if (!settings?.password) throw new Error("未配置密码(password)，请在设置中配置")

  const refreshMinutes = clampRefreshMinutes((settings as any).refreshInterval)

  const result = await getTelecomImportantData({
    forceRefresh,
    refreshIntervalMinutes: refreshMinutes,
    cache: (settings as any).cache,
  })

  const body = result.data
  if (!body?.responseData) {
    console.warn(`❌ CT：获取重要数据失败 | ${kv(result.meta || {})}`)
    return null
  }

  const cacheMeta = {
    ...(result.meta || {}),
    fromCache: result.fromCache === true,
    mode: result.mode,
    fetchedAt: result.fetchedAt,
    cacheUpdatedAt: result.cacheUpdatedAt,
  }

  const data = body?.responseData?.data ?? body?.responseData ?? body
  if (data && typeof data === "object") {
    ; (data as any).__cacheMeta = cacheMeta
  }

  return data
}