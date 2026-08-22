# U60 Pro 状态（Scripting）

适用于 iOS/iPadOS 的 Scripting App，中号桌面小组件。

## 使用

1. 在 iPhone/iPad 上用 Scripting 打开 `U60-Pro-Status.scripting`。
2. 运行一次脚本，填写 WebSSH-u60pro 地址、用户名和密码。
3. 点“测试连接”，成功后保存。
4. 添加 Scripting 中号桌面小组件，并选择“U60 Pro 状态”。

地址示例：`http://192.168.0.1:8899`。如果 WebSSH 使用了 WebBaseDir，例如 `/u60`，则填写 `http://192.168.0.1:8899/u60`。

## 数据来源

- 登录：`POST /api/login`
- 主状态：`POST /api/ubus`，使用与 WebSSH-u60pro 首页相同的批量 UBUS 请求
- 未读短信：`GET /api/system/sms`

密码写入当前脚本隔离的 Keychain；JWT 会缓存，并在失效时自动重新登录。
