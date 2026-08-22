import { Text, VStack, Widget } from "scripting"
import { fetchDashboardData } from "./api"
import { emptyDashboardData } from "./model"
import { U60ProWidget } from "./widget_view"

;(async () => {
  if (Widget.family !== "systemMedium") {
    Widget.present(
      <VStack padding>
        <Text font="headline">U60 Pro 状态</Text>
        <Text font="caption" foregroundStyle="secondaryLabel">
          请使用中号小组件
        </Text>
      </VStack>,
    )
    return
  }

  try {
    const data = await fetchDashboardData()
    Storage.set("u60pro.last.dashboard.v1", data)
    Widget.present(<U60ProWidget data={data} />)
  } catch (error) {
    const cached = Storage.get<any>("u60pro.last.dashboard.v1")
    const data = cached ?? emptyDashboardData(shortError(error))
    data.stale = true
    Widget.present(<U60ProWidget data={data} />)
  }
})()

function shortError(error: unknown): string {
  const text = String(error instanceof Error ? error.message : error)
  return text.length > 22 ? `${text.slice(0, 21)}…` : text
}
