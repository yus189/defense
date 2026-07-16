/**
 * 把高频的 push 合并为每个调度 tick 一次 flush。调度器可注入，因此批处理逻辑
 * 可以确定性地测试（用手动调度器），而不必依赖真实的 requestAnimationFrame。
 */
export interface Scheduler {
  request(cb: () => void): number;
  cancel(handle: number): void;
}

export const rafScheduler: Scheduler = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export class DeltaBatcher<T> {
  private buffer: T[] = [];
  private handle: number | null = null;

  constructor(
    private readonly onFlush: (batch: T[]) => void,
    private readonly scheduler: Scheduler = rafScheduler,
    /** 安全上限：rAF 在后台标签页会暂停，因此给缓冲设界，超出时丢弃最旧的
     *  条目（最新状态仍然胜出），而非无界增长。 */
    private readonly maxBuffer = 20_000,
  ) {}

  /** 缓冲条目；若尚无待处理的 flush，则为下一个 tick 调度一次。 */
  push(items: readonly T[]): void {
    for (let i = 0; i < items.length; i++) this.buffer.push(items[i]);
    if (this.buffer.length > this.maxBuffer) {
      this.buffer.splice(0, this.buffer.length - this.maxBuffer);
    }
    if (this.buffer.length > 0 && this.handle === null) {
      this.handle = this.scheduler.request(() => this.flush());
    }
  }

  private flush(): void {
    this.handle = null;
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    this.onFlush(batch);
  }

  /** 已缓冲但尚未 flush 的条目数。 */
  get pending(): number {
    return this.buffer.length;
  }

  dispose(): void {
    if (this.handle !== null) this.scheduler.cancel(this.handle);
    this.handle = null;
    this.buffer = [];
  }
}
