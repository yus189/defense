import { useEffect, useState } from 'react';
import { STATUSES } from '@shared/protocol';
import { useBoardStore } from '../store/boardStore';
import { STATUS_META } from '../board/statusMeta';

/**
 * 筛选 + 搜索控件。搜索做了防抖（150ms），因此每次击键都不会触发一次完整的 1 万行扫描。
 * 实时结果计数被隔离进独立的子组件，这样在状态筛选生效、数据翻动导致 `filteredOrder`
 * 每帧变化时，只有计数重渲染——输入框和 chip 不受影响。
 */
export function FilterBar() {
  const statusFilter = useBoardStore((s) => s.statusFilter);
  const toggleStatusFilter = useBoardStore((s) => s.toggleStatusFilter);
  const setSearch = useBoardStore((s) => s.setSearch);
  const clearFilters = useBoardStore((s) => s.clearFilters);

  const [text, setText] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setSearch(text), 150);
    return () => clearTimeout(id);
  }, [text, setSearch]);

  const active = statusFilter.size > 0 || text.trim() !== '';
  const clear = () => {
    setText('');
    clearFilters();
  };

  return (
    <div className="filters">
      <input
        className="search"
        type="search"
        placeholder="Search reference or customer…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Search reference or customer"
      />
      <div className="chips" role="group" aria-label="Filter by status">
        {STATUSES.map((s) => {
          const on = statusFilter.has(s);
          const meta = STATUS_META[s];
          return (
            <button
              key={s}
              type="button"
              className={on ? 'fchip fchip--on' : 'fchip'}
              style={on ? { color: meta.color, borderColor: meta.color, backgroundColor: meta.bg } : undefined}
              onClick={() => toggleStatusFilter(s)}
              aria-pressed={on}
            >
              {meta.label}
            </button>
          );
        })}
      </div>
      <ResultCount />
      {active && (
        <button type="button" className="clear" onClick={clear}>
          Clear
        </button>
      )}
    </div>
  );
}

function ResultCount() {
  const shown = useBoardStore((s) => s.filteredOrder.length);
  const total = useBoardStore((s) => s.order.length);
  const active = useBoardStore((s) => s.statusFilter.size > 0 || s.search.trim() !== '');
  if (!active) return null;
  return (
    <span className="result-count">
      <strong>{shown.toLocaleString()}</strong> of {total.toLocaleString()}
    </span>
  );
}
