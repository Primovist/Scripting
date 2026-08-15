import { fetch } from "scripting";

export const API_URL = "https://miniappcsfw.122.gov.cn:8443/openapi/invokeApi/business/biz";
export const ALIPAY_URL = "alipays://platformapi/startapp?appId=2019050964403523";
export const PRODUCT_ID = "p10000000000000000001";
export const TOKEN_KEY = "12123.token";
export const DATA_KEY = "12123.data";
export const REFRESH_MINUTES_KEY = "12123.refreshMinutes";
export const BOXJS_DOMAIN_KEY = "12123.boxjsDomain";
export const BOXJS_DEFAULT_DOMAIN = "boxjs.net";
export const BOXJS_TOKEN_NAME = "wx_12123";
export const VEHICLES_KEY = "12123.vehicles";
export const SELECTED_VEHICLE_KEY = "12123.selectedVehicle";
export const SURGE_PORT_KEY = "12123.surgePort";
export const SURGE_PASSWORD_KEY = "12123.surgePassword";
export const SURGE_DEFAULT_PORT = "6166";
export const SURGE_DEFAULT_PASSWORD = "";
export const SURGE_MODULE_NAME = "交管12123";

class TokenExpiredError extends Error {
  constructor() {
    super("verifyToken 已过期");
    this.name = "TokenExpiredError";
  }
}

function surgeConfig(): { url: string; key: string } {
  const port = Keychain.get(SURGE_PORT_KEY) || SURGE_DEFAULT_PORT;
  const key = Keychain.get(SURGE_PASSWORD_KEY) || SURGE_DEFAULT_PASSWORD;
  return { url: `http://127.0.0.1:${port}`, key };
}
async function setSurgeModule(enabled: boolean): Promise<void> {
  try {
    const config = surgeConfig();
    await fetch(`${config.url}/v1/modules`, {
      method: "POST",
      headers: { "X-Key": config.key, "Content-Type": "application/json" },
      body: JSON.stringify({ [SURGE_MODULE_NAME]: enabled }),
      allowInsecureRequest: true,
      timeout: 5,
      debugLabel: enabled ? "开启 12123 Token 模块" : "关闭 12123 Token 模块",
    });
  } catch (error) {
    console.log(`Surge 模块${enabled ? "开启" : "关闭"}失败：${String(error)}`);
  }
}

export async function enableTokenModule(): Promise<void> {
  await setSurgeModule(true);
}

export async function disableTokenModule(): Promise<void> {
  await setSurgeModule(false);
}
export type Vehicle = {
  id: string;
  plateNumber: string;
  ownerType: "本人" | "他人备案";
  inspectionDate?: string;
};

type ApiResult = {
  success?: boolean;
  data?: any;
  [key: string]: any;
};

export type WidgetData = {
  vehicleTitle: string;
  violationCount: string;
  vehicleStatus: string;
  updatedAt: string;
  vehicleInspectionDate: string;
  licenseTitle: string;
  licenseStatus: string;
  cumulativePoint: string;
  resetDate: string;
  licenseChangeDate: string;
  error?: string;
};

export const defaultData = (error?: string): WidgetData => ({
  vehicleTitle: "车辆",
  violationCount: "0",
  vehicleStatus: "正常",
  updatedAt: "—",
  vehicleInspectionDate: "—",
  licenseTitle: "驾驶证",
  licenseStatus: "正常",
  cumulativePoint: "0",
  resetDate: "—",
  licenseChangeDate: "—",
  error,
});

function decodeToken(token: string): { sign?: string; verifyToken?: string } {
  const raw = token.trim().replace(/^params=/, "");
  const decoded = decodeURIComponent(raw);
  const parsed = JSON.parse(decoded);
  return {
    sign: parsed.sign,
    verifyToken: parsed.verifyToken,
  };
}

async function invoke(api: string, params: { sign?: string; verifyToken?: string }): Promise<ApiResult> {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `params=${encodeURIComponent(JSON.stringify({
      api,
      productId: PRODUCT_ID,
      ...params,
    }))}`,
  });
  if (!response.ok) throw new Error(`网络请求失败（${response.status}）`);
  return (await response.json()) as ApiResult;
}

async function syncTokenFromBoxJS(): Promise<string | null> {
  const configured = Keychain.get(BOXJS_DOMAIN_KEY) || BOXJS_DEFAULT_DOMAIN;
  const domain = configured.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!domain) return null;

  try {
    const response = await fetch(`http://${domain}/query/data/${BOXJS_TOKEN_NAME}`, {
      method: "GET",
      allowInsecureRequest: true,
      timeout: 5,
      debugLabel: "12123 BoxJS Token",
    });
    if (!response.ok) return null;
    const result = (await response.json()) as { val?: unknown };
    const token = typeof result.val === "string" ? result.val.trim() : "";
    if (!token) return null;
    Keychain.set(TOKEN_KEY, token);
    return token;
  } catch (error) {
    console.log(`BoxJS Token 读取失败：${String(error)}`);
    return null;
  }
}

