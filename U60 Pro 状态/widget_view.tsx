import {
  Button,
  Circle,
  Color,
  HStack,
  Image,
  Rectangle,
  Spacer,
  Text,
  VStack,
  Widget,
  ZStack,
} from "scripting"
import { RefreshIntent } from "./app_intents"
import { DashboardData } from "./model"

const transparent =
  Widget.isTransparentBackground || Widget.isTransparentMode || Widget.isBlurMode
const dark = Device.colorScheme === "dark"

const primary: Color = "label"
const secondary: Color = "secondaryLabel"
const accent: Color = "systemBlue"
const routerColor: Color = "systemBlue"
const cyan: Color = "systemCyan"
const teal: Color = "systemTeal"
const blue: Color = "systemIndigo"
const purple: Color = "systemPurple"
const magenta: Color = "systemPink"
const divider: Color = "separator"
const pillBackground: Color = transparent
  ? dark
    ? "rgba(28,28,30,0.5)"
    : "rgba(242,242,247,0.5)"
  : "secondarySystemBackground"
const widgetBackground: Color = transparent ? "clear" : "systemBackground"

export function U60ProWidget({ data }: { data: DashboardData }) {
  return (
    <Button intent={RefreshIntent(undefined)} buttonStyle="plain">
      <VStack
        spacing={4}
        padding={{ top: 8, bottom: 7, leading: 12, trailing: 12 }}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        widgetBackground={widgetBackground}
        fontDesign="rounded"
      >
        <Header data={data} />
        <Traffic data={data} />
        <StatusRows data={data} />
        <Footer data={data} />
      </VStack>
    </Button>
  )
}

function Header({ data }: { data: DashboardData }) {
  const battery = data.battery === null ? "--" : `${Math.round(data.battery)}%`
  return (
    <HStack spacing={5} frame={{ height: 20 }}>
      <Image
        systemName="wifi.router.fill"
        font={14}
        foregroundStyle={routerColor}
        frame={{ width: 18 }}
      />
      <Text font={12} fontWeight="bold" lineLimit={1} minScaleFactor={0.72}>
        {data.model}
      </Text>
      <Text font={11} fontWeight="semibold" lineLimit={1} minScaleFactor={0.55}>
        {data.version}
      </Text>
      <Spacer minLength={2} />
      <Image
        systemName="cellularbars"
        variableValue={signalFill(data.signalBars)}
        font={14}
        foregroundStyle={primary}
      />
      {hasQCI(data.qci) ? <QCIIndicator value={data.qci} /> : null}
      <Rectangle fill={divider} frame={{ width: 1, height: 13 }} />
      <BatteryIcon value={data.battery} charging={data.charging} />
      <Text font={12} fontWeight="bold" monospacedDigit>
        {battery}
      </Text>
    </HStack>
  )
}

function Traffic({ data }: { data: DashboardData }) {
  return (
    <HStack spacing={12} frame={{ height: 50 }}>
      <TrafficValue title="今日流量" value={data.dailyValue} unit={data.dailyUnit} />
      <Rectangle fill={divider} frame={{ width: 2, height: 42 }} />
      <TrafficValue title="本月流量" value={data.monthlyValue} unit={data.monthlyUnit} />
    </HStack>
  )
}

function TrafficValue({ title, value, unit }: { title: string; value: string; unit: string }) {
  return (
    <VStack spacing={0} frame={{ maxWidth: "infinity" }}>
      <Text font={12} fontWeight="bold" foregroundStyle={accent}>
        {title}
      </Text>
      <HStack spacing={3} alignment="lastTextBaseline">
        <Text font={31} fontWeight="bold" monospacedDigit lineLimit={1} minScaleFactor={0.68}>
          {value}
        </Text>
        <Text font={13} fontWeight="bold" fontDesign="serif" baselineOffset={1}>
          {unit}
        </Text>
      </HStack>
    </VStack>
  )
}

function StatusRows({ data }: { data: DashboardData }) {
  const rowLayout = {
    spacing: 4,
    padding: { horizontal: 4 },
    frame: { maxWidth: "infinity" as const, height: 23 },
  }

  return (
    <VStack
      spacing={4}
      frame={{ maxWidth: "infinity", alignment: "center" }}
      font={statusFontSize(data)}
    >
      <HStack {...rowLayout}>
        <Pill icon="network" color={cyan} value={data.providerAndType} />
        <Pill icon="antenna.radiowaves.left.and.right" color={accent} value={data.band} />
        <Pill icon="cpu.fill" color={blue} value={data.cpu} />
        <Pill
          icon="thermometer.medium"
          color={temperatureColor(data.cpuTemperature, data.batteryTemperature)}
          value={`${temperatureText(data.cpuTemperature)}|${temperatureText(data.batteryTemperature)}`}
        />
      </HStack>
      <HStack {...rowLayout}>
        <Pill icon="wifi" color={teal} value={data.ssid} />
        <Pill icon="dot.radiowaves.left.and.right" color={teal} value={data.wifiBand} />
        <Pill icon="memorychip" color={purple} value={data.memory} />
        <Pill icon="macbook.and.ipod" color={magenta} value={data.clients} />
        <Pill icon="envelope.badge" color={Number(data.unreadSMS) > 0 ? "systemRed" : accent} value={data.unreadSMS} />
      </HStack>
    </VStack>
  )
}

