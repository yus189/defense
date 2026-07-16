import { type Shipment, type Status, type StatusUpdate } from '../shared/protocol';

/** 生成器的唤醒间隔。delta 按 tick 批量发送，而非每条更新一发。 */
const TICK_MS = 50;
const MAX_RATE = 5000;

/**
 * 让货运沿真实生命周期推进，而非发纯噪声，使看板像真实运营看板一样翻动
 *（且每条更新都是真实变更，从而让高亮 + 筛选成员逻辑得到有意义的检验）。
 * 终态回收回 `created`，使 feed 可以无限流动下去。
 */
function nextStatus(current: Status): Status {
  switch (current) {
    case 'created':
      return 'picked_up';
    case 'picked_up':
      return 'in_transit';
    case 'in_transit':
      return Math.random() < 0.12 ? 'failed' : 'delivered';
    case 'delivered':
      return 'created';
    case 'failed':
      return 'created';
  }
}

/**
 * 服务端权威 feed 状态。持有所有货运的唯一真相源，按可配置速率变更它们，
 * 并发出批量 delta。新客户端拿到的是*当前*状态的快照（而非过时的 CSV），
 * 因此任意数量的客户端都保持一致。
 */
export class FeedEngine {
  private readonly byRef = new Map<string, Shipment>();
  private readonly order: string[] = [];
  private rate: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly onDelta: (updates: StatusUpdate[]) => void;

  constructor(shipments: Shipment[], rate: number, onDelta: (updates: StatusUpdate[]) => void) {
    for (const s of shipments) {
      // 克隆一份，以便我们独占这份可变状态
      this.byRef.set(s.reference, { ...s });
      this.order.push(s.reference);
    }
    this.rate = clampRate(rate);
    this.onDelta = onDelta;
  }

  /** 当前权威状态，按稳定的 CSV 顺序返回。 */
  snapshot(): Shipment[] {
    return this.order.map((ref) => this.byRef.get(ref)!);
  }

  getRate(): number {
    return this.rate;
  }

  setRate(rate: number): void {
    this.rate = clampRate(rate);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** 生成一个 tick 的更新量，并作为单个批次发出。 */
  private tick(): void {
    if (this.order.length === 0) return;
    const count = Math.round((this.rate * TICK_MS) / 1000);
    if (count <= 0) return;

    const now = new Date().toISOString();
    const updates: StatusUpdate[] = new Array(count);

    for (let i = 0; i < count; i++) {
      const ref = this.order[(Math.random() * this.order.length) | 0];
      const s = this.byRef.get(ref)!;
      s.status = nextStatus(s.status);
      s.last_update = now;
      updates[i] = { reference: ref, status: s.status, last_update: now };
    }

    this.onDelta(updates);
  }
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 0;
  return Math.max(0, Math.min(MAX_RATE, Math.round(rate)));
}

export { TICK_MS, MAX_RATE };
