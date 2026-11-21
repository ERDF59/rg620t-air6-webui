# D-Link DWR-BE7200G · RG620T 管理控制台源码

这是当前 D-Link 设备上 `/rg620/` 控制台及其配套后端的源码快照。要改网页，从 `webui/src/pages/device/` 开始；要查某个按钮实际调用了什么，从 `backend/cellular/root/usr/libexec/rpcd/dlink-cellular` 开始。此包供阅读和构建，不是固件或安装包。

| 组件 | 对应版本 | 入口 |
|---|---|---|
| Semi WebUI | rg620-semi-webui 3.0.3-r4 | `webui/src/App.tsx`、`webui/src/services/deviceUbus.ts` |
| 蜂窝管理 / LuCI | luci-app-dlink-cellular 1.0.0-r18 | `backend/cellular/src/`、`backend/cellular/root/`（rpcd、ACL、服务、LuCI 页面） |
| 网页通话 | t830-webvoice 0.1.0-r1 | `backend/webvoice/gateway/`（Go/WebRTC）、`backend/webvoice/native/`（设备侧收发音）、`backend/audio-common/` |

## 先构建网页

本次验证使用 Node.js 22 和 npm 10。在已安装 Node.js 的机器上：

```sh
cd webui
npm ci
npm run typecheck
npm run lint:tokens
npm run build -- --mode dlink
```

`dist/` 的内容对应设备的 `/www/rg620/`；浏览器入口是 `https://<设备地址>/rg620/`。D-Link 页面使用同源 `/ubus` 和 rpcd 登录，不使用旧版 AT WebSocket 服务。只启动本地 Vite 不会连接到路由器的登录服务。源码保留了旧版前端的未路由页面和演示数据；**不要用 `npm run deploy` 或 `sync:www` 部署 D-Link**，这两个旧命令针对另一机型的 `/5700/` 目录。

## 从网页跟到基带

- **信号、锁频/锁小区、短信**：界面经 `deviceUbus.ts` 调用 `dlink-cellular`。对应 rpcd 方法、ACL 和调用的 shell / C 程序都在 `backend/cellular/`。
- **来电提醒和按键**：`webui/src/modules/alerts/IncomingAlerts.tsx` 处理跨页面来电和新短信；弹窗的接听／拒接会在后端再核对通话。通话中的 DTMF 由 `backend/cellular/src/dtmf.c` 通过 MIPC 发送。
- **浏览器语音**：`webui/src/modules/webvoice/` 对接 `dlink-webvoice`；网关管理 WebRTC 会话，`rx.c` 读设备音频，`tx.c` 将上行音频送到设备语音服务。实际使用要有受浏览器信任的 HTTPS 和麦克风权限。

## 构建设备后端

原生部分需要匹配的 MT6990/T830 AArch64-musl 工具链、Quectel 开发头和运行库、MediaTek 语音头及 D-Link 语音运行环境。通用 OpenWrt SDK 或仅有这份 ZIP 不足以构建全部 C 程序。浏览代码、构建前端和 Go 网关不需要这些厂商文件。

在 Linux 编译机配置以下环境变量，均为已有 SDK 的绝对路径：

| 变量 | 指向 |
|---|---|
| `CC`、`STAGING_DIR` | 目标编译器 `aarch64-openwrt-linux-musl-gcc`、对应 OpenWrt 目标 staging 目录 |
| `VENDOR_INC` | 移远目标 include 根，内含 `mipc/msg/`、`mipc/common/` 和 `alsa/` |
| `RIL_INC`、`RIL_LIB` | `ql_nw.h` 与 `ql_sms.h` 所在目录；含 `libqlril.so`、`libmipc_msg.so`、`libasound.so.2` 和匹配 libc 的库目录 |
| `SPEECH_OS` | `libspeech_drv/audio_big_sw/os`，内含 `include/speech_drv.h` 和 `system/audio-base.h` |
| `SPEECH_ROOT` | 匹配的语音运行环境根，含 `lib/`、`usr/lib/libspeech_drv.so` 和 `usr/lib/libaudioparamparser.so` |

从本包根目录执行，`out` 须为尚不存在的目录：

```sh
./tools/build-native.sh out
(
  cd backend/webvoice/gateway
  go test ./...
  CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -o ../../../out/webvoice/usr/sbin/dlink-webvoice .
)
```

Go 版本要求见 `backend/webvoice/gateway/go.mod`（1.26）。`out/cellular/` 和 `out/webvoice/` 是供打包的文件树，脚本不会连接或更改路由器。默认 Go 测试覆盖编解码与通话状态保护；若开发机装有 Chromium 和 playwright-core，可设置 `CHROMIUM_PATH`（浏览器路径）、`PW_CORE`（模块路径）与 `WEBVOICE_BROWSER_TEST=1`，再跑 `go test -count=1 ./...` 测试模拟双向语音。

设备运行还需要与原固件匹配的 `t830-quectel-runtime`；网页通话依赖 `t830-speech-runtime 0.1.0-r3`、对应内核音频支持和设备混音路由。厂商库、内核、基带、校准数据和设备证书均未附带，不能把本包直接刷入路由器。

## 许可与构建核对

蜂窝管理包附带的 MIT 文本在 `backend/cellular/root/usr/share/licenses/luci-app-dlink-cellular/LICENSE`。前端保留了 MT5700M/Semi 项目来源；其依赖见 `webui/package-lock.json`，Go 依赖见 `go.mod` 和 `go.sum`。本快照没有为前端或整包新增开源许可证，蜂窝子包的 MIT 声明不代表厂商 SDK 或整个工程的授权。

本次从导出源码重建的网页与 r4 发布目录逐文件一致。编译机交叉构建的全部 C 助手，代码段和只读数据段与对应发布程序一致。Go 网关通过 ARM64 构建，并通过模拟浏览器双向音频、静音和挂断释放测试；未用真实电话、短信或刷机作验证。
