import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FeedEngine, MAX_RATE } from './feed';
import type { Shipment, Status, StatusUpdate } from '../shared/protocol';

function makeShipments(n: number): Shipment[] {
  return Array.from({ length: n }, (_, i) => ({
    reference: `TV-${i}`,
    customer_name: `Customer ${i}`,
    status: 'created' as Status,
    last_update: '2026-07-01T00:00:00Z',
  }));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('FeedEngine', () => {
  it('snapshots all shipments in stable order', () => {
    const engine = new FeedEngine(makeShipments(3), 0, () => {});
    expect(engine.snapshot().map((s) => s.reference)).toEqual(['TV-0', 'TV-1', 'TV-2']);
  });

  it('clamps the rate into [0, MAX_RATE]', () => {
    const engine = new FeedEngine(makeShipments(1), 100, () => {});
    engine.setRate(-50);
    expect(engine.getRate()).toBe(0);
    engine.setRate(999_999);
    expect(engine.getRate()).toBe(MAX_RATE);
    engine.setRate(Number.NaN);
    expect(engine.getRate()).toBe(0);
  });

  it('emits rate x tick worth of updates (rate=200 → ~200/sec)', () => {
    const batches: StatusUpdate[][] = [];
    const engine = new FeedEngine(makeShipments(50), 200, (u) => batches.push(u));
    engine.start();
    vi.advanceTimersByTime(1000); // 20 个 50ms 的 tick，每个 10 条更新
    engine.stop();

    const total = batches.reduce((n, b) => n + b.length, 0);
    expect(total).toBe(200);
    // 每个 tick 一条批量消息，而非每条更新一条
    expect(batches).toHaveLength(20);
  });

  it('emits nothing at rate 0', () => {
    const batches: StatusUpdate[][] = [];
    const engine = new FeedEngine(makeShipments(5), 0, (u) => batches.push(u));
    engine.start();
    vi.advanceTimersByTime(500);
    engine.stop();
    expect(batches).toHaveLength(0);
  });

  it('every update is a genuine status change (lifecycle, never a no-op)', () => {
    const shipments = makeShipments(4);
    const lastStatus = new Map<string, Status>(shipments.map((s) => [s.reference, s.status]));
    let violations = 0;

    const engine = new FeedEngine(shipments, 400, (updates) => {
      for (const u of updates) {
        if (u.status === lastStatus.get(u.reference)) violations++;
        lastStatus.set(u.reference, u.status);
        expect(typeof u.last_update).toBe('string');
      }
    });
    engine.start();
    vi.advanceTimersByTime(2000); // 仅 4 行上发生大量流转
    engine.stop();

    expect(violations).toBe(0);
  });

  it('stop() halts emission', () => {
    const batches: StatusUpdate[][] = [];
    const engine = new FeedEngine(makeShipments(10), 200, (u) => batches.push(u));
    engine.start();
    vi.advanceTimersByTime(200);
    const afterStart = batches.length;
    engine.stop();
    vi.advanceTimersByTime(1000);
    expect(batches.length).toBe(afterStart);
  });
});
