import { AppIntentManager, AppIntentProtocol, Widget } from "scripting";

export const RefreshIPIntent = AppIntentManager.register({
    name: "RefreshIPIntent",
    protocol: AppIntentProtocol.AppIntent,
    perform: async () => {
        console.log("执行刷新意图：RefreshIPIntent");
        Widget.reloadAll();
    }
});
