# ZEC Desk for macOS（预览版）

支持 macOS 14 或更新版本。Apple 芯片（M1 / M2 / M3 / M4 等）下载 arm64；Intel Mac 下载 x64。

## 使用

1. 完整解压 ZIP，将 **ZEC Desk.app** 拖到“应用程序”。
2. 双击应用。程序启动本机服务，优先在 Chrome 打开 `http://localhost:8793/`，没有 Chrome 时打开默认浏览器。
3. 使用 Noir 需要在装有 Noir 的 Chrome 中打开上述地址。连接与最终付款在钱包插件中确认。
4. Zingo 独立钱包使用随包附带的 macOS 原生组件，**不需要 WSL**。先备份，再同步和预检；只有确认启动后的 ZADDR Public 任务才会自动付款。
5. 保持电脑开机、联网、不休眠。关闭浏览器不会停止 Zingo 后台；Noir 等待需要页面保持打开。退出请点击页面左下角“停止并退出软件”。

程序没有 Apple Developer ID 签名或公证。macOS 可能阻止首次打开；请先核对来源与 SHA-256，再按系统“隐私与安全性”的提示操作。本项目不提供关闭 Gatekeeper 或批量移除隔离标记的命令。

## 数据与升级

- 应用记录：`~/Library/Application Support/ZEC Desk/data`
- 独立钱包：`~/Library/Application Support/ZEC Desk/wallet-mainnet`
- 项目任务地址与任务记录保存在当前浏览器的本机存储中。
- 更新前停止后台并备份钱包；替换 `.app` 不会清除上述数据。
- 发布包不含开发者的钱包、地址记录、助记词、登录态或 API Key。不要把自己的上述目录打包上传。

Mac 版通过本机浏览器显示界面。项目任务在浏览器打开，使用“复制钱包地址”手动填写；不含 Windows WebView2 内置任务窗口的自动填表功能。

构建检查不代表真实 mint 成功验证。自动 mint 仍只适配 ZADDR Public，不能保证抢到；官网、网络和钱包状态均可能影响结果。
