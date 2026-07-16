import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useBoardStore } from '../store/boardStore';
import { metrics } from '../perf/metrics';
import { ShipmentRow } from './ShipmentRow';

const ROW_HEIGHT = 40;

/**
 * 虚拟化的货运列表。只订阅 `order`（行数 + 索引映射），它在状态更新时保持稳定——
 * 因此本组件不会因数据翻动而重渲染，只有用户滚动或视图变化时才重渲染。
 * 各行拥有各自的订阅。
 */
export function ShipmentTable() {
  const order = useBoardStore((s) => s.filteredOrder);
  const loaded = useBoardStore((s) => s.loaded);
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: order.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    // 按 reference（而非 index）作为行 key，使 React 在滚动和筛选重排时把同一条货运
    // 对应到同一个行实例——这既保持了 memo 有效，又避免了某个槽位被复用给另一条行时
    // 出现的误闪。
    getItemKey: (index) => order[index],
  });

  const items = virtualizer.getVirtualItems();

  // 把挂载的行数暴露给 HUD（在渲染之后、不在热路径上）。
  useEffect(() => {
    metrics.setVisibleRows(items.length);
  }, [items.length]);

  return (
    <div className="board">
      <div className="board__head">
        <div className="col col--ref">Reference</div>
        <div className="col col--cust">Customer</div>
        <div className="col col--status">Status</div>
        <div className="col col--time">Last update</div>
      </div>

      <div className="board__scroll" ref={parentRef}>
        {order.length === 0 ? (
          <div className="board__empty">
            {loaded ? 'No shipments match the current filters.' : 'Waiting for snapshot…'}
          </div>
        ) : (
          <div className="board__viewport" style={{ height: virtualizer.getTotalSize() }}>
            {items.map((vi) => (
              <ShipmentRow
                key={vi.key}
                reference={order[vi.index]}
                top={vi.start}
                height={ROW_HEIGHT}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
