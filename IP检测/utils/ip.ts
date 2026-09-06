// File: utils/ip.ts
// 获取 IP 信息并计算风险值
import { fetch, Device } from "scripting"

export const API_URL = "http://ip-api.com/json/?lang=zh-CN"
// 国内IP查询源（3322最快最稳定）
const CHINA_IP_APIS = [
  "https://ip.3322.net",           // 首选：国内服务器，纯文本
  "https://api.ipify.org?format=json",  // 备用1：全球CDN
  "https://checkip.amazonaws.com"       // 备用2：AWS
]

export interface IPInfo {
  query: string;
  country: string;
  countryCode: string;
  regionName: string;
  city: string;
  isp: string;
  org: string;
  as: string;
  status: string;
  lat: number;
  lon: number;
}

export function formatIPLocation(
  info: Pick<IPInfo, "country" | "countryCode" | "regionName" | "city"> | null | undefined,
  fallback = "未知位置"
): string {
  if (!info) return fallback

  const code = (info.countryCode || "").toUpperCase()
  const source = `${info.country || ""} ${info.regionName || ""} ${info.city || ""}`.toLowerCase()
  const detail = [info.regionName, info.city]
    .filter((value, index, values): value is string =>
      !!value &&
      !/^(香港|香港特别行政区|澳门|澳门特别行政区|台湾|台湾省)$/i.test(value) &&
      values.indexOf(value) === index
    )

  let region: string | null = null
  if (code === "HK" || source.includes("香港") || source.includes("hong kong")) {
    region = "香港地区"
  } else if (code === "MO" || source.includes("澳门") || source.includes("macao") || source.includes("macau")) {
    region = "澳门地区"
  } else if (code === "TW" || source.includes("台湾") || source.includes("taiwan")) {
    region = "台湾省"
  }

  if (region) return ["中国", region, ...detail].join(" · ")

  return [info.country, info.regionName, info.city]
    .filter((value, index, values): value is string => !!value && values.indexOf(value) === index)
    .join(" · ") || fallback
}

const RISK_KEYWORDS = {
  dataCenter: ["数据中心", "Amazon", "Google", "Tencent", "Alibaba", "Cloudflare", "IDC", "DMIT", "Vultr", "DigitalOcean", "Linode", "OVH"],
  homeBroadband: ["电信", "移动", "联通", "宽带", "Comcast", "Verizon", "ChinaNet", "家庭", "住宅"],
  highRiskCountries: ["俄罗斯", "印度", "乌克兰"],
  vpnKeywords: ["VPN", "Proxy", "Tunnel", "虚拟", "加速器", "节点"]
};

/**
 * 获取本地活跃的网络接口信息
 */
function getLocalNetworkInfo(): { hasVPNInterface: boolean } {
  try {
    const interfaces = Device.networkInterfaces();
    const vpnInterfaceKeywords = ["utun", "ppp", "ipsec", "tun", "tap", "wireguard", "wg"];
    let hasVPNInterface = false;

    for (const [name, addresses] of Object.entries(interfaces)) {
      const lowerName = name.toLowerCase();
      // 检查是否为VPN接口
      if (vpnInterfaceKeywords.some(kw => lowerName.includes(kw))) {
        const hasExternal = addresses.some((addr: any) => !addr.isInternal && addr.family === "IPv4");
        if (hasExternal) {
          hasVPNInterface = true;
          break;
        }
      }
    }

    return { hasVPNInterface };
  } catch (e) {
    return { hasVPNInterface: false };
  }
}

/**
 * 判断是否为内网IP
 */
function isPrivateIP(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4) return false;

  // 10.0.0.0/8
  if (parts[0] === 10) return true;
  // 172.16.0.0/12
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 127.0.0.0/8 (localhost)
  if (parts[0] === 127) return true;

  return false;
}

/**
 * 分析ISP类型
 */
function analyzeISP(isp: string, org: string): {
  isDataCenter: boolean;
  isHomeBroadband: boolean;
  isVPNService: boolean;
  confidence: number;
} {
  const ispLower = isp.toLowerCase();
  const orgLower = org.toLowerCase();
  const combined = `${ispLower} ${orgLower}`;

  // 检测数据中心
  const isDataCenter = RISK_KEYWORDS.dataCenter.some(kw =>
    combined.includes(kw.toLowerCase())
  );

  // 检测家宽
  const isHomeBroadband = RISK_KEYWORDS.homeBroadband.some(kw =>
    combined.includes(kw.toLowerCase())
  );

  // 检测VPN服务商
  const isVPNService = RISK_KEYWORDS.vpnKeywords.some(kw =>
    combined.includes(kw.toLowerCase())
  );

  // 计算置信度
  let confidence = 50;
  if (isDataCenter) confidence += 30;
  if (isVPNService) confidence += 20;
  if (isHomeBroadband) confidence -= 20;

  return { isDataCenter, isHomeBroadband, isVPNService, confidence: Math.max(0, Math.min(100, confidence)) };
}

/**
 * 检测IP是否为海外（与中国大陆对比）
 */
function isOverseasIP(ipInfo: IPInfo): boolean {
  // 检查国家代码
  if (ipInfo.countryCode && ipInfo.countryCode !== "CN") {
    return true;
  }
  // 检查国家名称
  if (ipInfo.country && !ipInfo.country.includes("中国")) {
    return true;
  }
  return false;
}

/**
 * 综合判断VPN/代理状态（含多源IP对比）
 */
