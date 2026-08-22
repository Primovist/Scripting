interface AppConfig {
  baseURL: string
  username: string
}

const CONFIG_KEY = "u60pro.webssh.config.v1"
const PASSWORD_KEY = "u60pro.webssh.password.v1"
const TOKEN_KEY = "u60pro.webssh.token.v1"

export function getConfig(): AppConfig {
  const saved = Storage.get<Partial<AppConfig>>(CONFIG_KEY) ?? {}
  return {
    baseURL: normalizeBaseURL(saved.baseURL ?? "http://192.168.0.1:8899"),
    username: String(saved.username ?? "admin"),
  }
}

export function saveConfig(config: AppConfig, password?: string): void {
  Storage.set(CONFIG_KEY, {
    baseURL: normalizeBaseURL(config.baseURL),
    username: config.username.trim(),
  })
  if (password !== undefined && password !== "") {
    Keychain.set(PASSWORD_KEY, password, {
      accessibility: "first_unlock_this_device",
    })
    Keychain.remove(TOKEN_KEY)
  }
}

export function getPassword(): string {
  return Keychain.get(PASSWORD_KEY) ?? ""
}

export function getToken(): string {
  return Keychain.get(TOKEN_KEY) ?? ""
}

export function saveToken(token: string): void {
  if (token) {
    Keychain.set(TOKEN_KEY, token, {
      accessibility: "first_unlock_this_device",
    })
  }
}

export function clearToken(): void {
  Keychain.remove(TOKEN_KEY)
}

function normalizeBaseURL(input: string): string {
  let value = String(input ?? "").trim().replace(/\/+$/, "")
  value = value.replace(/\/app(?:\/index\.html)?$/i, "")
  return value
}
