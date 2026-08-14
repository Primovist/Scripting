import {
  BMW_HEADERS,
  BMW_SERVER_HOST,
  DEFAULT_X,
  DEFAULT_X_CORRELATION_ID,
  KEYS,
  REMOTE_ROOT,
  type Settings,
  type VehicleData,
} from "./constants"
import { formatDate, formatUserMobile, keyGet, keyRemove, keySave, md5Hex, nowSeconds, notify, requestJSON, requestText, today, uuidv4 } from "./storage"

type CaptchaHeaders = Record<string, string>

function appHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...BMW_HEADERS, ...extra }
}

function findJoyCoin(value: any, depth = 0): any {
  if (value === null || value === undefined || depth > 8) return undefined
  if (typeof value === "string") {
    const text = value.trim()
    if (text.startsWith("{") || text.startsWith("[")) {
      try { return findJoyCoin(JSON.parse(text), depth + 1) } catch { return undefined }
    }
    return text !== "" && Number.isFinite(Number(text)) ? text : undefined
  }
  if (typeof value !== "object") return undefined
  for (const key of ["joyCoin", "joycoin", "joy_coin", "joyCoinNum", "totalJoyCoin", "joyCoinCount"]) {
    if (value[key] !== undefined && value[key] !== null && (typeof value[key] === "number" || typeof value[key] === "string")) return value[key]
  }
  for (const key of Object.keys(value)) {
    const found = findJoyCoin(value[key], depth + 1)
    if (found !== undefined) return found
  }
  return undefined
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

  getSignature(username: string): string {
    // 原 Scriptable 文件中 getSignature 是 jsjiami 混淆代码；核心逻辑是用手机号、时间因子、x-user-agent build 号生成 nonce 服务器参数 k。
    const match = BMW_HEADERS["x-user-agent"].match(/^.+?;.*?;(.+?)\((.+?)\).+$/)
    const build = Number(match?.[2] || 0)
    const phoneDigits = Array.from(username).filter(c => !Number.isNaN(Number(c))).join("")
    const seed = phoneDigits.slice(0, 13)
    // 注意：原脚本的混淆签名实际使用 getCurrentTimeStamp()/1000；
    // getCurrentTimeStamp() 已经是秒级时间戳，所以这里必须再除以 1000，否则远程 nonce 服务会返回 noSignature。
    const mixed = (Number(seed) + Math.floor(nowSeconds() / 1000) + build).toString(36)
    const reversed = Array.from(mixed).reverse().join("")
    const charCodes = Array.from(reversed).map(c => c.charCodeAt(0).toString(10)).join("")
    const diffs = Array.from(charCodes).map((c, i) => Math.abs(Number(c) - i).toString(10)).join("")
    const picked = Array.from(seed).map(d => diffs[Number(d)] || "0").join("")
    return Number(picked || "0").toString(36)
  }

  async getNonceData(username: string, x = 0): Promise<any> {
    const k = this.getSignature(username || "1381234567890")
    return await requestJSON(`${REMOTE_ROOT}/bmwNonceV5.php?phone=${encodeURIComponent(username)}&k=${k}&x=${x}`, {
      headers: {
        xua: BMW_HEADERS["x-user-agent"],
        fkthiefcopy: "Plagiarism/Copying/Server Runaway Interface Deadly Family",
        author: "MeiDaiSan",
      },
    })
  }

  private async captchaPosition(backGroundImg: string): Promise<string> {
    const img = UIImage.fromBase64String(backGroundImg)
    const pixels = img?.getPixelData()
    if (!pixels) return "0.50"
    const bytes = pixels.data.toUint8Array()
    if (!bytes) return "0.50"
    const target = [220, 230, 221]
    const tolerance = 15
    const block = { width: 15, height: 75 }
    for (let y = 0; y < pixels.height - block.height; y++) {
      for (let x = 0; x < pixels.width - block.width; x++) {
        let ok = true
        for (let i = 0; i < block.height && ok; i++) {
          for (let j = 0; j < block.width; j++) {
            const idx = ((y + i) * pixels.width + (x + j)) * 4
            if (
              Math.abs(bytes[idx] - target[0]) > tolerance ||
              Math.abs(bytes[idx + 1] - target[1]) > tolerance ||
              Math.abs(bytes[idx + 2] - target[2]) > tolerance
            ) { ok = false; break }
          }
        }
        if (ok) return ((x - 26) / pixels.width).toFixed(2)
      }
    }
    return "0.50"
  }

  async getSliderCaptcha(phone = this.phone(), retry = 0): Promise<string> {
    const mobile = formatUserMobile(phone)
    const candidates = ["x", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"]
    let captcha: any = null
    let lastError = ""
    for (let i = 0; i < candidates.length; i++) {
      let uuid = uuidv4()
      let x = (candidates[i] + md5Hex(uuidv4()) + md5Hex(uuidv4())).slice(0, 64)
      if (i === 0 && retry === 0) { uuid = DEFAULT_X_CORRELATION_ID; x = DEFAULT_X }
      this.xHeaders = { "x-correlation-id": uuid, "bmw-correlation-id": uuid, x }
      const res = await requestJSON(`${BMW_SERVER_HOST}/eadrax-coas/v2/cop/create-captcha`, {
        method: "POST",
        headers: appHeaders(this.xHeaders),
        body: JSON.stringify({ mobile, brand: "BMW" }),
      })
      if (res?.code === 200 && res?.data?.verifyId && res?.data?.backGroundImg) {
        captcha = res
        keySave(KEYS.correlation, uuid)
        keySave(KEYS.x, x)
        break
      }
      lastError = res?.description || res?.message || JSON.stringify(res).slice(0, 160)
    }
    if (!captcha?.data?.verifyId) throw new Error(`无法创建滑块验证：${lastError || "BMW 接口未返回验证码"}`)
    const position = await this.captchaPosition(captcha.data.backGroundImg)
    const checked = await requestJSON(`${BMW_SERVER_HOST}/eadrax-coas/v2/cop/verify-captcha`, {
      method: "POST",
      headers: appHeaders(this.xHeaders),
      body: JSON.stringify({ position, verifyId: captcha.data.verifyId, mobile }),
    })
    if (checked?.code === 200) return captcha.data.verifyId
    if (retry < 2) return await this.getSliderCaptcha(mobile, retry + 1)
    throw new Error(`滑块验证码校验失败：${checked?.description || checked?.message || checked?.code}`)
  }

  async sendLoginSMS(): Promise<string> {
    const phone = this.phone()
    const verifyId = await this.getSliderCaptcha(phone)
    const res = await requestJSON(`${BMW_SERVER_HOST}/eadrax-coas/v1/cop/message`, {
      method: "POST",
      headers: appHeaders(),
      body: JSON.stringify({ mobile: phone, deviceId: md5Hex(phone.slice(0, 16)), verifyId }),
    })
    if (res?.code !== 200 || !res?.data?.otpID) throw new Error(res?.description || "发送短信失败")
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
    if (keyRes?.code !== 200 || !keyRes?.data?.value) throw new Error(keyRes?.description || "获取密码加密公钥失败")
    const publicKey = keyRes.data.value
    const webView = new WebViewController({ ephemeral: true })
    try {
      await webView.loadHTML(`<!doctype html><meta name="viewport" content="width=device-width"><script src="https://cdn.jsdelivr.net/npm/jsencrypt@3.3.2/bin/jsencrypt.min.js"></script>`)
      for (let i = 0; i < 30; i++) {
        const ready = await webView.evaluateJavaScript<boolean>("return typeof JSEncrypt !== 'undefined'")
        if (ready) break
        await new Promise<void>(resolve => setTimeout(() => resolve(), 100))
      }
      const encrypted = await webView.evaluateJavaScript<string>(`
        if (typeof JSEncrypt === 'undefined') throw new Error('JSEncrypt 加密库加载失败');
        const encrypt = new JSEncrypt();
        encrypt.setPublicKey(${JSON.stringify(publicKey)});
        return encrypt.encrypt(${JSON.stringify(password)});
      `)
      if (!encrypted) throw new Error("密码加密失败")
      return encrypted
    } finally {
      webView.dispose()
    }
  }

  async loginByPassword(password: string): Promise<void> {
    const phone = this.phone()
    if (!password) throw new Error("请输入密码")
    const verifyId = await this.getSliderCaptcha(phone)
    const encryptedPassword = await this.getEncryptedPassword(password)
    const nonce = await this.getNonceData(phone)
    if (!nonce || nonce.code !== 0 || !nonce.data) throw new Error("获取 nonce 失败")
    const res = await requestJSON(`${BMW_SERVER_HOST}/eadrax-coas/v2/login/pwd`, {
      method: "POST",
      headers: appHeaders({ "x-login-nonce": nonce.data, ...this.xHeaders }),
      body: JSON.stringify({
        mobile: phone,
        password: encryptedPassword,
        verifyId,
        deviceId: md5Hex(phone),
      }),
    })
    if (res?.code !== 200 || !res?.data?.refresh_token) throw new Error(res?.description || "请检查密码是否正确")
    keySave(KEYS.refreshToken, res.data.refresh_token)
    keySave(KEYS.refreshGcid, res.data.gcid)
    keyRemove(KEYS.accessToken)
    await this.getData(true)
  }

  async getAccessToken(force = false): Promise<string> {
    const cached = keyGet(KEYS.accessToken)
    const updatedAt = Number(keyGet(KEYS.tokenUpdatedAt) || 0)
    if (!force && cached && updatedAt > nowSeconds() - 50 * 60) return cached
    const refresh = keyGet(KEYS.refreshToken)
    if (!refresh) throw new Error("未登录或 refresh token 缺失")
    return await this.refreshToken(refresh)
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
    keySave(KEYS.refreshToken, res.refresh_token)
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
        vehicle.properties = state?.state || {}
        keySave(KEYS.tiresData, JSON.stringify(vehicle.properties))
      } else if (keyGet(KEYS.tiresData)) {
        vehicle.properties = JSON.parse(keyGet(KEYS.tiresData)!)
      } else vehicle.properties = {}
      vehicle.properties.averageConsumption = await this.sustainability(accessToken, vehicle.vin)
      keySave(KEYS.vehicleUpdatedAt, nowSeconds())
      keySave(KEYS.vehicleData, JSON.stringify(vehicle))
      return vehicle
    } catch (e) {
      const cached = keyGet(KEYS.vehicleData)
      if (cached) return JSON.parse(cached)
      throw e
    }
  }

  async getData(force = false): Promise<VehicleData | null> {
    const access = await this.getAccessToken(force)
    if (this.settings.signIn) this.checkInDaily(access).catch(() => {})
    return await this.getVehicleDetails(access, force)
  }

  // 独立查询 JOY 数量用于展示；失败只保留缓存，不影响车辆数据刷新。
  async refreshJoyCoinForDisplay(force = false): Promise<string> {
    let lastError: any = null
    try {
      const access = await this.getAccessToken(force)
      const joy = await this.getJoyCoinInfo(access, false, false)
      if (joy !== null && joy !== "") return joy
    } catch (e) { lastError = e }
    try {
      const access = await this.getAccessToken(true)
      const joy = await this.getJoyCoinInfo(access, false, false)
      if (joy !== null && joy !== "") return joy
    } catch (e) { lastError = e }
    const cached = keyGet(KEYS.lastJoyCoin)
    if (cached !== null && cached !== "") return cached
    throw lastError || new Error("JOY 数量为空")
  }

  async checkInDaily(accessToken: string) {
    if (keyGet(KEYS.lastCheckIn) === today()) return
    const res = await requestJSON(`${BMW_SERVER_HOST}/cis/eadrax-community/private-api/v4/mine/check-in`, {
      method: "POST",
      headers: appHeaders({ authorization: `Bearer ${accessToken}` }),
      body: JSON.stringify({ verificationId: null, verificationCode: null }),
    })
    if (Number(res?.code) === 200) keySave(KEYS.lastCheckIn, today())
    else await notify("My BMW 签到", res?.message || "签到失败", this.settings.notify)
  }

  async getJoyCoinInfo(accessToken: string, doNotify = false, cache = false): Promise<string | null> {
    if (cache && nowSeconds() - Number(keyGet(KEYS.joyCoinInfoTime) || 0) < 300 && keyGet(KEYS.lastJoyCoin) !== null) return keyGet(KEYS.lastJoyCoin)
    const res = await requestJSON(`${BMW_SERVER_HOST}/cis/eadrax-membership/api/v3/joy-list`, {
      method: "POST",
      headers: appHeaders({ authorization: `Bearer ${accessToken}` }),
      body: JSON.stringify({}),
    })
    const rawData = res?.data
    const data = typeof rawData === "string" ? (() => { try { return JSON.parse(rawData) } catch { return rawData } })() : rawData
    const joy = findJoyCoin(data) ?? findJoyCoin(res)
    if (String(res?.code) === "200" && joy !== undefined && joy !== null) {
      const joyText = String(joy)
      keySave(KEYS.lastJoyCoin, joyText)
      keySave(KEYS.joyCoinInfoTime, nowSeconds())
      if (doNotify) await notify("My BMW JOY", `当前共${joyText || 0} JOY币`, this.settings.notify)
      return joyText
    }
    throw new Error(res?.message || res?.description || `JOY 接口返回异常(code=${res?.code ?? "unknown"})`)
  }

  async sustainability(accessToken: string, vin: string): Promise<[string, string]> {
    if (nowSeconds() - Number(keyGet(KEYS.sustainabilityTime) || 0) < 60 && keyGet(KEYS.sustainability)) {
      return JSON.parse(keyGet(KEYS.sustainability)!)
    }
    const gcid = keyGet(KEYS.refreshGcid) || ""
    const res = await requestJSON(`${BMW_SERVER_HOST}/eadrax-suscs/v1/vehicles/sustainability`, {
      headers: appHeaders({ authorization: `Bearer ${accessToken}`, "bmw-vin": vin, "x-gcid": gcid }),
    })
    let ret: [string, string] = ["油耗", ""]
    if (res?.status === "Success") {
      if (res.widget?.monthly?.totalElectricConsumption) {
        const last = Number(res.widget.lastTrip.electricConsumption.averageConsumption)
        const month = Number(res.widget.monthly.totalElectricConsumption.averageConsumption)
        ret = ["电耗", `${last.toFixed(1)}${this.settings.showTireFuelTrend ? trend(last - month) : ""}`]
      } else if (res.widget?.monthly?.totalCombustionConsumption) {
        const last = Number(res.widget.lastTrip.fuelConsumption.averageConsumption)
        const month = Number(res.widget.monthly.totalCombustionConsumption.averageConsumption)
        ret = ["油耗", `${last.toFixed(1)}${this.settings.showTireFuelTrend ? trend(last - month) : ""}`]
      }
      keySave(KEYS.sustainabilityTime, nowSeconds())
      keySave(KEYS.sustainability, JSON.stringify(ret))
    }
    return ret
  }

  async queryCoupons(accessToken: string): Promise<any> {
    return await requestJSON(`${BMW_SERVER_HOST}/cis/eadrax-membership-m2/m2/api/equity/v2/listWithGroupSort`, {
      method: "POST",
      headers: appHeaders({ authorization: `Bearer ${accessToken}` }),
    })
  }

  async receiveFirstCoupon(): Promise<string> {
    const access = await this.getAccessToken()
    const list = await this.queryCoupons(access)
    const item = list?.data?.list?.find((x: any) => x.customerEquityId != null && x.receiveStatus === 2)
    if (!item) return "暂无可领取礼券"
    const detail = await requestJSON(`${BMW_SERVER_HOST}/cis/eadrax-active-luckin-bff/membership/api/v2/membership-my-benifit-detail`, {
      method: "POST",
      headers: appHeaders({ authorization: `Bearer ${access}` }),
      body: JSON.stringify({ customerEquityId: `${item.customerEquityId}` }),
    })
    const voucherId = detail?.data?.equityVouchers?.[0]?.voucherId
    if (!voucherId) return "礼券详情异常"
    const res = await requestJSON(`${BMW_SERVER_HOST}/cis/eadrax-active-luckin-bff/loyalty-coupon/api/v2/receive`, {
      method: "POST",
      headers: appHeaders({ authorization: `Bearer ${access}` }),
      body: JSON.stringify({ voucherId: `${voucherId}`, vin: "", equityId: `${detail.data.equityId || ""}` }),
    })
    return res?.message || (res?.code === 200 ? "领取完成" : "领取失败")
  }
}

function trend(v: number): string { return v > 0 ? "↑" : v < 0 ? "↓" : "↔" }