function Pill({
  icon,
  color,
  value,
}: {
  icon: string
  color: Color
  value: string
}) {
  return (
    <HStack
      spacing={4}
      padding={{ top: 3, bottom: 3, leading: 7, trailing: 7 }}
      background={pillBackground}
      clipShape={{ type: "rect", cornerRadius: 11 }}
      frame={{ height: 23 }}
    >
      <Image
        systemName={icon}
        font={11}
        foregroundStyle={color}
        frame={{ width: 13, height: 13 }}
      />
      <Text
        fontWeight="semibold"
        foregroundStyle={primary}
        lineLimit={1}
      >
        {value}
      </Text>
    </HStack>
  )
}

function Footer({ data }: { data: DashboardData }) {
  return (
    <HStack spacing={4} frame={{ height: 17 }}>
      <Image
        systemName="antenna.radiowaves.left.and.right.circle"
        font={11}
        foregroundStyle={accent}
      />
      <Text
        font={8.5}
        fontWeight="semibold"
        foregroundStyle={secondary}
        monospacedDigit
        lineLimit={1}
        minScaleFactor={0.68}
      >
        {`RSRP ${suffix(data.rsrp, "dBm")} · RSRQ ${data.rsrq} · SNR ${data.snr}`}
      </Text>
      <Spacer minLength={1} />
      <Image
        systemName="clock.arrow.trianglehead.2.counterclockwise.rotate.90"
        font={10}
        foregroundStyle={data.stale ? "systemOrange" : "systemGreen"}
      />
      <Text
        font={8.5}
        fontWeight="semibold"
        foregroundStyle={secondary}
        monospacedDigit
        lineLimit={1}
        minScaleFactor={0.72}
      >
        {data.updateTime}
      </Text>
    </HStack>
  )
}

function QCIIndicator({ value }: { value: string }) {
  return (
    <ZStack alignment="center" frame={{ width: 14, height: 14 }}>
      <Circle
        fill="clear"
        stroke={{ shapeStyle: primary, strokeStyle: { lineWidth: 1.2 } }}
        frame={{ width: 13, height: 13 }}
      />
      <Text
        font={7}
        fontWeight="bold"
        foregroundStyle={primary}
        monospacedDigit
        frame={{ width: 13, height: 13, alignment: "center" }}
        offset={{ x: 0.4, y: 0.4 }}
      >
        {value}
      </Text>
    </ZStack>
  )
}

function signalFill(bars: number): number {
  const level = Math.round((Math.min(5, Math.max(0, bars)) * 4) / 5)
  return level / 4
}

function hasQCI(value: string): boolean {
  return /^\d+$/.test(value)
}

function statusFontSize(data: DashboardData): number {
  const rows = [
    [
      data.providerAndType,
      data.band,
      data.cpu,
      `${temperatureText(data.cpuTemperature)}|${temperatureText(data.batteryTemperature)}`,
    ],
    [data.ssid, data.wifiBand, data.memory, data.clients, data.unreadSMS],
  ]
  const availableWidth = Widget.displaySize.width - 32
  const fontSize = Math.min(
    ...rows.map((values) => {
      const fixedWidth = values.length * 31 + (values.length - 1) * 4
      const textWidthAtTen = values.reduce(
        (total, value) => total + estimatedTextWidth(value),
        0,
      )
      return (10 * Math.max(0, availableWidth - fixedWidth)) / textWidthAtTen
    }),
  )
  return Math.max(5, Math.min(10, fontSize * 0.94))
}

function estimatedTextWidth(value: string): number {
  let width = 0
  for (const character of value) {
    width += /[\u2E80-\u9FFF℃]/.test(character) ? 10.5 : 6.2
  }
  return width
}

function temperatureColor(cpu: string, battery: string): Color {
  const highest = Math.max(temperatureNumber(cpu), temperatureNumber(battery))
  if (highest >= 70) return "systemRed"
  if (highest > 50) return "systemOrange"
  return "systemGreen"
}

function temperatureNumber(value: string): number {
  const number = Number.parseFloat(value)
  return Number.isFinite(number) ? number : 0
}

function temperatureText(value: string): string {
  return value === "--" ? value : `${value}℃`
}

function suffix(value: string, unit: string): string {
  return value === "--" ? value : `${value}${unit}`
}

function BatteryIcon({
  value,
  charging,
}: {
  value: number | null
  charging: boolean
}) {
  const unknown = value === null
  const color: Color = unknown
    ? "systemRed"
    : charging
      ? "systemGreen"
      : value < 20
        ? "systemRed"
        : primary

  return (
    <ZStack frame={{ width: 22, height: 16 }}>
      <Image
        systemName={batterySymbol(value, charging)}
        font={16}
        foregroundStyle={color}
      />
      {unknown ? (
        <Image
          systemName="exclamationmark"
          font={7}
          fontWeight="bold"
          foregroundStyle="systemRed"
        />
      ) : null}
    </ZStack>
  )
}

function batterySymbol(value: number | null, charging: boolean): string {
  if (charging) return "battery.100percent.bolt"
  if (value === null || value < 13) return "battery.0percent"
  if (value < 38) return "battery.25percent"
  if (value < 63) return "battery.50percent"
  if (value < 88) return "battery.75percent"
  return "battery.100percent"
}
