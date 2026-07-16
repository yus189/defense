# 答辩文档 / 项目全知识库 — Live Ops Board

> 私用备战底稿（放 `.assignment/`，不交付）。本文目标：**信息完备到——把它单独喂给一个没有上下文的 agent，也能答出本项目的所有细节**。
> 配套（交付版，英文）：`README.md` · `ARCHITECTURE.md` · `DECISIONS.md` · `AI_USAGE.md`；性能验证脚本在 `tools/`。中文陪读：`ARCHITECTURE-CN.md` · `DECISIONS-CN.md` · `AI_USAGE-CN.md` · `README-CN.md`。

---

## 0. 一句话电梯陈述

"这是一张 1 万行的实时货运运营看板。真正的工程挑战不是数据建模（CSV 是干净的合成数据），而是**让虚拟化表格在每秒数百到数千条状态更新涌入时保持 120fps，且筛选/搜索始终正确**。我用三层架构（feed / 协议 / web）+ 三条性能主线（虚拟化、rAF 批处理、按行订阅 + 结构共享）达成，实测 800/s 满帧、2000/s 仍跟得上、churn 下筛选 0 违规，全部由一条 `npm run dev` 启动、无外部服务。"

## 1. 评审标准 → 本项目落点（逐条对齐）

| 评审维度 | 本项目如何满足 | 讲哪里 |
|---|---|---|
| 技术选型有合理依据（会追问） | 每个选型都有 options→decision→why→放弃，记在 `DECISIONS.md` D1–D9 | §9 + DECISIONS |
| 现场演示 ~5min | `DEMO.md` 分镜脚本（点什么、说什么） | DEMO.md |
| 可拓展性（CTO+Leader 提扩展） | Scale 三问预写 + 架构边界清晰便于讲优化 | §12 |
| **可运行是核心**（跑不起来终止） | 单命令 `npm run dev`、纯 npm、锁文件、全新 `npm ci` 实测通过 | §2 |
| 高并发下页面稳定性 | rAF 批处理 + 虚拟化 + 按行订阅；CDP 实测 800/s 120fps | §7 §11 |
| 数据流服务与系统架构 | 独立 Node ws feed（producer/transport/consumer）+ 三层 | §4 §5 |
| 搭建流程、工具链选型 | Vite/tsx/concurrently/Vitest，最小摩擦；单包 | §9 |
| 架构与状态管理 | Zustand + 按行 selector + 结构共享 | §6 |
| 代码整洁/可读性 | 分层清晰、命名一致、注释到位、多代理评审过 | §4 §15 |
| 前端性能优化落地 | 8 条性能决策 + 量化实测 | §7 §11 |
| 文档能否阐述取舍 | DECISIONS 每条带"放弃了什么" | §9 |
| AI 使用合理度 + 自我校验 | AI_USAGE：工具/生成vs主导/2 主讲+2备用纠错/多代理评审 | §15 |
| 终面：扩容论证 | 10×行 / 多看板 / 离线仓储 | §12 §13 |
| 终面：团队搭建培养 | 边界即分工 + 标准低成本落地 | §14 |

## 2. 如何运行（可运行是最高优先级）

```bash
npm install      # 只需 Node 20+，无数据库/云/其他
npm run dev      # 一条命令：concurrently 同起 feed + web
```
- `dev` = `concurrently -k -n feed,web "npm:dev:server" "npm:dev:web"`
  - `dev:server` = `tsx watch server/index.ts`（tsx 直接跑 TS，无需预编译）
  - `dev:web` = `vite`
- 打开 **http://localhost:5173**；feed 在 **ws://localhost:8080**。
- 其他脚本：`npm test`（26 单测）、`npm run typecheck`、`npm run build`（Vite 生产构建）、`npm run preview`。
- 可选环境变量：`FEED_RATE=800 npm run dev` 设初始速率；`FEED_PORT` / `CSV_PATH` 也可覆盖（见 `server/index.ts`）；前端 `VITE_FEED_URL` 可覆盖 ws 地址。
- **故障恢复**：端口占用 → `lsof -ti tcp:8080 tcp:5173 | xargs kill -9` 再 `npm run dev`。页面红色 `disconnected` → feed 没起来，看终端 `[feed]` 日志；客户端会**自动指数退避重连**，feed 恢复后会自愈。
- **可复现性保障**：提交了 `package-lock.json`，`npm ci` 得到逐字节一致的依赖树；已在全新目录 `npm ci → typecheck → 26 tests → build → npm run dev` 全绿实测。

## 3. 数据与领域

- 文件：`data/shipments_10k.csv`，4 列：`reference, customer_name, status, last_update`。
- **10000 行，reference 全唯一**（`TV-100001` → `TV-110000`）；**300 个客户名**。
- `status` 5 枚举 + 初始分布：`delivered` 2451 / `in_transit` 2406 / `created` 2358 / `picked_up` 2282 / `failed` 503。
- `last_update`：ISO-8601 UTC，范围 `2026-07-01T08:00:00Z` ~ `2026-07-10T07:59:00Z`。
- **数据是干净的合成数据**（已取证：无内嵌逗号/引号、无缺失字段、无格式错、行列整齐）。→ 结论：**建模不是难点，性能才是**。这是我最早的判断，决定了整个方案重心。
- 生命周期语义（自定义、合理）：`created → picked_up → in_transit → delivered/failed → 回收到 created`。

## 4. 系统架构与文件职责（逐文件）

三层，边界即分工线：

```
shared/   两端共享的类型化协议
server/   Node feed：权威状态 + 生成器 + WebSocket 传输
web/      React 客户端：feed 消费 + store + 虚拟表 + 筛选 + 性能 HUD
data/     shipments_10k.csv（随包，满足"无外部服务"）
tools/    CDP 性能验证脚本
```

