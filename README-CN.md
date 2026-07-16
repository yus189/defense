# Live Ops Board

> 本文为 [`README.md`](./README.md) 的中文版。技术标识符、命令与工具名保留原样。

一张高吞吐的货运运营看板：1 万行货运的虚拟化表格，在**每秒数百条状态更新**经由自建 WebSocket feed 涌入时，仍保持 **120fps** 流畅。技术栈：React + TypeScript、Zustand、TanStack Virtual，以及一个 Node WebSocket feed——以**单条命令启动、无外部服务**。

![Live Ops Board](docs/screenshot.png)

## 运行 demo

```bash
npm install
npm run dev
```

`npm run dev` 会通过 `concurrently` **同时**启动 feed 服务（`ws://localhost:8080`）和 web 应用。打开 **http://localhost:5173**。

- 需要 **Node 20+**（在 Node 24 上开发）。无数据库、无云、无其他需安装项。
- 可选：`FEED_RATE=800 npm run dev` 设定 feed 的初始速率（也可在界面里实时调）。

```bash
npm test        # 26 个单测（批处理、churn 下筛选、feed 引擎、CSV）
npm run typecheck
npm run build   # 生产构建
```

## 上手试试

- 把 **FEED RATE** 拖到 2000/s——表格依旧流畅；看 **FPS / Applied/s / Batch** HUD。
- 边翻动边按**状态** chip 筛选、在**搜索**框输入（reference 或 customer）——视图始终正确。
- 高负载下快速滚动——DOM 行数恒定（虚拟化）。

## 关键决策（及原因）

完整取舍见 [DECISIONS.md](./DECISIONS.md)；性能设计见 [ARCHITECTURE.md](./ARCHITECTURE.md)。要点：

| 选择 | 原因 |
|---|---|
| **独立 Node `ws` feed** | 一个诚实的、贴近生产的 feed，有真实的传输边界；本地进程不算"外部服务"，所以一条命令仍能跑起全部。 |
| **Zustand + 按行 selector + 结构共享** | 一次状态更新只重渲染一行、而非整表——规避"整表重渲染"陷阱。 |
| **TanStack Virtual** | 1 万行下 DOM 节点数恒定；活跃维护、headless。 |
| **rAF 批处理** | 任意到达速率塌缩成每帧 ≤1 次提交（~16.7ms）。 |
| **单包（`web/ server/ shared/`）、纯 npm** | 可复现性优先：只需 Node——一次 `npm install`、一条 `npm run dev`、零额外工具链。边界靠文件夹 + 类型化 `shared` 契约保持清晰。 |
| **只测棘手部分** | 批处理、churn 下筛选、feed 引擎、CSV 守卫——不做宽泛 UI 快照（按题目要求）。 |

## 工具选型

Vite + TypeScript、React 18、Zustand、TanStack Virtual、`ws`、`tsx`（直接跑 TS）、`concurrently`（单命令）、Vitest。为快速开发循环与最小搭建摩擦而选；提交的 `package-lock.json` 锁死依赖树（`npm ci` 可复现）。

## 下一步会做

- **生产级单进程启动**：由 feed 的 Node 进程直接托管已构建的 SPA，使一条命令也能跑构建后的应用（目前 `npm run dev` 是那条单命令）。
- **筛选移到 Web Worker**：在 10 万+ 行时保持主线程空闲。
- **重连时 delta 追赶**（序列号 + 服务端环形缓冲）以及 ARCHITECTURE.md 中描述的 IndexedDB 离线缓存。
- **Playwright 冒烟测试**：在 CI 中断言负载下 FPS 与 churn 下筛选（[`tools/`](./tools) 里的 CDP 脚本已在本地证明这一点）。
- **列排序**，以及在筛选 chip 上显示每个状态的实时数量。

## AI 使用说明

见 [AI_USAGE.md](./AI_USAGE.md)：用了哪些工具、哪些由 AI 生成 vs. 由工程师主导，以及 AI/流程犯的两个具体错误及如何抓到。

## 项目结构

```
web/     React 客户端——虚拟表、Zustand store、rAF 批处理更新、筛选、性能 HUD
server/  Node ws feed——加载 CSV、发快照、推随机状态 delta
shared/  两端共享的传输协议（Shipment、ServerMessage、status 枚举）
data/    shipments_10k.csv（随包——demo 无需外部服务）
```
