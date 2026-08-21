import {
  BMW_HEADERS,
  BMW_SERVER_HOST,
  DEFAULT_X,
  DEFAULT_X_CORRELATION_ID,
  KEYS,
  REMOTE_ROOT,
  type Settings,
  type VehicleData,
  type VehicleSnapshot,
} from "./constants"
import { formatUserMobile, keyGet, keyRemove, keySave, md5Hex, nowSeconds, requestJSON, requestText, uuidv4 } from "./storage"

type CaptchaHeaders = Record<string, string>

function appHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...BMW_HEADERS, ...extra }
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

  async loginByPassword(password: string, refreshData = true): Promise<void> {
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
    keySave(KEYS.username, phone)
    keySave(KEYS.password, password)
    keySave(KEYS.refreshToken, res.data.refresh_token)
    keySave(KEYS.refreshGcid, res.data.gcid)
    keyRemove(KEYS.accessToken)
    keyRemove(KEYS.tokenUpdatedAt)
    if (refreshData) await this.getData(true)
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
          "x-user-agent": BMW_HEADERS["x-user-agent"],
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

  async getData(force = false): Promise<VehicleData | null> {
    const access = await this.getAccessToken(force)
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
