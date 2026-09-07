import {
  Button,
  Capsule,
  Circle,
  HStack,
  Image,
  Rectangle,
  Spacer,
  Text,
  VStack,
  VirtualNode,
  Widget,
  ZStack,
  modifiers,
} from "scripting"
import { RefreshIPIntent } from "./app_intents"
import {
  calculateRiskValue,
  fetchChinaIP,
  fetchIPInfo,
  formatIPAddress,
  formatIPLocation,
  getPrivacyMode,
  IPInfo,
} from "./utils/ip"
import { hasCoordinates, takeIPMapSnapshot } from "./utils/map"

export interface WidgetProps {
  ipInfo: IPInfo | null
  riskValue: number
  isHomeBroadband: string
  isNative: string
  vpnStatus: string
  widgetSize: { width: number; height: number }
  mapImage?: any
  mapSize?: { width: number; height: number }
  pinPoint?: { x: number; y: number } | null
}

type Layout = {
  dashboard: boolean
  medium: boolean
  large: boolean
  padding: number
  contentWidth: number
  leftWidth: number
  gaugeWidth: number
}

const COLORS = {
  green: { light: "#248A3D", dark: "#30D158" },
  green2: { light: "#34C759", dark: "#63D471" },
  lime: { light: "#7CB342", dark: "#B7E36D" },
  yellow: { light: "#C99A00", dark: "#FFD60A" },
  orange: { light: "#C93400", dark: "#FF9F0A" },
  red: { light: "#D70015", dark: "#FF453A" },
  white: { light: "#000000", dark: "#FFFFFF" },
  secondary: { light: "#3A3A3C", dark: "#D1D1D6" },
  background: { light: "#FFFFFF", dark: "#000000" },
  status: { light: "#8E1645", dark: "#FF9FC1" },
  title: { light: "#0B5D1E", dark: "#7CFF8A" },
  marker: { light: "#000000", dark: "#FFFFFF" },
} as const

function layoutMetrics(family: string | undefined, size: { width: number; height: number }): Layout {
  const medium = family === "systemMedium"
  const large = family === "systemLarge" || family === "systemExtraLarge"
  const dashboard = medium || large
  const padding = large ? 16 : 12
  const contentWidth = Math.max(130, size.width - padding * 2)
  const leftWidth = medium
    ? Math.round(contentWidth * 0.62)
    : large
      ? Math.round(contentWidth * 0.64)
      : contentWidth

  return {
    dashboard,
    medium,
    large,
    padding,
    contentWidth,
    leftWidth,
    gaugeWidth: Math.max(116, leftWidth - 2),
  }
}
function DataRow({
  icon,
  label,
  value,
  width,
  compact = false,
  valueColor = COLORS.white,
}: {
  icon: string
  label?: string
  value: string
  width: number
  compact?: boolean
  valueColor?: (typeof COLORS)[keyof typeof COLORS]
}) {
  return (
    <HStack spacing={compact ? 5 : 6} alignment="center" frame={{ width }}>
      <Image
        systemName={icon}
        font={compact ? 10 : 12}
        foregroundStyle={COLORS.secondary}
        frame={{ width: compact ? 13 : 16 }}
      />
      {label ? <Text font={compact ? 9 : 10} foregroundStyle={COLORS.secondary}>{label}</Text> : null}
      <Text
        font={compact ? 11 : 12}
        fontWeight="semibold"
        foregroundStyle={valueColor}
        lineLimit={1}
        minScaleFactor={0.64}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
      >
        {value}
      </Text>
    </HStack>
  )
}

