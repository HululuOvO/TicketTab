<div align="center">
  <img src="./assets/logo.svg" width="132" height="132" alt="TicketTab Logo" />
  <h1>TicketTab</h1>
  <p><strong>贴在屏幕边缘的热敏小票桌面任务板 · 支持 Windows &amp; macOS · 全平台 AI 接入</strong></p>

  <p>
    <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-221f1b?style=flat-square" alt="Platform" />
    <img src="https://img.shields.io/badge/Runtime%20Deps-Zero-2e8b67?style=flat-square" alt="Zero Deps" />
    <img src="https://img.shields.io/badge/AI%20Ready-MCP%20%7C%20HTTP%20%7C%20Clipboard-c95642?style=flat-square" alt="AI Ready" />
    <img src="https://img.shields.io/badge/License-MIT-8a7f70?style=flat-square" alt="License" />
  </p>
</div>

<p align="center">
  <img src="./docs/preview.png" alt="TicketTab Preview" width="100%" />
</p>

---

## 核心特性

- **极简贴边书签 · 60/120fps 丝滑收放**  
  平时仅在屏幕左侧或右侧露出纤细的奶油纸书签（含环形微进度与计数），鼠标靠近轻盈探出；采用固定透明画布 + 鼠标穿透 + 纯 GPU `transform` 滑轨，展开与收起彻底告别窗口跳变卡顿。按住书签可自由上下拖动，拖过屏幕中线自动吸附换边。
- **明亮热敏小票机实体质感 × 火烤消字动效**  
  顶部陶瓷哑光热敏机头（内置电源指示灯、散热格栅、25 分钟专注倒计时模块与深凹出纸槽）+ 从纸槽自然吐出的暖象牙热敏纸 + 底部真实锯齿撕边与条形码 +「本周已清 N 项」正向累计（无连打焦虑）。当天任务全部勾选完成变成 `ALL DONE` 后，自动触发自下而上的暖色热敏烘烤动画，已完成字迹泛黄消散归档；未完成任务次日自动顺延置顶，并换上泛黄旧票纸色与原日期角标（如 `11.22`）清晰区分。
- **内置 25 分钟专注倒计时（联动贴边悬浮窗）**  
  点击热敏机头右上角计时器即可开始/暂停（右键快速切换 25 / 15 / 45 分钟）；收起面板后，贴边悬浮书签会自动切换为实时跳动的倒计时胶囊与呼吸灯，不遮挡屏幕也能随时掌握专注节奏。
- **多日排期 + 自然语言自动识别**  
  顶部日期条一键切换「今天 / 明天 / 后天 / 未来排期 / 任意日历日期」。输入框直接写 `明天 评审方案`、`下周三 季度复盘`、`12月5日 合同归档`，自动落入对应日期。
- **全平台 AI 零门槛接入（GPT / Claude / Gemini / DeepSeek / 通义 / Kimi / WorkBuddy）**  
  - **方式 1 · 新手 0 配置**：复制任意 AI 的会议纪要/待办回复，直接 `Ctrl+V / Cmd+V` 贴进输入框，或点击 `✦` →「从剪贴板一键吸票」，自动按日期拆条出票。
  - **方式 2 · MCP 原生直连**：内置零依赖标准 MCP Server（[`mcp/mcp-server.js`](./mcp/mcp-server.js)），点击 `✦` 一键复制配置，直接接入 Claude Desktop / Cursor / WorkBuddy / Cherry Studio / DeepSeek Harness。
  - **方式 3 · 本地 HTTP 网关**：应用运行时自动监听 `http://127.0.0.1:27319`，支持 Coze / Dify / WorkBuddy / 快捷指令 / 脚本直接推送任务并实时触发桌面出票动画。
- **高自由度偏好设置**  
  内置轻量设置抽屉：支持 **4 种贴边悬浮样式**（真实出纸口 / 探头动漫小票机 / 灵动岛胶囊 / 复古小硬件，均自适应 10+ 任务与 25 分钟倒计时）、**4 套明亮纸张配色**（暖象牙 / 樱桃粉 / 抹茶绿 / 晴空蓝）、左右贴边切换、悬停自动滑出、热敏自动消字开关、未完成跨天顺延、失焦固定、纸张音效与开机自动启动。

---

