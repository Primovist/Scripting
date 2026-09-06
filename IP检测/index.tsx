import {
  Button,
  HStack,
  List,
  Map,
  MapCircle,
  MapCompass,
  MapScaleView,
  Marker,
  Navigation,
  NavigationStack,
  Script,
  Section,
  Spacer,
  Text,
  modifiers,
  useEffect,
  useObservable,
  useState,
} from "scripting"
import { calculateRiskValue, fetchChinaIP, fetchIPInfo, formatIPLocation, IPInfo } from "./utils/ip"
import { approximateRadiusMeters, hasCoordinates } from "./utils/map"

type PageState = {
  loading: boolean
  error: string | null
  ipInfo: IPInfo | null
  riskValue: number
  isHomeBroadband: string
  isNative: string
  vpnStatus: string
}

async function loadState(): Promise<PageState> {
  const [ipInfo, chinaIP] = await Promise.all([fetchIPInfo(), fetchChinaIP()])
  if (!ipInfo) {
    return {
      loading: false,
      error: "无法获取 IP 数据",
      ipInfo: null,
      riskValue: 0,
      isHomeBroadband: "未知",
      isNative: "未知",
      vpnStatus: "未知",
    }
  }
  const result = calculateRiskValue(ipInfo, chinaIP)
  return {
    loading: false,
    error: null,
    ipInfo,
    ...result,
  }
}

function LocationMap({ info }: { info: IPInfo }) {
  const camera = useObservable(
    MapCameraPosition.region({
      center: { latitude: info.lat, longitude: info.lon },
      span: { latitudeDelta: 0.08, longitudeDelta: 0.08 },
    })
  )
  const radius = approximateRadiusMeters(info)
  const title = [info.city, info.country].filter(Boolean).join(" · ") || info.query

  return (
    <Map
      cameraPosition={camera}
      mapStyle={{
        style: "standard",
        elevation: "realistic",
        showsTraffic: false,
      }}
      annotationTitles="visible"
      controls={
        <>
          <MapCompass />
          <MapScaleView />
        </>
      }
      modifiers={modifiers()
        .frame({ height: 360 })
        .frame({ maxWidth: "infinity" })
        .clipShape({ type: "rect", cornerRadius: 16 })
      }
    >
      <MapCircle
        center={{ latitude: info.lat, longitude: info.lon }}
        radius={radius}
        fillColor="rgba(255, 59, 48, 0.16)"
        strokeColor="systemRed"
        strokeStyle={{ lineWidth: 1 }}
      />
      <Marker
        title={title}
        coordinate={{ latitude: info.lat, longitude: info.lon }}
        systemImage="network"
        tint="systemRed"
      />
    </Map>
  )
}

function IPPage() {
  const dismiss = Navigation.useDismiss()
  const [state, setState] = useState<PageState>({
    loading: true,
    error: null,
    ipInfo: null,
    riskValue: 0,
    isHomeBroadband: "未知",
    isNative: "未知",
    vpnStatus: "未知",
  })

  async function refresh() {
    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      setState(await loadState())
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: String(error),
      }))
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const info = state.ipInfo
  const located = hasCoordinates(info)
  const riskColor = state.riskValue > 60 ? "systemRed" : state.riskValue > 20 ? "systemOrange" : "systemGreen"

  async function openInMaps() {
    if (!info || !located) return
    const query = [info.city, info.regionName, info.country].filter(Boolean).join(" ") || info.query
    const items = await MapSearch.locate({
      query,
      region: {
        center: { latitude: info.lat, longitude: info.lon },
        span: { latitudeDelta: 0.2, longitudeDelta: 0.2 },
      },
    })
    if (items.length > 0) {
      await items[0].openInMaps({ mapType: "standard" })
      return
    }
    await MapSearch.locate({
      query: `${info.lat},${info.lon}`,
    }).then(async (fallback) => {
      if (fallback.length > 0) {
        await fallback[0].openInMaps()
      }
    })
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="IP 检测"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={() => dismiss()} />,
          primaryAction: <Button title="刷新" action={refresh} />,
        }}
      >
        {located ? (
          <Section>
            <LocationMap key={`${info!.lat},${info!.lon}`} info={info!} />
            <Text font={12} foregroundStyle="secondaryLabel">
              IP 定位通常只到城市，红圈表示大致范围，不是精确街道。
            </Text>
          </Section>
        ) : null}

        <Section header={<Text>当前出口</Text>}>
          {state.error ? <Text foregroundStyle="systemRed">{state.error}</Text> : null}
          <HStack>
            <Text>IP</Text>
            <Spacer />
            <Text fontWeight="semibold">{info?.query ?? (state.loading ? "加载中…" : "—")}</Text>
          </HStack>
          <HStack>
            <Text>位置</Text>
            <Spacer />
            <Text>{formatIPLocation(info, "—")}</Text>
          </HStack>
          <HStack>
            <Text>网络</Text>
            <Spacer />
            <Text lineLimit={2}>{info?.isp ?? "—"}</Text>
          </HStack>
          {located ? (
            <HStack>
              <Text>坐标</Text>
              <Spacer />
              <Text font={13} foregroundStyle="secondaryLabel">
                {info!.lat.toFixed(4)}, {info!.lon.toFixed(4)}
              </Text>
            </HStack>
          ) : null}
        </Section>

        <Section header={<Text>状态</Text>}>
          <HStack>
            <Text>VPN / 代理</Text>
            <Spacer />
            <Text fontWeight="semibold">{state.vpnStatus}</Text>
          </HStack>
          <HStack>
            <Text>线路</Text>
            <Spacer />
            <Text>{state.isNative} · {state.isHomeBroadband}</Text>
          </HStack>
          <HStack>
            <Text>风险</Text>
            <Spacer />
            <Text fontWeight="bold" foregroundStyle={riskColor}>{state.riskValue}%</Text>
          </HStack>
        </Section>

        {located ? (
          <Section footer={<Text>在系统地图中查看同一位置。</Text>}>
            <Button title="在地图中打开" action={openInMaps} />
          </Section>
        ) : null}
      </List>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present(<IPPage />)
  Script.exit()
}

run()