export async function refreshTokenFromBoxJS(): Promise<string | null> {
  return syncTokenFromBoxJS();
}
export function loadVehicles(): Vehicle[] {
  const raw = Keychain.get(VEHICLES_KEY);
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value as Vehicle[] : [];
  } catch {
    return [];
  }
}

export function getSelectedVehicleId(): string {
  return Keychain.get(SELECTED_VEHICLE_KEY) ?? "";
}

export function saveSelectedVehicle(id: string): void {
  if (id) Keychain.set(SELECTED_VEHICLE_KEY, id);
}

function normalizeVehicles(data: any): Vehicle[] {
  const own = Array.isArray(data?.vehicles) ? data.vehicles : [];
  const others = Array.isArray(data?.othersVehicles) ? data.othersVehicles : [];
  const result: Vehicle[] = [];
  const add = (item: any, ownerType: Vehicle["ownerType"], index: number) => {
    const plateNumber = String(item?.plateNumber ?? item?.vehicleNumber ?? item?.licensePlate ?? "").trim();
    if (!plateNumber) return;
    const id = String(item?.vehicleId ?? item?.vehicleNo ?? item?.id ?? `${ownerType}-${plateNumber}-${index}`);
    const inspectionDate = item?.validPeriodEnd;
    if (!result.some(vehicle => vehicle.id === id)) result.push({ id, plateNumber, ownerType, inspectionDate: typeof inspectionDate === "string" ? inspectionDate : undefined });
  };
  own.forEach((item: any, index: number) => add(item, "本人", index));
  others.forEach((item: any, index: number) => add(item, "他人备案", index));
  return result;
}
function formatDateValue(value: unknown): string {
  if (typeof value !== "string" || !value) return "—";
  const parts = value.split("-");
  return parts.length >= 3 ? `${parts[0]}-${parts[1]}-${parts[2]}` : value;
}

function firstDate(source: any, keys: string[]): string {
  for (const key of keys) {
    if (source?.[key]) return formatDateValue(source[key]);
  }
  return "—";
}
function formatTime(date = new Date()): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}


function readCache(): WidgetData | null {
  const raw = Keychain.get(DATA_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WidgetData;
  } catch {
    return null;
  }
}

export async function loadWidgetData(): Promise<WidgetData> {
  const cached = readCache();
  // 优先从 BoxJS 同步最新 Token；代理不可用时继续使用本地 Token。
  await syncTokenFromBoxJS();
  const token = Keychain.get(TOKEN_KEY);
  if (!token) return cached ?? defaultData("请先在 12123 设置 Token");

  try {
    const params = decodeToken(token);
    if (!params.sign || !params.verifyToken) throw new Error("Token 格式无效");

    const countResult = await invoke("biz.vio.unhandledVioCount.query", params);
    if (!countResult.success) throw new TokenExpiredError();

    const detailResult = await invoke("biz.user.integration.query", params);
    if (!detailResult.success) throw new TokenExpiredError();

    const illegal = detailResult.data?.list?.[0];
    const integration = detailResult.data ?? {};
    const license = integration.drivingLicense ?? {};
    const reaccDate = typeof license.reaccDate === "string" ? license.reaccDate.split("-") : [];

    const vehicles = normalizeVehicles(integration);
    if (vehicles.length) {
      Keychain.set(VEHICLES_KEY, JSON.stringify(vehicles));
      const selected = getSelectedVehicleId();
      if (!selected || !vehicles.some(vehicle => vehicle.id === selected)) saveSelectedVehicle(vehicles[0].id);
    }
    const selectedVehicleId = getSelectedVehicleId();
    const selectedVehicle = vehicles.find(vehicle => vehicle.id === selectedVehicleId) ?? vehicles[0];

    const data: WidgetData = {
      vehicleTitle: selectedVehicle?.plateNumber || "车辆",
      violationCount: String(countResult.data?.list?.[0]?.count ?? illegal?.count ?? 0),
      vehicleStatus: "正常",
      updatedAt: formatTime(),
      vehicleInspectionDate: formatDateValue(selectedVehicle?.inspectionDate),
      licenseTitle: `驾驶证${license.allowToDrive ? ` ${license.allowToDrive}` : ""}`,
      licenseStatus: "正常",
      cumulativePoint: String(license.cumulativePoint ?? 0),
      resetDate: reaccDate.length >= 3 ? `${reaccDate[1]}-${reaccDate[2]}` : "—",
      licenseChangeDate: firstDate(license, ["validityEnd"]),
    };
    Keychain.set(DATA_KEY, JSON.stringify(data));
    await disableTokenModule();
    return data;
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      await enableTokenModule();
      return defaultData("Token 已失效，点击此组件打开支付宝更新");
    }
    const message = error instanceof Error ? error.message : "数据获取失败";
    if (cached) return { ...cached, error: message };
    return defaultData(message);
  }
}

export function saveToken(token: string): void {
  const value = token.trim();
  if (value) Keychain.set(TOKEN_KEY, value);
  else Keychain.remove(TOKEN_KEY);
}

export function getRefreshMinutes(): number {
  const value = Number(Keychain.get(REFRESH_MINUTES_KEY) ?? "1440");
  return Number.isFinite(value) && value > 0 ? value : 1440;
}
