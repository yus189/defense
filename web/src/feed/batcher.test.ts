import { describe, it, expect, vi } from 'vitest';
import { DeltaBatcher, type Scheduler } from './batcher';

/** 一个我们手动驱动的调度器，以便精确断言 flush 何时发生。 */
function manualScheduler() {
  let queued: (() => void) | null = null;
  const scheduler: Scheduler = {
    request: (cb) => {
      queued = cb;
      return 1;
    },
    cancel: () => {
      queued = null;
    },
  };
  return {
    scheduler,
    hasPending: () => queued !== null,
    tick: () => {
      const cb = queued;
      queued = null;
      cb?.();
    },
  };
}

describe('DeltaBatcher — update batching', () => {
  it('coalesces many pushes into a single flush per tick', () => {
    const m = manualScheduler();
    const onFlush = vi.fn();
    const batcher = new DeltaBatcher<number>(onFlush, m.scheduler);

    batcher.push([1, 2]);
    batcher.push([3]);
    batcher.push([4, 5]);

    // 在被调度的 tick 触发之前，什么都不 flush。
    expect(onFlush).not.toHaveBeenCalled();
    expect(batcher.pending).toBe(5);

    m.tick();

    // 五个条目在一次 flush 中全部送达。
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith([1, 2, 3, 4, 5]);
    expect(batcher.pending).toBe(0);
  });

  it('schedules a fresh flush only after the previous one fired', () => {
    const m = manualScheduler();
    const onFlush = vi.fn();
    const batcher = new DeltaBatcher<number>(onFlush, m.scheduler);

    batcher.push([1]);
    m.tick();
    expect(onFlush).toHaveBeenLastCalledWith([1]);

    batcher.push([2]);
    expect(m.hasPending()).toBe(true);
    m.tick();
    expect(onFlush).toHaveBeenLastCalledWith([2]);
    expect(onFlush).toHaveBeenCalledTimes(2);
  });

  it('does not schedule or flush on an empty push', () => {
    const m = manualScheduler();
    const onFlush = vi.fn();
    const batcher = new DeltaBatcher<number>(onFlush, m.scheduler);

    batcher.push([]);
    expect(m.hasPending()).toBe(false);
    expect(batcher.pending).toBe(0);
  });

  it('caps the buffer, dropping oldest items (latest state wins)', () => {
    const m = manualScheduler();
    const onFlush = vi.fn();
    const batcher = new DeltaBatcher<number>(onFlush, m.scheduler, 3); // 上限 = 3

    batcher.push([1, 2, 3, 4, 5]);
    expect(batcher.pending).toBe(3);
    m.tick();
    expect(onFlush).toHaveBeenCalledWith([3, 4, 5]); // 最旧的 (1,2) 被丢弃
  });

  it('dispose cancels a pending flush and clears the buffer', () => {
    const m = manualScheduler();
    const onFlush = vi.fn();
    const batcher = new DeltaBatcher<number>(onFlush, m.scheduler);

    batcher.push([1, 2, 3]);
    expect(m.hasPending()).toBe(true);
    batcher.dispose();

    expect(m.hasPending()).toBe(false);
    expect(batcher.pending).toBe(0);
    m.tick(); // 空操作——没有排队的回调
    expect(onFlush).not.toHaveBeenCalled();
  });
});
