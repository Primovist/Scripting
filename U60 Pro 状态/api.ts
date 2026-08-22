import { fetch } from "scripting"
import {
  clearToken,
  getConfig,
  getPassword,
  getToken,
  saveToken,
} from "./config"
import { DashboardData, makeDashboardData, UbusMap } from "./model"

type FetchResponse = Awaited<ReturnType<typeof fetch>>

interface RPCResponse {
  id: number
  result?: [number, any]
}

const SESSION_ID = "00000000000000000000000000000000"

const BATCH_REQUESTS = [
  rpc(1, "zte_nwinfo_api", "nwinfo_get_netinfo", {}),
  rpc(5, "zwrt_data", "get_wwandst", {
    source_module: "web",
    cid: 1,
    type: 4,
  }),
  rpc(6, "zwrt_mc.device.manager", "get_device_info", {}),
  rpc(7, "zwrt_bsp.thermal", "get_cpu_temp", {}),
  rpc(11, "zwrt_router.api", "router_get_user_list_num", {}),
  rpc(14, "zwrt_wlan", "report", {}),
  rpc(15, "uci", "get", {
    config: "zwrt_common_info",
    section: "common_config",
  }),
]

export async function fetchDashboardData(): Promise<DashboardData> {
  const config = getConfig()
  if (!config.baseURL) throw new Error("请先填写 WebSSH 地址")
  if (!config.username) throw new Error("请先填写 WebSSH 用户名")
  if (!getPassword()) throw new Error("请先填写 WebSSH 密码")

  let token = getToken()
  if (!token) token = await login()

  let response = await authorizedFetch("/api/ubus", token, {
    method: "POST",
    body: JSON.stringify(BATCH_REQUESTS),
    headers: { "Content-Type": "application/json" },
  })

  if (response.status === 401) {
    clearToken()
    token = await login()
    response = await authorizedFetch("/api/ubus", token, {
      method: "POST",
      body: JSON.stringify(BATCH_REQUESTS),
      headers: { "Content-Type": "application/json" },
    })
  }

  if (!response.ok) {
    throw new Error(`状态接口请求失败（HTTP ${response.status}）`)
  }

  updateRenewedToken(response)
  const payload = (await response.json()) as RPCResponse[]
  if (!Array.isArray(payload)) throw new Error("WebSSH 返回了非预期数据")

  const map: UbusMap = {}
  for (const item of payload) {
    const code = item?.result?.[0]
    if (code === 0) map[item.id] = item.result?.[1]
  }
  if (!map[1]) throw new Error("未取得关键网络状态，请检查 WebSSH 权限")

  const [unreadSMS, qci] = await Promise.all([
    fetchUnreadSMS(token).catch(() => 0),
    fetchQCI(token).catch(() => "--"),
  ])
  return makeDashboardData(map, unreadSMS, qci)
}

export async function testConnection(): Promise<DashboardData> {
  clearToken()
  return fetchDashboardData()
}

async function login(): Promise<string> {
  const config = getConfig()
  const response = await fetch(`${config.baseURL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: config.username, pwd: getPassword() }),
    timeout: 12,
    allowInsecureRequest: true,
    debugLabel: "U60 Pro 登录",
  })

  let payload: any = null
  try {
    payload = await response.json()
  } catch {}

  if (!response.ok || payload?.code !== 0 || !payload?.token) {
    throw new Error(payload?.msg || `登录失败（HTTP ${response.status}）`)
  }
  saveToken(String(payload.token))
  return String(payload.token)
}

async function authorizedFetch(
  path: string,
  token: string,
  init: {
    method?: string
    headers?: Record<string, string>
    body?: string
  } = {},
): Promise<FetchResponse> {
  const config = getConfig()
  return fetch(`${config.baseURL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: token,
      Time: String(Date.now()),
    },
    timeout: 15,
    allowInsecureRequest: true,
    debugLabel: `U60 Pro ${path}`,
  })
}

async function fetchUnreadSMS(token: string): Promise<number> {
  const response = await authorizedFetch("/api/system/sms", token)
  if (!response.ok) return 0
  updateRenewedToken(response)
  const payload: any = await response.json()
  const messages = payload?.data?.messages
  if (!Array.isArray(messages)) return 0
  return messages.filter((message: any) => String(message?.tag) === "1").length
}

async function fetchQCI(token: string): Promise<string> {
  const response = await authorizedFetch("/api/net/ambr/get", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  })
  if (!response.ok) return "--"
  updateRenewedToken(response)
  const payload: any = await response.json()
  const data = payload?.data ?? {}
  return qciNumber(data.qci1) ?? qciNumber(data.qci2) ?? qciFromRaw(data.raw_qci) ?? "--"
}

function qciNumber(value: unknown): string | null {
  const text = String(value ?? "").trim()
  return /^\d+$/.test(text) ? String(Number(text)) : null
}

function qciFromRaw(value: unknown): string | null {
  const match = String(value ?? "").match(/\bQCI\s*[:=,]\s*(\d+)\b/i)
  return match ? String(Number(match[1])) : null
}

function updateRenewedToken(response: FetchResponse): void {
  const renewed = response.headers.get("NewToken")
  if (renewed) saveToken(renewed)
}

function rpc(id: number, service: string, method: string, params: any) {
  return {
    jsonrpc: "2.0",
    id,
    method: "call",
    params: [SESSION_ID, service, method, params],
  }
}
