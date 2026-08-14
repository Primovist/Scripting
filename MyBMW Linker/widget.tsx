import { Color, HStack, Image, Link, Spacer, Text, VStack, Widget, ZStack, fetch, gradient } from "scripting"
import { BMWClient } from "./bmw"
import { BMW_HEADERS, BMW_SERVER_HOST, DEFAULT_LOGO_LIGHT, KEYS, type Settings, type VehicleData } from "./constants"
import { hidden, keyGet, normalizeSettings, readSettings } from "./storage"

function safeText(v: any, fallback = "--") { return v === undefined || v === null || v === "" ? fallback : String(v) }

function fuelRows(p: any, totalFuelLiters = 0): Array<{ icon: string; value: string }> {
  const fuelLevel = p?.combustionFuelLevel
  const electricState = p?.electricChargingState
  const hasValue = (v: any) => v !== undefined && v !== null && v !== ""
  const hasFuel = !!fuelLevel && (hasValue(fuelLevel.remainingFuelLiters) || hasValue(fuelLevel.remainingFuelPercent))
  const hasElectric = !!electricState && hasValue(electricState.chargingLevelPercent)
  const rows: Array<{ icon: string; value: string }> = []

  // 油车：只显示油量；混动车：油量和电量分别显示。
  if (hasFuel) {
    let liters = fuelLevel.remainingFuelLiters
    const percent = fuelLevel.remainingFuelPercent
    if (!hasValue(liters) && hasValue(percent) && Number(totalFuelLiters) > 0) {
      liters = (Number(totalFuelLiters) * Number(percent) / 100).toFixed(0)
    }
    const parts: string[] = []
    if (hasValue(liters)) parts.push(`${liters}L`)
    if (hasValue(percent)) parts.push(`${percent}%`)
    rows.push({ icon: "fuelpump", value: parts.join("/") || "--" })
  }

  // 电车：只显示电量；混动车：与油量一起显示。
  if (hasElectric) {
    rows.push({ icon: "minus.plus.batteryblock", value: `${electricState.chargingLevelPercent}%` })
  }

  if (!rows.length) rows.push({ icon: "fuelpump", value: "--" })
  return rows
}

function fuelSummary(p: any, totalFuelLiters = 0): string {
  return fuelRows(p, totalFuelLiters).map(x => x.value).join(" / ")
}

type VehicleCoordinate = { latitude: number; longitude: number }

