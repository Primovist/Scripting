import {
  Button,
  HStack,
  List,
  Navigation,
  NavigationStack,
  ProgressView,
  Script,
  Section,
  SecureField,
  Text,
  TextField,
  Widget,
  useState,
} from "scripting"
import { testConnection } from "./api"
import { getConfig, saveConfig } from "./config"

function SettingsView() {
  const dismiss = Navigation.useDismiss()
  const initial = getConfig()
  const [baseURL, setBaseURL] = useState(initial.baseURL)
  const [username, setUsername] = useState(initial.username)
  const [password, setPassword] = useState("")
  const [testing, setTesting] = useState(false)

  const persist = () => {
    saveConfig({ baseURL, username }, password || undefined)
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="U60 Pro 状态"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: [<Button title="关闭" action={dismiss} />],
          confirmationAction: [
            <Button
              title="保存"
              action={() => {
                persist()
                Widget.reloadUserWidgets()
                dismiss()
              }}
            />,
          ],
        }}
      >
        <Section
          header={<Text>WebSSH-u60pro</Text>}
          footer={
            <Text foregroundStyle="secondaryLabel">
              地址请填写到 WebSSH 根路径；若设置了 WebBaseDir，也要包含该路径。HTTP 局域网地址可直接使用。
            </Text>
          }
        >
          <HStack spacing={12}>
            <Text>地址</Text>
            <TextField
              title=""
              value={baseURL}
              onChanged={setBaseURL}
              prompt="http://192.168.0.1:8899"
              keyboardType="URL"
              textInputAutocapitalization="never"
              autocorrectionDisabled
              multilineTextAlignment="trailing"
              frame={{ maxWidth: "infinity" }}
            />
          </HStack>
          <HStack spacing={12}>
            <Text>用户名</Text>
            <TextField
              title=""
              value={username}
              onChanged={setUsername}
              prompt="admin"
              textInputAutocapitalization="never"
              autocorrectionDisabled
              multilineTextAlignment="trailing"
              frame={{ maxWidth: "infinity" }}
            />
          </HStack>
          <HStack spacing={12}>
            <Text>密码</Text>
            <SecureField
              title=""
              value={password}
              onChanged={setPassword}
              prompt="留空保留已保存密码"
              multilineTextAlignment="trailing"
              frame={{ maxWidth: "infinity" }}
            />
          </HStack>
        </Section>

        <Section>
          <Button
            disabled={testing}
            action={async () => {
              persist()
              setTesting(true)
              try {
                const data = await testConnection()
                await Dialog.alert({
                  title: "连接成功",
                  message: `${data.model}\n${data.providerAndType} · ${data.band}\n今日 ${data.dailyValue}${data.dailyUnit}`,
                })
              } catch (error) {
                await Dialog.alert({
                  title: "连接失败",
                  message: String(error instanceof Error ? error.message : error),
                })
              } finally {
                setTesting(false)
              }
            }}
          >
            {testing ? <ProgressView /> : <Text>测试连接</Text>}
          </Button>
          <Button
            title="预览组件"
            action={async () => {
              persist()
              await Widget.preview({ family: "systemMedium" })
            }}
          />
        </Section>

        <Section>
          <Text>点击整个小组件即可刷新。密码保存在当前脚本独立的系统钥匙串中。数据字段与 WebSSH-u60pro 首页的 UBUS 批量请求保持一致。温度显示为“CPU温度|电池温度”。</Text>
        </Section>
      </List>
    </NavigationStack>
  )
}

// 此设置页不需要保留运行状态。下滑收起根界面时直接结束实例，
// 同时监听最小化事件，兼容系统已开始执行收起流程的情况。
Script.enableMinimize(false)
Script.onMinimize(() => Script.exit())

;(async () => {
  try {
    await Navigation.present({ element: <SettingsView /> })
  } catch (error) {
    await Dialog.alert({ title: "错误", message: String(error) })
  } finally {
    Script.exit()
  }
})()
