import { fetch, Notification, type RequestInit } from "scripting"
import { SCRIPT_NAME, type Settings, defaultSettings } from "./constants"

const settingsKey = `${SCRIPT_NAME}:settings`

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

export function today(): string {
  return formatDate(new Date(), "yyyy-MM-dd")
}

export function formatDate(date: Date, pattern = "yyyy-MM-dd HH:mm:ss"): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, "0")
  return pattern
    .replace("yyyy", String(date.getFullYear()))
    .replace("MM", pad(date.getMonth() + 1))
    .replace("dd", pad(date.getDate()))
    .replace("HH", pad(date.getHours()))
    .replace("mm", pad(date.getMinutes()))
    .replace("ss", pad(date.getSeconds()))
}

export function formatUserMobile(input: string): string {
  const mobile = input.replace(/\D/g, "")
  if (mobile.startsWith("86")) return mobile
  if (mobile.length === 11) return `86${mobile}`
  return mobile
}

export function hidden(input?: string | null): string {
  if (!input) return ""
  return input.replace(/^(\w{5})\w*(\w{4})$/, "$1****$2")
}

export function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function md5Hex(text: string): string {
  const data = Data.fromRawString(text)
  if (!data) return ""
  return Crypto.md5(data).toHexString()
}

export function keySave(key: string, value: string | number | boolean | null | undefined) {
  if (value === undefined || value === null || value === "") return
  Keychain.set(`${SCRIPT_NAME}:${key}`, String(value), { synchronizable: true })
}

export function keyGet(key: string, fallback: string | null = null): string | null {
  return Keychain.get(`${SCRIPT_NAME}:${key}`, { synchronizable: true }) ?? fallback
}

export function keyRemove(key: string) {
  Keychain.remove(`${SCRIPT_NAME}:${key}`, { synchronizable: true })
}

export function readSettings(): Settings {
  const raw = Keychain.get(settingsKey, { synchronizable: true })
  if (!raw) return { ...defaultSettings }
  try {
    return { ...defaultSettings, ...JSON.parse(raw) }
  } catch {
    return { ...defaultSettings }
  }
}

export function writeSettings(settings: Settings) {
  Keychain.set(settingsKey, JSON.stringify({ ...readSettings(), ...settings }), { synchronizable: true })
}

export function normalizeSettings(settings: Settings): Settings {
  return {
    ...defaultSettings,
    ...settings,
    phone: settings.phone ? formatUserMobile(settings.phone) : undefined,
    totalFuelLiters: Number(settings.totalFuelLiters || 0),
  }
}

export async function notify(title: string, body: string, enabled = true) {
  if (!enabled) return
  await Notification.schedule({ title, body, sound: "default" })
}

export async function requestJSON<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, init)
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`非 JSON 响应 (${res.status}): ${text.slice(0, 160)}`)
  }
}

export async function requestText(url: string, init: RequestInit = {}): Promise<string> {
  const res = await fetch(url, init)
  return await res.text()
}
