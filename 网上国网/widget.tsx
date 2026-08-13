import {
  Widget,
  Script,
  VStack,
  HStack,
  ZStack,
  Text,
  Spacer,
  Image,
  RoundedRectangle,
  Capsule,
  Color,
} from "scripting"
import {
  getAccountData,
  getSettings,
  processBarChartData,
  processLargeWidgetData,
  extractDisplayData,
  SGCCSettings,
  BarData
} from "./api"

// --- 全局声明 ---
declare const FileManager: any
declare const fetch: (url: string, init?: any) => Promise<{ data: () => Promise<any> }>

// --- 配置与常量 ---
const LOGO_URL = "https://raw.githubusercontent.com/Honye/scriptable-scripts/master/static/sgcc.png"
const LOGO_FILENAME = "sgcc_logo_cache.png"

const C = {
  teal: "#00706B" as any,
  yellow: "#E8C70B" as any,
  orange: "#D0580D" as any,
  textPrimary: { light: "#18231C", dark: "#FFFFFF" } as any,
  textSecondary: { light: "rgba(24, 35, 28, 0.7)", dark: "rgba(255, 255, 255, 0.7)" } as any,
  bgCard: { light: "#ffffff", dark: "#1C1C1E" } as any,
  trackBg: { light: "rgba(0,0,0,0.06)", dark: "rgba(255,255,255,0.15)" } as any
}

const isTransparentWidget = Widget.isTransparentBackground


// --- 尺寸适配逻辑 (From SGCC.js) ---
function getWidgetSize() {
  const phones: { [key: number]: any } = {
    /** 16 Pro Max */
    956: { small: 170, medium: 364, large: 382 },
    /** 16 Pro */
    874: { small: 162, medium: 344, large: 366 },
    /** 16 Plus, 15 Pro Max, 15 Plus, 14 Pro Max */
    932: { small: 170, medium: 364, large: 382 },
    /** 13 Pro Max, 12 Pro Max */
    926: { small: 170, medium: 364, large: 382 },
    /** 11 Pro Max, 11, XS Max, XR */
    896: { small: 169, medium: 360, large: 379 },
    /** Plus phones */
    736: { small: 157, medium: 348, large: 357 },
    /** 16, 15 Pro, 15, 14 Pro */
    852: { small: 158, medium: 338, large: 354 },
    /** 13, 13 Pro, 12, 12 Pro */
    844: { small: 158, medium: 338, large: 354 },
    /** 13 mini, 12 mini / 11 Pro, XS, X */
    812: { small: 155, medium: 329, large: 345 },
    /** SE2 and 6/6S/7/8 */
    667: { small: 148, medium: 321, large: 324 },
    /** iPad Pro 2 */
    1194: { small: 155, medium: 342, large: 342, extraLarge: 715.5 },
    /** iPad 6 */
    1024: { small: 141, medium: 305.5, large: 305.5, extraLarge: 634.5 }
  }

  try {
    // @ts-ignore
    if (typeof Device !== 'undefined' && Device.screenSize) {
      // @ts-ignore
      let { width, height } = Device.screenSize()
      if (typeof width === 'number' && typeof height === 'number') {
        if (width > height) height = width
        if (phones[height]) return phones[height]
      }
    }
  } catch (e) {
    console.log("Device.screenSize not supported, using fallback.")
  }

  return { small: 155, medium: 329, large: 329 }
}

function vmin(num: number): number {
  const size = getWidgetSize()
  let family: any = Widget.family
  if (family === 'systemSmall') family = 'small'
  else if (family === 'systemMedium') family = 'medium'
  else if (family === 'systemLarge') family = 'large'
  else if (family === 'systemExtraLarge') family = 'extraLarge'
  else family = 'medium' // fallback

  const width = size[family === 'large' ? 'medium' : family] || 329
  // Logical mismatch in SGCC source? 
  // SGCC: width = size[family === 'large' ? 'medium' : family];
  // Height logic: family === 'medium' ? size.small : ...
  let height = 155
  if (family === 'medium') height = size.small
  else if (family === 'extraLarge') height = size.large
  else height = size[family]

  return num * Math.min(width, height) / 100
}

function rpt(n: number): number {
  return vmin(n * 100 / 155)
}

