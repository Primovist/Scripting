import { Widget, VStack, HStack, Text, Image, Spacer, Canvas, gradient } from "scripting"
import { fetch } from "scripting"

type StatusValue = boolean | undefined

type Config = {
  baseUrl: string
  username?: string
  password?: string
}

type Snapshot = {
  running: StatusValue
  homebridgeUtd: StatusValue
  pluginsUtd: StatusValue
  nodeUtd: StatusValue
  cpu?: number
  ram?: number
  temperature?: number
  cpuHistory?: number[]
  ramHistory?: number[]
  systemUptime?: string
  uiUptime?: string
  updatedAt: string
  error?: string
}

const DEFAULT_URL = "http://192.168.1.10:8581"
const HOME_BRIDGE_LOGO_PATH = `${FileManager.scriptsDirectory}/Homebridge Status/assets/homebridge-logo.png`

function parseConfig(): Config {
  const parameter = (Widget.parameter || "").trim()
  if (!parameter) {
    try {
      const savedPath = `${FileManager.appGroupDocumentsDirectory}/homebridgeStatus/config.json`
      if (FileManager.existsSync(savedPath)) {
        const saved = JSON.parse(FileManager.readAsStringSync(savedPath))
        if (saved.baseUrl) return {
          username: saved.username?.trim(),
          password: saved.password?.trim(),
          baseUrl: saved.baseUrl.trim().replace(/\/$/, "")
        }
      }
    } catch (_) {
      // Fall back to the default address below.
    }
    return { baseUrl: DEFAULT_URL }
  }

  const parts = parameter.split(",,")
  if (parts.length === 3 && parts[2].startsWith("http")) {
    return {
      username: parts[0].trim(),
      password: parts[1].trim(),
      baseUrl: parts[2].trim().replace(/\/$/, "")
    }
  }

  return { baseUrl: parameter.replace(/\/$/, "") }
}

async function json(url: string, init?: any): Promise<any> {
  const response = await fetch(url, init as any)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return await response.json()
}

async function getToken(config: Config): Promise<string> {
  try {
    const noAuth = await json(`${config.baseUrl}/api/auth/noauth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    })
    if (noAuth.access_token) return noAuth.access_token
  } catch (_) {
    // Fall through to credential login.
  }

  if (!config.username || !config.password) {
    throw new Error("请在小组件 Parameter 中填写 URL 或 用户名,,密码,,URL")
  }

  const login = await json(`${config.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: config.username,
      password: config.password,
      otp: "string"
    })
  })
  if (!login.access_token) throw new Error("Homebridge 登录失败")
  return login.access_token
}

async function fetchSnapshot(config: Config): Promise<Snapshot> {
  const token = await getToken(config)
  const headers = { Authorization: `Bearer ${token}`, Accept: "*/*" }
  const get = (path: string) => json(`${config.baseUrl}${path}`, { headers })

  const [status, cpu, ram, hbVersion, plugins, node, uptime] = await Promise.all([
    get("/api/status/homebridge"),
    get("/api/status/cpu"),
    get("/api/status/ram"),
    get("/api/status/homebridge-version"),
    get("/api/plugins"),
    get("/api/status/nodejs"),
    get("/api/status/uptime")
  ])

  const pluginList = Array.isArray(plugins) ? plugins : []
  const usedRam = ram?.mem?.total
    ? 100 - (100 * ram.mem.available) / ram.mem.total
    : undefined

  return {
    running: status?.status === "ok" || status?.status === "up",
    homebridgeUtd: !hbVersion?.updateAvailable,
    pluginsUtd: !pluginList.some((plugin: any) => plugin.updateAvailable),
    nodeUtd: !node?.updateAvailable,
    cpu: typeof cpu?.currentLoad === "number" ? cpu.currentLoad : undefined,
    ram: usedRam,
    temperature:
      typeof cpu?.cpuTemperature?.main === "number"
        ? cpu.cpuTemperature.main
        : undefined,
    cpuHistory: Array.isArray(cpu?.cpuLoadHistory) ? cpu.cpuLoadHistory : [],
    ramHistory: Array.isArray(ram?.memoryUsageHistory) ? ram.memoryUsageHistory : [],
    systemUptime: formatUptime(uptime?.time?.uptime),
    uiUptime: formatUptime(uptime?.processUptime),
    updatedAt: formatDateTime()
  }
}

function formatUptime(value: any): string {
  const seconds = Number(value)
  if (!isFinite(seconds)) return "--"
  if (seconds >= 864000) return `${Math.round(seconds / 86400)}d`
  if (seconds >= 86400) return `${Math.round(seconds / 86400 * 10) / 10}d`
  if (seconds >= 3600) return `${Math.round(seconds / 3600 * 10) / 10}h`
  if (seconds >= 60) return `${Math.round(seconds / 60 * 10) / 10}m`
  return `${Math.round(seconds * 10) / 10}s`
}

