import { describe, it, expect, beforeEach } from 'vitest';
import type { Shipment, StatusUpdate } from '@shared/protocol';
import { useBoardStore } from './boardStore';

const fixture: Shipment[] = [
  { reference: 'TV-1', customer_name: 'Acme Foods', status: 'created', last_update: '2026-07-01T00:00:00Z' },
  { reference: 'TV-2', customer_name: 'Metro Retail', status: 'picked_up', last_update: '2026-07-01T00:00:00Z' },
  { reference: 'TV-3', customer_name: 'Acme Textiles', status: 'in_transit', last_update: '2026-07-01T00:00:00Z' },
  { reference: 'TV-4', customer_name: 'Kingsway Pharma', status: 'delivered', last_update: '2026-07-01T00:00:00Z' },
  { reference: 'TV-5', customer_name: 'Metro Pharma', status: 'failed', last_update: '2026-07-01T00:00:00Z' },
];

const reset = () =>
  useBoardStore.setState({
    byRef: {},
    order: [],
    loaded: false,
    statusFilter: new Set(),
    search: '',
    filteredOrder: [],
  });

const store = () => useBoardStore.getState();

beforeEach(() => {
  reset();
  store().loadSnapshot(fixture);
});

describe('loadSnapshot', () => {
  it('indexes rows, preserves order, and precomputes lowercase searchKey', () => {
    const s = store();
    expect(s.order).toEqual(['TV-1', 'TV-2', 'TV-3', 'TV-4', 'TV-5']);
    expect(s.byRef['TV-1'].rev).toBe(0);
    expect(s.byRef['TV-1'].searchKey).toBe('tv-1 acme foods');
    expect(s.filteredOrder).toBe(s.order); // 无筛选 → 同一引用
    expect(s.loaded).toBe(true);
  });
});

describe('applyDeltas — structural sharing', () => {
  it('replaces only changed rows; unchanged rows keep their identity', () => {
    const before = store().byRef;
    const update: StatusUpdate = { reference: 'TV-2', status: 'in_transit', last_update: '2026-07-02T10:00:00Z' };
    store().applyDeltas([update]);
    const after = store().byRef;

    // 变更行：新对象、rev 递增、字段更新
    expect(after['TV-2']).not.toBe(before['TV-2']);
    expect(after['TV-2'].status).toBe('in_transit');
    expect(after['TV-2'].last_update).toBe('2026-07-02T10:00:00Z');
    expect(after['TV-2'].rev).toBe(1);

    // 未触及的行：同一引用——这正是按行 selector 不重渲染的原因
    expect(after['TV-1']).toBe(before['TV-1']);
    expect(after['TV-3']).toBe(before['TV-3']);
  });

  it('coalesces multiple updates to the same row to the last value', () => {
    store().applyDeltas([
      { reference: 'TV-1', status: 'picked_up', last_update: '2026-07-02T00:00:01Z' },
      { reference: 'TV-1', status: 'in_transit', last_update: '2026-07-02T00:00:02Z' },
    ]);
    const row = store().byRef['TV-1'];
    expect(row.status).toBe('in_transit');
    expect(row.last_update).toBe('2026-07-02T00:00:02Z');
    expect(row.rev).toBe(2);
  });

  it('ignores unknown references and empty batches without throwing', () => {
    const before = store().byRef;
    store().applyDeltas([{ reference: 'TV-999', status: 'created', last_update: 'x' }]);
    expect(store().byRef['TV-999']).toBeUndefined();
    store().applyDeltas([]);
    expect(store().byRef).toBe(before); // 空批次：状态不变
  });
});

describe('filtering', () => {
  it('filters by status', () => {
    store().toggleStatusFilter('failed');
    expect(store().filteredOrder).toEqual(['TV-5']);
  });

  it('searches over reference and customer, case-insensitively', () => {
    store().setSearch('acme');
    expect(store().filteredOrder).toEqual(['TV-1', 'TV-3']);
    store().setSearch('PHARMA');
    expect(store().filteredOrder).toEqual(['TV-4', 'TV-5']);
  });

  it('combines status + search (intersection)', () => {
    store().toggleStatusFilter('failed');
    store().setSearch('pharma');
    expect(store().filteredOrder).toEqual(['TV-5']); // failed 且匹配 pharma
  });

  it('clearFilters restores the full order', () => {
    store().toggleStatusFilter('failed');
    store().setSearch('x');
    store().clearFilters();
    expect(store().filteredOrder).toBe(store().order);
  });
});

describe('filtering under churn', () => {
  it('keeps status-filter membership correct as rows transition in and out', () => {
    store().toggleStatusFilter('in_transit');
    expect(store().filteredOrder).toEqual(['TV-3']); // 初始只有 TV-3 是 in_transit

    // 翻动：TV-3 离开 in_transit（→ delivered）；TV-2 进入 in_transit。
    store().applyDeltas([
      { reference: 'TV-3', status: 'delivered', last_update: '2026-07-02T00:00:00Z' },
      { reference: 'TV-2', status: 'in_transit', last_update: '2026-07-02T00:00:00Z' },
    ]);

    // 成员在 flush 时重算，并保持原有顺序。
    expect(store().filteredOrder).toEqual(['TV-2']);
  });

  it('does not recompute search membership on churn (deltas never change ref/customer)', () => {
    store().setSearch('acme'); // TV-1、TV-3
    const filteredBefore = store().filteredOrder;
    // 状态变更不会影响谁匹配 "acme"。
    store().applyDeltas([{ reference: 'TV-1', status: 'delivered', last_update: '2026-07-02T00:00:00Z' }]);
    expect(store().filteredOrder).toEqual(filteredBefore); // 成员不变
    expect(store().byRef['TV-1'].status).toBe('delivered'); // 但行数据确实更新了
  });
});