**逐文件职责：**
- `shared/protocol.ts` — 唯一的类型契约：`Shipment`、`StatusUpdate`、`SnapshotMessage`/`DeltaMessage`(=`ServerMessage`)、`SetRateMessage`(=`ClientMessage`)、`STATUSES` 枚举、`Status` 类型、`DEFAULT_FEED_PORT=8080`。两端 import 同一份，杜绝协议漂移。
- `server/csv.ts` — `parseShipments(text)`（纯函数，逐行守卫：字段数=4、status 合法，跳过脏行/表头/空行、支持 CRLF）+ `loadShipments(path)`（读文件后调纯函数）。
- `server/feed.ts` — `FeedEngine` 类：持有 `Map<ref,Shipment>` 权威态 + `order` 数组；`snapshot()`、`getRate()`/`setRate()`(clamp [0,5000])、`start()`/`stop()`；私有 `tick()` 每 50ms 生成 `rate×0.05` 条更新经 `onDelta` 回调发出；`nextStatus()` 生命周期流转（保证每次都变、无 no-op）。常量 `TICK_MS=50`、`MAX_RATE=5000`。
- `server/index.ts` — 接线：加载 CSV（try/catch 守卫）→ 建 `WebSocketServer` → 连接时发 `snapshot` → 引擎 `onDelta` 广播 `delta` → 处理客户端 `setRate`（null 守卫）→ `EADDRINUSE` 处理 + `SIGINT/SIGTERM` 优雅关闭（terminate clients + 1s 硬退出兜底）。env：`FEED_PORT`/`FEED_RATE`/`CSV_PATH`。
- `web/src/main.tsx` — React 入口（`StrictMode` + createRoot）。
- `web/src/App.tsx` — 顶层：`useFeed()` 拿 status/setRate；持有 `rate` state（`INITIAL_RATE=200`）；`metrics.start()`；**连接时/rate 变时 `setRate(rate)` 断言**（滑杆作真相源）；渲染 topbar + TelemetryBar + FilterBar + ShipmentTable。
- `web/src/feed/useFeed.ts` — feed 客户端 hook：建 WebSocket（`WS_URL=ws://localhost:8080`，可被 `VITE_FEED_URL` 覆盖）；`onmessage` try/catch 安全解析 → snapshot 灌 store / delta 进 `DeltaBatcher`；**指数退避自动重连**（`250×2^attempt`，上限 `MAX_BACKOFF_MS=5000`）；`setRate` 经 ws 发送。
- `web/src/feed/batcher.ts` — `DeltaBatcher<T>`：可注入调度器（默认 rAF）；`push()` 缓冲 + 上限 `maxBuffer=20000`（超限丢最旧）；每帧 `flush()` 一次把整批交给 `onFlush`；`pending` getter；`dispose()`。
- `web/src/store/boardStore.ts` — Zustand store：`byRef`(Record)、`order`、`filteredOrder`、`loaded`、`statusFilter`(Set)、`search`；`Row = Shipment & {rev, searchKey}`；actions：`loadSnapshot`(去重、算 searchKey、rev=0)、`applyDeltas`(结构共享 + changed 守卫 + 仅状态筛选激活时重算 filteredOrder)、`toggleStatusFilter`、`setSearch`、`clearFilters`；纯函数 `computeFiltered()`。
- `web/src/board/ShipmentTable.tsx` — 虚拟表：`useVirtualizer`（count=filteredOrder.length、`ROW_HEIGHT=40`、`overscan=12`、**`getItemKey=(i)=>order[i]`** 按 ref 键）；只订阅 `filteredOrder`；空态提示；`metrics.setVisibleRows`。
- `web/src/board/ShipmentRow.tsx` — `memo` 行：按行订阅 `byRef[ref]`；`mounted` 守卫 + `rev>0` 控制高亮；`<span key={rev} className="row__flash">` 覆盖层；4 列 + 状态 chip + 左色轨。
- `web/src/board/statusMeta.ts` — `STATUS_META`：每个 status 的 label/color/bg（驱动 chip + 色轨）。
- `web/src/board/formatTime.ts` — 模块级 `Intl.DateTimeFormat`（en-AU，提升避免每行构造）格式化时间。
- `web/src/controls/FilterBar.tsx` — 搜索框（防抖 150ms → `setSearch`）+ 5 个状态 chip（`toggleStatusFilter`）+ 隔离的 `ResultCount` 子组件 + Clear。
- `web/src/perf/metrics.ts` — `PerfMetrics` 单例（**在 React 之外**）：常驻 rAF 计真实帧 → fps/updatesPerSec；字段 batchSize/lagMs/visibleRows；`snapshot()`。
- `web/src/perf/TelemetryBar.tsx` — 速率滑杆（受控，`MAX_RATE=2000`、step=50）+ HUD（每 250ms 采样 metrics）：FPS / Applied/s / Batch / Feed lag / Visible。
- `web/src/styles.css` — 全部样式（暗色控制台风、状态色、`.row__flash` 动画 650ms、`prefers-reduced-motion` 关闭动画）。

## 4.5 架构层面的思考（白话）——这套架构为什么站得住

> 面试官（CTO + Leader）最想听的不是"你用了什么库"，而是"你怎么想这套架构的"。核心就八个字：**能推理、能演进**。

**1. 为什么这么切三层（而不是别的切法）**
这道题的"形状"是一条数据流：数据从 CSV 出发 → 被加工成实时事件 → 推给界面画出来。我就顺着这条流切：`server`(产生数据) / `shared`(数据长什么样) / `web`(把数据画出来)。不是按"功能模块"切（登录、订单…），因为这题根本不是 CRUD、没有一堆功能，它是一条管道。**架构的形状贴着问题的形状走，就不会长出多余的东西。**

**2. 依赖方向是干净的（谁依赖谁）**
`shared` 谁都不依赖，却被两边依赖——它是"大家都认的那份合同"。`web` 不认识 `server`，只认识合同；`server` 也不知道 `web` 存在。**两边隔着一份协议，谁都能单独换掉而不动对方**：明天想把前端换成别的框架、把传输从 WebSocket 换成别的，只要合同不变，另一边一行都不用改。这就是"松耦合"落到实处的样子（稳定依赖原则：越被依赖的东西越稳定）。

**3. 单向数据流 = 整个系统能一句话讲清**
服务端是**唯一真相源**，前端只是它的一个"投影"——任何时刻，界面就等于"服务端状态经过筛选画出来"。没有双向、前端不自己攒一份权威数据。好处特别实在：**重连时我什么都不用多想，重新拉一份快照就一定对**，因为前端从没有"自己的真相"会跟服务端打架。

**4. 每个边界都是一道"以后能撬开的缝"**
架构好不好，看它留没留升级的口子。我这三道边界，每道都是未来可替换/可分布式化的点：
- **传输缝**：`ws` 以后换 SSE / WebTransport / 消息队列，前端只认协议、不受影响。
- **生成器缝**：现在是随机造数据，以后接真实业务事件（数据库 CDC、Kafka），只要还从 `onDelta` 吐出来，其它全不动。
- **store 缝**：Zustand 想换，组件只认 selector、不认具体库。

**"把缝画在对的地方，放大时只换缝里的实现、不动缝的形状"——这就是可规模化的本质。**

**5. 把"可扩展"拆成三条互不打架的路**
别把"扩展"当一个模糊大词，它其实是三条正交的方向：
- **数据更大**（10k→100k→百万）：瓶颈会**依次**出现——先 DOM（虚拟化已解）、再每帧筛选扫描（增量索引/Worker）、再快照传输（分块/二进制）、最后内存。好在是一层层来的，可**按需逐层加**，不必一开始全上。
- **并发更多**（多看板/多网点）：从"一进程一份状态"→"按 board/depot 分区"（数据天然可按 reference/网点分片）→"消息中间件扇出"。
- **代码/团队更大**：三层=三条并行工作流，协议=接口，三个人可同时干、互不踩脚。

