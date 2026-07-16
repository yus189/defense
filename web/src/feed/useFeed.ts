import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, ServerMessage, StatusUpdate } from '@shared/protocol';
import { useBoardStore } from '../store/boardStore';
import { metrics } from '../perf/metrics';
import { DeltaBatcher } from './batcher';

const WS_URL = import.meta.env.VITE_FEED_URL ?? 'ws://localhost:8080';
const MAX_BACKOFF_MS = 5000;

export type ConnStatus = 'connecting' | 'connected' | 'disconnected';

/**
 * feed 客户端，也是更新路径的核心。
 *
 * 到达的 delta 先被缓冲，每个动画帧只 flush 一次，因此任意到达速率都塌缩成
 * 每帧最多一次 store 提交（~16.7ms）。socket 以带上限的退避自动重连，这也
 * 覆盖了启动竞态（客户端先于 feed 监听而打开）和服务端重启——对"实时"看板很重要。
 */
export function useFeed() {
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const loadSnapshot = useBoardStore((s) => s.loadSnapshot);
  const applyDeltas = useBoardStore((s) => s.applyDeltas);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let disposed = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const batcher = new DeltaBatcher<StatusUpdate>((batch) => {
      metrics.setBatchSize(batch.length);
      metrics.recordApplied(batch.length);
      applyDeltas(batch);
    });

    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) return;
        attempt = 0;
        setStatus('connected');
      };

      ws.onmessage = (ev) => {
        if (disposed) return;
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data as string) as ServerMessage;
        } catch {
          return; // 忽略格式错误/不完整的帧，而不是抛异常
        }
        if (msg.type === 'snapshot') {
          loadSnapshot(msg.shipments);
        } else if (msg.type === 'delta') {
          metrics.setLag(Math.max(0, Date.now() - msg.sentAt));
          batcher.push(msg.updates);
        }
      };

      ws.onerror = () => {
        /* 'error' 之后必然跟着 'close'，重连在那里处理 */
      };

      ws.onclose = () => {
        if (disposed) return;
        setStatus('disconnected');
        const delay = Math.min(MAX_BACKOFF_MS, 250 * 2 ** attempt);
        attempt++;
        reconnectTimer = setTimeout(() => {
          if (disposed) return;
          setStatus('connecting');
          connect();
        }, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      batcher.dispose();
      wsRef.current?.close();
    };
  }, [loadSnapshot, applyDeltas]);

  const setRate = useCallback((rate: number) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const msg: ClientMessage = { type: 'setRate', rate };
      ws.send(JSON.stringify(msg));
    }
  }, []);

  return { status, setRate };
}
