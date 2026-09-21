# ZEC Desk

Zcash NFT 项目监控、早期线索发现与 ZADDR Public mint 本地工作台。复古桌面界面，MIT 开源。

**Windows 下载：[Releases](https://github.com/cryptoresetlife/ZEC-Desk/releases)**。下载 Windows ZIP，完整解压后双击 **ZEC Desk.exe**。不要只移动 EXE。

## 功能

- ZADDR 官网状态、Public 开售时间、价格、余量与公开动态。
- zebra.family 市场系列、挂牌数量、最低挂单价、项目图片和变化提醒。
- 添加项目官网或市场系列为自选；目标价提醒、搜索、筛选。
- 早期项目与资格线索：项目官网检查、ZECMAP 资格页面、待开售计划。
- X 搜索热度与官推线索：需自行配置可用 X API Bearer Token，可设置扫描频率与请求上限。
- Grok 手动研究：官方设备授权登录，或自行填写 xAI API Key；结果提供来源链接；流式显示搜索进度，最长等待 5 分钟，可取消本次查询。
- 独立本地 Zcash 钱包：余额、同步、备份、交易记录。
- Noir 插件付款：在 Chrome 连接本机页面，等待 ZADDR Public 后唤起插件，用户确认付款。
- 项目任务工作台：在软件中打开项目页面，辅助填写选定的公开钱包地址。
- **ZADDR Public 自动 mint**：选择钱包、备份、预检并确认数量和预算后，等待官网开放再执行；付款状态不明时停止，避免重复付款。

## 快速使用

1. Windows 10/11 x64，安装 [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。解压并启动程序。
2. 在“发现项目”启动扫描；在“我的自选”粘贴 HTTPS 官网链接，预览后添加。
3. 使用 Noir：在“开始 mint”点击“在 Chrome 连接 Noir”，打开的是下载者自己电脑的 `http://localhost:8793/#noirmint`。连接插件、核对预算并等待开售，最终付款在 Noir 中确认。
4. 如需 Zingo 全自动 mint，安装 WSL 的 **Ubuntu** 发行版（建议 Ubuntu 24.04）：管理员终端运行 `wsl --install -d Ubuntu`，按提示重启、完成 Ubuntu 首次初始化。
5. 在“更多功能 → 独立钱包”创建或打开软件钱包，备份恢复信息，等待同步完成，再转入自己决定的少量预算。它与 Noir 插件钱包独立。
6. 在“Zingo 全自动 mint”核对项目、收款规则、数量、单价和费用预算，完成预检后确认启动。保持电脑开机且不休眠。
7. 退出请用“停止并退出软件”。关闭窗口后 Zingo 后台可能继续运行；Noir 等待需要保持 Chrome 页面打开。重新打开不会自动恢复付款任务。

## 接入范围与限制

- 预览版：目前自动付款只适配 **ZADDR Public**，ZECMAP 仅资格观察。添加任意官网不会自动获得付款能力。
- 项目发现来自已配置公开网页、市场索引和可用 X 搜索样本，**不是全链所有 NFT / 预售扫描**。挂牌不等于公开预售；早期线索不代表官方身份或收益。
- X API、xAI API 和 Grok 订阅额度不同；X Premium 不会自动生成免费 xAI API Key。实际权限、额度和费用以服务方账号为准。Grok 订阅接口为实验兼容，可能变更。
- 扫描、手动研究和 Noir 插件流程不需要 WSL；Zingo 独立钱包需要它。程序未做代码签名。
- 开售抢购没有成功保证，官网限流、钱包同步和网络可能影响执行。上链付款不能撤回；勿把测试通过理解为实盘成交保证。
- 市场图片从提供方加载；未提供或不可用的图片显示占位。公开包不附带 ZADDR NFT 图片缓存，点击卡片可去官网图库查看。

## 隐私与数据

发布包首次启动不含钱包、个人自选、任务、登录态、API Key 或运行记录。应用数据写入本机 `data/`；钱包文件位于 Ubuntu 的 `~/.local/share/zec-desk/wallet-mainnet`，**删除软件目录不会删除钱包**。

Grok 登录凭据、X Token、API Key 与官网访问口令仅在进程内存中保存，退出后需要重新填写或登录。钱包恢复信息只在主动备份时显示。WebView2 浏览器资料保存在本地 data 目录，分享程序时不能带上。

数据不会上传到本项目的服务器；查询会访问对应官网、市场、图片网关、X/xAI 和 Zcash lightwallet 服务，它们会看到相应请求。不要将恢复信息、登录码或密钥提交到 Issue。

v0.2.0 起使用 Zingolib v6 及配套 Nym 传输组件。首次打开钱包可能需要等待网络组件初始化，随后自动同步。升级前先备份钱包，并保留自己的 `data/` 防重复付款记录；发布下载包中不包含这些资料。

## 开发

安装 Node.js 24，在仓库目录运行：

```sh
node --test tests/*.test.mjs
node server.mjs
```

打开 `http://127.0.0.1:8793`。仅绑定本机回环地址。源码仓库不含运行时二进制，钱包与 Windows 外壳构建见 [BUILD.md](BUILD.md)。

## 许可证

应用源码使用 [MIT](LICENSE)。第三方组件和 NFT 图片不包含在本项目 MIT 授权中，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