## 快速开始（Windows & macOS）

### 1. 本地运行
> 需要 Node.js 20+ 与 pnpm（或 npm）

```bash
pnpm install
pnpm start
```

### 2. 打包桌面安装包

**Windows（生成免安装单文件 `.exe`）：**
```bash
pnpm run build:win
# 产物位置：dist/TicketTab 1.0.0.exe
```

**macOS（生成 Apple Silicon M1–M4 + Intel `.dmg`，需在 MacBook 或 GitHub Actions 上执行）：**
```bash
pnpm run build:mac
# 产物位置：dist/TicketTab-1.0.0-arm64.dmg & dist/TicketTab-1.0.0.dmg
```

> 本仓库已内置 [`.github/workflows/release.yml`](./.github/workflows/release.yml)，推送到 GitHub 后在 **Actions** 页面点击 `Run workflow` 即可云端自动构建 Windows `.exe` 与 macOS `.dmg` 双端安装包！

---

## 接入任意 AI 的 3 种方法

### 方法 A：所有网页 / App AI 通用（零配置）
1. 在 TicketTab 输入框点右侧的 **`✦`** → 点击 **「通用 AI 口令」**；
2. 把口令和你的会议记录/想法一起发给 ChatGPT / DeepSeek / Gemini / Kimi / 豆包 / Claude；
3. 复制 AI 回复 → 点 **「从剪贴板一键吸票」**（或直接粘贴进任务输入框），自动识别日期并生成任务小票。

### 方法 B：标准 MCP 协议直连（Claude / Cursor / WorkBuddy / Cherry Studio / DeepSeek Harness）
点 **`✦`** → 点击 **「MCP 直连配置」**，粘贴到对应客户端的 MCP 配置中即可：
```json
{
  "mcpServers": {
    "tickettab": {
      "command": "node",
      "args": ["/你的路径/TicketTab/mcp/mcp-server.js"]
    }
  }
}
```
提供 3 个标准工具：`tickettab_add_tasks`、`tickettab_list_tasks`、`tickettab_toggle_task`。

### 方法 C：本地 HTTP API 实时推票（WorkBuddy / Dify / Coze / 快捷指令 / 脚本）
```bash
curl -X POST http://127.0.0.1:27319/import \
  -H "Content-Type: application/json" \
  -d '{"text":"今天 完成周报 !\n明天 下午评审设计稿\n下周三 季度复盘"}'
```

| 接口 | 方法 | 说明 |
|---|---|---|
| `/health` | `GET` | 检查运行状态与端口 |
| `/tasks?date=YYYY-MM-DD` | `GET` | 读取指定日期与未来排期快照 |
| `/import` | `POST` | 批量解析自然语言 / 会议纪要 / JSON 并出票 |
| `/tasks` | `POST` | 新增单条或多条结构化任务 |
| `/tasks/:id/toggle` | `POST` | 勾选 / 取消勾选任务 |
| `/tasks/:id` | `DELETE` | 删除指定任务 |

---

## 运行单元测试

```bash
pnpm test
```

## 目录结构

```text
TicketTab/
├── assets/
│   ├── logo.svg                 # 动漫卡通热敏小票机矢量主 Logo
│   └── tray-icon.png            # 系统托盘图标
├── build/
│   ├── icon.ico                 # Windows 多尺寸应用图标
│   ├── icon.icns                # macOS Retina 应用图标
│   └── icon.png                 # 1024×1024 高清主图标
├── docs/
│   └── preview.png              # 实机多态视觉展示图
├── mcp/
│   └── mcp-server.js            # 零依赖标准 MCP Server (stdio)
├── src/
│   ├── shared/
│   │   ├── date-parser.js       # 自然语言日期与 AI 笔记解析引擎
│   │   └── store.js             # 多日排期持久化与顺延状态机
│   ├── main/
│   │   ├── ai-bridge.js         # 127.0.0.1:27319 本地 AI HTTP 网关
│   │   └── main.js              # 透明置顶窗、鼠标穿透、托盘、快捷键
│   ├── preload/preload.js       # contextBridge 安全白名单桥接
│   └── renderer/                # HTML / CSS / Web Audio 音效 / 渲染交互
└── tests/store.test.js          # Node 原生单元测试
```

## License

[MIT](./LICENSE)
