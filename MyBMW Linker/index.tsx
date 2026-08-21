import {
  Button,
  HStack,
  Image,
  List,
  Map,
  Annotation,
  Circle,
  MapCompass,
  MapScaleView,
  Picker,
  Navigation,
  NavigationStack,
  Section,
  Spacer,
  Text,
  TextField,
  SecureField,
  Toggle,
  VStack,
  ZStack,
  Widget,
  useEffect,
  useColorScheme,
  useState,
  Script,
} from "scripting"
import { BMWClient } from "./bmw"
import { KEYS, type Settings, type VehicleData } from "./constants"
import { hidden, keyGet, keyRemove, normalizeSettings, readSettings, writeSettings } from "./storage"

type VehicleCoordinate = { latitude: number; longitude: number }
type PreviewFamily = "systemSmall" | "systemMedium" | "systemLarge"


function vehicleCoordinate(p: any): VehicleCoordinate | null {
  const c = p?.location?.coordinates
  const latitude = Number(c?.latitude)
  const longitude = Number(c?.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  return { latitude, longitude }
}

function fuelRows(p: any, totalFuelLiters = 0): Array<{ icon: string; value: string }> {
  const fuelLevel = p?.combustionFuelLevel
  const electricState = p?.electricChargingState
  const hasValue = (v: any) => v !== undefined && v !== null && v !== ""
  const vehicleType = String(p?.vehicleType || "").toUpperCase()
  const hasFuel = vehicleType !== "BEV" && !!fuelLevel && (hasValue(fuelLevel.remainingFuelLiters) || hasValue(fuelLevel.remainingFuelPercent))
  const hasElectric = (vehicleType === "BEV" || vehicleType === "PHEV") && !!electricState && hasValue(electricState.chargingLevelPercent)
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

function Stat({ icon, title, value }: { icon: string; title: string; value: string | number }) {
  return <HStack alignment="center" spacing={6}>
    <ZStack alignment="center" frame={{ width: 20, height: 18 }}>
      <Image systemName={icon} font="body" frame={{ width: 20, height: 18 }} />
    </ZStack>
    <Text frame={{ width: 60, alignment: "leading" }}>{title}</Text>
    <Spacer />
    <Text>{String(value || "--")}</Text>
  </HStack>
}

function StatRow({ icon, title, value }: { icon: string; title: string; value: string }) {
  return <HStack alignment="center" spacing={6}>
    <ZStack alignment="center" frame={{ width: 20, height: 18 }}>
      <Image systemName={icon} font="body" frame={{ width: 20, height: 18 }} />
    </ZStack>
    <Text frame={{ width: 60, alignment: "leading" }}>{title}</Text>
    <Spacer />
    <Text>{value || "--"}</Text>
  </HStack>
}

function LoginView({ initial, onDone }: { initial: Settings; onDone: () => void }) {
  const [phone, setPhone] = useState(initial.phone || "")
  const [mode, setMode] = useState<"sms" | "password">("password")
  const [otpId, setOtpId] = useState("")
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("默认使用密码登录。手机号会自动规范化为 86 开头；用户名和密码将安全保存到 Keychain，用于 Refresh Token 失效后自动重新登录。")

  async function sendSMS() {
    setBusy(true)
    setMessage("正在创建滑块验证码并发送短信…")
    try {
      writeSettings({ phone })
      const client = new BMWClient(normalizeSettings(readSettings()))
      const id = await client.sendLoginSMS()
      setOtpId(id)
      setMessage("短信已发送，请填写验证码。")
    } catch (e: any) {
      setMessage(`发送失败：${e?.message || e}`)
    } finally { setBusy(false) }
  }

  async function loginBySMS() {
    if (!otpId) { setMessage("请先发送短信。") ; return }
    setBusy(true)
    setMessage("正在短信登录并获取车辆…")
    try {
      writeSettings({ phone })
      const client = new BMWClient(normalizeSettings(readSettings()))
      await client.loginBySMS(otpId, code)
      setMessage("登录成功。")
      onDone()
    } catch (e: any) {
      setMessage(`登录失败：${e?.message || e}`)
    } finally { setBusy(false) }
  }

  async function loginByPassword() {
    setBusy(true)
    setMessage("正在创建滑块验证、加密密码并登录…")
    try {
      writeSettings({ phone })
      const client = new BMWClient(normalizeSettings(readSettings()))
      await client.loginByPassword(password)
      setMessage("密码登录成功。")
      onDone()
    } catch (e: any) {
      setMessage(`密码登录失败：${e?.message || e}`)
    } finally { setBusy(false) }
  }

  async function clearTokens() {
    keyRemove(KEYS.username)
    keyRemove(KEYS.password)
    keyRemove(KEYS.accessToken)
    keyRemove(KEYS.refreshToken)
    keyRemove(KEYS.refreshGcid)
    keyRemove(KEYS.tokenUpdatedAt)
    keyRemove(KEYS.correlation)
    keyRemove(KEYS.x)
    setPassword("")
    setMessage("已清除保存的账号密码及登录令牌，请重新登录。")
  }

  return <NavigationStack>
    <List navigationTitle="账号登录" navigationBarTitleDisplayMode="inline">
      <Section footer={<Text>{message}</Text>}>
        <TextField title="手机号" value={phone} onChanged={setPhone} prompt="11 位手机号，或 86 开头手机号" />
        <Picker title="登录方式" systemImage="person.crop.rectangle" value={mode === "password" ? 0 : 1} onChanged={(v: number) => { const next = v === 0 ? "password" : "sms"; setMode(next); setMessage(next === "password" ? "密码登录：会先完成滑块验证，再用 BMW 公钥加密密码提交。登录成功后凭据将保存到 Keychain，用于 Token 失效时自动续期。" : "短信验证码登录：先发送短信，再填写验证码完成登录。短信登录不会保存密码，Refresh Token 失效后需要重新登录。") }}>
          <Text tag={0}>密码登录</Text>
          <Text tag={1}>短信登录</Text>
        </Picker>
        {mode === "sms" && otpId ? <TextField title="短信验证码" value={code} onChanged={setCode} prompt="6 位验证码" /> : null}
        {mode === "password" ? <SecureField title="登录密码" value={password} onChanged={setPassword} prompt="My BMW 账号密码；安全保存到 Keychain" /> : null}
      </Section>
      <Section>
        {mode === "sms" ? <Button title={busy ? "处理中…" : "发送短信"} systemImage="paperplane" action={sendSMS} /> : null}
        {mode === "sms" ? <Button title="完成短信登录" systemImage="checkmark.seal" action={loginBySMS} /> : null}
        {mode === "password" ? <Button title={busy ? "处理中…" : "密码登录"} systemImage="key.fill" action={loginByPassword} /> : null}
        <Button title="清除登录令牌" role="destructive" systemImage="trash" action={clearTokens} />
      </Section>
    </List>
  </NavigationStack>
}

function VehicleMapView({ data }: { data: VehicleData | null }) {
  const p: any = data?.properties || {}
  const coordinate = vehicleCoordinate(p)
  const title = p.location?.address?.formatted || "车辆位置"
  const colorScheme = useColorScheme()
  const mapStyle = colorScheme === "dark" ? { style: "standard" as const, elevation: "flat" as const } : { style: "standard" as const, elevation: "flat" as const }
  if (!coordinate) return <Text>暂无车辆坐标</Text>
  return <VStack spacing={8}>
    <Map
      initialCameraPosition={MapCameraPosition.region({
        center: coordinate,
        span: { latitudeDelta: 0.01, longitudeDelta: 0.01 },
      })}
      mapStyle={mapStyle}
      controls={<>
        <MapCompass />
        <MapScaleView />
      </>}
      frame={{ height: 220 }}
    >
      <Annotation coordinate={coordinate} title="">
        <ZStack>
          <Circle fill="#2F80ED" frame={{ width: 22, height: 22 }} />
          <Image systemName="car.fill" font="caption2" foregroundStyle="white" />
        </ZStack>
      </Annotation>
    </Map>
    <Text font="caption" lineLimit={3}>{title}</Text>
  </VStack>
}

function SettingField({ label, value, onChanged }: { label: string; value: string; onChanged: (value: string) => void }) {
  return <HStack alignment="center" spacing={8} frame={{ maxWidth: Infinity }}>
    <Text>{label}</Text>
    <Spacer />
    <TextField title="" value={value} onChanged={onChanged} frame={{ width: 190 }} multilineTextAlignment="trailing" />
  </HStack>
}
function SettingsView({ settings, vehicle, onSaved }: { settings: Settings; vehicle: VehicleData | null; onSaved: () => void }) {
  const [s, setS] = useState<Settings>(settings)
  const update = (patch: Settings) => { const next = { ...s, ...patch }; setS(next); writeSettings(next); onSaved() }
  return <NavigationStack>
    <List navigationTitle="设置" navigationBarTitleDisplayMode="inline">
      <Section title="车辆与显示">
        <SettingField label="自定义车名" value={s.customName || ""} onChanged={v => update({ customName: v })} />
        <SettingField label="车牌" value={s.licensePlate || ""} onChanged={v => update({ licensePlate: v })} />
        {String((vehicle?.properties as any)?.vehicleType || "").toUpperCase() !== "BEV" ? <SettingField label="油箱容积(L)" value={String(s.totalFuelLiters || 0)} onChanged={v => update({ totalFuelLiters: Number(v) || 0 })} /> : null}
        <SettingField label="车辆图片 URL" value={s.customVehicleImage || ""} onChanged={v => update({ customVehicleImage: v })} />
        <SettingField label="Logo 图片 URL" value={s.customLogoImage || ""} onChanged={v => update({ customLogoImage: v })} />
      </Section>
      <Section title="开关">
        <Toggle title="通知提醒" value={s.notify ?? true} onChanged={v => update({ notify: v })} />
        <Toggle title="胎压/能耗趋势" value={s.showTireFuelTrend ?? false} onChanged={v => update({ showTireFuelTrend: v })} />
      </Section>
    </List>
  </NavigationStack>
}

function locationSignature(data: VehicleData | null): string {
  const p: any = data?.properties || {}
  const coordinates = p?.location?.coordinates || {}
  const latitude = Number(coordinates.latitude)
  const longitude = Number(coordinates.longitude)
  const address = String(p?.location?.address?.formatted || "")
  return `${Number.isFinite(latitude) ? latitude.toFixed(6) : ""}|${Number.isFinite(longitude) ? longitude.toFixed(6) : ""}|${address}`
}

function Dashboard() {
  const [settings, setSettings] = useState<Settings>(normalizeSettings(readSettings()))
  const [vehicle, setVehicle] = useState<VehicleData | null>(null)
  const [status, setStatus] = useState("准备就绪")
  const [loading, setLoading] = useState(false)
  const [previewFamily, setPreviewFamily] = useState<PreviewFamily>("systemLarge")
  const [lastLocationSignature, setLastLocationSignature] = useState("")
  async function refresh(force = false) {
    setLoading(true)
    setStatus("正在获取车辆数据…")
    try {
      const latest = normalizeSettings(readSettings())
      setSettings(latest)
      const data = await new BMWClient(latest).getData(force)
      setVehicle(data)
      const nextLocationSignature = locationSignature(data)
      if (nextLocationSignature && nextLocationSignature !== lastLocationSignature) {
        setLastLocationSignature(nextLocationSignature)
        Widget.reloadAll()
      }
      setStatus(data ? "更新成功" : "没有车辆数据")
      if (data?.vin && latest.vin !== data.vin) writeSettings({ vin: data.vin })
    } catch (e: any) {
      setStatus(`失败：${e?.message || e}`)
    } finally { setLoading(false) }
  }

  useEffect(() => { refresh(false) }, [])

  const p: any = vehicle?.properties || {}
  const isLocked = (p.doorsState?.combinedSecurityState || "UNLOCKED") !== "UNLOCKED"
  const range = p.combustionFuelLevel?.range || "--"
  const fuel = fuelRows(p, settings.totalFuelLiters)
  const mileage = p.currentMileage || "--"
  const consumptionTitle = fuel.some(item => item.icon === "minus.plus.batteryblock") && !fuel.some(item => item.icon === "fuelpump") ? "电耗" : "油耗"
  const consumptionValue = Array.isArray(p.averageConsumption) ? String(p.averageConsumption[1] || p.averageConsumption[0] || "--") : "--"
  const location = p.location?.address?.formatted || "--"

  async function openLogin() {
    await Navigation.present(<LoginView initial={settings} onDone={() => refresh(true)} />)
    setSettings(normalizeSettings(readSettings()))
  }

  async function openSettings() {
    await Navigation.present(<SettingsView settings={settings} vehicle={vehicle} onSaved={() => setSettings(normalizeSettings(readSettings()))} />)
  }
  async function openMap() {
    await Navigation.present(<NavigationStack><List navigationTitle="车辆位置" navigationBarTitleDisplayMode="inline"><Section><VehicleMapView data={vehicle} /></Section></List></NavigationStack>)
  }
  async function handlePreview() {
    try {
      await Widget.preview({ family: previewFamily })
    } catch (e: any) {
      setStatus(`预览失败：${e?.message || e}`)
    }
  }
  return <NavigationStack>
    <List navigationTitle="MyBMW Linker" navigationBarTitleDisplayMode="large">
      <Section>
        <VStack alignment="leading" spacing={6} padding={8}>
          <HStack>
            <Text font="title3" fontWeight="bold">{settings.customName || `${vehicle?.brand || "BMW"} ${vehicle?.model || ""}`}</Text>
            <Spacer />
            <Text>{isLocked ? "已上锁" : "已解锁"}</Text>
          </HStack>
          <Text>{vehicle?.vin ? hidden(vehicle.vin) : "未选择车辆"}</Text>
          <Text>{status}</Text>
        </VStack>
      </Section>
      <Section title="车辆状态">
         <Stat icon="globe.asia.australia" title="总里程" value={`${mileage} km`} />
         <Stat icon="map" title="续航" value={`${range} km`} />
         {fuel.map((item, index) => <StatRow icon={item.icon} title={item.icon === "fuelpump" ? "油量" : "电量"} value={item.value} key={`fuel-${index}`} />)}
         <Stat icon="flame" title={consumptionTitle} value={consumptionValue} />
        <Stat icon="location" title="位置" value={location} />
        {vehicleCoordinate(p) ? <Button title="查看车辆位置" systemImage="map" action={openMap} /> : null}
      </Section>
      <Section title="操作">
        <Button title="账号登录" systemImage="person.crop.rectangle" action={openLogin} />
        <Button title={loading ? "刷新中…" : "刷新车辆数据"} systemImage="arrow.clockwise" action={() => refresh(true)} />
        <Button title="设置" systemImage="gearshape" action={openSettings} />
        <HStack alignment="center">
          <Text>预览类型</Text>
          <Picker title="" value={previewFamily} onChanged={(v: string) => setPreviewFamily(v as PreviewFamily)} pickerStyle="menu">
            <Text tag="systemSmall">小组件</Text>
            <Text tag="systemMedium">中组件</Text>
            <Text tag="systemLarge">大组件</Text>
          </Picker>
          <Spacer />
          <Button title="预览" action={handlePreview} />
        </HStack>
      </Section>
    </List>
  </NavigationStack>
}

async function run() {
  await Navigation.present(<Dashboard />)
  Script.exit()
}

run()