**6. "合理"体现在：该简单的地方简单，该讲究的地方往死里讲究**
我没上 monorepo、微前端、状态机库、CQRS——这个规模用不上，上了就是给自己和面试官添乱（over-engineering）。但在**唯一真正的瓶颈**（渲染热路径）上，我做到每帧一次提交、按行订阅、结构共享。**力气花在刀刃上、其余地方保持"无聊"**，这才是架构的合理。两种病都躲开了：过度设计和欠设计。

**7. 失效了会怎样（韧性 / 失效域）**
系统单点是 feed 进程。它挂了，前端自动重连、看板显示"stale/重连中"但**不崩、不花屏**——因为前端没有本地权威态，不存在"脑裂"。要生产化，把 feed 做成**无状态**（状态放 Redis/DB），就能多实例 + 负载均衡。

**8. 我要的是"够用的一致"，不是"最强的一致"**
这是个**只读监控看板**，要的是"低延迟看到最新态"，不是银行转账那种事务强一致。所以模型是"快照打底 + 增量逼近 + 乱序用时间戳/序列号兜底（后写胜出）"。**看清场景要什么、就不给它上不需要的重机制**——这本身就是架构判断。

**一句话总结这套架构为什么合理**：它让系统"**能一句话讲清**（单向流 + 单一真相源）、**能单独换任一块**（协议隔离）、**能按需逐层放大**（正交的扩展路径），且**没有一处是为炫技而存在**"。

## 5. Feed 设计（数据流服务）

- **feed = 持续变更流**（事件一发生就推），与静态文件相对。跨三段：**producer**(`FeedEngine`) / **transport**(ws) / **consumer**(`useFeed`)。
- **传输选独立 Node `ws` 服务**（非浏览器内 Worker、非 SSE）：真实网络边界 → 批处理/背压/重连都是真的、scale 叙事具体；本地进程≠"外部服务"（那指 Redis/云 broker），单命令仍成立。SSE 单向不够（我需要 setRate 客户端→服务端）；浏览器内 Worker 回避了传输难点。
- **服务端权威态**：`Map<ref,Shipment>`，新客户端连上拿**当前**态快照（非静态 CSV）→ 多客户端/重连一致。`snapshot`（连接时一次，10000 行）**不是** feed，之后的 `delta` 流才是。
- **FEED RATE** = 每秒状态更新条数（流的强度）。可配：env `FEED_RATE`（服务端初值）+ **UI 滑杆（运行时真相源，连接时/变更时向服务端断言）**。
- **批量生成 + `rate×0.05` 推导**：引擎每 `TICK_MS=50`ms 醒一次，一个 tick 推 `rate × (TICK_MS/1000) = rate × 0.05` 条，打包成**一条** delta 消息。因为一秒 `1000/50=20` 个 tick，`20 × (rate×0.05) = rate`，还原成配置速率。例：rate=800 → 每 tick 40 条 → 每秒 20 条消息 × 40 = 800 条/秒。**线上始终 ~20 条消息/秒，与速率无关**——这是"Batch"HUD 通常显示 40 的原因。
- **生命周期而非纯噪声**：`nextStatus` 让每次更新都是真实状态变更（无 no-op），看板像真实运营台一样翻动，也让高亮/筛选逻辑得到真实检验。
- **已验证**：`FEED_RATE=300` → 实测 ~295/s；snapshot=10000。

## 6. 状态管理（架构与状态管理方案）

- **选 Zustand**：极简外部 store，底层就是 `useSyncExternalStore`。为什么弃裸 `useState`/Redux：高频下更新路径必须活在 **React 渲染周期之外**（否则每条更新触发整树 reconcile），且更新要**按行**——两点它都以极小 API 面做到。为什么弃 Valtio（10k proxy 有开销、难 defend）/ Jotai（1 万 atom 偏重）/ 自建 store（教学价值高但代码多）。
- **store 形状**：`byRef: Record<ref, Row>`（O(1) 查、按行订阅）+ `order: string[]`（行索引→ref，供虚拟器）+ 派生 `filteredOrder`（渲染视图）。`Row = Shipment & { rev: number; searchKey: string }`。
- **按行订阅 + 结构共享（核心机制，能讲到底层）**：
  - 每个**可见**行 `useBoardStore(s => s.byRef[ref])` 只订阅自己那条。
  - `applyDeltas` 每帧浅拷贝一次 `byRef`、**只替换变更行为新对象**；未变行保持原引用 → selector `Object.is` 相等 → **不重渲染**。
  - 因虚拟化只有 ~30 行挂载 → 每次 flush 只有 ~30 个 selector 跑。**这就是规避 Zustand"整表重渲染"陷阱的办法**。
  - 表格只订阅 `order`/`filteredOrder`（状态更新时不变）→ **纯 churn 下表格不重渲染，只滚动/筛选时重渲染**。
  - `changed` 守卫：一批全未知 ref → 不新建 byRef 引用（保"无变更→无新引用"不变式，避免无谓通知）。
- **rev 是什么**：每行的"第几版"计数，加载时 0、每次原地更新 +1。既参与高亮（见 §7 的 rev-key），也保证对象身份变化触发按行重渲染。

## 7. 渲染性能（前端性能优化落地）

**成本模型**：两维同时爆炸——数据量（10k 行）× 更新频率（数百~2000/s）。朴素渲染 = ~1 万 DOM 节点 + 每秒数百次完整 React 提交，任一者都掉帧。
**预算**：DOM 工作量只随**可见**内容、不随数据量；且每帧最多 1 次 React 提交（~16.7ms / 120Hz 下 8.3ms）——无论速率多高都守住。

**8 条决策（问题→收益）：**
1. **虚拟化**（TanStack Virtual）：10k DOM→~30；渲染/滚动成本与数据量无关。`ROW_HEIGHT=40`、`overscan=12`。
2. **rAF 批处理**（`DeltaBatcher`）：数百 setState/s→每帧 ≤1 次提交；同 ref 合并取最新；no-op 批次跳过；后台标签页缓冲上限 20000 丢最旧。
3. **按行订阅 + 结构共享**：一次更新只重渲染变更的可见行；离屏变更只改 store、零 DOM。
4. **表格只订阅 `order`/`filteredOrder`**：纯 churn 下不重渲染。
5. **`getItemKey` 按 reference**：筛选重排时 React 把货运映射到稳定行实例→memo 有效 + 高亮不闪错行。
6. **`filteredOrder` 仅状态筛选激活时重算**：delta 不改 ref/customer→搜索/无筛选视图 churn 下从不重扫（省每帧 10k 扫描）。
7. **搜索防抖 150ms + 预计算 `searchKey`**：不每击键全表扫；小写 key 加载时算一次→零分配子串匹配。
8. **隔离**：行 `React.memo`+原始 props；`ResultCount` 独立组件（churn 不重渲染搜索框/chip）；HUD 每 250ms 采样离热路径；高亮纯 CSS 跑合成器层 + `prefers-reduced-motion` 关闭。

**离屏更新只触 store（零 DOM）→ 任一帧成本由可见变更行数决定，与数据量/速率无关。** 每帧一次 O(n) 浅拷贝 byRef 是亚毫秒级、换干净不可变（若真成瓶颈可改原地变更兜底）。

