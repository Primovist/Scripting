import { AppIntentManager, AppIntentProtocol, Widget } from "scripting"

export const RefreshIntent = AppIntentManager.register({
  name: "U60ProRefresh",
  protocol: AppIntentProtocol.AppIntent,
  perform: async (_params: undefined) => {
    Widget.reloadUserWidgets()
  },
})