// --- Logo 获取 ---
async function getLogoPath() {
  try {
    if (typeof FileManager === 'undefined') return null
    const docs = FileManager.appGroupDocumentsDirectory || FileManager.documentsDirectory
    const path = `${docs}/${LOGO_FILENAME}`

    if (FileManager.existsSync(path)) return path

    const req = await fetch(LOGO_URL)
    const data = await req.data()
    await FileManager.writeAsData(path, data)
    return FileManager.existsSync(path) ? path : null
  } catch (e) {
    return null
  }
}

// --- UI 组件 ---

// --- UI 组件 ---

// --- UI 组件 ---

function BarChart({ data }: { data: BarData[] }) {
  const isSmall = Widget.family === 'systemSmall'
  const isMedium = Widget.family === 'systemMedium'
  const isExtraLarge = Widget.family === 'systemExtraLarge'
  const isAccessoryRectangular = Widget.family === 'accessoryRectangular'
  const isSidePanelChart = isMedium || isExtraLarge
  const mediumChartWidth = rpt(78)
  const smallChartWidth = rpt(115)
  const rectangularChartWidth = 145
  const chartWidth = isSidePanelChart ? mediumChartWidth : isSmall ? smallChartWidth : isAccessoryRectangular ? rectangularChartWidth : undefined

  if (!data || data.length === 0) {
    return (
      <VStack frame={{ width: chartWidth, height: isAccessoryRectangular ? 48 : isSidePanelChart ? rpt(40) : rpt(68) } as any} alignment="center">
        <Text font={rpt(8)} foregroundStyle={C.textSecondary}>暂无数据</Text>
      </VStack>
    )
  }

  const values = data.map(d => Number(d.value) || 0)
  const max = Math.max(...values, 1)

  const minValNumber = Math.min(...values)
  const maxIndex = values.lastIndexOf(max)
  const minIndex = values.lastIndexOf(minValNumber)
  const maxColor = { light: "#E53935", dark: "#FF6B6B" } as any
  const minColor = { light: "#66C0BC", dark: "#1A5B58" } as any

  // Adjust height to save space (SGCC Medium uses 40)
  const height = isAccessoryRectangular ? 48 : isSmall ? rpt(50) : rpt(40)
  const dataCount = Math.max(data.length, 1)
  const minBarWidth = isAccessoryRectangular ? 1.2 : isSidePanelChart ? rpt(1.5) : isSmall ? rpt(2) : rpt(8)
  const maxBarWidth = isAccessoryRectangular ? 4 : isSidePanelChart ? rpt(6) : isSmall ? rpt(8) : rpt(8)
  const preferredGap = isAccessoryRectangular
    ? dataCount > 20 ? 1.5 : dataCount > 12 ? 2 : 4
    : isSidePanelChart
      ? dataCount > 20 ? rpt(1) : dataCount > 12 ? rpt(2) : rpt(4)
      : isSmall ? dataCount > 20 ? rpt(1) : dataCount > 12 ? rpt(2) : rpt(6) : 0
  const barWidth = chartWidth
    ? Math.max(
      minBarWidth,
      Math.min(maxBarWidth, (chartWidth - preferredGap * (dataCount - 1)) / dataCount)
    )
    : rpt(8)
  const gap = chartWidth && dataCount > 1
    ? Math.max(0, (chartWidth - barWidth * dataCount) / (dataCount - 1))
    : 0
  const vp = isAccessoryRectangular ? 4 : isSidePanelChart ? rpt(4) : rpt(10)
  const px = chartWidth ? 0 : rpt(8)


  // 所有柱状图颜色统一在 BarChart 中按数值占最大值比例计算，月度/日度一致。
  const bars = data.map(({ value }, i) => {
    const val = Number(value) || 0
    let barHeight = (val / max) * (height - vp * 2)
    if (!Number.isFinite(barHeight) || barHeight < 0) barHeight = 0
    barHeight = Math.max(rpt(4), barHeight)

    // 动态颜色逻辑 (与 LineChart 保持一致)
    const ratio = max > 0 ? val / max : 0
    let color: any

    if (i === maxIndex) {
      color = maxColor
    } else if (minValNumber < max && i === minIndex) {
      color = minColor
    } else if (ratio > 0.85) {
      color = C.orange
    } else if (ratio > 0.5) {
      color = C.teal
    } else {
      color = { light: "#2F9A95", dark: "#0F3F3C" }
    }

    return (
      <RoundedRectangle
        key={i}
        frame={{ width: barWidth, height: barHeight }}
        cornerRadius={rpt(3)}
        style="continuous"
        fill={color}
      />
    )
  })

  // 受限方格内使用精确宽度和动态间距，避免柱状图超出方格。
  const children: any[] = bars

  return (
    <VStack frame={{ width: chartWidth, height: height } as any} padding={{ top: vp, horizontal: px, bottom: 2 }}>
      <Spacer />
      <HStack
        alignment="bottom"
        spacing={gap}
        frame={{ width: chartWidth, maxWidth: chartWidth ? undefined : Infinity, height: height } as any}
      >
        {children}
      </HStack>
    </VStack>
  )
}

