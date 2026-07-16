import { useEffect, useState } from 'react';
import { metrics, type MetricsSnapshot } from './metrics';

export const MAX_RATE = 2000;

interface Props {
  /** 目标 feed 速率（条/秒）。滑杆是服务端速率的真相源——App 在连接时与每次变更时
   *  都向服务端断言它。 */
  rate: number;
  onRateChange: (rate: number) => void;
}

/**
 * 控制 + 遥测条——看板的签名元素。滑杆操纵实时 feed；读数在 demo 中证明负载下的响应性。
 * 它以 250ms 间隔采样指标，因此从不在热路径上渲染。
 */
export function TelemetryBar({ rate, onRateChange }: Props) {
  const [m, setM] = useState<MetricsSnapshot>(() => metrics.snapshot());

  useEffect(() => {
    const id = setInterval(() => setM(metrics.snapshot()), 250);
    return () => clearInterval(id);
  }, []);

  const fpsTone = m.fps >= 55 ? 'good' : m.fps >= 40 ? 'warn' : 'bad';

  return (
    <div className="telemetry">
      <div className="telemetry__control">
        <label htmlFor="rate">Feed rate</label>
        <input
          id="rate"
          type="range"
          min={0}
          max={MAX_RATE}
          step={50}
          value={rate}
          onChange={(e) => onRateChange(Number(e.target.value))}
        />
        <span className="telemetry__rate">{rate}/s</span>
      </div>

      <div className="telemetry__stats">
        <Stat label="FPS" value={m.fps} tone={fpsTone} />
        <Stat label="Applied/s" value={m.updatesPerSec} />
        <Stat label="Batch" value={m.batchSize} />
        <Stat label="Feed lag" value={`${m.lagMs}ms`} />
        <Stat label="Visible" value={m.visibleRows} />
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className={tone ? `stat stat--${tone}` : 'stat'}>
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
    </div>
  );
}
