import { fetch } from "scripting"

// --- 全局声明 ---
declare const Storage: any

// --- 常量与配置 ---
const CACHE_KEY = 'sgcc_data_cache'
const SETTINGS_KEY = 'sgccSettings'

// --- 类型定义 ---
export interface SGCCSettings {
  barCount: number          // 图表显示条数（日：7/15/30，月：3/6/12）
  dimension: 'daily' | 'monthly' // 图表维度
  oneLevelPq: number        // 一阶电量阈值
  twoLevelPq: number        // 二阶电量阈值
  refreshInterval: number   // 刷新间隔(分钟)
  largeWidgetRange: '7days' | '30days' | '12months' // 大尺寸组件显示范围
}

export const DEFAULT_SETTINGS: SGCCSettings = {
  barCount: 7,
  dimension: 'daily',
  oneLevelPq: 2760,
  twoLevelPq: 4800,
  refreshInterval: 180,
  largeWidgetRange: '7days'
}

export interface BarData {
  value: number
  level: number
  label?: string // 可选：用于显示日期或其他标签
}

// --- 设置管理 ---

/** 获取设置，自动合并默认值 */
export function getSettings(): SGCCSettings {
  try {
    const s = Storage.get(SETTINGS_KEY)
    return s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

/** 保存设置 */
export function saveSettings(settings: SGCCSettings) {
  try {
    Storage.set(SETTINGS_KEY, JSON.stringify(settings))
  } catch (e) {
    console.error('[API] Save settings failed:', e)
  }
}

// --- 数据获取 ---

function getCachedData() {
  try {
    const cacheString = Storage.get(CACHE_KEY)
    if (cacheString) return JSON.parse(cacheString)
  } catch (e) { }
  return null
}

function saveCachedData(data: any) {
  try {
    Storage.set(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data }))
  } catch (e) { }
}

function isSameLocalDay(timestamp: number, now = new Date()): boolean {
  const cachedDate = new Date(timestamp)
  return Number.isFinite(timestamp)
    && !isNaN(cachedDate.getTime())
    && cachedDate.getFullYear() === now.getFullYear()
    && cachedDate.getMonth() === now.getMonth()
    && cachedDate.getDate() === now.getDate()
}

/** 获取缓存；仅当缓存不是今天的数据时才联网刷新 */
export async function getElectricityData(forceRefresh = false) {
  const cachedData = getCachedData()

  // 先检查缓存时间：当天数据直接展示，跨日数据才联网刷新。
  if (cachedData && !forceRefresh && isSameLocalDay(Number(cachedData.timestamp))) {
    console.log('[API] Using today\'s cached data')
    return { data: cachedData.data, timestamp: cachedData.timestamp }
  }

  try {
    const url = 'http://api.wsgw-rewrite.com/electricity/bill/all?monthElecQuantity=1&dayElecQuantity31=1&stepElecQuantity=1&eleBill=1'
    const response = await fetch(url)
    const data = await response.json()

    if (data) {
      saveCachedData(data)
      return { data, timestamp: Date.now() }
    }
  } catch (error) {
    console.error('[API] Network request failed:', error)
    if (cachedData) return { data: cachedData.data, timestamp: cachedData.timestamp }
  }
  return { data: [], timestamp: Date.now() }
}

/** 获取指定或者当前设置户号的数据 */
export async function getAccountData(forceRefresh = false, accountIndex = 0): Promise<any> {
  const settings = getSettings()
  const result = await getElectricityData(forceRefresh)
  const allData = result.data
  const timestamp = result.timestamp

  if (allData && allData.length > 0) {
    const index = Math.min(Math.max(0, accountIndex), allData.length - 1)
    return { ...allData[index], lastUpdateTime: timestamp }
  }

  // 返回默认空结构，防止 UI 报错
  return {
    eleBill: { sumMoney: "0.00" },
    arrearsOfFees: false,
    stepElecQuantity: [],
    monthElecQuantity: { dataInfo: {}, mothEleList: [] },
    dayElecQuantity31: { sevenEleList: [] },
    lastUpdateTime: Date.now()
  }
}

// --- 业务逻辑处理 ---

function getMonthValue(item: any): number {
  return Number(item?.monthEleNum || item?.eleNum || item?.usage || item?.monthElec || 0) || 0
}

function getMonthLabel(item: any): string {
  return String(item?.month || item?.monthDate || item?.date || item?.yearMonth || item?.ym || '')
}

