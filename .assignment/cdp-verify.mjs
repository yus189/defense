// Minimal CDP driver: verifies virtualization + captures screenshots via system Chrome.
// Not part of the deliverable (lives under .assignment/). Uses the already-installed `ws`.
import WebSocket from 'ws';
import { writeFileSync } from 'node:fs';

const CDP = 'http://localhost:9222';
const APP = 'http://localhost:5173';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPageTarget() {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch(`${CDP}/json`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.includes('5173'))
        || list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch {}
    await sleep(300);
  }
  throw new Error('no CDP page target');
}

function makeClient(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  const ready = new Promise((res) => ws.on('open', res));
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  }
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r.result.value;
  };
  return { ready, send, evaluate, ws };
}

const target = await getPageTarget();
const c = makeClient(target.webSocketDebuggerUrl);
await c.ready;
await c.send('Page.enable');
await c.send('Runtime.enable');
await c.send('Page.navigate', { url: APP });

// wait for rows
let rows = 0;
for (let i = 0; i < 40; i++) {
  rows = await c.evaluate(`document.querySelectorAll('.row').length`);
  if (rows > 0) break;
  await sleep(250);
}

const probe = () =>
  c.evaluate(`(() => {
    const rows = document.querySelectorAll('.row');
    const firstRef = document.querySelector('.row .cell--ref')?.textContent ?? null;
    const conn = document.querySelector('[data-testid=conn-status]')?.textContent?.trim() ?? null;
    const count = document.querySelector('.count')?.textContent?.trim() ?? null;
    const sc = document.querySelector('.board__scroll');
    return JSON.stringify({
      rowCount: rows.length,
      firstRef,
      conn,
      count,
      scrollHeight: sc?.scrollHeight ?? null,
      clientHeight: sc?.clientHeight ?? null,
    });
  })()`);

const before = JSON.parse(await probe());
console.log('BEFORE scroll:', JSON.stringify(before, null, 0));

async function shot(path) {
  const { data } = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path, Buffer.from(data, 'base64'));
}
await shot('/tmp/m3-before.png');

// scroll down 4000px
await c.evaluate(`document.querySelector('.board__scroll').scrollTop = 4000`);
await sleep(500);
const after = JSON.parse(await probe());
console.log('AFTER scroll: ', JSON.stringify(after, null, 0));
await shot('/tmp/m3-after.png');

console.log('RESULT:',
  before.rowCount > 0 && before.rowCount < 200 ? 'VIRTUALIZED_OK' : 'ROWCOUNT_SUSPECT',
  '| firstRef changed:', before.firstRef !== after.firstRef,
  '| rowCount stable window:', Math.abs(before.rowCount - after.rowCount) < 10);

c.ws.close();
process.exit(0);
