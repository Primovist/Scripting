export const SCRIPT_NAME = "MyBMW Linker"
export const REMOTE_ROOT = "https://m.qqtlr.com"
export const BMW_SERVER_HOST = "https://myprofile.bmw.com.cn"

export const BMW_HEADERS: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "Accept": "*/*",
  "x-user-agent": "ios(17.6.1);bmw;5.14.0(58417);cn",
  "Accept-Language": "zh-CN",
  "User-Agent": "Dart/3.2 (dart:io)",
}

export const DEFAULT_LOGO_LIGHT = `${REMOTE_ROOT}/logo.png`
export const DEFAULT_X_CORRELATION_ID = "meiDaiSan-only-used-xid"
export const DEFAULT_X = "cd16030b4acc1006694040177d4de3fd434a78b4b872397ff77ac7fad6be93d3"

export const KEYS = {
  username: "PHONE_MY_BMW_USERNAME",
  password: "PHONE_MY_BMW_PASSWORD",
  refreshToken: "PHONE_MY_BMW_REFRESH_TOKEN",
  refreshGcid: "PHONE_MY_BMW_REFRESH_GCID",
  accessToken: "PHONE_MY_BMW_TOKEN",
  tokenUpdatedAt: "PHONE_MY_BMW_TOKEN_UPDATE_LAST_AT",
  correlation: "PHONE_MY_BMW_CORRELATION",
  x: "PHONE_MY_BMW_X",
  vehicleListTime: "PHONE_MY_BMW_VEHICLE_LIST_TIME",
  vehicleList: "PHONE_MY_BMW_VEHICLE_LIST",
  vehicleData: "VIN_MY_BMW_VEHICLE_DATA",
  vehicleUpdatedAt: "VIN_MY_BMW_VEHICLE_UPDATE_LAST_AT",
  tiresData: "VIN_MY_BMW_TIRES_DATA",
  sustainability: "VIN_MY_BMW_SUSTAINABILITY",
  sustainabilityTime: "VIN_sustainabilityTime",
}

export type Settings = {
  phone?: string
  vin?: string
  customName?: string
  customVehicleImage?: string
  customLogoImage?: string
  showTireFuelTrend?: boolean
  totalFuelLiters?: number
  licensePlate?: string
  notify?: boolean
}

export const defaultSettings: Required<Omit<Settings, "phone" | "vin" | "customName" | "customVehicleImage" | "customLogoImage" | "licensePlate">> = {
  showTireFuelTrend: true,
  totalFuelLiters: 0,
  notify: true,
}

export type VehicleSnapshot = {
  energy: { type: "fuel" | "electric" | "hybrid" | "unknown"; levelPercent?: number; fuelPercent?: number; batteryPercent?: number; remainingLiters?: number; rangeKm?: number }
  access: { lock: "locked" | "unlocked" | "unknown"; doors: string; windows: string; roof: string; hood: string; trunk: string; doorStates: Record<string, string>; windowStates: Record<string, string> }
  checks: Array<{ id: string; severity: "critical" | "warning"; title: string; detail?: string }>
  charging?: { state: "charging" | "complete" | "disconnected" | "unknown" }
  location?: { latitude: number; longitude: number; address?: string }
}

export type VehicleData = {
  vin: string
  brand?: string
  model?: string
  licensePlate?: string
  properties?: any
  snapshot?: VehicleSnapshot
}