function GridItem({ label, value }: { label: string; value: string }) {
  return (
    <ZStack alignment="center">
      <RoundedRectangle
        cornerRadius={rpt(6)}
        style="continuous"
        fill={isTransparentWidget ? ("clear" as any) : { light: "rgba(0, 112, 107, 0.05)", dark: "rgba(4, 96, 91, 0.15)" }}
        frame={{ maxWidth: Infinity, maxHeight: Infinity }}
      />
      <VStack padding={{ vertical: rpt(6), horizontal: rpt(8) }} alignment="center" spacing={0} frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
        <Text font={rpt(8)} foregroundStyle={C.textSecondary} lineLimit={1}>{label}</Text>
        <Text font={Widget.family === 'systemExtraLarge' ? rpt(14) : 14} fontWeight="bold" fontDesign="rounded" foregroundStyle={C.textPrimary} lineLimit={1} minScaleFactor={Widget.family === 'systemExtraLarge' ? 0.75 : undefined}>{value}</Text>
      </VStack>
    </ZStack>
  )
}

function getStepProgress(totalYearPq: number, settings: SGCCSettings, totalBars = 60) {
  const { oneLevelPq, twoLevelPq } = settings
  const barsPerTier = totalBars / 3
  const tier2Capacity = Math.max(1, twoLevelPq - oneLevelPq)

  let level = 1
  let percent = Math.max(0, Math.min(totalYearPq / oneLevelPq, 1))
  let activeBars = Math.ceil(percent * barsPerTier)

  if (totalYearPq > twoLevelPq) {
    level = 3
    percent = 1
    activeBars = totalBars
  } else if (totalYearPq > oneLevelPq) {
    level = 2
    percent = Math.max(0, Math.min((totalYearPq - oneLevelPq) / tier2Capacity, 1))
    activeBars = barsPerTier + Math.ceil(percent * barsPerTier)
  }

  return {
    level,
    percent,
    totalBars,
    barsPerTier,
    activeBars: Math.max(0, Math.min(totalBars, activeBars)),
    labelText: level === 3
      ? '第三梯度'
      : `第${['一', '二'][level - 1]}梯度：${(percent * 100).toFixed(2)}%`,
  }
}

function SmallStepProgress({ totalYearPq, settings }: { totalYearPq: number; settings: SGCCSettings }) {
  const { level, percent } = getStepProgress(totalYearPq, settings)

  const p1 = level >= 2 ? 1 : percent
  const p2 = level >= 3 ? 1 : level === 2 ? percent : 0
  const p3 = level === 3 ? 1 : 0

  // Full width for Small Widget content area: 155 - 12*2(padding) - 10*2(inner padding) = 111
  const barWidth = 115
  const gap = 2
  const segWidth = (barWidth - gap * 2) / 3

  // Track colors (faint version of tier color)
  const tier1Bg = { light: "rgba(0, 112, 107, 0.1)", dark: "rgba(4, 96, 91, 0.1)" } as any
  const tier2Bg = { light: "rgba(232, 199, 11, 0.1)", dark: "rgba(203, 173, 2, 0.1)" } as any
  const tier3Bg = { light: "rgba(208, 88, 13, 0.1)", dark: "rgba(208, 88, 13, 0.1)" } as any

  return (
    <HStack spacing={gap} frame={{ height: 4, width: barWidth }}>
      <ZStack alignment="leading" frame={{ width: segWidth, maxHeight: Infinity }}>
        <RoundedRectangle cornerRadius={2} style="continuous" fill={tier1Bg} frame={{ maxWidth: Infinity, maxHeight: Infinity }} />
        <RoundedRectangle cornerRadius={2} style="continuous" fill={C.teal} frame={{ width: Math.max(0, p1 * segWidth), maxHeight: Infinity }} />
      </ZStack>
      <ZStack alignment="leading" frame={{ width: segWidth, maxHeight: Infinity }}>
        <RoundedRectangle cornerRadius={2} style="continuous" fill={tier2Bg} frame={{ maxWidth: Infinity, maxHeight: Infinity }} />
        <RoundedRectangle cornerRadius={2} style="continuous" fill={C.yellow} frame={{ width: Math.max(0, p2 * segWidth), maxHeight: Infinity }} />
      </ZStack>
      <ZStack alignment="leading" frame={{ width: segWidth, maxHeight: Infinity }}>
        <RoundedRectangle cornerRadius={2} style="continuous" fill={tier3Bg} frame={{ maxWidth: Infinity, maxHeight: Infinity }} />
        <RoundedRectangle cornerRadius={2} style="continuous" fill={C.orange} frame={{ width: Math.max(0, p3 * segWidth), maxHeight: Infinity }} />
      </ZStack>
    </HStack>
  )
}