function parseMonthKey(item: any): number | null {
  const label = getMonthLabel(item)
  const match = label.match(/(\d{4})\D?(\d{1,2})/)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null

  return year * 100 + month
}

function previousMonthKey(date = new Date()): number {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const previousYear = month === 1 ? year - 1 : year
  const previousMonth = month === 1 ? 12 : month - 1
  return previousYear * 100 + previousMonth
}

function shiftMonthKey(monthKey: number, offset: number): number {
  const year = Math.floor(monthKey / 100)
  const month = monthKey % 100
  const d = new Date(year, month - 1 + offset, 1)
  return d.getFullYear() * 100 + d.getMonth() + 1
}

function buildMonthlyBarData(data: any, settings: SGCCSettings, count: number): BarData[] {
  const mothEleList = data.monthElecQuantity?.mothEleList || []
  const parsedItems = mothEleList
    .map((item: any) => ({ item, monthKey: parseMonthKey(item), value: getMonthValue(item) }))
    .filter(({ value }: any) => Number.isFinite(value))

  if (parsedItems.some(({ monthKey }: any) => monthKey !== null)) {
    const sorted = parsedItems
      .filter(({ monthKey }: any) => monthKey !== null)
      .sort((a: any, b: any) => a.monthKey - b.monthKey)

    const endKey = previousMonthKey()
    const startKey = shiftMonthKey(endKey, -(count - 1))
    const ranged = sorted.filter(({ monthKey }: any) => monthKey >= startKey && monthKey <= endKey)
    const source = ranged.length > 0 ? ranged : sorted.slice(-count)

    return source.map(({ item, monthKey, value }: any) => ({
      value,
      level: 1,
      label: getMonthLabel(item) || String(monthKey)
    }))
  }

  // 没有月份标签时无法跨年定位，只能按接口/缓存顺序取最后 count 条。
  return parsedItems.slice(-count).map(({ item, value }: any) => ({
    value,
    level: 1,
    label: getMonthLabel(item)
  }))
}

/** 处理图表数据：计算阶梯和数值 */
export function processBarChartData(data: any, settings: SGCCSettings): BarData[] {
  const { oneLevelPq, twoLevelPq, barCount, dimension } = settings

  let barData: BarData[] = []

  if (dimension === 'monthly') {
    // A. 月度模式：允许跨年，从接口/缓存月度数据中按当前月份之前的连续月份取数。
    return buildMonthlyBarData(data, settings, barCount)
  } else {
    // B. 日度模式 (默认)
    const mothEleList = data.monthElecQuantity?.mothEleList || []
    const monthlyData: { yearTotal: number; monthElec: number; level: number }[] = []
    let yearTotal = 0

    for (const item of mothEleList) {
      const n = getMonthValue(item)
      yearTotal += n
      const level = yearTotal > twoLevelPq ? 3 : yearTotal > oneLevelPq ? 2 : 1
      monthlyData.push({ yearTotal, monthElec: n, level })
    }
    const sevenEleList = data.dayElecQuantity31?.sevenEleList || []
    const currentYear = new Date().getFullYear()

    for (const { day, dayElePq } of sevenEleList) {
      if (dayElePq && !isNaN(Number(dayElePq))) {
        const match = day.match(/^(\d{4})\D?(\d{2})/)
        if (match) {
          const year = Number(match[1])
          const month = Number(match[2])
          let level = 1

          // 仅当是今年数据时，尝试匹配对应月份的阶梯
          if (currentYear === year) {
            // mothEleList通常按时间顺序排列，但月份索引需要小心处理
            // 简单映射：假设 monthlyData 索引 0 是 1月 (需要确认数据源顺序，原代码逻辑如下)
            // 原代码：Math.min(monthlyData.length - 1, month - 1)
            const safeIndex = Math.max(0, Math.min(monthlyData.length - 1, month - 1))
            level = monthlyData[safeIndex]?.level || 1
          }

          barData.unshift({ value: Number(dayElePq), level, label: day })
        }
      }
    }
  }

  // 截取指定数量
  return barData.slice(-barCount)
}