export function detectVPNStatus(
  ipInfo: IPInfo,
  chinaIP: string | null
): {
  isVPN: boolean;
  isProxy: boolean;
  proxyType: string;
  confidence: number;
  method: string;
} {
  const localInfo = getLocalNetworkInfo();
  const ispAnalysis = analyzeISP(ipInfo.isp, ipInfo.org);
  const intlIP = ipInfo.query;

  let vpnScore = 0;
  let isProxy = false;
  let proxyType = "";
  let methods: string[] = [];

  // 1. 多源IP对比（核心检测）
  if (chinaIP && chinaIP !== intlIP) {
    // IP不一致 = 存在分流代理/旁路由
    isProxy = true;
    proxyType = "分流代理";
    vpnScore += 50;
    methods.push("IP分流");
  }

  // 2. 地理位置异常检测（备用方案）
  // 如果查询失败，但IP显示在海外，而用户在国内，说明走了代理
  if (!chinaIP && isOverseasIP(ipInfo)) {
    // IP在海外且无法获取国内IP（说明国内直连被代理或查询失败）
    isProxy = true;
    proxyType = "代理";
    vpnScore += 45;
    methods.push("海外IP");
    console.log(`[IP检测] 检测到海外IP: ${ipInfo.country} ${intlIP}`);
  }

  // 3. VPN接口检测 (+40分)
  if (localInfo.hasVPNInterface) {
    vpnScore += 40;
    methods.push("VPN接口");
  }

  // 4. ISP分析 (+30分如果是数据中心/VPN服务)
  if (ispAnalysis.isVPNService) {
    vpnScore += 35;
    methods.push("VPN服务商");
  } else if (ispAnalysis.isDataCenter) {
    vpnScore += 25;
    methods.push("数据中心");
  }

  // 5. 如果明确是家宽，降低VPN可能性 (-20分)
  if (ispAnalysis.isHomeBroadband && !ispAnalysis.isDataCenter) {
    vpnScore -= 20;
    methods.push("家宽特征");
  }

  // 计算最终置信度
  let confidence = ispAnalysis.confidence;
  if (vpnScore > 0) {
    confidence = Math.min(95, confidence + vpnScore);
  } else {
    confidence = Math.max(5, confidence);
  }

  // 判定阈值：>= 60分认为是VPN/代理
  const isVPN = vpnScore >= 60;

  // 如果IP分流且VPN接口检测成功，认为是VPN
  if (isProxy && localInfo.hasVPNInterface) {
    return {
      isVPN: true,
      isProxy: true,
      proxyType: "VPN",
      confidence: Math.min(95, confidence),
      method: methods.join("+")
    };
  }

  return {
    isVPN,
    isProxy,
    proxyType,
    confidence,
    method: methods.length > 0 ? methods.join("+") : "直连"
  };
}

export async function fetchIPInfo(): Promise<IPInfo | null> {
  try {
    const response = await fetch(API_URL);
    return await response.json();
  } catch (error) {
    console.error("获取 IP 数据失败：", error);
    return null;
  }
}

/**
 * 获取国内出口IP（用于对比检测分流代理/旁路由）
 * 优先3322.net，2秒超时快速返回
 */
export async function fetchChinaIP(): Promise<string | null> {
  for (const apiUrl of CHINA_IP_APIS) {
    try {
      const response = await Promise.race([
        fetch(apiUrl),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("请求超时")), 2000)
        ),
      ]);

      if (response.ok) {
        const text = await response.text().catch(() => "");
        // 尝试解析JSON或直接返回IP
        let ip: string | null = null;
        try {
          const data = JSON.parse(text);
          ip = data.ip || data.query || data.origin || null;
        } catch {
          // 如果不是JSON，可能是纯文本IP
          const ipMatch = text.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
          if (ipMatch) ip = ipMatch[0];
        }

        if (ip && !isPrivateIP(ip)) {
          console.log(`[IP检测] 国内IP: ${ip} (${apiUrl})`);
          return ip;
        }
      }
    } catch (error) {
      continue;
    }
  }

  console.log("[IP检测] 国内IP查询失败，将使用地理位置备用方案");
  return null;
}

export function calculateRiskValue(ipInfo: IPInfo, chinaIP: string | null = null) {
  let riskValue = 0;

  // 使用新的VPN检测方法（含IP对比）
  const vpnStatus = detectVPNStatus(ipInfo, chinaIP);

  // ISP分析
  const ispAnalysis = analyzeISP(ipInfo.isp, ipInfo.org);

  // 风险计算
  if (vpnStatus.isVPN || vpnStatus.isProxy) {
    riskValue += vpnStatus.confidence * 0.5;
  }

  if (ispAnalysis.isDataCenter) {
    riskValue += 20;
  }

  if (ispAnalysis.isHomeBroadband) {
    riskValue -= 15;
  }

  if (RISK_KEYWORDS.highRiskCountries.some(kw => ipInfo.country.includes(kw))) {
    riskValue += 25;
  }

  riskValue = Math.max(0, Math.min(100, riskValue));

  // 状态显示文本
  let vpnStatusText = "未连接";
  if (vpnStatus.isVPN) {
    vpnStatusText = "已连接";
  } else if (vpnStatus.isProxy) {
    vpnStatusText = vpnStatus.proxyType;
  }

  return {
    riskValue: Math.round(riskValue),
    isHomeBroadband: ispAnalysis.isHomeBroadband ? "家宽" : "非家宽",
    isNative: riskValue < 50 ? "原生" : "非原生",
    vpnStatus: vpnStatusText,
    vpnConfidence: vpnStatus.confidence,
    vpnMethod: vpnStatus.method
  };
}