function MediumStepProgress({ totalYearPq, settings, lastUpdateTime, compact = false }: { totalYearPq: number; settings: SGCCSettings; lastUpdateTime: number; compact?: boolean }) {
  const { totalBars, barsPerTier, activeBars, labelText } = getStepProgress(totalYearPq, settings, compact ? 100 : 45)

  const bars: JSX.Element[] = []

  const colors = [
    { light: "#00706B", dark: "#04605B" },
    { light: "#E8C70B", dark: "#CBAD02" },
    { light: "#D0580D", dark: "#D0580D" }
  ]
  const bgColors = [
    { light: "rgba(0, 112, 107, 0.1)", dark: "rgba(4, 96, 91, 0.1)" },
    { light: "rgba(232, 199, 11, 0.1)", dark: "rgba(203, 173, 2, 0.1)" },
    { light: "rgba(208, 88, 13, 0.1)", dark: "rgba(208, 88, 13, 0.1)" }
  ]

  // 普通中组件恢复为原来的 45 段；Inline 保持 100 段。进度、文字及染色算法保持新逻辑。
  const end = activeBars

  const barWidth = compact ? 1 : 2
  const barHeight = compact ? 10 : 16
  const barGap = compact ? 0.3 : rpt(2)

  for (let i = 0; i < totalBars; i++) {
    const tier = Math.min(2, Math.floor(i / barsPerTier))
    const isActive = i < end
    const color = isActive ? colors[tier] : bgColors[tier]

    bars.push(
      <RoundedRectangle
        key={i}
        cornerRadius={1}
        style="continuous"
        frame={{ width: barWidth, height: barHeight }}
        fill={color as any}
      />
    )
    if (i < totalBars - 1) {
      bars.push(<Spacer key={`s-${i}`} minLength={barGap} />)
    }
  }

  if (compact) {
    return (
      <HStack spacing={0} alignment="center" padding={{ horizontal: 4 }}>
        {bars}
      </HStack>
    )
  }

  const d = new Date(lastUpdateTime)
  const timeString = d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })

  return (
    <ZStack alignment="center">
      <RoundedRectangle cornerRadius={rpt(6)} style="continuous" fill={isTransparentWidget ? ("clear" as any) : { light: "rgba(0, 112, 107, 0.05)", dark: "rgba(4, 96, 91, 0.15)" }} frame={{ maxWidth: Infinity, maxHeight: Infinity }} />
      <VStack padding={{ vertical: rpt(6), horizontal: rpt(12) }} spacing={rpt(6)} alignment="leading" frame={{ maxWidth: Infinity }}>
        <HStack alignment="center">
          <Text font={rpt(8)} foregroundStyle={C.textSecondary}>{labelText}</Text>
          <Spacer />
          <HStack spacing={2} alignment="center">
            <Image systemName="clock.arrow.circlepath" resizable frame={{ width: rpt(8), height: rpt(8) }} foregroundStyle={C.textSecondary} />
            <Text font={rpt(8)} foregroundStyle={C.textSecondary}>{timeString}</Text>
          </HStack>
        </HStack>
        <HStack spacing={0} alignment="center">
          {bars}
        </HStack>
      </VStack>
    </ZStack>
  )
}
// 折线图组件 - 用于大尺寸小组件（改用柱状图样式显示趋势）
function LineChart({ data, height = 120, isMonthly = false }: { data: BarData[]; height?: number; isMonthly?: boolean }) {
  if (!data || data.length === 0) {
    return (
      <VStack frame={{ height: height }} alignment="center">
        <Spacer />
        <Text font={12} foregroundStyle={C.textSecondary}>暂无数据</Text>
        <Spacer />
      </VStack>
    )
  }

  const values = data.map(d => Number(d.value) || 0)
  const max = Math.max(...values, 1)
  const min = 0 // 从0开始，方便查看趋势

  // 统计信息
  const maxVal = max.toFixed(1)
  const minValNumber = Math.min(...values)
  const minVal = minValNumber.toFixed(1)
  const avgVal = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)

  const chartHeight = height - 50 // 预留头尾空间
  const avgLineBottom = Math.max(0, Math.min(chartHeight, (Number(avgVal) / max) * chartHeight))

  // 动态布局计算 (Large Widget 宽度约 330，减去 padding 16*2 = 298)
  const containerWidth = 300
  const count = data.length

  // 根据数量调整条宽
  let barWidth = 4
  if (count <= 7) barWidth = 12
  else if (count <= 15) barWidth = 8
  else if (count <= 31) barWidth = 5

  // 计算间距: (总宽 - 条总宽) / (条数 - 1)
  const totalBarWidth = count * barWidth
  let spacing = (containerWidth - totalBarWidth) / Math.max(1, count - 1)
  if (count === 1) spacing = 0

  // 找出最大/最小值的索引（如果有多个，标记最近的一个）
  const maxIndex = values.lastIndexOf(max)
  const minIndex = values.lastIndexOf(minValNumber)
  const maxColor = { light: "#E53935", dark: "#FF6B6B" } as any
  const minColor = { light: "#66C0BC", dark: "#1A5B58" } as any

  // 生成柱子
  const bars = data.map((d, i) => {
    const val = Number(d.value) || 0
    let barHeight = (val / max) * chartHeight
    if (!Number.isFinite(barHeight) || barHeight < 0) barHeight = 0
    barHeight = Math.max(2, barHeight)

    // 动态颜色逻辑：根据数值比例变化
    const ratio = max > 0 ? val / max : 0
    let color: any

    if (i === maxIndex) {
      color = maxColor
    } else if (minValNumber < max && i === minIndex) {
      color = minColor
    } else if (ratio > 0.85) {
      color = C.orange // >85%: 橙色 (高负荷)
    } else if (ratio > 0.5) {
      color = C.teal   // 50%-85%: 主题青色 (正常)
    } else {
      // <=50%: 介于最小值淡绿和主题青色之间的中绿色
      color = { light: "#2F9A95", dark: "#0F3F3C" }
    }

    return (
      <RoundedRectangle
        key={i}
        frame={{ width: barWidth, height: barHeight }}
        cornerRadius={Math.min(2, barWidth / 2)}
        style="continuous"
        fill={color}
      />
    )
  })

  // 格式化标签 (区分 月份 和 日期)
  const formatLabel = (label: string) => {
    if (!label) return ''
    if (isMonthly) {
      const monthMatch = label.match(/(?:^|\D)(\d{4})?\D?(\d{1,2})(?:\D|$)/)
      if (monthMatch) return Number(monthMatch[2]) + '月'
    }
    // 主要是月份 (例如 "1", "12")
    if (/^\d{1,2}$/.test(label) || (label.length < 8 && label.includes('-'))) {
      const month = label.includes('-') ? label.split('-')[1] : label
      return Number(month) + '月'
    }
    // 主要是日期 (例如 "2023-12-18")
    const day = label.match(/(\d{2})$/)?.[1]
    return day ? Number(day) + '日' : label
  }

  const firstLabel = formatLabel(data[0]?.label || '')
  const lastLabel = formatLabel(data[data.length - 1]?.label || '')

  return (
    <VStack spacing={8} frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
      {/* 统计信息 */}
      <HStack spacing={8}>
        <HStack spacing={4} alignment="center">
          <Capsule fill={maxColor} frame={{ width: 8, height: 8 }} />
          <Text font={10} foregroundStyle={C.textSecondary} lineLimit={1} minScaleFactor={0.75}>最高: {maxVal}度</Text>
        </HStack>
        <HStack spacing={4} alignment="center">
          <Capsule fill={minColor} frame={{ width: 8, height: 8 }} />
          <Text font={10} foregroundStyle={C.textSecondary} lineLimit={1} minScaleFactor={0.75}>最低: {minVal}度</Text>
        </HStack>
        <HStack spacing={4} alignment="center">
          <Capsule fill={C.yellow} frame={{ width: 8, height: 8 }} />
          <Text font={10} foregroundStyle={C.textSecondary} lineLimit={1} minScaleFactor={0.75}>{isMonthly ? '月均' : '日均'}: {avgVal}度</Text>
        </HStack>
        <Spacer />
        <Text font={10} foregroundStyle={C.textSecondary}>共{data.length}{isMonthly ? '个月' : '天'}</Text>
      </HStack>

      {/* 柱状图区域 */}
      <ZStack alignment="bottom" frame={{ maxWidth: Infinity, height: chartHeight }}>
        <HStack
          alignment="bottom"
          spacing={spacing}
          frame={{ maxWidth: Infinity, height: chartHeight }}
        >
          {bars}
        </HStack>
        <VStack frame={{ maxWidth: Infinity, height: chartHeight }}>
          <Spacer />
          <RoundedRectangle
            cornerRadius={0.5}
            style="continuous"
            fill={{ light: "rgba(232, 199, 11, 0.5)", dark: "rgba(203, 173, 2, 0.5)" } as any}
            frame={{ maxWidth: Infinity, height: 1 }}
          />
          <Spacer minLength={avgLineBottom} />
        </VStack>
      </ZStack>

      {/* 日期标签 */}
      <HStack>
        <Text font={9} foregroundStyle={C.textSecondary}>{firstLabel}</Text>
        <Spacer />
        <Text font={9} foregroundStyle={C.textSecondary}>{lastLabel}</Text>
      </HStack>
    </VStack>
  )
}