**变更高亮 = rev-key 机制**：CSS 动画只在挂载时播一次；要重播用 React 惯用法——**改元素 `key` 强制 remount**。`<span key={row.rev} className="row__flash">`，rev 每次更新变→React 卸旧挂新→`@keyframes rowflash`（650ms opacity .3→0）重播。`mounted` 守卫 + `rev>0` 保证只在原地变更闪，加载/滚入不误闪。

### 性能 HUD 的 5 个字段（现场会指着讲）

顶部遥测条实时显示 5 个数（`metrics.ts` 采集、`TelemetryBar.tsx` 每 250ms 采样一次、**不进热路径**）：

| 字段 | 含义 | 怎么算 | 看它做什么 |
|---|---|---|---|
| **FPS** | 每秒实际渲染帧数 | 常驻 rAF 循环数真实帧、每 500ms 折算 | 最核心的稳定性指标；主线程一卡 rAF 就延迟、FPS 立刻掉。稳在 60/120=不掉帧。颜色：≥55 绿 / 40–54 黄 / <40 红 |
| **Applied/s** | 每秒实际**应用到 store** 的更新条数 | 每帧 flush 累加批量条数、每 500ms 折算 | 证明客户端消费得过来；应 ≈ 滑杆的 FEED RATE，明显偏低=跟不上 |
| **Batch** | 最近一帧**单次提交合并了多少条**更新 | flush 时记 `batch.length` | 证明 rAF 批处理在工作 + 无背压；正常≈一个 server tick 的量（800/s 时约 40），持续变大=堆积 |
| **Feed lag** | feed **端到端延迟**（ms） | `Date.now() - delta.sentAt`（服务端每条 delta 盖发送时间戳） | 从服务端发出到客户端处理的耗时；本地 demo 通常 ~0ms |
| **Visible** | 当前**真实挂载在 DOM 的行数** | 虚拟器上报 `getVirtualItems().length` | 虚拟化的直接证明；永远几十（视窗+overscan 12），不随一万行增长 |

一句话记忆：**FPS 看流不流畅、Applied/s 看跟不跟得上、Batch 看有没有堆积（背压）、Feed lag 看链路延迟、Visible 看虚拟化生效**。这 5 个组合起来，就是把"峰值下稳定"可视化地证明给面试官看。

## 8. 筛选 / 搜索 under churn（高并发下筛选正确性）

- **关键洞察**：delta 只改 `status`/`last_update`，**绝不改 `reference`/`customer`**。→ 搜索成员在 churn 下不变（key 不变）；只有**状态筛选**成员会随流转进出。难点被精确收窄。
- `filteredOrder`（表格渲染的视图）重算时机：用户操作（切状态/输入）时，以及每次 delta flush **仅当状态筛选激活**。纯搜索/无筛选 churn 下零重算。
- 搜索防抖 150ms；`searchKey`（"ref customer" 小写）预计算；`ResultCount` 隔离。
- **已验证（CDP）**：搜索/状态/组合全对；~2000/s churn + Failed 筛选，10 轮滚动 0 违规、fpsMin=120。

## 9. 技术选型逐条依据（会追问——每条能 30 秒 defend）

（完整见 `DECISIONS.md` D1–D9，含"放弃了什么"）
- **D1 传输**：独立 Node `ws`（vs 浏览器 Worker/SSE）。
- **D2 状态**：Zustand + 按行 selector + 结构共享（vs 自建/Valtio/Jotai）。
- **D3 虚拟化**：TanStack Virtual（vs react-window 已停更定高 / react-virtuoso 封装重）。
- **D4 结构**：单包 + 文件夹 + 纯 npm（vs pnpm/turbo monorepo）。理由=可复现性最高（只需 Node、一次 install、一条 dev、零 corepack）；何时才上真 monorepo=出现共享代码的独立消费者（多看板共享 @tv/ui + @tv/protocol）。
- **D5 批处理**：ref 缓冲 + rAF flush。
- **D6 生成器**：服务端权威态 + 按 tick 批量 + 生命周期。
- **D7 高亮**：rev-key 淡出覆盖层 + mount 守卫。
- **D8 churn 筛选**：只重算 churn 能改变的部分。
- **D9 测试范围**：只测难点、不做 UI 快照。
- **工具链**：Vite（快）+ TypeScript + React 18 + Zustand 5 + TanStack Virtual 3 + `ws` 8 + `tsx`（直接跑 TS 服务端）+ `concurrently`（单命令）+ Vitest。选择标准=快开发循环 + 最小搭建摩擦 + 可复现。

## 10. 测试策略（代码质量 / 自我校验）

- **26 个单测，全纯逻辑，零 UI 快照**（对齐 brief "no broad UI snapshot coverage"）。
  - `batcher.test.ts`（5）：多 push→1 flush、flush 后才再调度、空 push 不调度、缓冲上限丢最旧、dispose 取消。
  - `boardStore.test.ts`（10）：loadSnapshot 索引/searchKey、结构共享（未变行同引用）、批内合并取最新、未知/空批不抛错、筛选(状态/搜索/组合/清除)、**churn 下筛选正确性**。
  - `server/feed.test.ts`（6）：快照顺序、速率 clamp、`rate→count` 换算(200→恰 200/s、20 条消息)、rate=0 不推、**生命周期无 no-op**、stop 停发。
  - `server/csv.test.ts`（5）：合法解析/跳表头、列数错跳过、未知 status 跳过、空行/尾换行、CRLF。
- **可测性重构**：把 rAF 批处理抽成注入调度器的 `DeltaBatcher`、把 CSV 解析抽成纯 `parseShipments(text)`——测试用手动调度器/内联字符串确定性验证，避免 mock 真实 rAF/fs。
- **删除了 jsdom + @testing-library**（装了不用会误导）。

## 11. 性能验证方法与实测数据（可复现证据）

- **手段**：`tools/` 下 CDP 脚本驱动系统 headless Chrome（无需 Playwright/Puppeteer，只用已装的 `ws`）；**注入独立 rAF FPS 计**（不依赖 app 自己的 HUD，客观）。
- `tools/perf-fps-under-load.mjs`：静止负载 + 持续滚动负载各测 FPS 最低值 + liveness。
- `tools/perf-filter-under-churn.mjs`：搜索/状态/churn 下筛选/组合四项断言 + FPS。
- **实测**：800/s 静止 & 滚动均 **120fps**（120Hz 屏）；1200–2000/s 仍满速跟随、Batch 稳定（无背压）；~2000/s churn + 筛选 **0 违规**；重连（杀 feed→disconnected→重启→自动重连、数据恢复）已验证；滑杆端到端驱动服务端（200→1200）。
- **诚实标注**：headless rAF 偏理想，但"不掉帧 + Applied/s 满速跟随 + Batch 稳定 + Feed lag~0"是三重独立佐证；真机是你显示器刷新率。

## 12. 扩容三问（终面核心，深度版）

