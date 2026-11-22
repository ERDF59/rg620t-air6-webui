# D-Link DWR-BE7200G · RG620T 管理控制台源码

这是 D-Link 设备 `/rg620/` 控制台及其配套后端的源码，包含网络监测、工程工具和短信管理。要改网页，从 `webui/src/pages/device/` 开始；要查某个按钮实际调用了什么，从 `backend/cellular/root/usr/libexec/rpcd/dlink-cellular` 开始。此包供阅读和构建，不是固件或安装包。

| 组件 | 对应版本 | 入口 |
|---|---|---|
| Semi WebUI | rg620-semi-webui，基于 3.0.3-r6 | `webui/src/App.tsx`、`webui/src/services/deviceUbus.ts` |
| 蜂窝管理 / LuCI | luci-app-dlink-cellular，基于 1.0.0-r20 | `backend/cellular/src/`、`backend/cellular/root/`（rpcd、ACL、服务、LuCI 页面） |
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

短信删除需要网页与后端一起更新：后端包含删除助手、rpcd 方法和写权限，网页在确认设备支持后才展示单条／批量删除。长短信按整组提交，在同一把基带锁下先核对所有现存分片再删除；若基带中途拒绝，页面报告未完全删除并把剩余分片保留在同一条。删除前会重新核对存储索引里的原短信，避免错删已复用索引中的新短信。旧后端仍可收发短信，不显示删除入口。

## 工程工具与驻留状态

打开 **工程工具**（`/rg620/#/engineering`）：

- **AT 调试**支持单行自定义 AT 和可见命令名的快捷查询。预设走只读 `at_query`；其他命令须确认后走独立写权限 `at_send`，不自动重发。命令名由基带解释，参数大小写保留。
- **SIM 卡与设备温度**分卡展示。通过 HTTPS 可以设置开机 PIN 保护，或在卡要求 PIN/PUK 时解锁。温度卡按传感器分别列出系统与基带读数。
- **蜂窝 4×4 MIMO**分别控制 5G NR 和 LTE 的许可状态。只在对应 getter 返回明确状态时允许修改，写入后读回，不主动重启射频。网络状态按主/辅载波显示实际上下行层数、MCS、调制和 PUSCH 读数。
- **接入策略**可分别设置 SA / NSA 许可、漫游限制与开机自动拨号。
- **Wi-Fi 功率档**沿用 MT7990 原厂百分比档，分别保存 2.4 GHz 与 5 GHz 的 `txpower`。主 AP 启用、广播名称、客户端隔离及 WMM 同样按频段保存。页面不重载无线；下次正常重载后应用。“驱动报告功率”来自设备信息页，不等于配置百分比或实测 EIRP。开启应用前保留有线/独立管理路径。
- **在线扫小区**需明确开始，支持按制式与范围扫描、取消；只有基带返回终态才显示已结束。取消可能有部分结果，可带入频点/PCI，仍需在锁小区页主动提交。扫描期间同一把基带锁保护短信与射频命令，现有蜂窝连接可能波动。
- **锁小区**显示配置回读和实际驻留两种状态；实际驻留用制式、ARFCN、PCI 核对。白名单只确认写入应答。单载波不写成聚合；NSA 的两种制式分别计载波。**拨号与接口**显示已拨通 APN 和会话 5QI/QCI，并可按需读取 CEER、IMS 和接入计数。

首页「服务载波」显示基带上报的最佳 SSB 与波束 RSRP，展开可看各 Rx 接收链。邻区的 RSRQ 与 SINR 取自每个小区自己的测量，不使用主小区数值代填。

### 推送借用现有 HTTPS

设备的 `dlink-cellular-events` procd 服务为有订阅的浏览器共享采样：`POST /cgi-bin/rg620-events` 用请求体传当前会话并核对 rpcd 对相应接口的读权限。流只传网络快照和短信变更信号，正文仍走原短信接口。每个设备保留一个短时流槽，其他标签和不具推送能力的旧后端自动走轮询。来电继续使用原有提醒路径。事件流由设备端采样触发，不依赖尚未证实能上报的基带回调。

批准部署时与前端一同安装 `out/cellular/`、刷新 rpcd ACL，并启动/启用 `dlink-cellular-events`。uhttpd 已有 CGI 路径和并发配置，无需另开端口。若经现有公网 Caddy 访问，保留现有认证，仅按需为 `/cgi-bin/rg620-events` 加一条精确路径；不改代理时仍可使用轮询。不要把会话 ID 放在 URL。

## 构建设备后端

原生部分需要匹配的 MT6990/T830 AArch64-musl 工具链、Quectel 开发头和运行库、MediaTek 语音头及 D-Link 语音运行环境。通用 OpenWrt SDK 或仅有这份 ZIP 不足以构建全部 C 程序。浏览代码、构建前端和 Go 网关不需要这些厂商文件。

在 Linux 编译机配置以下环境变量，均为已有 SDK 的绝对路径：

| 变量 | 指向 |
|---|---|
| `CC`、`STAGING_DIR` | 目标编译器 `aarch64-openwrt-linux-musl-gcc`、对应 OpenWrt 目标 staging 目录 |
| `VENDOR_INC` | 移远目标 include 根，内含 `mipc/msg/`、`mipc/common/` 和 `alsa/` |
| `RIL_INC`、`RIL_LIB` | `ql_nw.h` 与 `ql_sms.h` 所在目录；含 `libqlril.so`、`libmipc_msg.so`、`libasound.so.2` 和匹配 libc 的库目录 |
| `AT_INC` | 包含 `quectel_atcid_sender.h` 的 SDK 目录，默认 `VENDOR_INC`；`RIL_LIB` 还须包含 `libql_at.so` |
| `JSON_C_CFLAGS`、`JSON_C_LIBS` | 目标 json-c 的编译与链接参数；非默认搜索路径时分别指定 `-I…` 和 `-L… -ljson-c` |
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

工程工具的验证入口见 `tests/engineering-*.sh` 和 `webui/tests/engineering-browser.cjs`，使用隔离的 OpenWrt、厂商 API 测试替身和合成数据，不需要连接路由器。其中 `engineering-sse-openwrt.sh` 用真实 rpcd/uhttpd 检查鉴权和流式响应；`engineering-scan-native.sh` 用测试回调验证扫描终态。交叉构建、浏览器验证和实机操作分别验收。