// --- 渐进式恢复视图 ---
function WidgetView({ displayData, barData, largeWidgetData, settings, logoPath, rawData }: any) {
  const family = Widget.family
  const isTransparent = isTransparentWidget
  const { balance, hasArrear, lastBill, lastUsage, yearBill, yearUsage, totalYearPq } = displayData

  const Logo = () => logoPath ? (
    <Image filePath={logoPath} resizable frame={{ width: rpt(30), height: rpt(30) }} clipShape={{ type: "capsule", style: "continuous" }} />
  ) : (
    <Image systemName="bolt.circle.fill" resizable frame={{ width: rpt(30), height: rpt(30) }} foregroundStyle={C.teal} />
  )

  // define styles for container background
  const contentBgStyle = {
    style: { light: "rgba(0, 112, 107, 0.05)", dark: "rgba(4, 96, 91, 0.15)" } as any,
    shape: { type: "rect", cornerRadius: 6, style: "continuous" } as any
  }

  if (family === "accessoryInline") {
    return <MediumStepProgress totalYearPq={totalYearPq} settings={settings} lastUpdateTime={displayData.lastUpdateTime || Date.now()} compact />
  }

  if (family === "accessoryCircular") {
    const currentMonthUsage = Number(displayData.currentMonthUsage || 0)
    return (
      <VStack alignment="center" spacing={1}>
        <Logo />
        <Text font={12} fontWeight="bold" lineLimit={1} minScaleFactor={0.6}>{currentMonthUsage.toFixed(0)}</Text>
        <Text font={8} foregroundStyle={C.textSecondary} lineLimit={1}>本月用量</Text>
      </VStack>
    )
  }

  if (family === "accessoryRectangular") {
    const rectangularSettings: SGCCSettings = {
      ...settings,
      dimension: 'daily',
      barCount: 30,
    }
    const rectangularBarData = processBarChartData(rawData || {}, rectangularSettings)
    const chartData = rectangularBarData.length > 0 ? rectangularBarData : barData.slice(-30)

    return (
      <VStack alignment="center" frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
        <BarChart data={chartData} />
      </VStack>
    )
  }

  // Small Widget Restoration
  if (family === "systemSmall") {
    return (
      <VStack
        padding={12}
        alignment="leading"
        widgetBackground={isTransparentWidget ? undefined : C.bgCard}
      >
        <VStack spacing={0} frame={{ maxWidth: Infinity, maxHeight: Infinity, alignment: "leading" }}>

          {/* Chart Area */}
          <VStack
            spacing={4}
            alignment="center"
            widgetBackground={isTransparentWidget ? undefined : contentBgStyle}
          >
            <BarChart data={barData} />
            <VStack padding={{ horizontal: rpt(8), bottom: rpt(8) }}>
              <SmallStepProgress totalYearPq={totalYearPq} settings={settings} />
            </VStack>
          </VStack>

          <Spacer />

          {/* Bottom Info */}
          <VStack alignment="leading" spacing={2}>
            <Text font={rpt(12)} foregroundStyle={C.textSecondary}>{lastBill !== "0.00" ? `余额(上期:${lastBill})` : '剩余电费'}</Text>
            <HStack alignment="center">
              <Text font={rpt(24)} fontWeight="bold" fontDesign="rounded" foregroundStyle={C.textPrimary} minScaleFactor={0.5} lineLimit={1}>{balance}</Text>
              <Spacer />
              <Logo />
            </HStack>
          </VStack>

        </VStack>
      </VStack>
    )
  }

  // Large Widget - 只显示近期用电趋势
  if (family === "systemLarge") {
    // 使用设置中的数据范围
    const chartData = largeWidgetData || barData
    const rangeLabel = settings.largeWidgetRange === '12months' ? '近一年用电趋势' :
      settings.largeWidgetRange === '30days' ? '近一月用电趋势' : '近一周用电趋势'

    return (
      <VStack
        padding={16}
        alignment="leading"
        widgetBackground={isTransparentWidget ? undefined : C.bgCard}
        spacing={8}
      >
        {/* 标题栏 */}
        <HStack alignment="center" padding={{ leading: 5 }}>
          {logoPath ? (
            <Image filePath={logoPath} resizable frame={{ width: 28, height: 28 }} clipShape={{ type: "capsule", style: "continuous" }} />
          ) : (
            <Image systemName="bolt.circle.fill" resizable frame={{ width: 28, height: 28 }} foregroundStyle={C.teal} />
          )}
          <Text font={16} fontWeight="semibold" foregroundStyle={C.textPrimary}>{rangeLabel}</Text>
          <Spacer />
          <Text font={12} foregroundStyle={C.textSecondary}>{!hasArrear ? '余额' : '欠费'}: {balance}元</Text>
        </HStack>

        {/* 折线图 - 占满剩余空间 */}
        <ZStack alignment="center" frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
          <RoundedRectangle
            cornerRadius={12}
            style="continuous"
            fill={isTransparentWidget ? ("clear" as any) : { light: "rgba(0, 112, 107, 0.03)", dark: "rgba(4, 96, 91, 0.1)" }}
            frame={{ maxWidth: Infinity, maxHeight: Infinity }}
          />
          <VStack padding={16} frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
            <LineChart data={chartData} height={280} isMonthly={settings.largeWidgetRange === '12months'} />
          </VStack>
        </ZStack>
      </VStack>
    )
  }

  // Medium / Extra Large Widget
  // Extra Large 复用中组件布局，并通过 rpt() 按组件尺寸等比例放大。
  return (
    <VStack
      padding={rpt(12)}
      alignment="leading"
      widgetBackground={isTransparentWidget ? undefined : C.bgCard}
    >
      <HStack spacing={rpt(12)} alignment="top">
        {/* 左侧面板 */}
        <ZStack frame={{ width: rpt(86), maxHeight: Infinity }}>
          <RoundedRectangle
            cornerRadius={rpt(6)}
            style="continuous"
            fill={isTransparentWidget ? ("clear" as any) : { light: "rgba(0, 112, 107, 0.05)", dark: "rgba(4, 96, 91, 0.15)" }}
            frame={{ width: rpt(86), maxHeight: Infinity }}
          />
          <VStack
            frame={{ width: rpt(86), maxHeight: Infinity }}
            padding={{ horizontal: rpt(4), vertical: 0 }}
            alignment="center"
            spacing={0}
          >
            <Spacer />
            <VStack alignment="center" spacing={rpt(2)}>
              {/* @ts-ignore */}
              <Image filePath={logoPath} frame={{ width: rpt(30), height: rpt(30) }} cornerRadius={rpt(15) as any} resizable />
              <Text font={rpt(10)} foregroundStyle={C.textSecondary}>{!hasArrear ? '剩余电费' : '待缴电费'}</Text>
              <Text font={rpt(22)} fontWeight="heavy" fontDesign="rounded" foregroundStyle={C.textPrimary} lineLimit={1} minScaleFactor={0.5}>{balance}</Text>
            </VStack>
            <Spacer />
            <BarChart data={barData} />
          </VStack>
        </ZStack>

        {/* 右侧面板 */}
        {family === "systemExtraLarge" ? (
          <VStack spacing={rpt(6)} frame={{ maxWidth: Infinity, maxHeight: Infinity }} alignment="leading">
            <HStack spacing={rpt(8)} frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
              <GridItem label="上期电费" value={lastBill} />
              <GridItem label="上期电量" value={lastUsage} />
            </HStack>
            <HStack spacing={rpt(8)} frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
              <GridItem label="年度电费" value={yearBill} />
              <GridItem label="年度电量" value={yearUsage} />
            </HStack>
            <ZStack frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
              <MediumStepProgress totalYearPq={totalYearPq} settings={settings} lastUpdateTime={displayData.lastUpdateTime || Date.now()} />
            </ZStack>
          </VStack>
        ) : (
          <VStack spacing={rpt(6)} frame={{ maxWidth: Infinity, maxHeight: Infinity }} alignment="leading">
            <HStack spacing={rpt(8)}>
              <VStack spacing={rpt(6)} frame={{ maxWidth: Infinity }}>
                <GridItem label="上期电费" value={lastBill} />
                <GridItem label="年度电费" value={yearBill} />
              </VStack>
              <VStack spacing={rpt(6)} frame={{ maxWidth: Infinity }}>
                <GridItem label="上期电量" value={lastUsage} />
                <GridItem label="年度电量" value={yearUsage} />
              </VStack>
            </HStack>
            {/* 阶梯进度 */}
            <MediumStepProgress totalYearPq={totalYearPq} settings={settings} lastUpdateTime={displayData.lastUpdateTime || Date.now()} />
          </VStack>
        )}
      </HStack>
    </VStack>
  )
}

