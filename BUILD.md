# Build

## Node.js

Use Node.js 24 (Windows release bundles official Node.js 24.19.0 x64). No npm dependencies are required. Run `node --test tests/*.test.mjs` before packaging. Run `node server.mjs` for the browser interface.

The default loopback port is 8793. Set `ZEC_DESK_PORT` to an unused port for isolated backend tests; the Windows launcher uses 8793. Never run tests against a funded wallet.

## Windows launchers

Prerequisites: Windows .NET Framework 4 compiler, WebView2 SDK NuGet package **Microsoft.Web.WebView2 1.0.3800.47**, app icon `ZEC Desk.ico`.

Download the SDK from NuGet, extract it, and copy its `lib/net462/Microsoft.Web.WebView2.Core.dll`, `lib/net462/Microsoft.Web.WebView2.WinForms.dll` and `runtimes/win-x64/native/WebView2Loader.dll` to the app root. Include the SDK license and notice. Install WebView2 Runtime separately.

From the repository root in PowerShell:

```powershell
$csc = "$env:WINDIR/Microsoft.NET/Framework64/v4.0.30319/csc.exe"
& $csc /nologo /target:winexe /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll '/win32icon:ZEC Desk.ico' '/out:ZEC Desk.exe' launcher/ZecDeskLauncher.cs
& $csc /nologo /target:winexe /platform:x64 /main:ZecDeskWindow /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:Microsoft.Web.WebView2.Core.dll /reference:Microsoft.Web.WebView2.WinForms.dll '/win32icon:ZEC Desk.ico' /out:ZecDeskWindow.exe launcher/ZecDeskLauncher.cs launcher/ZecDeskWindow.cs
```

Copy the official Windows Node executable into `runtime/node.exe`, with its license as `runtime/NODE-LICENSE.txt`.

## Zcash wallet (Ubuntu / WSL)

Upstream: https://github.com/zingolabs/zingolib

Pinned source: tag `zingolib_v5.0.0`, commit `9e897f8b2fc5f12a99604f2533164af62af7d3ac`. Use the upstream Rust 1.90 toolchain. The CLI package version is 0.4.0 and its displayed library version can differ.

```sh
git clone https://github.com/zingolabs/zingolib.git
cd zingolib
git checkout 9e897f8b2fc5f12a99604f2533164af62af7d3ac
git apply /path/to/ZEC-Desk/native/desk-stdio.patch
RUSTFLAGS="--remap-path-prefix=$PWD=/build/source --remap-path-prefix=$HOME=/build/home" cargo build --locked --release -p zingo-cli
```

Copy `target/release/zingo-cli` to `native/zingo-deskwallet`, alongside `native/ZINGO-LICENSE.txt`. Validate dependencies with `ldd` in Ubuntu. The release binary has had embedded personal build-home prefixes normalized with equal-length replacement; only source-path strings were changed. Future builds should use the compiler path remapping above.

`desk_stdio` adds newline-delimited JSON on a child-process pipe, with a restricted command list and `ZEC_DESK_JSON:` response prefix. It does not expose a wallet TCP port or rewrite cryptographic algorithms. Wallet storage is outside the application folder under `~/.local/share/zec-desk/wallet-mainnet` in the WSL distribution named `Ubuntu`.

## Release packaging

Use `node scripts/package.mjs` after building binaries. This copies only explicitly allowed source/runtime files into a new `release/ZEC-Desk-v0.1.0-Windows-x64` directory. It refuses to overwrite an existing release. Audit the output, then ZIP that directory and publish its SHA-256 hash.

Never copy `data/`, WebView2 profiles, logs, wallet files, local configuration, build caches or environment files. Do not redistribute NFT artwork caches without permission. Public project URLs and OAuth client identifiers in source are protocol configuration, not personal credentials.

## Grok compatibility

Device authorization uses `auth.x.ai`. Subscription traffic uses `cli-chat-proxy.grok.com`; explicit API-key traffic uses `api.x.ai`. The channels remain separate. This is experimental interoperability, not an official xAI client; service changes may require updates.

Reference implementations: https://github.com/lidge-jun/opencodex and https://github.com/RongleCat/grok-go . Credentials and research results stay in process memory. No model request is triggered just by logging in. Manual research is limited to three search tool calls and 2400 output tokens, which is not a monetary spending cap.

Fixture tests cover budget checks, uncertain payment handling, parser limits, source validation and authentication isolation. Tests do not establish real mint success or future service compatibility.
