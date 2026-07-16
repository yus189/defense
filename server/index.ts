import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  DEFAULT_FEED_PORT,
  type ClientMessage,
  type ServerMessage,
} from '../shared/protocol';
import { loadShipments } from './csv';
import { FeedEngine } from './feed';

const PORT = Number(process.env.FEED_PORT ?? DEFAULT_FEED_PORT);
const RATE = Number(process.env.FEED_RATE ?? 200);
const CSV_PATH =
  process.env.CSV_PATH ?? fileURLToPath(new URL('../data/shipments_10k.csv', import.meta.url));

let shipments;
try {
  shipments = loadShipments(CSV_PATH);
} catch (err) {
  console.error(`[feed] could not read CSV at ${CSV_PATH}:`, (err as Error).message);
  process.exit(1);
}
console.log(`[feed] loaded ${shipments.length} shipments from ${CSV_PATH}`);

const wss = new WebSocketServer({ port: PORT });

function broadcast(data: string): void {
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

const engine = new FeedEngine(shipments, RATE, (updates) => {
  const msg: ServerMessage = { type: 'delta', updates, sentAt: Date.now() };
  broadcast(JSON.stringify(msg));
});

wss.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[feed] port ${PORT} is already in use — is another feed running?`);
  } else {
    console.error('[feed] server error:', err.message);
  }
  process.exit(1);
});

wss.on('listening', () => {
  console.log(`[feed] WebSocket server listening on ws://localhost:${PORT}`);
  console.log(`[feed] streaming at ${engine.getRate()} updates/sec (configurable)`);
  engine.start();
});

wss.on('connection', (ws) => {
  console.log(`[feed] client connected (${wss.clients.size} total)`);

  const snapshot: ServerMessage = {
    type: 'snapshot',
    shipments: engine.snapshot(),
    serverTime: new Date().toISOString(),
  };
  ws.send(JSON.stringify(snapshot));

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return; // 忽略格式错误的输入
    }
    if (msg && typeof msg === 'object' && msg.type === 'setRate') {
      engine.setRate(msg.rate);
      console.log(`[feed] rate set to ${engine.getRate()} updates/sec`);
    }
  });

  ws.on('close', () => console.log(`[feed] client disconnected (${wss.clients.size} total)`));
  ws.on('error', (err) => console.error('[feed] socket error:', err.message));
});

function shutdown(): void {
  engine.stop();
  for (const client of wss.clients) client.terminate(); // 不等待存活的 socket
  wss.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref(); // close 若卡住则硬退出
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
