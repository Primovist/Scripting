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

  private async bmwNonceString(phone: string): Promise<string> {
    let cryptoSource = ""
    try {
      cryptoSource = await requestText("https://cdn.jsdelivr.net/npm/crypto-js@4.2.0/crypto-js.js", { timeout: 12 })
    } catch (error) {
      throw new Error(`下载 AES 加密组件失败：${error instanceof Error ? error.message : String(error)}`)
    }
    if (!cryptoSource || !cryptoSource.includes("CryptoJS")) throw new Error("AES 加密组件内容无效")

    const webView = new WebViewController({ ephemeral: true })
    try {
      const loaded = await withTimeout(webView.loadHTML(
        `<!doctype html><meta charset="utf-8"><script>${cryptoSource.replace(/<\/script/gi, "<\\/script")}</script>`,
      ), 5000, "初始化 AES nonce")
      if (!loaded) throw new Error("AES nonce 页面初始化失败")
      const encrypted = await withTimeout(webView.evaluateJavaScript<string>(`
        if (typeof CryptoJS === "undefined") throw new Error("CryptoJS 初始化失败");
        const key = CryptoJS.enc.Utf8.parse("Bimmer2021888666");
        const iv = CryptoJS.enc.Hex.parse("00000000000000000000000000000000");
        return CryptoJS.AES.encrypt(${JSON.stringify(phone)}, key, {
          iv,
          mode: CryptoJS.mode.CBC,
          padding: CryptoJS.pad.Pkcs7
        }).toString();
      `), 5000, "生成 AES nonce")
      if (typeof encrypted !== "string" || !encrypted.length) throw new Error("AES nonce 结果为空")
      return encrypted
    } finally {
      webView.dispose()
    }
  }

  async getNonceData(username: string, _x = 0, onProgress?: (message: string) => void): Promise<any> {
    onProgress?.("正在本地生成 nonce 请求签名…")
    const requestProof = await this.bmwNonceString(username)
    onProgress?.("正在请求登录验证服务…")
    return await withTimeout(requestJSON(`https://www.widgetc.cn/bmw/api/encryptV5?phone=${encodeURIComponent(username)}`, {
      timeout: 12,
      headers: {
        _xua: BMW_HEADERS["x-user-agent"],
        _sv: "27.0",
        accept: "*/*",
        _chl: "appstore",
        "accept-language": "zh-CN,zh-Hans;q=0.9",
        _nonce: requestProof,
        "user-agent": "Bimmer/2000501 CFNetwork/3896.100.1.2.1 Darwin/27.0.0",
        phm: "iPhone18,1(27.0)",
        _av: "2.0.5",
      },
    }), 15000, "请求登录验证服务")
  }

  private async captchaPosition(backGroundImg: string): Promise<string> {
    const img = UIImage.fromBase64String(backGroundImg)
    const pixels = img?.getPixelData()
    if (!pixels) return "0.50"
    const bytes = pixels.data.toUint8Array()
    if (!bytes) return "0.50"

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
      onProgress?.(`正在创建滑块验证（${i + 1}/${candidates.length}）…`)
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
    onProgress?.("正在识别并校验滑块验证码…")
    const position = await this.captchaPosition(captcha.data.backGroundImg)
    const checked = await requestJSON(`${BMW_SERVER_HOST}/eadrax-coas/v2/cop/verify-captcha`, {
      method: "POST",
      headers: appHeaders(this.xHeaders),
      body: JSON.stringify({ position, verifyId: captcha.data.verifyId, mobile }),
    })
    if (checked?.code === 200) return captcha.data.verifyId
    if (retry < 1) return await this.getSliderCaptcha(mobile, retry + 1, onProgress)
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
    onProgress?.("正在获取密码公钥及加密密码…")
    const encryptedPassword = await this.getEncryptedPassword(password)
    onProgress?.("正在获取登录验证值…")
    const nonceResponse = await this.getNonceData(phone, 0, onProgress)
    if (!nonceResponse || nonceResponse.code !== 0 || !nonceResponse.data) throw new Error(`获取登录验证值失败：${nonceResponse?.message || nonceResponse?.description || nonceResponse?.code || "响应缺少 data"}`)
    onProgress?.("正在提交 BMW 登录请求…")
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
