export const SCRIPT_NAME = "MyBMW Linker"
export const REMOTE_ROOT = "https://m.qqtlr.com"
export const BMW_SERVER_HOST = "https://myprofile.bmw.com.cn"
export const WIDGET_VERSION = "5.14.0"

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
  lastCheckIn: "PHONE_MY_BMW_LAST_CHECK_IN_AT",
  lastJoyCoin: "PHONE_MY_BMW_LAST_JOYCOIN",
  joyCoinInfoTime: "PHONE_getJoyCoinInfoTime",
  coupon: "PHONE_MY_BMW_ACTIVITY_COUPON",
  like: "PHONE_MY_BMW_ACTIVITY_LIKE",
  collect: "PHONE_MY_BMW_ACTIVITY_COLLECT",
  comment: "PHONE_MY_BMW_ACTIVITY_COMMENT",
  view120: "PHONE_MY_BMW_ACTIVITY_VIEW120S",
  follow: "PHONE_MY_BMW_ACTIVITY_FLLOW",
  moment: "PHONE_MY_BMW_ACTIVITY_MONENT",
  carLink: "PHONE_MY_BMW_DOOR_LOCK",
  accountId: "accountId",
  admin: "admin",
}

export type Settings = {
  phone?: string
  vin?: string
  customName?: string
  customVehicleImage?: string
  customLogoImage?: string
  showSignInIcon?: boolean
  transparentWidget?: boolean
  showTireFuelTrend?: boolean
  showJoyCoin?: boolean
  totalFuelLiters?: number
  licensePlate?: string
  signIn?: boolean
  notify?: boolean
  activityTimerVal?: string
  activityAllTasks?: boolean
  activityFollow?: boolean
  activityView120S?: boolean
  activityCoupon?: boolean
  activityPostMoment?: boolean
  activityCarLink?: boolean
  activityCommentText?: string
  activityPostMomentText?: string
}

export const defaultSettings: Required<Omit<Settings, "phone" | "vin" | "customName" | "customVehicleImage" | "customLogoImage" | "licensePlate">> = {
  showSignInIcon: true,
  transparentWidget: false,
  showTireFuelTrend: true,
  showJoyCoin: false,
  totalFuelLiters: 0,
  signIn: true,
  notify: true,
  activityTimerVal: "00:00",
  activityAllTasks: false,
  activityFollow: false,
  activityView120S: false,
  activityCoupon: false,
  activityPostMoment: false,
  activityCarLink: false,
  activityCommentText: "👍点赞",
  activityPostMomentText: "每日报道",
}

export type VehicleData = {
  vin: string
  brand?: string
  model?: string
  licensePlate?: string
  properties?: any
}