> 统一姿态（呼应 §4.5 第 4 条）：三个场景我都**不从头重写**，而是**沿着已画好的三道缝往外接**——契约（协议）不动，只换缝里的实现。每个场景讲三层：**现状/瓶颈 → 分层升级路径 → 取舍与触发信号**。

### 12.1 数据量 ×10（100k，乃至百万）

**关键认知**：虚拟化只解决"滚动"，**不解决"高频更新 + 筛选"叠加**——这是业界共识（Michel Weststrate 的分享《Beyond Virtual Lists：10 万条 + 每秒数百更新》）。瓶颈会**按顺序**冒出来：DOM（已解）→ 每帧筛选/搜索扫描（阻塞输入）→ 快照传输体积 → 内存 → 每帧 diff。

**分层升级路径（按需一层层加，别一次全上）：**
1. **渲染层不用动**：虚拟化 DOM 恒定 ~30 行，10×/100× 数据都不增 DOM。
2. **计算层下 Web Worker**：`computeFiltered`/搜索搬进 Worker，主线程只画。Worker 持有全量、对外只吐 **insert/update/remove 三种离散操作**——**这恰好就是我现在的 delta 模型**，把它从"网络→store"延伸成"网络→Worker→store"，架构形状不变。
3. **增量索引替代全表扫描**：每 status 一个有序集合、搜索用倒排/trie，delta 时 **O(changed)** 维护，替代每帧 O(n)。
4. **真正大规模：数据留服务端，只订阅"可见窗口"**：切 **server-side / manual 模式**——筛选/排序/滚动窗口变化时回调服务端，只拉当前视窗那几百行 + 订阅它们的实时补丁（前后端约定筛选算子契约）。快照不再整份下发。这是 AG Grid Enterprise 等企业级表格的 server-side row model 做法。
5. **初始加载分块**：500 条一批渐进灌 + 进度条，避免几秒白屏冻结。
6. **并发 React**：搜索/筛选包 `startTransition`/`useDeferredValue`，输入永不被阻塞。

**取舍 + 触发信号**：10k 时全客户端筛选亚毫秒、简单方案最优，**不上** Worker/服务端窗口（那是 over-engineering）。**触发升级的信号 = 单帧筛选扫描逼近帧预算（p99 帧时长开始抖）**——先上 Worker（改动小、不碰后端），再不够才上服务端窗口订阅（改动大、需后端配合）。始终"先量再改"。

**白话升级路径图（现场可手绘）：**
```
① 数据 ×10：瓶颈按顺序冒 → 就按顺序加（先量再改）

  现在(10k)  全客户端，简单最优，什么都不加
     │  数据涨、p99 帧时长开始抖
     ▼
  第1步   筛选/搜索 ─► Web Worker     （主线程只画；不碰后端，改动小）
     │  还不够
     ▼
  第2步   增量索引：每 status 一个有序集合，delta 时 O(changed)
     │  还不够 / 快照太大传不动
     ▼
  第3步   数据留服务端，前端只订阅"可见窗口"那几百行（server-side）

  ▓ 渲染层(虚拟化)全程不动 —— DOM 恒定 ~30 行 ▓
```

**讲解版（每步配一句为什么）：**
```
① 数据 ×10

  现在 10k：全客户端筛选，什么都不加
     └ 为什么：10k 全表扫描亚毫秒，加任何东西都是过度设计
     │
     ▼ 触发信号：p99 帧时长开始抖（不是看平均 FPS——均值会骗人）
     │
  第1步：筛选/搜索 搬进 Web Worker
     └ 为什么：筛选是纯计算、会阻塞输入；挪去别的线程，主线程只管画
     └ 代价小：不碰后端；Worker 对外仍吐 insert/update/remove（正是现有 delta 模型）
     │
     ▼ 还不够（Worker 里每帧仍在扫全量）
     │
  第2步：增量索引（每 status 一个有序集合 + 搜索倒排）
     └ 为什么：把"每帧 O(n) 全扫"变成"delta 时 O(changed)"，只动变的那几条
     │
     ▼ 还不够 / 快照太大传不动（百万行搬不进浏览器）
     │
  第3步：数据留服务端，前端只订"可见窗口"那几百行
     └ 为什么：再快的前端也架不住把百万行塞进浏览器；只拉眼睛能看到的
     └ 代价大：要后端配合，前后端约定筛选算子契约

  渲染层(虚拟化)全程不动
     └ 为什么：DOM 早就恒定 ~30 行，数据多少都不增节点，这层从来不是瓶颈
```

### 12.2 多看板同时运行

分两个尺度：**同一浏览器多标签** 和 **服务端多客户端**。

**A. 客户端：一个浏览器多看板/多标签 → SharedWorker 共享一条 WS**
- 现状痛点：每标签一条 socket，15 个标签 = 15 条连接 + 重复流量 + 重复内存。
- 方案：把连接管理搬进 **SharedWorker**，全浏览器**一条** WebSocket；各标签用 **MessagePort** 接入；Worker 维护端口注册表，按 topic **定向**或**广播**分发。
- 工程坑（都得处理）：标签关闭**没有** disconnect 事件 → 靠 `beforeunload`/`pagehide` 发显式清理消息；用 **Page Visibility API** 在无可见标签时关 socket 省资源；SharedWorker 无引用会自动销毁。
- 兼容性坑 + 兜底：Safari <16.4 / 隐身模式不支持、内存紧张会被浏览器杀、调试难 → **兜底 = BroadcastChannel + localStorage 选主（leader election）+ IndexedDB**，由"主标签"持连接、其它标签共享。

**B. 服务端：很多客户端 → pub/sub 背板 + 无状态网关**
- 现状：单 ws 进程只认识连它自己的客户端；一旦多实例，投递就变成**路由问题**。
- 方案：ws 网关做**无状态**（连接/会话态外置到 Redis）→ 才能自动扩缩容；前面加 **pub/sub 背板**做扇出；负载均衡用 **least_conn**（长连接下 round-robin 会不均）。
- 背板选型（可 defend 的决策框架）：
  - **Redis Pub/Sub**：最简、低延迟，~10 万连接 / 几台机内够用；要持久/重放用 **Redis Streams**（7.0 起有 sharded pub/sub）。
  - **NATS**：轻量、低延迟、**WS 友好**、易运维；core 做临时扇出，JetStream 加持久/重放/consumer group。
  - **Kafka**：超大规模 + 持久有序 + **按 partition 路由**（网关只订自己负责的分区），代价是跨网关不保证全局有序、运维重。
  - 决策：**先 Redis**（简单）；需要持久/重放上 NATS/Streams；超大规模 + 严格有序才上 Kafka。
- **本项目天然可分**：权威态 `Map<ref,Shipment>` 按 `reference` 或 **depot/网点**天然可分片——**一个看板 = 一个 topic/分区**，客户端只订自己看板的 topic。多看板 ≠ 一份大状态，而是 **N 个独立分区各自扇出**。
- 这也是 §9-D4 说的"真 monorepo 回本点"：多个前端应用共享 `@tv/ui` + `@tv/protocol`。

