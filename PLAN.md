# Live Ops Board — 落地计划（已确认）

> TransVirtual take-home · Senior/Staff Frontend · 目标：1 万行虚拟化表格在每秒数百条状态更新下保持 60fps，单命令启动，可 defend。

## 已锁定的技术决策

| 决策点 | 选择 | 一句话理由 |
|---|---|---|
| Feed 传输 | 独立 Node `ws` WebSocket 服务 | 最贴近真实生产 feed，可 defend 传输/背压/重连；本地进程非"外部服务" |
| 状态管理 | Zustand（按行 selector 订阅 + 结构共享） | 生态成熟；用 selector + 结构共享规避"整表重渲染"失效模式 |
| 虚拟化 | TanStack Virtual | 2026 主流、活跃、headless 可控，配 Staff 性能叙事 |
| 更新批处理 | ref 缓冲 + requestAnimationFrame 每帧 flush | 把任意数量消息塌缩成每帧 1 次 render |
| 工程结构 | 单包 + `web/ server/ shared/` + npm workspaces-free | 只依赖 Node、一次 install、一条 dev；可复现性最强 |
| 范围 | MVP 扎实 + 性能 HUD 亮点 | 契合"未完成但有理有据 > 镀金" |

## 架构分层（= 团队分工线）

```
web/     前端：虚拟表 + Zustand store + rAF 批处理 + 筛选/搜索 + 性能 HUD   （前端性能负责人）
server/  Node ws feed：加载 CSV → 发快照 → 按可配置速率推随机 delta        （数据流/后端负责人）
shared/  协议契约：Shipment / ServerMessage / StatusUpdate / status 枚举   （接口先行，两人并行）
data/    shipments_10k.csv（随仓库交付，满足"无外部服务"）
```

## 里程碑与验收闸门

- **M1** 骨架 + 单命令 + WS 握手 → `npm run dev` 两端起来，浏览器显示已连接
- **M2** Feed：CSV 快照 + 可配置速率随机 delta → 按速率推送，客户端计数 msgs/sec
- **M3** 虚拟表：1 万行 + 4 列 + 流畅滚动 → DOM 行节点恒定
- **M4** 实时更新：按行订阅 + rAF 批处理 + 高亮 + 性能 HUD → 峰值下滚动不卡
- **M5** 筛选 + 搜索：churn 下正确且响应
- **M6** 测试：批处理合并 + churn 下筛选正确性
- **M7** 文档：README + ARCHITECTURE.md + AI_USAGE + Demo 脚本

每个 M 结束停在验收点，等确认后进下一步。全程维护 `DECISIONS.md` 与 `AI_USAGE.md`。

## 性能预算（在 M4/ARCHITECTURE 中兑现）

- 帧预算 16.67ms/frame；峰值 ~500 updates/s。
- 数据层每秒接收数百 delta，渲染层每帧最多 1 次 commit。
- 仅可视区 + 变更行重渲染；离屏变更只改 store 不碰 DOM。
- 目标：峰值速率下滚动稳定 55–60fps，输入/筛选响应 < 100ms。

## 范围边界

- **做**：需求 1–7 全覆盖 + 性能 HUD + 速率滑杆。
- **不做（写进 What I'd do next）**：鉴权、部署、排序、多列自定义、服务端筛选、离线实现（仅设计）。