function RiskGauge({
  value,
  width,
  compact = false,
  showScale = false,
}: {
  value: number
  width: number
  compact?: boolean
  showScale?: boolean
}) {
  const barHeight = compact ? 5 : 6
  const markerSize = compact ? 8 : 9
  const markerX = Math.max(markerSize / 2, Math.min(width - markerSize / 2, width * value / 100))
  const colors = [COLORS.green, COLORS.green2, COLORS.lime, COLORS.yellow, COLORS.orange, COLORS.red]

  return (
    <VStack alignment="leading" spacing={1} frame={{ width }} offset={{ x: 0, y: 6 }}>
      <ZStack alignment="topLeading" frame={{ width, height: compact ? 15 : 17 }}>
        <Capsule
          fill={{
            light: {
              gradient: [
                { color: "#248A3D", location: 0.00 },
                { color: "#34C759", location: 0.18 },
                { color: "#7CB342", location: 0.34 },
                { color: "#C99A00", location: 0.50 },
                { color: "#C93400", location: 0.68 },
                { color: "#D70015", location: 1.00 },
              ],
              startPoint: { x: 0, y: 0.5 },
              endPoint: { x: 1, y: 0.5 },
            },
            dark: {
              gradient: [
                { color: "#30D158", location: 0.00 },
                { color: "#63D471", location: 0.18 },
                { color: "#B7E36D", location: 0.34 },
                { color: "#FFD60A", location: 0.50 },
                { color: "#FF9F0A", location: 0.68 },
                { color: "#FF453A", location: 1.00 },
              ],
              startPoint: { x: 0, y: 0.5 },
              endPoint: { x: 1, y: 0.5 },
            },
          }}
          frame={{ width, height: barHeight }}
          position={{ x: width / 2, y: barHeight / 2 }}
        />
        <Circle
          fill={COLORS.marker}
          frame={{ width: markerSize, height: markerSize }}
          position={{ x: markerX, y: barHeight / 2 }}
        />
      </ZStack>
      {showScale ? (
        <HStack frame={{ width }}>
          {[0, 15, 25, 40, 50, 70, 100].map((n, index) => (
            <HStack key={n}>
              <Text font={7} foregroundStyle={colors[Math.min(index, colors.length - 1)]}>{n}</Text>
              {index < 6 ? <Spacer /> : null}
            </HStack>
          ))}
        </HStack>
      ) : null}
    </VStack>
  )
}

function widgetRootModifiers() {
  const root = modifiers()

  if (!Widget.isTransparentMode) {
    root.widgetBackground(COLORS.background)
  }

  return root
    .ignoresSafeArea()
    .frame({ maxWidth: "infinity", maxHeight: "infinity" })
}

