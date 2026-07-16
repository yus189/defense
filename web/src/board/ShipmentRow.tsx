import { memo, useEffect, useRef } from 'react';
import { useBoardStore } from '../store/boardStore';
import { STATUS_META } from './statusMeta';
import { formatTime } from './formatTime';

interface Props {
  reference: string;
  top: number;
  height: number;
}

/**
 * 单个虚拟化行。它通过 selector 只订阅*自己那条*货运，因此一次状态更新只重渲染
 * 这一行——绝不重渲染整个列表。`memo` 使它在表格因无关原因重渲染时不被牵连。
 *
 * 高亮：一个以行的 `rev` 为 key 的覆盖层，在行原地变更时重放一次 CSS 淡出。
 * mount 守卫确保只在原地变更时闪——初始加载不闪、行（可能在离屏时已更新）滚入
 * 视图时也不闪。
 */
export const ShipmentRow = memo(function ShipmentRow({ reference, top, height }: Props) {
  const row = useBoardStore((s) => s.byRef[reference]);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);

  if (!row) return null;
  const meta = STATUS_META[row.status];

  return (
    <div
      className="row"
      style={{ transform: `translateY(${top}px)`, height, borderLeftColor: meta.color }}
    >
      {mounted.current && row.rev > 0 && (
        <span key={row.rev} className="row__flash" style={{ backgroundColor: meta.color }} />
      )}
      <div className="cell cell--ref">{row.reference}</div>
      <div className="cell cell--cust" title={row.customer_name}>
        {row.customer_name}
      </div>
      <div className="cell cell--status">
        <span className="chip" style={{ color: meta.color, backgroundColor: meta.bg }}>
          {meta.label}
        </span>
      </div>
      <div className="cell cell--time">{formatTime(row.last_update)}</div>
    </div>
  );
});
