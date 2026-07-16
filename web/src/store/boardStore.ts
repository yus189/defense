import { create } from 'zustand';
import type { Shipment, Status, StatusUpdate } from '@shared/protocol';

/**
 * 客户端行数据：在 shipment 基础上额外带
 * - `rev`：每次原地更新时递增的版本计数器（驱动高亮）
 * - `searchKey`：预计算的小写 "reference customer"，用于零分配的搜索。
 *   delta 永不改 reference/customer，因此它在加载时算一次、之后复用。
 */
export type Row = Shipment & { rev: number; searchKey: string };

export interface BoardState {
  byRef: Record<string, Row>;
  order: string[];
  loaded: boolean;

  // 筛选/搜索状态
  statusFilter: Set<Status>; // 空 = 全部状态
  search: string;
  filteredOrder: string[]; // 表格实际渲染的视图

  loadSnapshot: (shipments: Shipment[]) => void;
  applyDeltas: (updates: StatusUpdate[]) => void;
  toggleStatusFilter: (status: Status) => void;
  setSearch: (q: string) => void;
  clearFilters: () => void;
}

/**
 * 计算筛选视图。当没有任何筛选生效时直接返回 `order` 本身（同一引用），
 * 这样在无筛选时数据翻动不会引起表格重渲染。
 */
function computeFiltered(
  order: string[],
  byRef: Record<string, Row>,
  statusFilter: Set<Status>,
  search: string,
): string[] {
  const hasStatus = statusFilter.size > 0;
  const q = search.trim().toLowerCase();
  const hasSearch = q.length > 0;
  if (!hasStatus && !hasSearch) return order;

  const out: string[] = [];
  for (let i = 0; i < order.length; i++) {
    const row = byRef[order[i]];
    if (!row) continue;
    if (hasStatus && !statusFilter.has(row.status)) continue;
    if (hasSearch && !row.searchKey.includes(q)) continue;
    out.push(row.reference);
  }
  return out;
}

export const useBoardStore = create<BoardState>((set) => ({
  byRef: {},
  order: [],
  loaded: false,
  statusFilter: new Set<Status>(),
  search: '',
  filteredOrder: [],

  loadSnapshot: (shipments) => {
    const byRef: Record<string, Row> = {};
    const order: string[] = [];
    for (let i = 0; i < shipments.length; i++) {
      const s = shipments[i];
      if (byRef[s.reference]) continue; // 防止 reference 重复
      byRef[s.reference] = {
        ...s,
        rev: 0,
        searchKey: `${s.reference} ${s.customer_name}`.toLowerCase(),
      };
      order.push(s.reference);
    }
    set((state) => ({
      byRef,
      order,
      loaded: true,
      filteredOrder: computeFiltered(order, byRef, state.statusFilter, state.search),
    }));
  },

  /**
   * 以结构共享的方式应用一批 delta。只在状态筛选生效时才重算筛选视图——
   * 因为 delta 会改 `status`（影响状态筛选的成员），但绝不改 `reference`/`customer`
   *（所以搜索成员不受数据翻动影响）。
   */
  applyDeltas: (updates) => {
    if (updates.length === 0) return;
    set((state) => {
      const byRef: Record<string, Row> = { ...state.byRef };
      let changed = false;
      for (let i = 0; i < updates.length; i++) {
        const u = updates[i];
        const prev = byRef[u.reference];
        if (!prev) continue;
        changed = true;
        byRef[u.reference] = {
          ...prev,
          status: u.status,
          last_update: u.last_update,
          rev: prev.rev + 1,
        };
      }
      // 无任何命中——保留现有 byRef 引用（不做无谓的失效）。
      if (!changed) return {};
      if (state.statusFilter.size > 0) {
        return {
          byRef,
          filteredOrder: computeFiltered(state.order, byRef, state.statusFilter, state.search),
        };
      }
      return { byRef };
    });
  },

  toggleStatusFilter: (status) => {
    set((state) => {
      const statusFilter = new Set(state.statusFilter);
      if (statusFilter.has(status)) statusFilter.delete(status);
      else statusFilter.add(status);
      return {
        statusFilter,
        filteredOrder: computeFiltered(state.order, state.byRef, statusFilter, state.search),
      };
    });
  },

  setSearch: (q) => {
    set((state) => ({
      search: q,
      filteredOrder: computeFiltered(state.order, state.byRef, state.statusFilter, q),
    }));
  },

  clearFilters: () => {
    set((state) => ({
      statusFilter: new Set<Status>(),
      search: '',
      filteredOrder: state.order,
    }));
  },
}));