/** 获取大组件数据（根据 largeWidgetRange 设置） */
export function processLargeWidgetData(data: any, settings: SGCCSettings): BarData[] {
  if (!data) return []

  const { largeWidgetRange } = settings

  // 获取月度数据
  const monthlyData = data.monthElecQuantity?.mothEleList || []

  if (largeWidgetRange === '12months') {
    // 12个月数据
    return monthlyData.map((item: any) => ({
      value: getMonthValue(item),
      level: item.level || 1,
      label: getMonthLabel(item)
    })).slice(-12)
  }

  // 日度数据
  const sevenEleList = data.dayElecQuantity31?.sevenEleList || []
  const currentYear = new Date().getFullYear()

  const dailyData: BarData[] = []
  for (const { day, dayElePq } of sevenEleList) {
    if (dayElePq && !isNaN(Number(dayElePq))) {
      const match = day.match(/^(\d{4})\D?(\d{2})/)
      if (match) {
        const year = Number(match[1])
        const month = Number(match[2])
        let level = 1

        if (currentYear === year) {
          const safeIndex = Math.max(0, Math.min(monthlyData.length - 1, month - 1))
          level = monthlyData[safeIndex]?.level || 1
        }

        dailyData.unshift({ value: Number(dayElePq), level, label: day })
      }
    }
  }

  // 根据设置返回7天或30天
  const count = largeWidgetRange === '30days' ? 30 : 7
  return dailyData.slice(-count)
}

function getCurrentMonthDailyUsage(data: any): number {
  const now = new Date()
  const prefix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  const dayList = data.dayElecQuantity31?.sevenEleList || []

  return dayList
    .filter((item: any) => String(item?.day || '').startsWith(prefix))
    .reduce((sum: number, item: any) => sum + (Number(item?.dayElePq) || 0), 0)
}

/** 提取关键展示数据 (余额, 上期, 年度等) */
export function extractDisplayData(data: any) {
  const balance = data.eleBill?.sumMoney || "0.00"
  const hasArrear = !!data.arrearsOfFees

  // 上期数据 (优先尝试取最后一月，否则取阶梯数据中的第一项)
  let lastBill = "0.00"
  let lastUsage = "0"

  if (data.monthElecQuantity?.mothEleList?.length > 0) {
    const list = data.monthElecQuantity.mothEleList
    const last = list[list.length - 1]
    if (last) {
      lastBill = last.monthEleCost || last.cost || last.eleCost || "0.00"
      lastUsage = last.monthEleNum || last.eleNum || last.usage || "0"
    }
  } else if (data.stepElecQuantity?.[0]?.electricParticulars) {
    const p = data.stepElecQuantity[0].electricParticulars
    lastBill = p.totalAmount || "0.00"
    lastUsage = p.totalPq || "0"
  }

  // 阶梯进度分子：当年已结算月份累计电量 + 当月日用电量累计。
  // 当月电量按 dayElecQuantity31.sevenEleList 中当前年月的 dayElePq 求和。
  const yearBill = data.monthElecQuantity?.dataInfo?.totalEleCost || "0"
  const yearBase = Number(data.monthElecQuantity?.dataInfo?.totalEleNum || 0) || 0
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const dayList = data.dayElecQuantity31?.sevenEleList || []
  const monthData = data.monthElecQuantity?.mothEleList || []

  const sumForMonth = (targetYear: number, targetMonth: number): number => {
    const prefix = `${targetYear}${String(targetMonth).padStart(2, '0')}`
    return dayList
      .filter((item: any) => String(item?.day || '').startsWith(prefix))
      .reduce((sum: number, item: any) => sum + (Number(item?.dayElePq) || 0), 0)
  }

  let currentMonthEle = sumForMonth(year, month)

  // 当月没有日数据时：如果月数据已有上月记录，保持当月为 0；
  // 如果没有上月记录，则回退使用上月日用电量。
  if (currentMonthEle === 0) {
    const previousYear = month === 1 ? year - 1 : year
    const previousMonth = month === 1 ? 12 : month - 1
    const previousLabel = `${previousYear}${String(previousMonth).padStart(2, '0')}`
    const hasPreviousMonthData = monthData.some((item: any) => {
      const label = String(item?.month || item?.monthDate || item?.date || item?.yearMonth || '')
      return label === previousLabel || label.startsWith(previousLabel)
    })

    if (!hasPreviousMonthData) {
      currentMonthEle = sumForMonth(previousYear, previousMonth)
    }
  }

  const totalYearPq = Math.max(0, yearBase + Math.round(Number(currentMonthEle) || 0))
  const yearUsage = String(totalYearPq)

  return {
    balance,
    hasArrear,
    lastBill,
    lastUsage,
    yearBill,
    yearUsage,
    totalYearPq,
    currentMonthUsage: getCurrentMonthDailyUsage(data),
    lastUpdateTime: data.lastUpdateTime
  }
}