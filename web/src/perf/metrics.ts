/**
 * 轻量的性能遥测，刻意置于 React state *之外*，使热路径永不触发渲染。
 * 一个常驻的 rAF 循环计数真实帧数（因此卡顿会表现为 FPS 下降）；feed 和表格把
 * 计数推进来。HUD 以 250ms 间隔采样 `snapshot()`——它每秒渲染 4 次，而非每帧。
 */
class PerfMetrics {
  fps = 0;
  updatesPerSec = 0;
  batchSize = 0;
  lagMs = 0;
  visibleRows = 0;

  private frames = 0;
  private applied = 0;
  private windowStart = 0;
  private rafId = 0;
  private running = false;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.windowStart = performance.now();
    const loop = (t: number) => {
      this.frames++;
      const dt = t - this.windowStart;
      if (dt >= 500) {
        this.fps = Math.round((this.frames * 1000) / dt);
        this.updatesPerSec = Math.round((this.applied * 1000) / dt);
        this.frames = 0;
        this.applied = 0;
        this.windowStart = t;
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  recordApplied(n: number): void {
    this.applied += n;
  }
  /** 最近一帧的单次提交里合并的更新条数。 */
  setBatchSize(n: number): void {
    this.batchSize = n;
  }
  setLag(ms: number): void {
    this.lagMs = ms;
  }
  setVisibleRows(n: number): void {
    this.visibleRows = n;
  }

  snapshot(): MetricsSnapshot {
    return {
      fps: this.fps,
      updatesPerSec: this.updatesPerSec,
      batchSize: this.batchSize,
      lagMs: this.lagMs,
      visibleRows: this.visibleRows,
    };
  }
}

export interface MetricsSnapshot {
  fps: number;
  updatesPerSec: number;
  batchSize: number;
  lagMs: number;
  visibleRows: number;
}

export const metrics = new PerfMetrics();