function FullMapBackground(props: WidgetProps) {
  const size = props.widgetSize
  const transparentMode = Widget.isTransparentMode
  const isLarge = Widget.family === "systemLarge" || Widget.family === "systemExtraLarge"
  const isSmall = Widget.family === "systemSmall"
  const hasMap = !!props.mapImage && !!props.mapSize
  // 定位图标始终固定在地图中心；地图中心与组件坐标 (3/4, 1/2) 重合。
  const mapCenter = {
    x: size.width * 0.75,
    y: size.height * 0.50,
  }
  const pin = hasMap ? mapCenter : null
  const revealStart = isLarge ? 0.48 : isSmall ? 0.62 : 0.43
  const revealMid = isLarge ? 0.61 : isSmall ? 0.77 : 0.58
  const revealEnd = isLarge ? 0.80 : isSmall ? 0.92 : 0.76

  return (
    <ZStack alignment="topLeading" frame={size}>
      {hasMap ? (
        transparentMode ? (
          <ZStack frame={size}>
            <Image
              image={props.mapImage}
              resizable
              scaleToFill
              frame={size}
              position={mapCenter}
              modifiers={modifiers().mask(
                <Rectangle
                  fill={{
                    gradient: [
                      { color: "rgba(255,255,255,0.00)", location: 0.00 },
                      { color: "rgba(255,255,255,0.01)", location: Math.max(0, revealStart - 0.14) },
                      { color: "rgba(255,255,255,0.06)", location: revealStart },
                      { color: "rgba(255,255,255,0.18)", location: revealStart + (revealMid - revealStart) * 0.45 },
                      { color: "rgba(255,255,255,0.36)", location: revealMid },
                      { color: "rgba(255,255,255,0.57)", location: revealMid + (revealEnd - revealMid) * 0.45 },
                      { color: "rgba(255,255,255,0.76)", location: revealEnd },
                      { color: "rgba(255,255,255,0.90)", location: revealEnd + (1 - revealEnd) * 0.42 },
                      { color: "rgba(255,255,255,0.97)", location: revealEnd + (1 - revealEnd) * 0.72 },
                      { color: "rgba(255,255,255,1.00)", location: 1.00 },
                    ],
                    startPoint: { x: 0, y: 0.5 },
                    endPoint: { x: 1, y: 0.5 },
                  }}
                  frame={size}
                />
              )}
            />
          </ZStack>
        ) : (
          <Image
              image={props.mapImage}
              resizable
              scaleToFill
              frame={size}
              position={mapCenter}
            />
        )
      ) : transparentMode ? null : (
        <Rectangle fill={COLORS.background} frame={size} />
      )}

      {!transparentMode ? (
        <ZStack frame={size}>
          <Rectangle
            fill={{
              light: {
                gradient: [
                  { color: "rgba(255,255,255,1.00)", location: 0.00 },
                  { color: "rgba(255,255,255,0.92)", location: revealStart },
                  { color: "rgba(255,255,255,0.58)", location: revealMid },
                  { color: "rgba(255,255,255,0.18)", location: revealEnd },
                  { color: "rgba(255,255,255,0.00)", location: 1.00 },
                ],
                startPoint: { x: 0, y: 0.5 },
                endPoint: { x: 1, y: 0.5 },
              },
              dark: {
                gradient: [
                  { color: "rgba(0,0,0,1.00)", location: 0.00 },
                  { color: "rgba(0,0,0,0.92)", location: revealStart },
                  { color: "rgba(0,0,0,0.58)", location: revealMid },
                  { color: "rgba(0,0,0,0.18)", location: revealEnd },
                  { color: "rgba(0,0,0,0.00)", location: 1.00 },
                ],
                startPoint: { x: 0, y: 0.5 },
                endPoint: { x: 1, y: 0.5 },
              },
            }}
            frame={size}
          />
          <Rectangle
            fill={{
              light: {
                gradient: [
                  { color: "rgba(255,255,255,0.34)", location: 0.00 },
                  { color: "rgba(255,255,255,0.02)", location: 0.28 },
                  { color: "rgba(255,255,255,0.02)", location: 0.72 },
                  { color: "rgba(255,255,255,0.40)", location: 1.00 },
                ],
                startPoint: { x: 0.5, y: 0 },
                endPoint: { x: 0.5, y: 1 },
              },
              dark: {
                gradient: [
                  { color: "rgba(0,0,0,0.34)", location: 0.00 },
                  { color: "rgba(0,0,0,0.02)", location: 0.28 },
                  { color: "rgba(0,0,0,0.02)", location: 0.72 },
                  { color: "rgba(0,0,0,0.40)", location: 1.00 },
                ],
                startPoint: { x: 0.5, y: 0 },
                endPoint: { x: 0.5, y: 1 },
              },
            }}
            frame={size}
          />
        </ZStack>
      ) : null}

      {pin ? (
        <Image
          systemName="mappin.circle.fill"
          font={isSmall ? 14 : size.height < 200 ? 17 : 20}
          foregroundStyle={COLORS.red}
          widgetAccentedRenderingMode="fullColor"
          position={{ x: pin.x, y: pin.y }}
        />
      ) : null}
    </ZStack>
  )
}
function DashboardWidget(props: WidgetProps & { layout: Layout }): VirtualNode {
  const info = props.ipInfo!
  const layout = props.layout
  const location = formatIPLocation(info)
  const displayIP = formatIPAddress(info.query, getPrivacyMode())
  const asn = info.as || info.org || info.isp || "未知 ASN"
  const accessType = props.isHomeBroadband === "家宽" ? "住宅 IP" : "机房 / 商用 IP"
  const status = layout.medium
    ? `${accessType} · 风险 ${props.riskValue}%`
    : `${props.vpnStatus === "未连接" ? "直连" : props.vpnStatus} · ${accessType} · 风险 ${props.riskValue}%`

  if (layout.large) {
    const contentHeight = Math.max(210, props.widgetSize.height - layout.padding * 2)
    return (
      <Button
        intent={RefreshIPIntent(undefined)}
        buttonStyle="plain"
        modifiers={widgetRootModifiers()}
      >
        <ZStack alignment="topLeading" frame={props.widgetSize}>
          <FullMapBackground {...props} />
          <VStack
            alignment="leading"
            spacing={0}
            frame={{ width: layout.leftWidth, height: contentHeight }}
            position={{
              x: layout.padding + layout.leftWidth / 2,
              y: props.widgetSize.height / 2,
            }}
          >
            <Text font={16} fontWeight="semibold" foregroundStyle={COLORS.title}>
              IP信息概览
            </Text>
            <Spacer />
            <VStack alignment="leading" spacing={10}>
              <DataRow icon="mappin.and.ellipse" label="位置" value={location} width={layout.leftWidth} />
              <DataRow icon="network" label="IP" value={displayIP} width={layout.leftWidth} />
              <DataRow icon="building.2" label="ASN" value={asn} width={layout.leftWidth} />
              <DataRow icon="antenna.radiowaves.left.and.right" label="ISP" value={info.isp || "未知网络"} width={layout.leftWidth} />
            </VStack>
            <Spacer />
            <RiskGauge showScale value={props.riskValue} width={layout.gaugeWidth} />
            <Spacer />
            <DataRow
              icon="shield.lefthalf.filled"
              value={status}
              valueColor={COLORS.status}
              width={layout.leftWidth}
            />
          </VStack>
        </ZStack>
      </Button>
    )
  }

  return (
    <Button
      intent={RefreshIPIntent(undefined)}
      buttonStyle="plain"
      modifiers={widgetRootModifiers()}
    >
      <ZStack alignment="topLeading" frame={props.widgetSize}>
        <FullMapBackground {...props} />

        <VStack
          alignment="leading"
          spacing={layout.medium ? 7 : 10}
          frame={{ width: layout.leftWidth }}
          position={{
            x: layout.padding + layout.leftWidth / 2,
            y: props.widgetSize.height / 2,
          }}
        >
          <Text
            font={layout.medium ? 14 : 16}
            fontWeight="semibold"
            foregroundStyle={COLORS.title}
            offset={{ x: 0, y: layout.medium ? -5 : -6 }}
          >
            IP信息概览
          </Text>
          <DataRow compact={layout.medium} icon="mappin.and.ellipse" label="位置" value={location} width={layout.leftWidth} />
          <DataRow compact={layout.medium} icon="network" label="IP" value={displayIP} width={layout.leftWidth} />
          <DataRow compact={layout.medium} icon="building.2" label="ASN" value={asn} width={layout.leftWidth} />
          <RiskGauge
            compact={layout.medium}
            showScale={!layout.medium}
            value={props.riskValue}
            width={layout.gaugeWidth}
          />
          {layout.medium ? null : (
            <DataRow icon="antenna.radiowaves.left.and.right" label="ISP" value={info.isp || "未知网络"} width={layout.leftWidth} />
          )}
          <DataRow
            compact={layout.medium}
            icon="shield.lefthalf.filled"
            value={status}
            valueColor={COLORS.status}
            width={layout.leftWidth}
          />
        </VStack>
      </ZStack>
    </Button>
  )
}