**白话升级路径图（现场可手绘）：**
```
② 多看板：分两层看

【客户端】一个浏览器多标签
  之前                    之后
  Tab ─WS─┐               Tab ┐
  Tab ─WS─┼─► server      Tab ┼─port─►[SharedWorker]─1条WS─► server
  Tab ─WS─┘               Tab ┘        兜底:BroadcastChannel+选主

【服务端】多客户端 / 多实例
  client ─►[ws网关(无状态)]─┐
  client ─►[ws网关(无状态)]─┼─►[pub/sub 背板]─► 各网关扇出
  client ─►[ws网关(无状态)]─┘    Redis → NATS → Kafka
  · least_conn 负载均衡   · 连接态外置 Redis
  · 一个看板 = 一个 topic/分区（按 depot/ref 天然可分片）
```

**讲解版（每步配一句为什么）：**
```
② 多看板

【客户端】一个浏览器多标签
  之前：每标签各连一条 WS
     └ 为什么不行：15 标签=15 连接+15 份重复数据，白白压服务端和带宽
  之后：SharedWorker 里只留一条 WS，各标签用 MessagePort 接
     └ 为什么：一个浏览器对服务端只需 1 条连接，数据在 Worker 里分发给各标签
     └ 坑：标签关闭没有 disconnect 事件 → 靠 pagehide 主动发消息清理
     └ 坑：Safari<16.4/隐身不支持 → 兜底 BroadcastChannel+选主（主标签持连接）

【服务端】多客户端 / 多实例
  网关做无状态 + 前面加 pub/sub 背板扇出
     └ 为什么无状态：单进程只认识连自己的客户端；无状态才能自动扩缩容
     └ 为什么加背板：跨实例投递是"路由问题"，背板负责把消息扇给所有实例
     └ 为什么 least_conn：长连接下 round-robin 会不均，按最少连接数分才均
  背板选型：Redis(先) → NATS(轻量WS友好) → Kafka(超大规模有序)
     └ 为什么这个顺序：先用最简单的，需要持久/重放再升级，别一上来就 Kafka
  一个看板 = 一个 topic/分区（按 depot/ref 天然可分片）
     └ 为什么：多看板不是"一份大状态"，而是 N 个独立分区各自扇出、互不影响
```

### 12.3 线下仓储离线场景（offline depots）

**先分清"只读离线"还是"离线可写"——两者架构差一个数量级。**

**A. 当前是只读看板 → "离线"= feed 断，本质是缓存 + 重同步问题**
- **本地缓存**：IndexedDB 存上次快照（带版本、按 depot）；断网/冷启动先水合、挂 `stale·reconnecting` 横幅，秒开。
- **重连正确性（关键，也是当前真实缺口）**：给 snapshot 和每条 delta 带**单调序列号**；重连时服务端有界 **ring buffer** 保留近期 delta，客户端带"最后已见序列号"→ 只取缺口做 **delta 追赶**，免全量重传；同时解决 snapshot 与并发 delta 的**竞态**（丢弃早于 snapshot as-of-seq 的 delta）。乱序/重复用 **LWW（按 `last_update`）** 兜底——我们有权威时间戳，LWW 对只读监控完全够。
- 这类"**读路径同步**"正是 **ElectricSQL** 那一派的形状（DB → 客户端流式 Shape、LWW 默认）。

**B. 若 depot 未来"离线可写"（如现场标记已送达）→ 上真正的同步引擎**
- 模式：本地先写（乐观 UI）+ **持久化上传队列**（离线攒着、重连回放）+ 服务端权威校验。这正是 **PowerSync**（双向、本地 SQLite、上传队列，最适合移动/离线可写的现场工具）或 **Zero**（查询式、服务端权威、IndexedDB）的定位；**Replicache 已停更 → 被 Zero 取代**（本身就是"别押注单一小厂工具"的教训）。
- **冲突解决取舍**：结构化记录（本项目就是）用 **LWW** 足够；只有协作富文本/画布才需要 **CRDT（Yjs/Automerge）**——且 CRDT 只保证"能合并出一个结果"、不保证"是用户想要的结果"，实践常是 CRDT 合并 + 人工确认。**别为一个只读看板上 CRDT 这种重机制**（呼应 §4.5 第 8 条"够用的一致"）。
- 存储上限：SQLite（PowerSync/Electric）能到 GB；IndexedDB（Zero）通常几百 MB——按 depot 数据量选。
- **架构自保**：同步引擎这领域还年轻（Replicache 都能停更），**把同步层抽象成可几周内替换**，别把架构押在某个小厂单一工具上。

**白话升级路径图（现场可手绘）：**
```
③ 线下离线：先分"只读 or 可写"

  在线:  server ─ snapshot + delta ─► 看板
                                断网 │
                                     ▼
  ┌ 只读离线（当前）─────────────────────────────┐
  │ IndexedDB 缓存快照 → 断网先水合 + stale 横幅    │
  │ 重连: 带"最后序列号" → 服务端 ring buffer 补缺口 │
  │       (delta 追赶,免全量重传; 乱序 LWW 兜底)    │
  │  ≈ ElectricSQL 读路径同步                     │
  └──────────────────────────────────────────────┘
  ┌ 离线可写（未来: 现场标记已送达）───────────────┐
  │ 本地先写(乐观UI) → 上传队列(离线攒) → 重连回放   │
  │ → 服务端权威校验;  冲突 LWW 够(别上 CRDT)       │
  │  ≈ PowerSync / Zero                          │
  └──────────────────────────────────────────────┘
```

**讲解版（每步配一句为什么）：**
```
③ 线下离线

  先问一句：depot 只是"看"，还是要"离线也能改"？
     └ 为什么先问：只读和可写，架构复杂度差一个数量级，先分清别做多

  只读离线（当前就是）
    IndexedDB 缓存上次快照
       └ 为什么：断网/冷启动先用缓存秒开、别白屏；挂 stale 横幅告诉用户这是旧数据
    重连：客户端带"最后序列号" → 服务端 ring buffer 只补缺口
       └ 为什么：断网期间漏的那段增量，只补缺口就够，不用重传整份（省带宽）
       └ 为什么要序列号：还顺手解决"快照 vs 并发 delta 谁先谁后"的竞态
    乱序/重复：按 last_update 后写胜出（LWW）
       └ 为什么够用：这是只读监控，要的是"看到最新态"，不是事务级强一致
    ≈ ElectricSQL 那类"读路径同步"

  离线可写（未来：现场标记已送达）
    本地先写(乐观UI) → 上传队列(离线攒着) → 重连回放 → 服务端权威校验
       └ 为什么要队列：离线时写的操作不能丢，攒起来等联网再依次提交
    冲突用 LWW 就够，别上 CRDT
       └ 为什么：CRDT 只保证"能合并出一个结果"、不保证是用户想要的；结构化记录 LWW 更简单可控
    ≈ PowerSync / Zero（Replicache 已停更）
```

