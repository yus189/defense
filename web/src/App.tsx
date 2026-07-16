import { useEffect, useState } from 'react';
import { useFeed } from './feed/useFeed';
import { useBoardStore } from './store/boardStore';
import { ShipmentTable } from './board/ShipmentTable';
import { TelemetryBar } from './perf/TelemetryBar';
import { FilterBar } from './controls/FilterBar';
import { metrics } from './perf/metrics';

const INITIAL_RATE = 200;

export function App() {
  const { status, setRate } = useFeed();
  const total = useBoardStore((s) => s.order.length);
  const [rate, setRateValue] = useState(INITIAL_RATE);

  useEffect(() => {
    metrics.start();
    return () => metrics.stop();
  }, []);

  // 滑杆是服务端速率的真相源：连接时以及每次变更时都断言它，
  // 这样 HUD 的 "Applied/s" 始终与滑杆一致。
  useEffect(() => {
    if (status === 'connected') setRate(rate);
  }, [status, rate, setRate]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__glyph" aria-hidden="true" />
          <h1>Live Ops Board</h1>
        </div>
        <div className="topbar__meta">
          <span className="count">
            <strong>{total.toLocaleString()}</strong> shipments
          </span>
          <span
            className={`conn conn--${status}`}
            data-testid="conn-status"
            role="status"
            aria-live="polite"
          >
            <span className="conn__dot" aria-hidden="true" />
            {status}
          </span>
        </div>
      </header>
      <TelemetryBar rate={rate} onRateChange={setRateValue} />
      <FilterBar />
      <ShipmentTable />
    </div>
  );
}
