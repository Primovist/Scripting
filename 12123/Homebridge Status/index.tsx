import { Button, List, Navigation, NavigationStack, Section, Text, TextField, Widget, useState, Script } from "scripting"

const configDirectory = `${FileManager.appGroupDocumentsDirectory}/homebridgeStatus`
const configPath = `${configDirectory}/config.json`

type SavedConfig = {
  username: string
  password: string
  baseUrl: string
}

function readConfig(): SavedConfig {
  try {
    if (FileManager.existsSync(configPath)) {
      return JSON.parse(FileManager.readAsStringSync(configPath))
    }
  } catch (_) {
    // Use empty defaults when the saved file is unavailable or invalid.
  }
  return { username: "", password: "", baseUrl: "" }
}

function ConfigView() {
  const saved = readConfig()
  const [username, setUsername] = useState(saved.username)
  const [password, setPassword] = useState(saved.password)
  const [baseUrl, setBaseUrl] = useState(saved.baseUrl)
  const [message, setMessage] = useState("")

  function save() {
    const config: SavedConfig = {
      username: username.trim(),
      password: password.trim(),
      baseUrl: baseUrl.trim().replace(/\/$/, "")
    }
    if (!config.baseUrl) {
      setMessage("请填写 Homebridge 地址")
      return
    }
    FileManager.createDirectorySync(configDirectory, true)
    FileManager.writeAsStringSync(configPath, JSON.stringify(config, null, 2))
    Widget.reloadAll()
    setMessage("配置已保存，小组件将自动刷新")
  }

  return (
    <NavigationStack>
      <List navigationTitle="Homebridge Status">
        <Section title="说明">
          <Text>填写用户名、密码和 Homebridge 地址后，点击保存配置。</Text>
          <Text>如果 Homebridge 允许免登录访问，用户名和密码可以留空。</Text>
        </Section>
        <Section title="Homebridge 连接设置">
          <TextField title="用户名" value={username} onChanged={setUsername} />
          <TextField title="密码" value={password} onChanged={setPassword} />
          <TextField title="地址" value={baseUrl} onChanged={setBaseUrl} prompt="https://example.com:8581" />
        </Section>
        <Section>
          <Button title="保存配置" action={save} />
          <Button title="预览小组件" action={() => Widget.preview()} />
          {message ? <Text foregroundStyle="secondaryLabel">{message}</Text> : null}
        </Section>
      </List>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present(<ConfigView />)
  Script.exit()
}

run()