function CompactWidget(props: WidgetProps & { layout: Layout }): VirtualNode {
  const info = props.ipInfo!
  const location = formatIPLocation(info)
  const displayIP = formatIPAddress(info.query, getPrivacyMode())
  const accessType = props.isHomeBroadband === "家宽" ? "住宅 IP" : "非住宅 IP"
  const height = Math.max(118, props.widgetSize.height - 24)

  return (
    <Button
      intent={RefreshIPIntent(undefined)}
      buttonStyle="plain"
      modifiers={widgetRootModifiers()}
    >
      <ZStack alignment="topLeading" frame={props.widgetSize}>
        <FullMapBackground {...props} />
        <VStack
          alignment="leading"
          spacing={0}
          frame={{ width: props.layout.contentWidth, height }}
          position={{ x: props.widgetSize.width / 2, y: props.widgetSize.height / 2 }}
        >
        <Text font={14} fontWeight="semibold" foregroundStyle={COLORS.title}>IP信息概览</Text>
        <Spacer />
        <DataRow compact icon="mappin.and.ellipse" value={location} width={props.layout.leftWidth} />
        <Spacer />
        <DataRow compact icon="network" value={displayIP} width={props.layout.leftWidth} />
        <Spacer />
        <RiskGauge compact value={props.riskValue} width={props.layout.gaugeWidth} />
        <Spacer />
          <DataRow
            compact
            icon="shield.lefthalf.filled"
            value={`${accessType} · 风险 ${props.riskValue}%`}
            valueColor={COLORS.status}
            width={props.layout.leftWidth}
          />
        </VStack>
      </ZStack>
    </Button>
  )
}