**一句话收束三问**：数据大了在"计算/传输缝"插 Worker/窗口订阅；看板多了在"传输缝"插 SharedWorker/pub-sub；要离线在"消费缝"插缓存/同步引擎。**契约不动、只换缝里的实现**——这就是这套架构可规模化的证据。

## 13. 离线容忍设计（仅设计，未实现）

- **秒级冷启动**：IndexedDB 缓存上次快照（带版本、按看板）；加载先水合 + `stale·reconnecting` 横幅。
- **重连**：指数退避 + 抖动（客户端已实现基础重连：`250×2^attempt`，上限 5000ms）。
- **正确重同步**：每单单调 version（或用 last_update）→ 客户端丢弃乱序/重复 delta（LWW）；服务端有界 delta 环形缓冲（按序列号）→ **delta 追赶**（客户端带最后序列号只取缺口，免全量重传）。
- **离线网点**：depot 分区跑缓存态、连通 reconcile；有写操作才加 outbox。

## 14. Leadership / 团队（终面：如何搭建培养前端团队）

- **边界即分工**：`feed` / `shared` 协议 / `web`（渲染层 + store 层）三条并行工作流，`shared/protocol.ts` 契约先行 → 两三人并行、接口不漂移。
- **标准低成本落地**：① `DECISIONS.md` 记每个取舍的 why（新人读它就懂"为什么这样"）；② 只在真正难的部分写测试（不搞覆盖率仪式）；③ 可复现的 `tools/` CDP 性能脚本当**性能闸门**（任何改动一键量 FPS，不靠"感觉不卡"）。
- **务实文化**：brief 说"未完成但有理有据 > 镀金"，我砍掉 UI 快照测试、monorepo、排序等，把时间投在核心正确性 + 一个亮点(HUD)。带团队同理——教"判断该做什么、更要判断不做什么"。
- **AI-first 团队**：用 AI 快出、每个决策人来定、关键代码人来审（见 §15）。

## 15. AI 使用（合理度 + 自我校验能力）

- 工具：**Claude Code (Opus)** 全程，分里程碑、每步过验收闸门。
- 项目级 skills：`vercel-react-best-practices`(性能范式) + `frontend-design`(视觉) + `code-review`(收尾)；**主动删掉 `unit-tests`**（限定 VS Code 仓库、不适用）——"知道一个工具不该用也是判断力"。
- 生成 vs 主导：脚手架/引擎/store/表格/HUD/CSS 由 AI 起草，**架构与每个选型由我拍板并逐行审**。
- **AI/流程出错→我抓到（2 主讲 + 2 备用，与 `AI_USAGE.md` 口径一致）**：
  1. **滑杆没反映真实速率**（截图抓到）：数字全绿(120fps/Applied=800)，肉眼审截图发现滑杆 200 而 HUD 800——滑杆只是装饰。改为滑杆作真相源、连接/变更时断言。→"截图抓到断言抓不到的 bug"。
  2. **变更高亮误闪**（推理/评审抓到）：keyed overlay 一挂载就播→加载/滚入误闪；加 mount 守卫 + `rev>0`；评审又发现筛选重排闪错行→虚拟器按 `reference` 键。
  - 备用③ **端口串扰**：测速 197 而非 300 + 崩溃；旧 feed 占 8080、新进程 EADDRINUSE；读日志抓到、补端口处理。
  - 备用④ **测试逼出 store 失效**：全未知 ref 批次应 no-op 的单测挂了；`applyDeltas` 没命中也新建 byRef 引用；加 `changed` 守卫。
- **交付前多代理评审**：起 3 个并行子代理（正确性/React 性能/健壮性）终审，修了：客户端重连、`getItemKey`、服务端 null/空数据/关闭守卫、`import.meta.dirname`→`fileURLToPath`、移除未用 devDep、HUD "Buffer"→"Batch" 正名。→ 体现"用 AI 做对抗性自审、而非一遍过就交"。

## 16. 预演 Q&A（尽量多的刁问 + 答案）

- **为什么不用 SSE？** 单向够用但未来交互（背压反馈、客户端指令如 setRate）要双向；WS 更贴合实时运营，且我的 setRate 就走了客户端→服务端。
- **为什么不用 Redux / 裸 useState？** 高频下裸 setState 整树 reconcile；Redux 也需精细 selector。要点=把更新移出 React 热路径(ref 缓冲)+按行订阅，Zustand 最小、底层就是 useSyncExternalStore。
- **120fps 是不是 headless 假象？** 诚实——headless rAF 偏理想；但三重独立佐证：不掉帧 + Applied/s 满速跟随 + Batch 稳定不堆积 + Feed lag~0。真机是你显示器刷新率。
- **结构共享每帧浅拷贝 10k key 不慢吗？** 亚毫秒（~0.1–0.3ms），远低于帧预算；换干净不可变。若真成瓶颈可改原地变更（无人整体订阅 byRef）。
- **为什么每帧只 flush 一次、不会有延迟？** 最多晚 1 帧(~8–16ms)，不可感知；换来"任意速率塌缩成每帧 1 次提交"的稳定。
- **数据脏怎么办？** 本数据干净（已取证），但 CSV 解析仍逐行守卫（列数/未知 status/空行/CRLF）跳过、脏行不崩 feed；有单测。
- **高亮用 CSS 还是 JS？** 纯 CSS（合成器层），JS 只负责 keyed overlay 挂载；`prefers-reduced-motion` 关闭。
- **rate×0.05 哪来的？** `0.05 = TICK_MS/1000 = 50/1000`（每 tick 占 1/20 秒）；`20 tick/s × rate×0.05 = rate`。
- **多客户端速率会打架吗？** 当前全局单速率、任一客户端 setRate 影响全部（记为下一步：每客户端独立 feed）。
- **为什么服务端 clamp 到 5000 但滑杆只到 2000？** 服务端 `MAX_RATE=5000` 是安全上限；滑杆 2000 对 demo 够用；两处常量可集中到 shared（记为小改进）。
- **为什么不用 Web Worker 做筛选？** 10k 下主线程筛选亚毫秒、不必要；100k 才需要（见 §12）。先量再改。
- **一条命令怎么起两个进程？** `concurrently` 并行跑 `dev:server`(tsx watch) 和 `dev:web`(vite)；`-k` 一个挂了都杀掉。
- **重连会导致数据错乱吗？** 重连后服务端重发**当前**态快照、`loadSnapshot` 整体重置 store→天然一致；未来加序列号做 delta 追赶。

## 17. 已知局限、刻意取舍，与更深的下一步

> 面试官是 CTO + Leader，这一节是体现"我知道系统真正边界在哪、以及如何把它推得更远"的地方。分两层：先讲**当前刻意的取舍**（为什么现在不做），再讲**更深的下一步**（体现技术深度）。

### 17.1 当前刻意的取舍（能讲清"为什么现在够用"）

