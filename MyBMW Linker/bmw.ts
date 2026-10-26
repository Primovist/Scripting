import { fetch } from "scripting"
import {
  BMW_HEADERS,
  BMW_SERVER_HOST,
  DEFAULT_X,
  DEFAULT_X_CORRELATION_ID,
  KEYS,
  type Settings,
  type VehicleData,
  type VehicleSnapshot,
} from "./constants"
import { formatUserMobile, keyGet, keyRemove, keySave, md5Hex, nowSeconds, requestJSON, requestText, uuidv4 } from "./storage"

type CaptchaHeaders = Record<string, string>

function appHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...BMW_HEADERS, ...extra }
}

function randomNonceHeader(nBytes: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  const length = Math.ceil((nBytes * 4) / 3)
  let value = ""
  for (let i = 0; i < length; i++) value += chars[Math.floor(Math.random() * chars.length)]
  return value.replace(/=+$/, "") + "=="
}

async function fetchNonceResponse(url: string, headers: Record<string, string>) {
  const origin = (url.match(/^https?:\/\/[^/]+/) ?? [url])[0]
  return await fetch(url, {
    method: "GET",
    headers,
    timeout: 20,
    handleRedirect: async request => request.url.startsWith(origin) ? request : null,
    debugLabel: "BMW nonce primary",
  })
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, stage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${stage}超时（${Math.round(milliseconds / 1000)} 秒）`)), milliseconds)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function vehicleTypeFromProfile(profile?: Record<string, any> | null): "BEV" | "PHEV" | "ICE" | undefined {
  const dt = typeof profile?.driveTrain === "string" ? profile.driveTrain.trim().toUpperCase() : ""
  if (/HYBRID|PHEV/.test(dt)) return "PHEV"
  if (/ELECTRIC|BEV/.test(dt)) return "BEV"
  if (/COMBUSTION|^CO$|FUEL|ICE|DIESEL|GASOLINE|PETROL/.test(dt)) return "ICE"
  return undefined
}

function finiteNumber(value: any): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function compactObject(source: any, keys: string[]): any {
  const result: any = {}
  for (const key of keys) if (source?.[key] !== undefined && source?.[key] !== null) result[key] = source[key]
  return result
}

function compactVehicleState(state: any): any {
  const fuel = compactObject(state?.combustionFuelLevel, ["remainingFuelLiters", "remainingFuelPercent", "range"])
  const electric = compactObject(state?.electricChargingState, ["chargingLevelPercent", "range", "isChargerConnected", "chargingStatus", "chargingState", "state", "status"])
  const doors = compactObject(state?.doorsState, ["combinedSecurityState", "combinedState", "hood", "trunk", "leftFront", "rightFront", "leftRear", "rightRear"])
  const windows = compactObject(state?.windowsState, ["combinedState", "leftFront", "rightFront", "leftRear", "rightRear"])
  const roof = compactObject(state?.roofState, ["roofState"])
  const tires: any = {}
  for (const wheel of ["frontLeft", "frontRight", "rearLeft", "rearRight"]) {
    const status = compactObject(state?.tireState?.[wheel]?.status, ["currentPressure", "targetPressure"])
    if (Object.keys(status).length) tires[wheel] = { status }
  }
  const location = state?.location
  const coordinates = compactObject(location?.coordinates, ["latitude", "longitude"])
  const address = compactObject(location?.address, ["formatted"])
  const checks = Array.isArray(state?.checkControlMessages) ? state.checkControlMessages.map((item: any) => compactObject(item, ["id", "type", "name", "title", "text", "localizedText", "description", "message", "severity"])) : []
  return {
    ...(state?.pwf !== undefined ? { pwf: state.pwf } : {}),
    ...(state?.vehicleType !== undefined ? { vehicleType: state.vehicleType } : {}),
    ...(state?.currentMileage !== undefined ? { currentMileage: state.currentMileage } : {}),
    ...(state?.lastUpdatedAt !== undefined ? { lastUpdatedAt: state.lastUpdatedAt } : {}),
    combustionFuelLevel: fuel,
    electricChargingState: electric,
    doorsState: doors,
    windowsState: windows,
    roofState: roof,
    tireState: tires,
    checkControlMessages: checks,
    location: { coordinates, address, ...(location?.lastUpdatedAt !== undefined ? { lastUpdatedAt: location.lastUpdatedAt } : {}) },
  }
}

function knownState(value: any): string {
  const state = String(value || "").trim().toUpperCase()
  if (state === "OPEN") return "open"
  if (state === "CLOSED") return "closed"
  return "unknown"
}
function normalizeVehicleSnapshot(vehicle: VehicleData, profileVehicleType?: "BEV" | "PHEV" | "ICE"): VehicleSnapshot {
  const p: any = vehicle.properties || {}
  const electric = p.electricChargingState || {}
  const fuel = p.combustionFuelLevel || {}
  const type = profileVehicleType === "BEV" ? "electric" : profileVehicleType === "PHEV" ? "hybrid" : profileVehicleType === "ICE" ? "fuel" : "unknown"
  const batteryPercent = finiteNumber(electric.chargingLevelPercent)
  const fuelPercent = finiteNumber(fuel.remainingFuelPercent)
  const levelPercent = type === "electric" ? batteryPercent : type === "hybrid" ? (batteryPercent ?? fuelPercent) : fuelPercent
  const chargingStatus = String(electric.chargingStatus || electric.chargingState || electric.state || "").toUpperCase()
  const charging = electric.isChargerConnected === true || electric.isChargerConnected === "true" || ["CHARGING", "IN_PROGRESS", "ACTIVE"].includes(chargingStatus)
  const complete = ["FINISHED", "FULLY_CHARGED", "CHARGING_FULLY_CHARGED"].includes(chargingStatus)
  const doors = p.doorsState || {}
  const windows = p.windowsState || {}
  const roof = p.roofState || {}
  const rawChecks = Array.isArray(p.checkControlMessages) ? p.checkControlMessages : []
  const checks = rawChecks.filter((item: any) => ["HIGH", "HIGHEST", "CRITICAL"].includes(String(item?.severity || "").toUpperCase())).map((item: any, index: number) => ({ id: String(item?.id || item?.type || `bmw-check-${index}`), severity: "critical" as const, title: String(item?.name || item?.title || item?.message || item?.type || "车辆告警"), detail: String(item?.description || item?.message || item?.name || "") || undefined }))
  const coordinates = p.location?.coordinates
  const latitude = finiteNumber(coordinates?.latitude)
  const longitude = finiteNumber(coordinates?.longitude)
  return {
    driving: String(p.pwf || "").toUpperCase() === "DRIVING",
    energy: { type, levelPercent, fuelPercent, batteryPercent, remainingLiters: finiteNumber(fuel.remainingFuelLiters), rangeKm: finiteNumber(electric.range ?? fuel.range) },
    access: { lock: doors.combinedSecurityState === "LOCKED" ? "locked" : doors.combinedSecurityState === "UNLOCKED" ? "unlocked" : "unknown", doors: knownState(doors.combinedState), windows: knownState(windows.combinedState), roof: knownState(roof.roofState), hood: knownState(doors.hood), trunk: knownState(doors.trunk), doorStates: { leftFront: knownState(doors.leftFront), rightFront: knownState(doors.rightFront), leftRear: knownState(doors.leftRear), rightRear: knownState(doors.rightRear) }, windowStates: { leftFront: knownState(windows.leftFront), rightFront: knownState(windows.rightFront), leftRear: knownState(windows.leftRear), rightRear: knownState(windows.rightRear) } },
    checks,
    charging: electric ? { state: charging ? "charging" : complete ? "complete" : "disconnected" } : undefined,
    location: latitude !== undefined && longitude !== undefined && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude, address: p.location?.address?.formatted } : undefined,
  }
}
export class BMWClient {
  private xHeaders: CaptchaHeaders = {}
  constructor(private settings: Settings) {}

  private phone(): string {
    if (!this.settings.phone) throw new Error("请先配置手机号")
    const normalized = formatUserMobile(this.settings.phone)
    if (!normalized) throw new Error("手机号格式不正确")
    return normalized
  }

  async getNonceData(username: string, _x = 0, onProgress?: (message: string) => void): Promise<any> {
    const normalized = username.trim()
    if (!normalized || normalized.length > 128 || /[\s&#?]/.test(normalized)) {
      throw new Error("nonce 服务标识无效")
    }
    onProgress?.("阶段 5/6：正在向 BMW MINI 小助手同款 nonce 服务请求…")
    const url = `https://www.widgetc.cn/bmw/api/encryptV5?phone=${encodeURIComponent(normalized)}`
    const headers = {
      _xua: "android(29);bmw;5.11.0(48081);cn",
      _nonce: randomNonceHeader(16),
      "User-Agent": "Dart/3.2 (dart:io)",
      _av: "2.0.5",
      _sv: "17.6",
      _chl: "appstore",
      Accept: "*/*",
    }
    let response
    try {
      response = await fetchNonceResponse(url, headers)
    } catch (httpsError) {
      onProgress?.("阶段 5/6：HTTPS nonce 服务连接失败，按 BMW MINI 小助手兼容方式尝试 HTTP…")
      const httpUrl = url.replace(/^https:\/\//, "http://")
      try {
        response = await fetchNonceResponse(httpUrl, headers)
      } catch (httpError) {
        throw new Error(`nonce 服务 HTTPS/HTTP 连接均失败：${httpError instanceof Error ? httpError.message : String(httpError)}`)
      }
    }
    if (!response.ok) throw new Error(`nonce 服务 HTTP ${response.status}`)
    const raw = await response.text()
    if (raw.length > 8192) throw new Error("nonce 服务响应过大")
    let nonce = raw.trim()
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === "object" && typeof parsed.data === "string") {
        if (parsed.code !== undefined && parsed.code !== 0) {
          throw new Error(`nonce 服务拒绝请求（code=${parsed.code}）：${parsed.description || parsed.message || "无说明"}`)
        }
        nonce = parsed.data.trim()
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("nonce 服务拒绝请求")) throw error
    }
    if (!/^[0-9A-Za-z]+$/.test(nonce) || nonce.length < 64 || nonce.length > 1024) {
      throw new Error(`nonce 服务响应无效（长度 ${nonce.length}，前缀 ${nonce.slice(0, 80) || "空"}）`)
    }
    onProgress?.("阶段 5/6：nonce 服务返回有效 nonce。")
    return { code: 0, data: nonce }
  }

  private async captchaPosition(backGroundImg: string): Promise<string> {
    if (!backGroundImg || backGroundImg.length > 2_000_000) throw new Error(`验证码图片数据无效或过大（${backGroundImg?.length ?? 0} 字符）`)
    const img = UIImage.fromBase64String(backGroundImg)
    if (!img) throw new Error("Scripting 无法解码 BMW 返回的验证码图片")
    const pixels = img.getPixelData()
    if (!pixels) throw new Error("读取验证码像素失败（getPixelData 未返回数据）")
    const bytes = pixels.data.toUint8Array()
    if (!bytes) throw new Error("读取验证码 RGBA 像素失败")

    const target = [220, 230, 221]
    const tolerance = 15
    const width = pixels.width
    const height = pixels.height
    let bestX = -1
    let bestScore = 0

    // 原实现逐像素验证 15×75 色块，最坏会执行数千万次比较并冻结 JS 主线程。
    // 改为按列、隔行采样，寻找与目标颜色连续匹配最多的位置。
    for (let x = 0; x < width; x += 2) {
      let score = 0
      for (let y = 0; y < height; y += 3) {
        const idx = (y * width + x) * 4
        if (
          Math.abs(bytes[idx] - target[0]) <= tolerance &&
          Math.abs(bytes[idx + 1] - target[1]) <= tolerance &&
          Math.abs(bytes[idx + 2] - target[2]) <= tolerance
        ) score++
      }
      if (score > bestScore) {
        bestScore = score
        bestX = x
      }
      if (x > 0 && x % 80 === 0) {
        await new Promise<void>(resolve => setTimeout(resolve, 0))
      }
    }

    const minimumScore = Math.max(8, Math.floor(height / 18))
    if (bestX >= 0 && bestScore >= minimumScore) {
      return Math.max(0, Math.min(1, (bestX - 26) / width)).toFixed(2)
    }
    return "0.50"
  }

  async getSliderCaptcha(phone = this.phone(), retry = 0, onProgress?: (message: string) => void): Promise<string> {
    const mobile = formatUserMobile(phone)
    const candidates = ["x", "0", "1"]
    let captcha: any = null
    let lastError = ""
    for (let i = 0; i < candidates.length; i++) {
      onProgress?.(`阶段 1/6：正在向 BMW 创建滑块验证（参数尝试 ${i + 1}/${candidates.length}）…`)
      let uuid = uuidv4()
      let x = (candidates[i] + md5Hex(uuidv4()) + md5Hex(uuidv4())).slice(0, 64)
      if (i === 0 && retry === 0) { uuid = DEFAULT_X_CORRELATION_ID; x = DEFAULT_X }
      this.xHeaders = { "x-correlation-id": uuid, "bmw-correlation-id": uuid, x }
      let res: any
      try {
        res = await withTimeout(requestJSON(`${BMW_SERVER_HOST}/eadrax-coas/v2/cop/create-captcha`, {
          method: "POST",
          headers: appHeaders(this.xHeaders),
          body: JSON.stringify({ mobile, brand: "BMW" }),
        }), 18000, `创建滑块验证（${i + 1}/${candidates.length}）`)
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        onProgress?.(`阶段 1/6：创建滑块请求失败（${i + 1}/${candidates.length}）：${lastError}`)
        if (/(?:489|498).*blocked|blocked.*(?:489|498)/i.test(lastError)) {
          const status = lastError.match(/(?:489|498)/)?.[0] ?? "489/498"
          throw new Error(`BMW 创建验证码接口返回 HTTP ${status} Blocked。服务器在返回验证码图片前拒绝了请求；已停止后续候选重试。这不是图片解码或 nonce 错误。请先确认官方 App 可正常登录，并尝试不经过代理/过滤的网络；若官方 App 正常但此接口仍拒绝，需 BMW 服务端解释该拦截。`)
        }
        continue
      }
      if (res?.code === 200 && res?.data?.verifyId && res?.data?.backGroundImg) {
        onProgress?.(`阶段 1/6：BMW 已返回图片验证（图片数据 ${res.data.backGroundImg.length} 字符），正在解码…`)
        captcha = res
        keySave(KEYS.correlation, uuid)
        keySave(KEYS.x, x)
        break
      }
      lastError = `BMW code=${res?.code ?? "无"}：${res?.description || res?.message || JSON.stringify(res).slice(0, 160)}`
      onProgress?.(`阶段 1/6：BMW 拒绝创建滑块（${i + 1}/${candidates.length}）：${lastError}`)
      if (Number(res?.code) === 498 || /blocked/i.test(String(res?.description || res?.message || ""))) {
        throw new Error(`BMW 拒绝创建验证码（498 blocked）。这是 BMW 服务端的拦截响应，已停止继续重试，避免重复请求加重限制。请稍后再试，或通过官方 My BMW App 完成验证；这不是图片解码或 nonce 阶段的问题。`)
      }
    }
    if (!captcha?.data?.verifyId) throw new Error(`无法创建滑块验证：${lastError || "BMW 接口未返回验证码"}`)
    onProgress?.("阶段 2/6：图片已收到，开始解码并识别滑块位置…")
    let position: string
    try {
      position = await withTimeout(this.captchaPosition(captcha.data.backGroundImg), 12000, "读取并识别滑块图片")
    } catch (error) {
      throw new Error(`阶段 2/6 图片处理失败：${error instanceof Error ? error.message : String(error)}`)
    }
    onProgress?.(`阶段 3/6：图片分析完成（位置 ${position}），正在请求 BMW 校验…`)
    const checked = await withTimeout(requestJSON(`${BMW_SERVER_HOST}/eadrax-coas/v2/cop/verify-captcha`, {
      method: "POST",
      headers: appHeaders(this.xHeaders),
      body: JSON.stringify({ position, verifyId: captcha.data.verifyId, mobile }),
    }), 18000, "提交滑块校验")
    if (checked?.code === 200) {
      onProgress?.("阶段 3/6：滑块校验通过。")
      return captcha.data.verifyId
    }
    onProgress?.(`阶段 3/6：滑块校验未通过（code=${checked?.code ?? "无"}，${checked?.description || checked?.message || "无错误说明"}）`)
    if (retry < 1) return await this.getSliderCaptcha(mobile, retry + 1, onProgress)
    throw new Error(`滑块验证码校验失败：${checked?.description || checked?.message || checked?.code}`)
  }

  async sendLoginSMS(onProgress?: (message: string) => void): Promise<string> {
    const phone = this.phone()
    const verifyId = await this.getSliderCaptcha(phone, 0, onProgress)
    onProgress?.("短信验证阶段：滑块已通过，正在请求发送短信…")
    const res = await withTimeout(requestJSON(`${BMW_SERVER_HOST}/eadrax-coas/v1/cop/message`, {
      method: "POST",
      headers: appHeaders(),
      body: JSON.stringify({ mobile: phone, deviceId: md5Hex(phone.slice(0, 16)), verifyId }),
    }), 18000, "请求发送登录短信")
    if (res?.code !== 200 || !res?.data?.otpID) throw new Error(`发送短信失败（code=${res?.code ?? "无"}）：${res?.description || res?.message || "接口未返回 otpID"}`)
    return res.data.otpID
  }

  async loginBySMS(otpId: string, code: string): Promise<void> {
    const phone = this.phone()
    const nonce = await this.getNonceData(phone)
    if (!nonce || nonce.code !== 0 || !nonce.data) throw new Error("获取 nonce 失败")
    const res = await requestJSON(`${BMW_SERVER_HOST}/eadrax-coas/v2/login/sms`, {
      method: "POST",
      headers: appHeaders({ "x-login-nonce": nonce.data, ...this.xHeaders }),
      body: JSON.stringify({ mobile: phone, otpId, otpMsg: Number(code).toString() }),
    })
    if (res?.code !== 200 || !res?.data?.refresh_token) throw new Error(res?.description || "登录失败")
    keySave(KEYS.refreshToken, res.data.refresh_token)
    keySave(KEYS.refreshGcid, res.data.gcid)
    keyRemove(KEYS.accessToken)
    await this.getData(true)
  }

  async getEncryptedPassword(password: string): Promise<string> {
    const keyRes = await requestJSON(`${BMW_SERVER_HOST}/eadrax-coas/v1/cop/publickey`, {
      method: "GET",
      headers: appHeaders(),
    })
    if (keyRes?.code !== 200 || !keyRes?.data?.value) throw new Error(`获取 BMW 密码公钥失败（code=${keyRes?.code ?? "无"}）：${keyRes?.description || keyRes?.message || "响应缺少公钥"}`)

    let librarySource = ""
    try {
      librarySource = await requestText("https://cdn.jsdelivr.net/npm/jsencrypt@3.3.2/bin/jsencrypt.min.js")
    } catch (error) {
      throw new Error(`下载密码加密组件失败：${error instanceof Error ? error.message : String(error)}`)
    }
    if (!librarySource || !librarySource.includes("JSEncrypt")) throw new Error("密码加密组件内容无效")

    const publicKey = keyRes.data.value
    const webView = new WebViewController({ ephemeral: true })
    try {
      const loaded = await withTimeout(
        webView.loadHTML(`<!doctype html><meta charset="utf-8"><script>${librarySource.replace(/<\/script/gi, "<\\/script")}</script>`),
        5000,
        "初始化密码加密组件",
      )
      if (!loaded) throw new Error("初始化密码加密组件失败")
      const encrypted = await withTimeout(
        webView.evaluateJavaScript<string>(`
          if (typeof JSEncrypt === 'undefined') throw new Error('JSEncrypt 加密组件初始化失败');
          const encrypt = new JSEncrypt();
          encrypt.setPublicKey(${JSON.stringify(publicKey)});
          const result = encrypt.encrypt(${JSON.stringify(password)});
          if (!result) throw new Error('RSA 密码加密失败');
          return result;
        `),
        5000,
        "RSA 密码加密",
      )
      if (!encrypted) throw new Error("密码加密失败")
      return encrypted
    } finally {
      webView.dispose()
    }
  }

  async loginByPassword(password: string, refreshData = true, onProgress?: (message: string) => void): Promise<void> {
    const phone = this.phone()
    if (!password) throw new Error("请输入密码")
    const verifyId = await this.getSliderCaptcha(phone, 0, onProgress)
    onProgress?.("阶段 4/6：滑块已通过，正在获取 BMW 密码公钥…")
    const encryptedPassword = await this.getEncryptedPassword(password)
    onProgress?.("阶段 5/6：密码加密完成，开始获取登录 nonce…")
    const nonceResponse = await this.getNonceData(phone, 0, onProgress)
    if (!nonceResponse || nonceResponse.code !== 0 || !nonceResponse.data) throw new Error(`获取登录验证值失败：${nonceResponse?.message || nonceResponse?.description || nonceResponse?.code || "响应缺少 data"}`)
    onProgress?.("阶段 6/6：nonce 已获取，正在提交 BMW 密码登录请求…")
    const res = await requestJSON(`${BMW_SERVER_HOST}/eadrax-coas/v2/login/pwd`, {
      method: "POST",
      headers: appHeaders({ "x-login-nonce": nonceResponse.data, ...this.xHeaders }),
      body: JSON.stringify({
        mobile: phone,
        password: encryptedPassword,
        verifyId,
        deviceId: md5Hex(phone),
      }),
    })
    if (res?.code !== 200 || !res?.data?.refresh_token) throw new Error(res?.description || "请检查密码是否正确")
    keySave(KEYS.username, phone)
    keySave(KEYS.password, password)
    keySave(KEYS.refreshToken, res.data.refresh_token)
    keySave(KEYS.refreshGcid, res.data.gcid)
    keyRemove(KEYS.accessToken)
    keyRemove(KEYS.tokenUpdatedAt)
    if (refreshData) {
      onProgress?.("密码登录成功，正在加载车辆数据…")
      await this.getData(true)
    }
  }

  async getAccessToken(force = false): Promise<string> {
    const cached = keyGet(KEYS.accessToken)
    const updatedAt = Number(keyGet(KEYS.tokenUpdatedAt) || 0)
    if (!force && cached && updatedAt > nowSeconds() - 50 * 60) return cached

    const refresh = keyGet(KEYS.refreshToken)
    if (refresh) {
      try {
        return await this.refreshToken(refresh)
      } catch {
        keyRemove(KEYS.accessToken)
        keyRemove(KEYS.refreshToken)
        keyRemove(KEYS.refreshGcid)
        keyRemove(KEYS.tokenUpdatedAt)
      }
    }

    const username = keyGet(KEYS.username)
    const password = keyGet(KEYS.password)
    if (!username || !password) {
      throw new Error("Refresh Token 已失效，且没有保存可用于自动登录的账号密码")
    }

    this.settings.phone = username
    await this.loginByPassword(password, false)
    const renewedRefreshToken = keyGet(KEYS.refreshToken)
    if (!renewedRefreshToken) throw new Error("自动重新登录后未获得 Refresh Token")
    return await this.refreshToken(renewedRefreshToken)
  }

  async refreshToken(refreshToken: string): Promise<string> {
    const gcid = keyGet(KEYS.refreshGcid) || ""
    const nonce = await this.getNonceData(gcid)
    this.xHeaders = {
      "x-correlation-id": keyGet(KEYS.correlation) || DEFAULT_X_CORRELATION_ID,
      "bmw-correlation-id": keyGet(KEYS.correlation) || DEFAULT_X_CORRELATION_ID,
      x: keyGet(KEYS.x) || DEFAULT_X,
    }
    const res = await requestJSON(`${BMW_SERVER_HOST}/eadrax-coas/v2/oauth/token`, {
      method: "POST",
      headers: appHeaders({ "x-login-nonce": nonce.data, ...this.xHeaders }),
      body: `grant_type=refresh_token&refresh_token=${refreshToken}`,
    })
    if (!res?.access_token) throw new Error("刷新 access token 失败，请重新登录")
    keySave(KEYS.accessToken, res.access_token)
    if (res.refresh_token) keySave(KEYS.refreshToken, res.refresh_token)
    if (res.gcid) keySave(KEYS.refreshGcid, res.gcid)
    keySave(KEYS.tokenUpdatedAt, nowSeconds())
    return res.access_token
  }

  async getVehicleList(accessToken: string, force = false): Promise<VehicleData[]> {
    const cacheTime = Number(keyGet(KEYS.vehicleListTime) || 0)
    let res: any
    if (!force && nowSeconds() - cacheTime < 10 * 60 && keyGet(KEYS.vehicleList)) {
      res = JSON.parse(keyGet(KEYS.vehicleList)!)
    } else {
      res = await requestJSON(`${BMW_SERVER_HOST}/eadrax-vcs/v5/vehicle-list?`, {
        method: "POST",
        headers: appHeaders({ authorization: `Bearer ${accessToken}` }),
        body: JSON.stringify({}),
      })
    }
    const list = Array.isArray(res?.mappingInfos) ? res.mappingInfos.map((i: any) => i.cnData).filter(Boolean) : []
    if (list.length) {
      keySave(KEYS.vehicleListTime, nowSeconds())
      keySave(KEYS.vehicleList, JSON.stringify(res))
    }
    return list
  }

  async fetchVehicleProfile(accessToken: string, vin: string): Promise<any | null> {
    try {
      return await requestJSON(`${BMW_SERVER_HOST}/eadrax-vcs/v5/vehicle-data/profile`, {
        method: "GET",
        headers: appHeaders({
          authorization: `Bearer ${accessToken}`,
          "bmw-vin": vin,
        }),
      })
    } catch {
      return null
    }
  }
  async getVehicleDetails(accessToken: string, force = false): Promise<VehicleData | null> {
    try {
      const vehicles = await this.getVehicleList(accessToken, force)
      if (!vehicles.length) throw new Error("账号下没有车辆")
      let vehicle = vehicles.find(v => v.vin?.toUpperCase() === this.settings.vin?.toUpperCase()) || vehicles[0]
      if (!this.settings.vin && vehicle.vin) this.settings.vin = vehicle.vin
      const stateText = await requestText(`${BMW_SERVER_HOST}/eadrax-vcs/v4/vehicles/state`, {
        headers: appHeaders({ authorization: `Bearer ${accessToken}`, "bmw-vin": vehicle.vin }),
      })
      if (!stateText.includes("not found")) {
        const state = JSON.parse(stateText)
        vehicle.properties = compactVehicleState(state?.state || {})
        keySave(KEYS.tiresData, JSON.stringify(vehicle.properties))
      } else if (keyGet(KEYS.tiresData)) {
        vehicle.properties = compactVehicleState(JSON.parse(keyGet(KEYS.tiresData)!))
      } else vehicle.properties = {}
             const profile = await this.fetchVehicleProfile(accessToken, vehicle.vin)
       const profileVehicleType = vehicleTypeFromProfile(profile)
       
       if (profileVehicleType) vehicle.properties.vehicleType = profileVehicleType
       const sustainability = await this.sustainability(accessToken, vehicle.vin)
       vehicle.properties.averageConsumption = sustainability.averageConsumption
       vehicle.snapshot = normalizeVehicleSnapshot(vehicle, profileVehicleType)
       
      keySave(KEYS.vehicleUpdatedAt, nowSeconds())
      keySave(KEYS.vehicleData, JSON.stringify(vehicle))
      return vehicle
    } catch (e) {
      const cached = keyGet(KEYS.vehicleData)
      if (cached) return JSON.parse(cached)
      throw e
    }
  }

  async getData(force = false, forceToken = force): Promise<VehicleData | null> {
    const access = await this.getAccessToken(forceToken)
    return await this.getVehicleDetails(access, force)
  }

  async sustainability(accessToken: string, vin: string): Promise<{ averageConsumption: [string, string] }> {
    const cached = keyGet(KEYS.sustainability)
    if (nowSeconds() - Number(keyGet(KEYS.sustainabilityTime) || 0) < 60 && cached) {
      try {
        const parsed = JSON.parse(cached)
        if (Array.isArray(parsed)) return { averageConsumption: parsed as [string, string] }
        if (Array.isArray(parsed?.averageConsumption)) return { averageConsumption: parsed.averageConsumption as [string, string] }
      } catch {}
    }
    const gcid = keyGet(KEYS.refreshGcid) || ""
    const res = await requestJSON(`${BMW_SERVER_HOST}/eadrax-suscs/v1/vehicles/sustainability`, {
      headers: appHeaders({ authorization: `Bearer ${accessToken}`, "bmw-vin": vin, "x-gcid": gcid }),
    })
    let averageConsumption: [string, string] = ["油耗", ""]
    if (res?.status === "Success") {
      if (res.widget?.monthly?.totalElectricConsumption) {
        const last = Number(res.widget.lastTrip.electricConsumption.averageConsumption)
        const month = Number(res.widget.monthly.totalElectricConsumption.averageConsumption)
        averageConsumption = ["电耗", `${last.toFixed(1)}${this.settings.showTireFuelTrend ? trend(last - month) : ""}`]
      } else if (res.widget?.monthly?.totalCombustionConsumption) {
        const last = Number(res.widget.lastTrip.fuelConsumption.averageConsumption)
        const month = Number(res.widget.monthly.totalCombustionConsumption.averageConsumption)
        averageConsumption = ["油耗", `${last.toFixed(1)}${this.settings.showTireFuelTrend ? trend(last - month) : ""}`]
      }
      keySave(KEYS.sustainabilityTime, nowSeconds())
      keySave(KEYS.sustainability, JSON.stringify({ averageConsumption }))
      return { averageConsumption }
    }
    return { averageConsumption }
  }

}

function trend(v: number): string { return v > 0 ? "↑" : v < 0 ? "↓" : "↔" }