function EmptyWidget({ message }: { message: string }) {
  return (
    <VStack
      alignment="center"
      spacing={8}
      modifiers={widgetRootModifiers()}
    >
      <Image systemName="network.slash" font={24} foregroundStyle={COLORS.red} />
      <Text foregroundStyle={COLORS.secondary}>{message}</Text>
    </VStack>
  )
}

function WidgetView(props: WidgetProps): VirtualNode {
  if (!props.ipInfo) return <EmptyWidget message="无法获取 IP 数据" />
  const layout = layoutMetrics(Widget.family, props.widgetSize)
  return layout.dashboard
    ? <DashboardWidget {...props} layout={layout} />
    : <CompactWidget {...props} layout={layout} />
}

async function getWidgetProps(): Promise<WidgetProps> {
  const widgetSize = Widget.displaySize ?? { width: 338, height: 158 }
  const layout = layoutMetrics(Widget.family, widgetSize)
  const [ipInfo, chinaIP] = await Promise.all([fetchIPInfo(), fetchChinaIP()])

  if (!ipInfo) {
    return {
      ipInfo: null,
      riskValue: 0,
      isHomeBroadband: "未知",
      isNative: "未知",
      vpnStatus: "未知",
      widgetSize,
    }
  }

  const result = calculateRiskValue(ipInfo, chinaIP)
  let mapImage: any
  let mapSize: { width: number; height: number } | undefined
  let pinPoint: { x: number; y: number } | null = null

  if ((layout.dashboard || Widget.family === "systemSmall") && hasCoordinates(ipInfo)) {
    const snapshotOptions = {
      lat: ipInfo.lat,
      lon: ipInfo.lon,
      width: widgetSize.width,
      height: widgetSize.height,
      family: Widget.family,
    }
    const [lightSnap, darkSnap] = await Promise.all([
      takeIPMapSnapshot({ ...snapshotOptions, appearance: "light" }),
      takeIPMapSnapshot({ ...snapshotOptions, appearance: "dark" }),
    ])
    const referenceSnap = lightSnap ?? darkSnap
    if (referenceSnap && lightSnap && darkSnap) {
      mapImage = { light: lightSnap.image, dark: darkSnap.image }
      mapSize = referenceSnap.size
      pinPoint = referenceSnap.point({ latitude: ipInfo.lat, longitude: ipInfo.lon })
    } else if (referenceSnap) {
      mapImage = referenceSnap.image
      mapSize = referenceSnap.size
      pinPoint = referenceSnap.point({ latitude: ipInfo.lat, longitude: ipInfo.lon })
    }
  }

  return {
    ipInfo,
    ...result,
    widgetSize,
    mapImage,
    mapSize,
    pinPoint,
  }
}

export async function renderIPWidget() {
  return <WidgetView {...await getWidgetProps()} />
}

renderIPWidget().then((view) => Widget.present(view))
