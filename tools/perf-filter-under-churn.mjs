// M5 verification: search correctness, status-filter correctness, filter-under-churn, FPS.
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
  let id = 0; const pending = new Map();
  ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const ready = new Promise((res) => ws.on('open', res));
  const send = (method, params = {}) => new Promise((resolve, reject) => { const mid = ++id; pending.set(mid, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result))); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;
  return { ready, send, evaluate, ws };
}

const target = await getPageTarget();
const c = makeClient(target.webSocketDebuggerUrl);
await c.ready;
await c.send('Page.enable');
await c.send('Runtime.enable');
await c.send('Page.navigate', { url: APP });
for (let i = 0; i < 40; i++) { if ((await c.evaluate(`document.querySelectorAll('.row').length`)) > 0) break; await sleep(250); }

const shot = async (path) => { const { data } = await c.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path, Buffer.from(data, 'base64')); };

// fps meter
await c.evaluate(`window.__fps={frames:0,fps:0,last:performance.now(),min:999};(function l(t){window.__fps.frames++;const dt=t-window.__fps.last;if(dt>=500){window.__fps.fps=Math.round(window.__fps.frames*1000/dt);if(window.__fps.fps<window.__fps.min)window.__fps.min=window.__fps.fps;window.__fps.frames=0;window.__fps.last=t;}requestAnimationFrame(l);})(performance.now());true;`);

// helpers to drive React-controlled inputs
const setSearch = (q) => c.evaluate(`(()=>{const el=document.querySelector('.search');const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;set.call(el,${JSON.stringify(q)});el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
const clickStatus = (label) => c.evaluate(`(()=>{const b=[...document.querySelectorAll('.fchip')].find(x=>x.textContent.trim()===${JSON.stringify(label)});if(b){b.click();return true;}return false;})()`);
const clickClear = () => c.evaluate(`(()=>{const b=document.querySelector('.clear');if(b){b.click();return true;}return false;})()`);
const rowsSample = () => c.evaluate(`JSON.stringify([...document.querySelectorAll('.row')].map(r=>({ref:r.querySelector('.cell--ref').textContent,cust:r.querySelector('.cell--cust').textContent,status:r.querySelector('.cell--status').textContent})))`);
const resultCount = () => c.evaluate(`document.querySelector('.result-count')?.textContent ?? null`);

// ---- Test 1: search correctness ----
await setSearch('Acme');
await sleep(400);
let rows = JSON.parse(await rowsSample());
const allMatchAcme = rows.every((r) => (r.ref + ' ' + r.cust).toLowerCase().includes('acme'));
console.log('TEST 1 search "Acme":', rows.length, 'visible; all match =', allMatchAcme, '; count=', await resultCount());
await shot('/tmp/m5-search.png');

// ---- Test 2: clear, then status filter correctness ----
await clickClear();
await sleep(300);
await clickStatus('Failed');
await sleep(400);
rows = JSON.parse(await rowsSample());
const allFailed = rows.every((r) => r.status.trim() === 'Failed');
console.log('TEST 2 status=Failed:', rows.length, 'visible; all Failed =', allFailed, '; count=', await resultCount());
await shot('/tmp/m5-filter.png');

// ---- Test 3: filter-under-churn correctness ----
// With status=Failed active and the feed churning, scroll + wait, then assert EVERY visible row is Failed.
await c.evaluate(`window.__fps.min=999`);
let churnViolations = 0;
for (let i = 0; i < 8; i++) {
  await c.evaluate(`(()=>{const el=document.querySelector('.board__scroll');el.scrollTop=(el.scrollTop+400)% Math.max(1,(el.scrollHeight-el.clientHeight));})()`);
  await sleep(350);
  const r = JSON.parse(await rowsSample());
  const bad = r.filter((x) => x.status.trim() !== 'Failed').length;
  churnViolations += bad;
}
const fpsMinChurn = await c.evaluate(`window.__fps.min`);
console.log('TEST 3 filter-under-churn: violations(non-Failed visible under Failed filter) =', churnViolations, '; fpsMin =', fpsMinChurn);

// ---- Test 4: combined status + search ----
await setSearch('pharma');
await sleep(400);
rows = JSON.parse(await rowsSample());
const allFailedPharma = rows.every((r) => r.status.trim() === 'Failed' && (r.ref + ' ' + r.cust).toLowerCase().includes('pharma'));
console.log('TEST 4 status=Failed + search "pharma":', rows.length, 'visible; all match =', allFailedPharma, '; count=', await resultCount());

console.log('VERDICT:',
  allMatchAcme ? 'SEARCH_OK' : 'SEARCH_BAD', '|',
  allFailed ? 'FILTER_OK' : 'FILTER_BAD', '|',
  churnViolations === 0 ? 'CHURN_CORRECT' : 'CHURN_VIOLATION', '|',
  fpsMinChurn >= 45 ? 'CHURN_SMOOTH' : 'CHURN_JANK', '|',
  allFailedPharma ? 'COMBINED_OK' : 'COMBINED_BAD');

c.ws.close();
process.exit(0);
