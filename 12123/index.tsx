import { Button, HStack, List, Navigation, NavigationStack, Picker, Script, Spacer, Text, TextField, VStack, Widget, useState } from "scripting";
import { ALIPAY_URL, BOXJS_DEFAULT_DOMAIN, BOXJS_DOMAIN_KEY, getRefreshMinutes, loadVehicles, refreshTokenFromBoxJS, REFRESH_MINUTES_KEY, SURGE_DEFAULT_PASSWORD, SURGE_DEFAULT_PORT, SURGE_PASSWORD_KEY, SURGE_PORT_KEY, TOKEN_KEY, getSelectedVehicleId, saveSelectedVehicle, saveToken, type Vehicle, loadWidgetData } from "./data";

function SettingsPage() {
  const dismiss = Navigation.useDismiss();
  const [token, setToken] = useState(Keychain.get(TOKEN_KEY) ?? "");
  const [refresh, setRefresh] = useState(String(getRefreshMinutes()));
  const [boxjsDomain, setBoxjsDomain] = useState(Keychain.get(BOXJS_DOMAIN_KEY) ?? BOXJS_DEFAULT_DOMAIN);
  const [surgePort, setSurgePort] = useState(Keychain.get(SURGE_PORT_KEY) ?? SURGE_DEFAULT_PORT);
  const [surgePassword, setSurgePassword] = useState(Keychain.get(SURGE_PASSWORD_KEY) ?? SURGE_DEFAULT_PASSWORD);
  const [vehicles, setVehicles] = useState<Vehicle[]>(loadVehicles());
  const [selectedVehicle, setSelectedVehicle] = useState(getSelectedVehicleId() || vehicles[0]?.id || "");

  const [message, setMessage] = useState("");
  const [previewFamily, setPreviewFamily] = useState("systemMedium");

  const handlePreview = async () => {
    await Widget.preview({ family: previewFamily as any });
  };

  const refreshVehicles = async () => {
    await loadWidgetData();
    const latest = loadVehicles();
    setVehicles(latest);
    const selected = getSelectedVehicleId() || latest[0]?.id || "";
    setSelectedVehicle(selected);
  };

  const chooseVehicle = (id: string) => {
    setSelectedVehicle(id);
    saveSelectedVehicle(id);
    setMessage("展示车辆已保存，小组件下次刷新时生效。");
  };

  const saveAll = () => {
    saveToken(token);
    Keychain.set(BOXJS_DOMAIN_KEY, boxjsDomain.trim() || BOXJS_DEFAULT_DOMAIN);
    Keychain.set(SURGE_PORT_KEY, surgePort.trim() || SURGE_DEFAULT_PORT);
    Keychain.set(SURGE_PASSWORD_KEY, surgePassword.trim() || SURGE_DEFAULT_PASSWORD);
    const minutes = Number(refresh);
    if (Number.isFinite(minutes) && minutes > 0) Keychain.set(REFRESH_MINUTES_KEY, String(Math.floor(minutes)));
    if (selectedVehicle) saveSelectedVehicle(selectedVehicle);
  };

  const save = () => {
    saveAll();
    setMessage("已保存。桌面小组件将在系统安排的时间刷新。");
  };

  const syncBoxJS = async () => {
    Keychain.set(BOXJS_DOMAIN_KEY, boxjsDomain.trim() || BOXJS_DEFAULT_DOMAIN);
    const value = await refreshTokenFromBoxJS();
    if (value) {
      setToken(value);
      await refreshVehicles();
      setMessage("已从 BoxJS 读取 Token 并保存，车辆列表已更新。");
    } else setMessage("BoxJS 未返回 wx_12123，请检查域名、代理或模块配置。");
  };

  const clear = () => {
    setToken("");
    saveToken("");
    setMessage("Token 已清除。");
  };

  const openAlipay = () => {
    Safari.openURL(ALIPAY_URL).catch((error) => console.log(String(error)));
  };

  return (
    <NavigationStack>
      <List navigationTitle="交管 12123">
        <VStack alignment="leading" spacing={10}>
          <Text font="headline" fontWeight="bold">Token 配置</Text>
          <Text font="caption" foregroundStyle="#666666">
            请从支付宝小程序“交管12123”获取 Token 后粘贴到这里或使用BoxJS自动填写。Token 只保存在本机钥匙串中。
          </Text>
          <TextField
            title="Token"
            prompt="粘贴 params=... 或 JSON 编码内容"
            value={token}
            onChanged={setToken}
          />
          <HStack spacing={10}>
            <Button title="保存" action={save} />
            <Button title="清除" action={clear} />
          </HStack>
        </VStack>
        <VStack alignment="leading" spacing={8}>
          <Text font="headline" fontWeight="bold">BoxJS 自动同步</Text>
          <Text font="caption" foregroundStyle="#666666">
            运行环境需要能够访问 BoxJS。默认读取 /query/data/wx_12123，读取成功后会自动保存到本机钥匙串。
          </Text>
          <TextField title="BoxJS 域名" prompt="例如 boxjs.net 或 boxjs.com" value={boxjsDomain} onChanged={setBoxjsDomain} />
          <HStack spacing={10}>
            <Button title="保存域名" action={() => { Keychain.set(BOXJS_DOMAIN_KEY, boxjsDomain.trim() || BOXJS_DEFAULT_DOMAIN); setMessage("BoxJS 域名已保存。"); }} />
            <Button title="立即同步 Token" action={syncBoxJS} />
          </HStack>
        </VStack>
        <VStack alignment="leading" spacing={8}>
          <Text font="headline" fontWeight="bold">Surge HTTP API</Text>
          <Text font="caption" foregroundStyle="#666666">用于 Token 失效时开启模块、请求成功后关闭模块。地址固定为本机 127.0.0.1。</Text>
          <TextField title="HTTP API 端口" prompt="例如 6166" value={surgePort} onChanged={setSurgePort} />
          <TextField title="HTTP API 密码" prompt="Surge http-api 密码" value={surgePassword} onChanged={setSurgePassword} />
        </VStack>
        <VStack alignment="leading" spacing={8}>
          <Text font="headline" fontWeight="bold">选择展示车辆</Text>
          <Text font="caption" foregroundStyle="#666666">备案后的本人车辆和非本人车辆都会列在这里。</Text>
          {vehicles.length ? (
            <Picker title="车辆" systemImage="car.fill" value={selectedVehicle} onChanged={chooseVehicle} pickerStyle="menu">
              {vehicles.map(vehicle => <Text tag={vehicle.id} key={vehicle.id}>{`${vehicle.plateNumber}（${vehicle.ownerType === "本人" ? "本人" : "非本人"}）`}</Text>)}
            </Picker>
          ) : <Text foregroundStyle="#666666">暂无车辆，请先点击刷新车辆列表。</Text>}
          <HStack spacing={10}>
            <Text>{vehicles.length ? `已读取${vehicles.length}辆车` : "未读取到车辆"}</Text>
            <Button title="刷新车辆列表" action={refreshVehicles} />
          </HStack>
        </VStack>
        <VStack alignment="leading" spacing={8}>
          <Text font="headline" fontWeight="bold">刷新设置</Text>
          <TextField title="刷新间隔（分钟）" value={refresh} onChanged={setRefresh} />
          <Button title="保存刷新设置" action={save} />
        </VStack>
        <VStack alignment="leading" spacing={8}>
          <Text font="headline" fontWeight="bold">Token 获取帮助</Text>
          <Text font="caption" foregroundStyle="#666666">
            如果接口提示 verifyToken 已过期，请打开辅助工具后进入支付宝交管12123页面，再重新复制 Token。
          </Text>
          <Button title="打开支付宝交管12123" action={openAlipay} />
        </VStack>
        {message ? <Text foregroundStyle="#2581f2">{message}</Text> : null}
        <HStack alignment="center">
          <Text>预览类型</Text>
          <Picker
            title=""
            value={previewFamily}
            onChanged={setPreviewFamily}
            pickerStyle="menu"
          >
            <Text tag="systemSmall">小组件</Text>
            <Text tag="systemMedium">中组件</Text>
            <Text tag="systemLarge">大组件</Text>
            <Text tag="systemExtraLarge">超大组件</Text>
            <Text tag="accessoryCircular">圆形配件</Text>
            <Text tag="accessoryRectangular">矩形配件</Text>
            <Text tag="accessoryInline">行内配件</Text>
          </Picker>
          <Spacer />
          <Button title="预览" action={handlePreview} />
        </HStack>
        <Button title="完成" action={() => { saveAll(); dismiss(); }} />
      </List>
    </NavigationStack>
  );
}

async function main() {
  await Navigation.present(<SettingsPage />);
  Script.exit();
}

main();