- **全局单速率**（非每客户端独立 feed）——demo 单客户端够用。
- **极低速率量化归零**：`round(rate×0.05)`，rate<10 会取整成 0；滑杆 step=50 已规避，需要任意低速率再用"跨 tick 累加小数余数"修。
- **每帧 O(n) 浅拷贝 `byRef`**：10k 下亚毫秒，刻意选简单不可变；100k+ 才需要持久化数据结构（见 17.2）。
- **`filteredOrder` 每帧 O(n) 重算**（且仅状态筛选激活时）：10k 亚毫秒；100k 才需增量索引（见 17.2）。
- **全量重连**：重连拉整份快照——正确但重；delta 追赶是更优解（见 17.2）。
- **服务端 broadcast 无背压检查**、**`MAX_RATE` 两处未集中**、**离线仅设计**——均为已知、低风险边角。

### 17.2 更深的下一步（按主题，current → deeper → trade-off）

**A. 测量的诚实性（最能体现 senior）**
- **现状**：FPS 是 rAF 计数的 500ms 均值——它会**掩盖长尾**：均值 60fps 下仍可能有偶发 30ms 长帧。
- **更深**：用 **Long Tasks API / PerformanceObserver** 测 **p95/p99 帧时长**与 **INP**，把"卡顿"定义为**尾延迟**而非平均帧率；HUD 增加"最长帧""掉帧数"。
- **意义**：主动指出自己 HUD 的局限，比任何漂亮数字都更有可信度。

**B. 更新热路径再压榨**
- **apply 前按 ref 去重**：一批里同 ref 多次时，`applyDeltas` 现在按序全 apply（多次 +rev、多次分配中间对象）。改为 apply 前 dedupe 到最新 → 重复 churn 下显著减分配。
- **增量索引替代每帧 O(n) 扫描**：每个 status 维护有序集合、搜索用倒排/trie，delta 时 **O(changed)** 进出，替代 `computeFiltered` 的 O(n)。这是 100k 的具体落地。
- **并发 React**：把 `filteredOrder` 重算包进 `startTransition`、搜索用 `useDeferredValue`，让**输入/滚动永远 100% 优先**、筛选结果稍后追上（现在用 150ms 防抖近似，transition 更细粒度、无固定延迟）。
- **自适应削峰 / 背压感知客户端**：测每次 flush 耗时，超帧预算(如 8ms)则更激进合并或跳一帧渲染；配合服务端流控 → 端到端不过载。
- **状态层挪出主线程**：极端规模下把 store + delta 应用放进 Web Worker，主线程只负责绘制（配 `useSyncExternalStore` 读快照）。

**C. 传输 / 协议深度**
- **二进制 + 位打包 delta**：一条更新 =(ref, status, ts)。ref 用整数索引（两端已知有序集合）、status 3-bit 枚举、ts 用相对基准 → 一帧塞大量更新；再叠 `permessage-deflate`。大规模带宽大赢（trade：CPU↑ 带宽↓，需实测）。
- **snapshot↔delta 竞态 + 序列号（真实正确性缺口）**：客户端连上拿 snapshot 后，可能收到"早于该 snapshot"的 delta。给 snapshot 带 **as-of seq**、客户端丢弃 seq 更早的 delta；同一序列号机制支撑**重连 delta 追赶**（服务端有界 ring buffer + 客户端带 last-seq，只取缺口、免全量重传）。
- **端到端背压**：服务端按 `ws.bufferedAmount` 阈值对慢客户端削峰/降级/断开；客户端可反馈"我落后了"（credit-based 流控）。

**D. 正确性 / 验证深度**
- **属性测试（fast-check）**：churn 下筛选正确性极适合 property test——随机生成 delta 序列 + 筛选态，断言不变式"每个可见行都匹配当前筛选"，比示例测试覆盖面更广。
- **可复现 feed（seed RNG）**：生成器现用 `Math.random`；加可注入种子 → demo/测试每次同样翻动，利于复现与截图对比。
- **性能回归门禁**：把 `tools/` 的 CDP 脚本移植成 **Playwright + p99 帧时长预算**断言，一回归就挂 CI——性能当测试、不靠"感觉不卡"。

**E. 大规模可访问性（少见但显功力）**
- **现状**：虚拟化下屏幕阅读器只见 ~30 行、用的是 div。
- **更深**：`role="grid"` + `aria-rowcount=10000` + 每行 `aria-rowindex`，让辅助技术知道"第 42 行 / 共 1 万行"——虚拟化 × 无障碍是公认难点，做对了是加分项。

**F. 大规模数据结构取舍**
- **现状**：每帧一次 O(n) 浅拷贝 map（10k 亚毫秒，刻意选简单）。
- **更深**：100k+ 换持久化 HashMap/HAMT（immer/immutable），更新 **O(log n)** 且结构共享内建。trade：常数更大、库依赖，10k 不划算——所以现在不做，是有意识的取舍。

**G. 可观测性 / 生产化**
- HUD 是开发工具；生产用 **RUM** 上报 INP/长任务/掉帧到指标端点。React **error boundary** 包住表格；**"feed stale" 检测**（rate>0 但 N 秒无 delta → 告警自愈）。

> 讲这一节的姿态：不是"我没做完"，而是"我清楚每一处的边界和触发升级的信号——在 10k/单客户端这个规模，简单方案是对的；到 100k/多看板/离线，我知道确切该换哪一块、以及代价"。这正是 CTO 想听的"可规模化架构判断"。

## 18. 关键数字/常量速查

| 常量 | 值 | 位置/含义 |
|---|---|---|
| feed tick | `TICK_MS=50`ms | 每 50ms 生成一批 |
| 每 tick 条数 | `rate×0.05` | =rate×(50/1000) |
| 线上消息率 | ~20 条/秒 | 与速率无关 |
| 服务端速率上限 | `MAX_RATE=5000` | clamp |
| 滑杆上限/步进 | 2000 / 50 | UI |
| 初始速率 | `INITIAL_RATE=200` | 滑杆默认 |
| 行高 | `ROW_HEIGHT=40`px | 虚拟器 |
| overscan | 12 | 视窗外多渲染行数 |
| 挂载行数 | ~30 | 视窗+overscan |
| 缓冲上限 | `maxBuffer=20000` | DeltaBatcher 后台兜底 |
| 搜索防抖 | 150ms | FilterBar |
| HUD 采样 | 250ms | TelemetryBar |
| 高亮动画 | 650ms | .row__flash |
| 重连退避 | `250×2^attempt`，上限 5000ms | useFeed |
| 端口 | web 5173 / feed 8080 | |
| 数据 | 10000 行 / 300 客户 / 5 status | CSV |
| 帧预算 | 16.7ms（120Hz 8.3ms） | |
| 测试 | 26 个 | 4 文件 |
| 依赖 | React18.3 / Zustand5 / TanStackVirtual3 / ws8 / Vite5 / Vitest2 / tsx4 / TS5.6，Node≥20 | |
