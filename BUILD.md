# Build

## Windows desktop exit

Build both executables with `scripts/build-windows.ps1 -DependencyRoot <runtime-and-WebView2-folder> -OutputDirectory <output-folder>`.
Closing the main window or choosing the tray quit action uses the authenticated exit route after verifying the folder identity. Busy wallet/payment operations keep the window open; HTTP timeouts never kill processes. New mutations are rejected during shutdown. Minimize the desktop window to keep tasks running.

Validation: the native shutdown handshake rejects foreign instances, missing tokens and busy responses. Closing the real desktop window released port 8793 and both desktop processes. Relaunch succeeded without a conflict; no wallet or payment was active during testing.

## Node.js

Use Node.js 24 (Windows release bundles official Node.js 24.19.0 x64). No npm dependencies are required. Run `node --test tests/*.test.mjs` before packaging. Run `node server.mjs` for the browser interface.

The default loopback port is 8793. Set `ZEC_DESK_PORT` to an unused port for isolated backend tests; the Windows launcher uses 8793. Never run tests against a funded wallet.

## Windows launchers

Prerequisites: Windows .NET Framework 4 compiler, WebView2 SDK NuGet package **Microsoft.Web.WebView2 1.0.3800.47**, app icon `ZEC Desk.ico`.

Download the SDK from NuGet, extract it, and copy its `lib/net462/Microsoft.Web.WebView2.Core.dll`, `lib/net462/Microsoft.Web.WebView2.WinForms.dll` and `runtimes/win-x64/native/WebView2Loader.dll` to the app root. Include the SDK license and notice. Install WebView2 Runtime separately.

From the repository root in PowerShell:

```powershell
$csc = "$env:WINDIR/Microsoft.NET/Framework64/v4.0.30319/csc.exe"
& $csc /nologo /target:winexe /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll '/win32icon:ZEC Desk.ico' '/out:ZEC Desk.exe' launcher\ZecDeskLauncher.cs
& $csc /nologo /target:winexe /platform:x64 /main:ZecDeskWindow /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:Microsoft.Web.WebView2.Core.dll /reference:Microsoft.Web.WebView2.WinForms.dll /resource:launcher\task-autofill.js,task-autofill.js '/win32icon:ZEC Desk.ico' /out:ZecDeskWindow.exe launcher\ZecDeskLauncher.cs launcher\ZecDeskWindow.cs launcher\ProjectTaskWindow.cs
```

Copy the official Windows Node executable into `runtime/node.exe`, with its license as `runtime/NODE-LICENSE.txt`.

## Zcash wallet (Ubuntu / WSL)

Upstream: https://github.com/zingolabs/zingolib

Pinned source: tag `zingolib_v6.0.0`, commit `c6381534f802b1022041beda4b01c106ad132329`. Use the upstream Rust 1.97.1 toolchain. The CLI package is 0.4.0, the wallet library is 6.0.0. Keep default features and the NU6.3 configuration. This release uses zcash_primitives 0.30.0 for Ironwood transactions.

```sh
git clone https://github.com/zingolabs/zingolib.git
cd zingolib
git checkout c6381534f802b1022041beda4b01c106ad132329
git apply /path/to/ZEC-Desk/native/desk-stdio.patch
export RUSTFLAGS="--cfg zcash_unstable=\"nu6.3\" --remap-path-prefix=$PWD=/build/source --remap-path-prefix=$HOME=/build/home"
cargo build --locked --release -p zingo-cli
cargo build --locked --release --manifest-path zingo-netutils/Cargo.toml --features nym --bin nym-proxy
```

Copy `target/release/zingo-cli` to `native/zingo-deskwallet`, and `zingo-netutils/target/release/nym-proxy` to `native/nym-proxy`, alongside `native/ZINGO-LICENSE.txt`. Both binaries are required. Validate dependencies with `ldd` in Ubuntu. Generate `native/SHA256SUMS.txt` for both binaries and the patch. Compiler path remapping excludes personal build paths. Include upstream dependency licenses when redistributing.

`--desk-stdio` adds bounded newline-delimited JSON on a private child-process pipe, with a restricted command list and `ZEC_DESK_JSON:` response prefix. Commands use upstream parsing and dispatch. The Nym companion manages its own loopback transport endpoints. Wallet storage is outside the application folder under `~/.local/share/zec-desk/wallet-mainnet` in the WSL distribution named `Ubuntu`. Preserve an opaque private backup before upgrading existing wallets.

## Release packaging

Use `node scripts/package.mjs` after building binaries. This copies only explicitly allowed source/runtime files into a new `release/ZEC-Desk-v0.2.0-Windows-x64` directory. It refuses to overwrite an existing release. Audit the output, then ZIP that directory and publish its SHA-256 hash.

Never copy `data/`, WebView2 profiles, logs, wallet files, local configuration, build caches or environment files. Do not redistribute NFT artwork caches without permission. Public project URLs and OAuth client identifiers in source are protocol configuration, not personal credentials.

## Grok compatibility

Device authorization uses `auth.x.ai`. Subscription traffic uses `cli-chat-proxy.grok.com`; explicit API-key traffic uses `api.x.ai`. The channels remain separate. This is experimental interoperability, not an official xAI client; service changes may require updates.

Reference implementations: https://github.com/lidge-jun/opencodex and https://github.com/RongleCat/grok-go . Credentials and research results stay in process memory. No model request is triggered just by logging in. Manual research is limited to three search tool calls and 2400 output tokens, which is not a monetary spending cap.

Fixture tests cover budget checks, uncertain payment handling, parser limits, source validation and authentication isolation. Tests do not establish real mint success or future service compatibility.

v0.2.0 validation: 100 automated tests; disposable-wallet mainnet synchronization reached 100%, including Ironwood outputs. The wrapper uses v6 height syntax and requires every native scan range to be fully scanned before payment readiness. No funded mint is part of release testing. Backup-modal tests cover stale close events and late recovery responses. Noir tests cover account changes, explicit consent, single-use requests and uncertain results.

## macOS releases

`.github/workflows/macos.yml` builds on native Apple Silicon and Intel GitHub-hosted macOS runners. Node.js 24.21.0 archives are checked against the official SHA-256 manifest. The pinned wallet source and desk patch above are built natively with Rust 1.97.1, deployment target macOS 14.0, and remapped build paths. `launcher/wallet-lock.c` holds an OS lock across wallet execution and checks create/open under that lock. No WSL dependency is used on macOS.

`node scripts/package-macos.mjs` assembles an allowlisted .app bundle with matching Node/wallet/Nym architectures, applies ad-hoc signatures and verifies the bundle. This is not Apple Developer ID signing or notarization. `node scripts/smoke-macos.mjs <release-directory>` checks native binary loading, exclusive wallet locking, fresh isolated data and authenticated shutdown, without creating a live wallet or making payments. `node scripts/audit-macos.mjs <release-directory>` rejects private data files and obvious credentials. ZIP extraction and signature checks run again before upload. The workflow creates a draft release only; review both architecture jobs and artifact hashes before publication.

The .app launcher opens the local interface in Chrome when available (otherwise the default browser), and refuses to reuse a different installation on port 8793. Application data and the native wallet live outside the app bundle under `~/Library/Application Support/ZEC Desk`. Browser task records stay in that browser profile. macOS project tasks use browser/manual address entry, not the Windows WebView2 autofill window. Closing the browser leaves the Zingo service running; stop through the app UI.
