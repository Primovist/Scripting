export interface DashboardData {
  model: string
  version: string
  signalBars: number
  battery: number | null
  charging: boolean
  dailyValue: string
  dailyUnit: string
  monthlyValue: string
  monthlyUnit: string
  providerAndType: string
  band: string
  qci: string
  cpu: string
  cpuTemperature: string
  batteryTemperature: string
  ssid: string
  wifiBand: string
  memory: string
  clients: string
  unreadSMS: string
  rsrp: string
  rsrq: string
  snr: string
  updateTime: string
  stale?: boolean
}

export type UbusMap = Record<number, any>

export function makeDashboardData(
  map: UbusMap,
  unreadSMS: number,
  qci: string,
): DashboardData {
  const net = map[1] ?? {}
  const traffic = map[5] ?? {}
  const device = map[6] ?? {}
  const thermal = map[7] ?? {}
  const clients = map[11] ?? {}
  const wifi = map[14] ?? {}
  const system = map[15]?.values ?? map[15] ?? {}

  const daily = formatBytes(sum(traffic.day_tx_bytes, traffic.day_rx_bytes))
  const monthly = formatBytes(sum(traffic.month_tx_bytes, traffic.month_rx_bytes))
  const battery = finiteNumber(device.bat_percent)
  const cpuIdle = finiteNumber(device.cpuinfo?.[0]?.idle)
  const totalMemory = finiteNumber(device.meminfo?.total)
  const availableMemory = finiteNumber(
    device.meminfo?.avaliable ?? device.meminfo?.available,
  )
  const memory =
    totalMemory !== null && totalMemory > 0 && availableMemory !== null
      ? `${Math.round(((totalMemory - availableMemory) / totalMemory) * 100)}%`
      : "--"

  return {
    model: pick(
      system.device_market_name,
      system.device_alias_name,
      system.model_name,
      "U60 Pro",
    ),
    version: pick(
      system.wa_inner_version,
      system.integrate_version,
      system.hardware_version,
      "--",
    ),
    signalBars: clamp(Math.round(finiteNumber(net.signalbar) ?? 0), 0, 5),
    battery,
    charging:
      String(device.bat_charger_connect) === "1" ||
      String(device.bat_charger_status).toLowerCase().includes("charg"),
    dailyValue: daily.value,
    dailyUnit: daily.unit,
    monthlyValue: monthly.value,
    monthlyUnit: monthly.unit,
    providerAndType: joinMeaningful([
      providerName(net.network_provider, net.network_provider_fullname),
      networkType(net.network_type),
    ]),
    band: currentBand(net),
    qci,
    cpu:
      cpuIdle === null
        ? "--"
        : `${Math.round(clamp(100 - cpuIdle, 0, 100))}%`,
    cpuTemperature: numericText(thermal.cpuss_temp ?? thermal.cpu_temp, 1),
    batteryTemperature: numericText(device.bat_temperature, 1),
    ssid: pick(wifi.main5g_ssid, wifi.main2g_ssid, "--"),
    wifiBand: wifi.main5g_ssid ? "5G" : wifi.main2g_ssid ? "2.4G" : "--",
    memory,
    clients: String(Math.max(0, Math.round(finiteNumber(clients.wireless_num) ?? 0))),
    unreadSMS: String(Math.max(0, unreadSMS)),
    rsrp: numericText(net.nr5g_rsrp ?? net.lte_rsrp, 0),
    rsrq: numericText(net.nr5g_rsrq ?? net.lte_rsrq, 0),
    snr: numericText(net.nr5g_snr ?? net.lte_snr, 0),
    updateTime: formatUpdateTime(new Date()),
  }
}

export function emptyDashboardData(message: string): DashboardData {
  return {
    model: "U60 Pro",
    version: message,
    signalBars: 0,
    battery: null,
    charging: false,
    dailyValue: "--",
    dailyUnit: "",
    monthlyValue: "--",
    monthlyUnit: "",
    providerAndType: "--",
    band: "--",
    qci: "--",
    cpu: "--",
    cpuTemperature: "--",
    batteryTemperature: "--",
    ssid: "--",
    wifiBand: "--",
    memory: "--",
    clients: "0",
    unreadSMS: "0",
    rsrp: "--",
    rsrq: "--",
    snr: "--",
    updateTime: formatUpdateTime(new Date()),
    stale: true,
  }
}

function providerName(code: unknown, fullName: unknown): string {
  const normalized = String(code ?? "").toUpperCase()
  const map: Record<string, string> = {
    CMCC: "中国移动",
    CUCC: "中国联通",
    UNICOM: "中国联通",
    CT: "中国电信",
    CTCC: "中国电信",
    CBN: "中国广电",
  }
  return map[normalized] ?? pick(fullName, code, "--")
}

function networkType(raw: unknown): string {
  const value = String(raw ?? "").toUpperCase()
  if (/NR|5G|SA|NSA|ENDC/.test(value)) return "5G"
  if (/4G|LTE/.test(value)) return "4G"
  if (/HSPA/.test(value)) return "H+"
  if (/3G|WCDMA/.test(value)) return "3G"
  if (/2G|GSM/.test(value)) return "2G"
  return value || "--"
}

function currentBand(net: any): string {
  const direct = finiteNumber(String(net.nr5g_action_band ?? "").replace(/^n/i, ""))
  if (direct !== null) return `N${Math.round(direct)}`

  const nrCarriers = String(net.nrca ?? "")
    .split(";")
    .filter(Boolean)
  for (const carrier of nrCarriers) {
    const fields = carrier.split(",")
    const band = finiteNumber(fields[3])
    if (band !== null) return `N${Math.round(band)}`
  }

  const nrBand = finiteNumber(String(net.nr5g_band ?? "").split(",")[0])
  if (nrBand !== null) return `N${Math.round(nrBand)}`

  const lteCarriers = String(net.lteca ?? "")
    .split(";")
    .filter(Boolean)
  for (const carrier of lteCarriers) {
    const fields = carrier.split(",")
    const band = finiteNumber(fields[1])
    if (band !== null) return `B${Math.round(band)}`
  }
  return "--"
}

function formatBytes(raw: number): { value: string; unit: string } {
  if (!Number.isFinite(raw) || raw < 0) return { value: "--", unit: "" }
  const gb = raw / 1073741824
  if (gb >= 1) {
    const digits = gb >= 10 ? 1 : 2
    return { value: trimZero(gb.toFixed(digits)), unit: "GB" }
  }
  const mb = raw / 1048576
  return {
    value: trimZero(mb.toFixed(mb >= 10 ? 0 : 1)),
    unit: "MB",
  }
}

function formatUpdateTime(date: Date): string {
  return [
    date.getFullYear(),
    "-",
    pad2(date.getMonth() + 1),
    "-",
    pad2(date.getDate()),
    " ",
    pad2(date.getHours()),
    ":",
    pad2(date.getMinutes()),
  ].join("")
}

function numericText(value: unknown, digits: number): string {
  const number = finiteNumber(value)
  if (number === null) return "--"
  return trimZero(number.toFixed(digits))
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const match = String(value).match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const number = Number(match[0])
  return Number.isFinite(number) ? number : null
}

function pick(...values: unknown[]): string {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return String(value).trim()
    }
  }
  return "--"
}

function joinMeaningful(values: string[]): string {
  const valid = values.filter((value) => value && value !== "--")
  return valid.length ? valid.join(" ") : "--"
}

function sum(a: unknown, b: unknown): number {
  return (finiteNumber(a) ?? 0) + (finiteNumber(b) ?? 0)
}

function trimZero(value: string): string {
  return value.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1")
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