function formatDateTime(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function percent(value?: number): string {
  return value === undefined ? "--" : `${Math.round(value * 10) / 10}%`
}

type StatusKind = "health" | "update"

function statusIcon(value: StatusValue, kind: StatusKind): string {
  if (value === true) return "checkmark.circle.fill"
  if (kind === "update" && value === false) return "exclamationmark.triangle.fill"
  return "xmark.circle.fill"
}

function statusColor(value: StatusValue, kind: StatusKind): string {
  if (value === true) return "systemGreen"
  if (kind === "update" && value === false) return "systemYellow"
  return "systemRed"
}

function StatusLine({ value, label, kind = "health", compact = false }: { value: StatusValue; label: string; kind?: StatusKind; compact?: boolean }) {
  return (
    <HStack spacing={3}>
      <Image systemName={statusIcon(value, kind)} font={compact ? 10 : 13} foregroundStyle={statusColor(value, kind) as any} />
      <Text font={compact ? 8 : 10} fontWeight="semibold" foregroundStyle="white" lineLimit={1} minScaleFactor={0.8}>
        {label}
      </Text>
    </HStack>
  )
}

function StatusGrid({ snapshot, compact = false }: { snapshot: Snapshot; compact?: boolean }) {
  return (
    <VStack alignment="leading" spacing={compact ? 2 : 4}>
      <HStack spacing={5}>
        <StatusLine value={snapshot.running} label="运行状态" kind="health" compact />
        <StatusLine value={snapshot.homebridgeUtd} label="Homebridge更新" kind="update" compact />
      </HStack>
      <HStack spacing={5}>
        <StatusLine value={snapshot.pluginsUtd} label="插件更新" kind="update" compact />
        <StatusLine value={snapshot.nodeUtd} label="Node.js更新" kind="update" compact />
      </HStack>
    </VStack>
  )
}

function MiniChart({ values, color, label, icon, current, suffix = "%", extra, extraIcon, footer }: { values: number[]; color: string; label: string; icon: string; current?: number; suffix?: string; extra?: string; extraIcon?: string; footer?: string }) {
  const points = values.filter(value => typeof value === "number" && isFinite(value)).slice(-30)
  const rawMin = points.length ? Math.min(...points) : 0
  const rawMax = points.length ? Math.max(...points) : 100
  const padding = 1
  const chartMin = Math.max(0, rawMin - padding)
  const chartMax = Math.min(100, rawMax + padding)
  const range = Math.max(chartMax - chartMin, 1)
  return (
    <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity" }}>
      <HStack spacing={3} frame={{ maxWidth: "infinity" }}>
        <Image systemName={icon} font={10} foregroundStyle="white" />
        <Text font={9} fontWeight="semibold" foregroundStyle="white" lineLimit={1}>{percent(current)}</Text>
        {extra ? <HStack spacing={2}><Image systemName={extraIcon ?? "thermometer.medium"} font={10} foregroundStyle="white" /><Text font={8} foregroundStyle="white" lineLimit={1}>{extra}</Text></HStack> : null}
        <Spacer />
      </HStack>
      <HStack spacing={3} frame={{ maxWidth: "infinity" }}>
        <VStack alignment="trailing" spacing={18} frame={{ width: 26, height: 38 }}>
          <Text font={7} foregroundStyle="rgba(255,255,255,0.58)">{Math.trunc(chartMax)}{suffix}</Text>
          <Text font={7} foregroundStyle="rgba(255,255,255,0.58)">{Math.trunc(chartMin)}{suffix}</Text>
        </VStack>
        <Canvas opaque={false} frame={{ height: 38, maxWidth: "infinity" }} draw={(ctx, size) => {
          ctx.clearRect(0, 0, size.width, size.height)
          ctx.strokeStyle = "rgba(255,255,255,0.18)"
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(0, 1)
          ctx.lineTo(size.width, 1)
          ctx.moveTo(0, size.height - 1)
          ctx.lineTo(size.width, size.height - 1)
          ctx.stroke()
          if (points.length < 2) return
          ctx.strokeStyle = color
          ctx.lineWidth = 2
          ctx.lineJoin = "round"
          ctx.lineCap = "round"
          ctx.beginPath()
          const chartPoints = points.map((value, index) => ({
            x: (index / (points.length - 1)) * size.width,
            y: size.height - 3 - ((value - chartMin) / range) * (size.height - 6)
          }))
          ctx.moveTo(chartPoints[0].x, chartPoints[0].y)
          for (let index = 0; index < chartPoints.length - 1; index++) {
            const current = chartPoints[index]
            const next = chartPoints[index + 1]
            const midX = (current.x + next.x) / 2
            const midY = (current.y + next.y) / 2
            ctx.quadraticCurveTo(current.x, current.y, midX, midY)
          }
          const last = chartPoints[chartPoints.length - 1]
          ctx.quadraticCurveTo(last.x, last.y, last.x, last.y)
          ctx.stroke()
        }} />
      </HStack>
      <HStack spacing={3} frame={{ maxWidth: "infinity" }}>
        <Spacer minLength={29} />
        <HStack spacing={0} frame={{ maxWidth: "infinity" }}>
          <Text font={7} foregroundStyle="rgba(255,255,255,0.48)" frame={{ maxWidth: "infinity", alignment: "leading" }}>-10m</Text>
          <Text font={7} foregroundStyle="rgba(255,255,255,0.48)" frame={{ maxWidth: "infinity", alignment: "trailing" }}>0</Text>
        </HStack>
      </HStack>
      {footer ? <Text font={7} foregroundStyle="white" multilineTextAlignment="center" lineLimit={1} minScaleFactor={0.45} frame={{ maxWidth: "infinity", alignment: "center" }}>{footer}</Text> : null}
    </VStack>
  )
}

export default function HomebridgeWidget({ snapshot }: { snapshot: Snapshot }) {
  const isSmall = Widget.family === "systemSmall"
  const purple = gradient("linear", {
    colors: ["#421367", "#7a04d4"],
    startPoint: "topLeading",
    endPoint: "bottomTrailing"
  })

  return (
    <VStack
      alignment="leading"
      spacing={isSmall ? 6 : 7}
      padding={{ top: 12, bottom: 12, leading: 13, trailing: 13 }}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      background={purple}
    >
      <HStack spacing={5} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Image
          filePath={HOME_BRIDGE_LOGO_PATH}
          resizable
          scaleToFit
          frame={{ width: 24, height: 24 }}
        />
        <VStack alignment="leading" spacing={0}>
          <Text font={14} fontWeight="bold" foregroundStyle="white">Homebridge</Text>
          <Text font={8} foregroundStyle="rgba(255,255,255,0.68)">STATUS MONITOR</Text>
        </VStack>
        <Spacer minLength={20} />
        {!isSmall ? <StatusGrid snapshot={snapshot} compact /> : <Image systemName={snapshot.running ? "checkmark.seal.fill" : "xmark.seal.fill"} font={17} foregroundStyle={snapshot.running ? "systemGreen" : "systemRed"} />}
      </HStack>

      {snapshot.error ? (
        <VStack alignment="leading" spacing={3}>
          <Text font={10} foregroundStyle="white" lineLimit={3}>{snapshot.error}</Text>
          <Text font={8} foregroundStyle="rgba(255,255,255,0.65)">请检查地址、密码及网络连接</Text>
        </VStack>
      ) : (
        <>
          {!isSmall ? (
            <HStack spacing={12} frame={{ maxWidth: "infinity" }}>
              <MiniChart
                values={snapshot.cpuHistory ?? []}
                color="#65d9ff"
                label="CPU" icon="cpu"
                current={snapshot.cpu}
                extra={snapshot.temperature !== undefined ? `${Math.round(snapshot.temperature * 10) / 10}℃` : undefined} footer={`系统启动：${snapshot.systemUptime ?? "--"}    UI运行：${snapshot.uiUptime ?? "--"}`}
              />
              <MiniChart values={snapshot.ramHistory ?? []} color="#dca4ff" label="RAM" icon="memorychip" current={snapshot.ram} footer={`更新时间：${snapshot.updatedAt}`} />
            </HStack>
          ) : null}

        </>
      )}
    </VStack>
  )
}

const config = parseConfig()

// Runtime entry: fetch data and present the widget. The default export above
// is also used by Scripting's UI preview tool.
if (typeof Widget !== "undefined" && typeof Widget.present === "function") {
  fetchSnapshot(config)
    .then(snapshot => Widget.present(<HomebridgeWidget snapshot={snapshot} />))
    .catch(error => Widget.present(
      <HomebridgeWidget snapshot={{
        running: undefined,
        homebridgeUtd: undefined,
        pluginsUtd: undefined,
        nodeUtd: undefined,
        cpuHistory: [],
        ramHistory: [],
        systemUptime: "--",
        uiUptime: "--",
        updatedAt: formatDateTime(),
        error: error instanceof Error ? error.message : "无法连接 Homebridge"
      }} />
    ))
}
