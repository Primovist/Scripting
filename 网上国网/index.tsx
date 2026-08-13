import {
  Widget,
  Navigation,
  NavigationStack,
  List,
  Section,
  Text,
  TextField,
  Picker,
  Button,
  HStack,
  Spacer,
  useState,
  Script,
  Toggle
} from "scripting"
import { getSettings, saveSettings, DEFAULT_SETTINGS, SGCCSettings } from "./api"

function SettingsView() {
  const dismiss = Navigation.useDismiss()

  // 初始化状态
  const initial = getSettings()

  // 户号由小组件参数指定，设置页不再保存户号索引
  const [dimension, setDimension] = useState<string>(initial.dimension)
  const [barCount, setBarCount] = useState<number>(initial.barCount)
  const [oneLevelPq, setOneLevelPq] = useState(String(initial.oneLevelPq))
  const [twoLevelPq, setTwoLevelPq] = useState(String(initial.twoLevelPq))
  const [refreshInterval, setRefreshInterval] = useState(initial.refreshInterval)
  const [largeWidgetRange, setLargeWidgetRange] = useState<string>(initial.largeWidgetRange)
  const [previewFamily, setPreviewFamily] = useState<string>('systemMedium')

  const handleDimensionChange = (value: string) => {
    setDimension(value)
    // 月度数据最多按 12 个月展示，避免 15/30 对月度无实际变化。
    if (value === 'monthly' && ![3, 6, 12].includes(Number(barCount))) {
      setBarCount(12)
    } else if (value === 'daily' && ![7, 15, 30].includes(Number(barCount))) {
      setBarCount(DEFAULT_SETTINGS.barCount)
    }
  }

  const countOptions = dimension === 'monthly'
    ? [
      { value: 3, label: '近 3 月' },
      { value: 6, label: '近 6 月' },
      { value: 12, label: '近 12 月' },
    ]
    : [
      { value: 7, label: '近 7 天' },
      { value: 15, label: '近 15 天' },
      { value: 30, label: '近 30 天' },
    ]

  const handleSave = () => {
    const newSettings: SGCCSettings = {
      ...initial,
      dimension: dimension as 'daily' | 'monthly',
      barCount: Number(barCount),
      oneLevelPq: Number(oneLevelPq) || DEFAULT_SETTINGS.oneLevelPq,
      twoLevelPq: Number(twoLevelPq) || DEFAULT_SETTINGS.twoLevelPq,
      refreshInterval: Number(refreshInterval),
      largeWidgetRange: largeWidgetRange as '7days' | '30days' | '12months'
    }

    saveSettings(newSettings)
    Widget.reloadAll()
    dismiss()
  }

  const handlePreview = async () => {
    // 预览前先保存当前编辑内容，确保预览使用最新设置。
    const previewSettings: SGCCSettings = {
      ...initial,
      dimension: dimension as 'daily' | 'monthly',
      barCount: Number(barCount),
      oneLevelPq: Number(oneLevelPq) || DEFAULT_SETTINGS.oneLevelPq,
      twoLevelPq: Number(twoLevelPq) || DEFAULT_SETTINGS.twoLevelPq,
      refreshInterval: Number(refreshInterval),
      largeWidgetRange: largeWidgetRange as '7days' | '30days' | '12months'
    }
    saveSettings(previewSettings)
    await Widget.preview({ family: previewFamily as any })
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="网上电网配置"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: [
            <Button title="取消" action={dismiss} />
          ],
          topBarTrailing: [
            <Button title="保存" fontWeight="bold" action={handleSave} />
          ]
        }}
      >
        <Section header={<Text>图表配置</Text>}>
          <Picker
            title="统计维度"
            value={dimension}
            onChanged={handleDimensionChange}
            pickerStyle="menu"
          >
            <Text tag="daily">每日用电</Text>
            <Text tag="monthly">每月用电</Text>
          </Picker>

          <Picker
            title="显示数量"
            value={barCount}
            onChanged={(v: number) => setBarCount(v)}
            pickerStyle="menu"
          >
            {countOptions.map((option) => (
              <Text key={option.value} tag={option.value}>{option.label}</Text>
            ))}
          </Picker>

          <Picker
            title="大尺寸显示"
            value={largeWidgetRange}
            onChanged={setLargeWidgetRange}
            pickerStyle="menu"
          >
            <Text tag="7days">近 7 天用电</Text>
            <Text tag="30days">近 30 天用电</Text>
            <Text tag="12months">近 12 月用电</Text>
          </Picker>
        </Section>

        <Section header={<Text>阶梯阈值 (年度)</Text>} footer={<Text font="caption2" foregroundStyle="secondaryLabel">用于计算阶梯电价进度条颜色</Text>}>
          <TextField
            title="一阶电量上限"
            value={oneLevelPq}
            keyboardType="numberPad"
            onChanged={setOneLevelPq}
          />
          <TextField
            title="二阶电量上限"
            value={twoLevelPq}
            keyboardType="numberPad"
            onChanged={setTwoLevelPq}
          />
        </Section>

        <Section header={<Text>系统</Text>}>
          <Picker
            title="自动刷新间隔"
            value={refreshInterval}
            onChanged={(v: number) => setRefreshInterval(v)}
            pickerStyle="menu"
          >
            <Text tag={60}>1 小时</Text>
            <Text tag={180}>3 小时 (推荐)</Text>
            <Text tag={360}>6 小时</Text>
            <Text tag={720}>12 小时</Text>
          </Picker>

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
            <Button
              title="预览"
              action={handlePreview}
            />
          </HStack>
        </Section>

      </List>
    </NavigationStack>
  )
}

// 只有在 APP 内运行脚本时才会渲染此页面
if (Script.env === "index") {
  Navigation.present({
    element: <SettingsView />
  }).then(() => Script.exit())
}
