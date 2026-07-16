// M4 verification: FPS under load (idle + continuous scroll), liveness, HUD readout.
import WebSocket from 'ws';
import { writeFileSync } from 'node:fs';

const CDP = 'http://localhost:9222';
const APP = 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPageTarget() {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch(`${CDP}/json`)).json();
      const p = list.find((t) => t.type === 'page' && t.url.includes('5173')) || list.find((t) => t.type === 'page');
      if (p?.webSocketDebuggerUrl) return p;
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
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const ready = new Promise((res) => ws.on('open', res));
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;
  return { ready, send, evaluate, ws };
}

const target = await getPageTarget();
const c = makeClient(target.webSocketDebuggerUrl);
await c.ready;
await c.send('Page.enable');
await c.send('Runtime.enable');
await c.send('Page.navigate', { url: APP });

for (let i = 0; i < 40; i++) {
  if ((await c.evaluate(`document.querySelectorAll('.row').length`)) > 0) break;
  await sleep(250);
}

// Inject an independent FPS meter (does not rely on the app's own HUD).
await c.evaluate(`
  window.__fps = { frames: 0, fps: 0, last: performance.now(), min: 999 };
  (function loop(t){
    window.__fps.frames++;
    const dt = t - window.__fps.last;
    if (dt >= 500) {
      window.__fps.fps = Math.round(window.__fps.frames*1000/dt);
      if (window.__fps.fps < window.__fps.min) window.__fps.min = window.__fps.fps;
      window.__fps.frames = 0; window.__fps.last = t;
    }
    requestAnimationFrame(loop);
  })(performance.now());
  true;
`);

const hud = () => c.evaluate(`JSON.stringify([...document.querySelectorAll('.stat')].map(s => s.querySelector('.stat__label').textContent + '=' + s.querySelector('.stat__value').textContent))`);
const sampleRows = () => c.evaluate(`JSON.stringify([...document.querySelectorAll('.row')].slice(0,25).map(r => r.querySelector('.cell--ref').textContent + '|' + r.querySelector('.cell--status').textContent + '|' + r.querySelector('.cell--time').textContent))`);
const shot = async (path) => { const { data } = await c.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path, Buffer.from(data, 'base64')); };

// ---- Phase A: idle under load ----
await c.evaluate(`window.__fps.min = 999`);
await sleep(2500);
const fpsIdle = await c.evaluate(`window.__fps.fps`);
const fpsIdleMin = await c.evaluate(`window.__fps.min`);
const s1 = JSON.parse(await sampleRows());
await sleep(1200);
const s2 = JSON.parse(await sampleRows());
const changed = s1.filter((v, i) => v !== s2[i]).length;
console.log('PHASE A (idle under load):');
console.log('  fps=', fpsIdle, ' fpsMin=', fpsIdleMin, ' HUD=', await hud());
console.log('  liveness: of top 25 visible rows,', changed, 'changed in 1.2s');
await shot('/tmp/m4-idle.png');

// ---- Phase B: continuous scroll under load ----
await c.evaluate(`
  window.__scroll = true;
  (function s(){
    const el = document.querySelector('.board__scroll');
    if (!el || !window.__scroll) return;
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTop = (el.scrollTop + 80) % max;
    requestAnimationFrame(s);
  })();
  window.__fps.min = 999; true;
`);
await sleep(3000);
const fpsScroll = await c.evaluate(`window.__fps.fps`);
const fpsScrollMin = await c.evaluate(`window.__fps.min`);
await c.evaluate(`window.__scroll = false`);
console.log('PHASE B (continuous scroll under load):');
console.log('  fps=', fpsScroll, ' fpsMin=', fpsScrollMin, ' HUD=', await hud());
await shot('/tmp/m4-scroll.png');

console.log('VERDICT:',
  fpsIdleMin >= 50 ? 'IDLE_SMOOTH' : 'IDLE_JANK',
  '|', fpsScrollMin >= 45 ? 'SCROLL_SMOOTH' : 'SCROLL_JANK',
  '| liveness', changed > 0 ? 'OK' : 'NONE');

c.ws.close();
process.exit(0);