function vehicleCoordinate(p: any): VehicleCoordinate | null {
  const c = p?.location?.coordinates
  const latitude = Number(c?.latitude)
  const longitude = Number(c?.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  return { latitude, longitude }
}

function appleMapsNavigationURL(p: any): string | null {
  const coordinate = vehicleCoordinate(p)
  if (!coordinate) return null
  return `https://maps.apple.com/?daddr=${encodeURIComponent(`${coordinate.latitude},${coordinate.longitude}`)}&dirflg=d`
}

async function createMapSnapshot(p: any): Promise<string | null> {
  const coordinate = vehicleCoordinate(p)
  if (!coordinate) return null
  const dir = `${FileManager.appGroupDocumentsDirectory}/BMW Linker`
  const coordinateKey = `${coordinate.latitude.toFixed(6)}_${coordinate.longitude.toFixed(6)}`.replace(/[^0-9_-]/g, "_")
  const path = `${dir}/vehicle-map-${coordinateKey}.png`
  await FileManager.createDirectory(dir, true)
  const snap = await MapSnapshotter.take({
    // 下半个大组件尺寸；车辆保持在地图中心。
    size: { width: 340, height: 180 },
    // 约 30m 级别比例尺；通过组件中的 offset 调整地图位置。
    region: {
      center: coordinate,
      span: { latitudeDelta: 0.0007, longitudeDelta: 0.0007 },
    },
    mapStyle: { style: "standard" },
         annotations: [{ coordinate, tintColor: "#2F80ED", glyph: "car.fill" }],
  })
  const base64 = snap.image.toPNGBase64String()
  if (!base64) return null
  const data = Data.fromBase64String(base64)
  if (data) await FileManager.writeAsData(path, data)
  return `data:image/png;base64,${base64}`
}

function Row({ icon, value, width, iconColor, lineLimit = 1, font = 11, widgetURL }: { icon: string; value: string; width?: number; iconColor?: string; lineLimit?: number; font?: number | "caption2"; widgetURL?: string }) {
  const content = <HStack alignment="center" spacing={4} frame={width ? { width } : undefined}>
    <ZStack alignment="center" frame={{ width: 11, height: 14 }}>
      <Image systemName={icon} font={font} foregroundStyle={iconColor as any} />
    </ZStack>
    <Text font={font} lineLimit={lineLimit}>{value}</Text>
  </HStack>
  return widgetURL ? <Link url={widgetURL}>{content}</Link> : content
}

function tireRows(p: any, showTrend = false): Array<{ side: "left" | "right"; value: string }> {
  const tire = p?.tireState || {}
  const read = (key: string, side: "left" | "right") => {
    const status = tire?.[key]?.status
    const pressure = status?.currentPressure
    if (!pressure) return null
    let suffix = ""
    if (showTrend && status?.targetPressure) {
      const diff = pressure - status.targetPressure
      suffix = diff > 0 ? " ↑" : diff < 0 ? " ↓" : " ↔"
    } else if (!showTrend) {
      suffix = " Bar"
    }
    return { side, value: `${(pressure / 100).toFixed(1)}${suffix}` }
  }
  return [
    read("frontLeft", "left"),
    read("frontRight", "right"),
    read("rearLeft", "left"),
    read("rearRight", "right"),
  ].filter(Boolean) as Array<{ side: "left" | "right"; value: string }>
}

function controlMessages(p: any): string[] {
  const list: string[] = []
  const checks = p?.checkControlMessages
  if (Array.isArray(checks) && checks.length > 0) {
    for (const item of checks) {
      // 原脚本只使用接口返回的 name；type/severity 的映射代码是注释状态。
      if (item?.name) list.push(item.name)
    }
  }
  if (p?.doorsState?.combinedState !== "CLOSED") list.push("车门未关闭")
  if (p?.windowsState?.combinedState !== "CLOSED") list.push("车窗未关闭")
  if (p?.roofState?.roofState !== "CLOSED") list.push("天窗未关闭")
  return Array.from(new Set(list))
}

function carStatusText(p: any): string {
  const messages = controlMessages(p)
  return messages.length ? messages[0] : "ALL GOOD"
}

async function vehicleImageUrl(data: VehicleData, settings: Settings): Promise<string> {
  if (settings.customVehicleImage) return settings.customVehicleImage
  const dir = `${FileManager.appGroupDocumentsDirectory}/BMW Linker`
  const path = `${dir}/vehicle-status.png`
  await FileManager.createDirectory(dir, true)
  // 地图标记样式变更后重新生成，避免继续读取旧的红色大标记缓存。
  try {
    const token = keyGet(KEYS.accessToken)
    if (!token || !data.vin) throw new Error("no token or vin")
    const res = await fetch(`${BMW_SERVER_HOST}/eadrax-ics/v3/presentation/vehicles/${data.vin}/images?carView=VehicleStatus`, {
      method: "GET",
      headers: { ...BMW_HEADERS, authorization: `Bearer ${token}` },
    })
    const imageData = await res.data()
    await FileManager.writeAsData(path, imageData)
    return `file://${path}`
  } catch {
    return DEFAULT_LOGO_LIGHT
  }
}

function doorWindowStatus(p: any): { ok: boolean; text: string; icon: string } {
  if (p?.doorsState?.combinedSecurityState === "UNLOCKED") return { ok: false, text: "已解锁", icon: "exclamationmark.shield" }
  if (p?.doorsState?.combinedState === "CLOSED" && p?.windowsState?.combinedState === "CLOSED") {
    let text = "门窗已关闭"
    let ok = true
    if (p?.roofState?.roofState && p.roofState.roofState !== "CLOSED") { text = "天窗未关闭"; ok = false }
    if (p?.doorsState?.hood === "OPEN") { text = "引擎盖打开"; ok = false }
    if (p?.doorsState?.trunk === "OPEN") { text = "后备箱打开"; ok = false }
    return { ok, text, icon: ok ? "checkmark.shield" : "exclamationmark.shield" }
  }
  return { ok: false, text: "门窗未关闭", icon: "exclamationmark.shield" }
}

function VehicleContent({ data, settings, carImageUrl, compact = false }: { data: VehicleData; settings: Settings; carImageUrl: string; compact?: boolean }) {
  const p: any = data.properties || {}
  const isLocked = (p.doorsState?.combinedSecurityState || "UNLOCKED") !== "UNLOCKED"
  const doorStatus = doorWindowStatus(p)
  const controlStatus = controlMessages(p)
  const width = compact ? 112 : 132
  const imageWidth = compact ? 112 : 144
  const imageHeight = compact ? 70 : 90
  const titleFont = compact ? 15 : 20
  return <Link url="de.bmw.connected.mobile20.cn://"><VStack alignment="center" spacing={compact ? 0 : 2} frame={{ width }}>
    <HStack alignment="center" spacing={0} frame={{ width }} offset={compact ? { x: 0, y: 0 } : { x: 8, y: 6 }}>
      <Spacer />
      {settings.showSignInIcon ? <Image imageUrl="https://m.qqtlr.com/signin.png" resizable scaleToFit renderingMode="template" foregroundStyle={{ light: "#4A4A4A", dark: "#FFFFFF" }} frame={{ width: compact ? 16 : 20, height: compact ? 16 : 20 }} offset={compact ? { x: 2, y: 2 } : { x: 4, y: 4 }} /> : null}
    </HStack>
    <ZStack alignment="topLeading" frame={{ width, height: imageHeight }} offset={compact ? { x: 0, y: 0 } : { x: 0, y: -5 }}>
      <VStack alignment="leading" spacing={-3} frame={{ width: compact ? 62 : 76, height: compact ? 34 : 40 }} offset={{ x: compact ? -8 : -14, y: 0 }}>
        {controlStatus.length === 0 ? <VStack alignment="leading" spacing={-4}>
          <Text font={titleFont} fontWeight="bold" opacity={0.72}>ALL</Text>
          <Text font={titleFont} fontWeight="bold" opacity={0.72}>GOOD</Text>
        </VStack> : <VStack alignment="leading" spacing={1}>
          {controlStatus.slice(0, 3).map((message, index) => <HStack spacing={2} key={`control-${index}`}>
            <Image systemName="exclamationmark.circle" font="caption2" foregroundStyle="systemRed" />
            <Text font="caption2" lineLimit={1}>{message}</Text>
          </HStack>)}
        </VStack>}
      </VStack>
      <HStack alignment="bottom" frame={{ width, height: imageHeight }}>
        <Spacer />
        <Image imageUrl={carImageUrl} resizable scaleToFit frame={{ width: imageWidth, height: imageHeight }} />
      </HStack>
    </ZStack>
    <HStack spacing={2} frame={{ width }} offset={compact ? { x: 0, y: -2 } : { x: 0, y: -6 }}>
      <Spacer />
      <Image systemName={doorStatus.icon} font="caption2" foregroundStyle={doorStatus.ok ? "systemGreen" : "systemOrange"} />
      <Text font="caption2" lineLimit={1}>{doorStatus.text}</Text>
      <Spacer />
    </HStack>
  </VStack></Link>
}

function widgetBackground() {
  return { light: "#B8DCFF", dark: "#0B2D52" } as any
}

function LargeTopWidget({ data, settings, carImageUrl }: { data: VehicleData; settings: Settings; carImageUrl: string }) {
  const p: any = data.properties || {}
  const isLocked = (p.doorsState?.combinedSecurityState || "UNLOCKED") !== "UNLOCKED"
  const name = settings.customName || `${data.brand || "BMW"} ${data.model || ""}`
  const avg = Array.isArray(p.averageConsumption) ? `${p.averageConsumption[1] || p.averageConsumption[0] || "--"}` : "--"
  const fuel = fuelRows(p, settings.totalFuelLiters)
  const tires = tireRows(p, settings.showTireFuelTrend ?? false)
  const address = p.location?.address?.formatted || "暂无位置"
  const doorStatus = doorWindowStatus(p)
  const controlStatus = controlMessages(p)
  return <VStack alignment="leading" spacing={3} padding={{ top: 0, leading: 6, bottom: 2, trailing: 8 }} frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
    <HStack spacing={5} offset={{ x: 0, y: -2 }}>
      <Text font="title2" fontWeight="bold" lineLimit={1} frame={{ maxWidth: Infinity }}>{name}</Text>
      <Text font="caption" lineLimit={1} frame={{ width: 78 }}>{settings.licensePlate || data.licensePlate || hidden(data.vin)}</Text>
      <Image imageUrl={settings.customLogoImage || DEFAULT_LOGO_LIGHT} resizable scaleToFit frame={{ width: 48, height: 24 }} />
    </HStack>

    <HStack spacing={4}>
      <VStack alignment="leading" spacing={2} frame={{ width: 174 }}> 
        <VStack alignment="leading" spacing={2} frame={{ width: 174 }}>
          <HStack spacing={10}>
          <VStack alignment="leading" spacing={3} frame={{ width: 82 }}>
            <Row icon="globe.asia.australia" value={`${safeText(p.currentMileage)}km`} />
            {fuel[0] ? <Row icon={fuel[0].icon} value={fuel[0].value} /> : null}
            {tires[0] ? <Row icon={tires[0].side === "left" ? "l.circle" : "r.circle"} value={tires[0].value} /> : null}
            {tires[2] ? <Row icon={tires[2].side === "left" ? "l.circle" : "r.circle"} value={tires[2].value} /> : null}
          </VStack>
          <VStack alignment="leading" spacing={3} frame={{ width: 82 }}>
            <Row icon="map" value={`${safeText(p.combustionFuelLevel?.range)}km`} />
            <Row icon="flame" value={avg} />
            {tires[1] ? <Row icon={tires[1].side === "left" ? "l.circle" : "r.circle"} value={tires[1].value} /> : null}
            {tires[3] ? <Row icon={tires[3].side === "left" ? "l.circle" : "r.circle"} value={tires[3].value} /> : null}
          </VStack>
          </HStack>
          <VStack alignment="leading" spacing={4} frame={{ width: 174 }} offset={{ x: 5, y: 0 }}>
            <Row icon={isLocked ? "lock.shield" : "xmark.shield"} value={`${isLocked ? "已上锁" : "已解锁"} ${formatStatus(p.lastUpdatedAt)} 更新`} iconColor={isLocked ? "systemGreen" : "systemRed"} lineLimit={1} />
            <Row icon="location" value={address} iconColor="systemBlue" lineLimit={2} />
          </VStack>
        </VStack>
      </VStack>

      <VehicleContent data={data} settings={settings} carImageUrl={carImageUrl} />
    </HStack>
  </VStack>
}

function LoadingWidget({ message }: { message: string }) {
  return <VStack alignment="leading" spacing={8} padding={12} widgetURL="scripting://run/BMW%20Linker">
    <Text font="headline">MyBMW Linker</Text>
    <Text font="caption">{message}</Text>
  </VStack>
}

function SmallWidget({ data, settings, carImageUrl }: { data: VehicleData; settings: Settings; carImageUrl: string }) {
  const p: any = data.properties || {}
  const isLocked = (p.doorsState?.combinedSecurityState || "UNLOCKED") !== "UNLOCKED"
  const plate = settings.licensePlate || data.licensePlate || hidden(data.vin)
  const smallStatus = `${isLocked ? "已上锁" : "已解锁"} ${formatStatus(p.lastUpdatedAt)} 更新`
  return <VStack alignment="center" spacing={3} frame={{ maxWidth: Infinity, maxHeight: Infinity }} padding={8} background={widgetBackground()}>
    <HStack alignment="center" spacing={6} frame={{ maxWidth: Infinity }}>
      <Spacer />
      <Text font="caption" lineLimit={1}>{plate}</Text>
      <Image imageUrl={settings.customLogoImage || DEFAULT_LOGO_LIGHT} resizable scaleToFit frame={{ width: 28, height: 18 }} />
    </HStack>
    <VehicleContent data={data} settings={settings} carImageUrl={carImageUrl} compact />
    <Row icon={isLocked ? "lock.shield" : "xmark.shield"} value={smallStatus} iconColor={isLocked ? "systemGreen" : "systemRed"} font="caption2" lineLimit={1} />
  </VStack>
}

function MediumWidget({ data, settings, carImageUrl }: { data: VehicleData; settings: Settings; carImageUrl: string }) {
  return <VStack alignment="leading" padding={{ top: 8, leading: 0, bottom: 0, trailing: 0 }} frame={{ maxWidth: Infinity }} background={widgetBackground()}>
    <LargeTopWidget data={data} settings={settings} carImageUrl={carImageUrl} />
  </VStack>
}

function LargeWidget({ data, settings, mapImageUrl, carImageUrl }: { data: VehicleData; settings: Settings; mapImageUrl?: string | null; carImageUrl: string }) {
  const p: any = data.properties || {}
  const address = p.location?.address?.formatted || "暂无位置"
  const mapURL = appleMapsNavigationURL(p)
  return <VStack alignment="leading" spacing={0} padding={0} background={widgetBackground()} frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
    <LargeTopWidget data={data} settings={settings} carImageUrl={carImageUrl} />
    {mapImageUrl ? <Link url={mapURL || "maps:"}><Image imageUrl={mapImageUrl} resizable scaleToFill frame={{ maxWidth: Infinity, height: 180 }} offset={{ x: 0, y: 0 }} /></Link> : <Link url={mapURL || "maps:"}><VStack frame={{ maxWidth: Infinity, height: 180 }} alignment="leading" padding={12}><Text font="caption" lineLimit={3}>{address}</Text></VStack></Link>}
  </VStack>
}

function formatStatus(lastUpdatedAt?: string): string {
  if (!lastUpdatedAt) return "--"
  const d = new Date(lastUpdatedAt)
  if (Number.isNaN(d.getTime())) return "--"
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function main() {
  const settings = normalizeSettings(readSettings())
  if (!settings.phone) {
    Widget.present(<LoadingWidget message="请先打开脚本配置 BMW 账号" />)
    return
  }
  try {
    const data = await new BMWClient(settings).getData(false)
    if (!data) { Widget.present(<LoadingWidget message="暂无车辆数据" />); return }
    if (Widget.family === "systemSmall" || Widget.family === "accessoryRectangular") Widget.present(<SmallWidget data={data} settings={settings} carImageUrl={await vehicleImageUrl(data, settings)} />)
    else if (Widget.family === "systemLarge" || Widget.family === "systemExtraLarge") {
      const mapImageUrl = await createMapSnapshot(data.properties || {}).catch(() => null)
      const carImageUrl = await vehicleImageUrl(data, settings)
      Widget.present(<LargeWidget data={data} settings={settings} mapImageUrl={mapImageUrl} carImageUrl={carImageUrl} />)
    }
    else Widget.present(<MediumWidget data={data} settings={settings} carImageUrl={await vehicleImageUrl(data, settings)} />)
  } catch (e: any) {
    Widget.present(<LoadingWidget message={e?.message || String(e)} />)
  }
}

main()