function getWidgetAccountIndex(): number {
  const parameter = (Widget.parameter || '').trim()
  if (!parameter) return 0

  // 小组件参数填写户号索引：0 表示第一个户号，1 表示第二个户号。
  const parsed = Number(parameter)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

async function render() {
  try {
    console.log('[Widget] Starting render, family:', Widget.family)

    const settings = getSettings()
    console.log('[Widget] Settings:', JSON.stringify(settings))

    const accountIndex = getWidgetAccountIndex()
    console.log('[Widget] Account index:', accountIndex)
    const rawData = await getAccountData(false, accountIndex)
    console.log('[Widget] Raw data received, keys:', Object.keys(rawData || {}))
    console.log('[Widget] stepElecQuantity:', JSON.stringify(rawData?.stepElecQuantity || []))

    const displayData = extractDisplayData(rawData)
    console.log('[Widget] Display data:', JSON.stringify(displayData))

    console.log('[Widget Debug] dayEleList:', JSON.stringify(rawData?.dayElecQuantity31?.sevenEleList || []))
    const barData = processBarChartData(rawData, settings)
    console.log('[Widget] Bar data count:', barData?.length || 0)

    const logoPath = await getLogoPath()
    console.log('[Widget] Logo path:', logoPath)

    // 大组件专用数据
    const largeWidgetData = processLargeWidgetData(rawData, settings)
    console.log('[Widget] Large widget data count:', largeWidgetData?.length || 0)

    Widget.present(
      <WidgetView
        displayData={displayData}
        barData={barData}
        largeWidgetData={largeWidgetData}
        settings={settings}
        logoPath={logoPath}
        rawData={rawData}
      />,
      {
        reloadPolicy: {
          policy: "after",
          date: new Date(Date.now() + Math.max(15, settings.refreshInterval) * 60 * 1000)
        }
      }
    )
    Script.exit()
  } catch (e) {
    console.error('[Widget] Render error:', e)
    Widget.present(
      <VStack padding={10} alignment="center">
        <Text font={12} foregroundStyle={"#000000" as any}>加载失败</Text>
        <Text font={10} foregroundStyle={"#888888" as any}>{String(e)}</Text>
      </VStack>
    )
    Script.exit()
  }
}

render()