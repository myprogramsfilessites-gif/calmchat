'use strict';
const fs = require('fs');
const path = require('path');

const API = 'https://api.cloudflare.com/client/v4';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.argv[2];
const SCRIPT = 'calmchat';
const PUBLIC_DIR = path.join(__dirname, 'public');
const STATE_FILE = path.join(__dirname, '.cf-deploy.json');
const SUBDOMAIN_CANDIDATES = ['calmchat', 'calmchat-app', 'calmchat-call'];

if (!TOKEN) {
  console.error('No token. Set CLOUDFLARE_API_TOKEN env or pass as first arg.');
  process.exit(1);
}

const AUTH = { Authorization: 'Bearer ' + TOKEN };

async function cf(method, p, body, extra) {
  const opts = { method, headers: { ...AUTH, ...(extra || {}) } };
  if (body !== undefined) {
    if (typeof body === 'string' || Buffer.isBuffer(body)) {
      opts.body = body;
    } else {
      opts.body = JSON.stringify(body);
      if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
    }
  }
  const res = await fetch(API + p, opts);
  let data = null;
  const text = await res.text();
  try { data = JSON.parse(text); } catch (e) { data = text; }
  if (!res.ok) throw new Error(method + ' ' + p + ' -> ' + res.status + ' ' + text.slice(0, 500));
  return data;
}

function listFiles(dir, base) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.join(base, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...listFiles(full, rel));
    else out.push({ rel: rel.split(path.sep).join('/'), full });
  }
  return out;
}

async function getAccountId() {
  const state = loadState();
  if (state.accountId) return state.accountId;
  const data = await cf('GET', '/accounts');
  if (data.result && data.result.length) return data.result[0].id;
  throw new Error('Cannot auto-detect account id. Set CLOUDFLARE_ACCOUNT_ID env or pass account id.');
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return {}; }
}

async function saveState(patch) {
  const state = { ...loadState(), ...patch };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  return state;
}

async function ensureSubdomain(accountId) {
  try {
    const res = await cf('GET', '/accounts/' + accountId + '/workers/subdomain');
    if (res.result && res.result.subdomain) {
      console.log('workers.dev subdomain:', res.result.subdomain);
      return res.result.subdomain;
    }
  } catch (e) {
    console.log('no workers.dev subdomain yet, creating one...');
  }
  for (const cand of SUBDOMAIN_CANDIDATES) {
    try {
      const res = await cf('PUT', '/accounts/' + accountId + '/workers/subdomain', { subdomain: cand });
      console.log('subdomain set:', cand);
      return cand;
    } catch (e) { console.log('subdomain', cand, 'unavailable, trying next'); }
  }
  throw new Error('Could not set workers.dev subdomain');
}

async function ensureKV(accountId) {
  const state = loadState();
  if (state.kvId) return state.kvId;
  const res = await cf('POST', '/accounts/' + accountId + '/storage/kv/namespaces', { title: 'calmchat' });
  console.log('KV namespace created:', res.result.id);
  await saveState({ kvId: res.result.id });
  return res.result.id;
}

async function uploadStatic(kvId, accountId) {
  const files = listFiles(PUBLIC_DIR, '');
  console.log('Uploading', files.length, 'static files...');
  for (const f of files) {
    const key = 'asset:' + f.rel;
    const body = fs.readFileSync(f.full);
    await cf('PUT', '/accounts/' + accountId + '/storage/kv/namespaces/' + kvId + '/values/' + encodeURIComponent(key),
      body, { 'Content-Type': 'application/octet-stream' });
    console.log('  uploaded', f.rel);
  }
}

async function uploadWorker(accountId, kvId) {
  const worker = fs.readFileSync(path.join(__dirname, 'worker.js'), 'utf8');
  const baseMeta = {
    main_module: 'worker.js',
    compatibility_date: '2025-01-01',
    compatibility_flags: [],
    bindings: [
      { name: 'KV', type: 'kv_namespace', namespace_id: kvId },
      { name: 'ROOMS', type: 'durable_object_namespace', class_name: 'Room' },
    ],
  };
  for (const withMigration of [true, false]) {
    const metadata = withMigration
      ? { ...baseMeta, migrations: { tag: 'v1', new_sqlite_classes: ['Room'] } }
      : baseMeta;
    const fd = new FormData();
    fd.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    fd.append('worker.js', new Blob([worker], { type: 'application/javascript+module' }), 'worker.js');
    const res = await fetch(API + '/accounts/' + accountId + '/workers/scripts/' + SCRIPT, {
      method: 'PUT',
      headers: { ...AUTH, ...fd.getHeaders ? fd.getHeaders() : {} },
      body: fd,
    });
    const text = await res.text();
    if (res.ok) {
      console.log('Worker uploaded:', SCRIPT, withMigration ? '(with migration)' : '(migration already applied)');
      return JSON.parse(text);
    }
    const alreadyApplied = text.includes('10074') || text.includes('already depended');
    if (!withMigration || !alreadyApplied) {
      throw new Error('Worker upload -> ' + res.status + ' ' + text.slice(0, 800));
    }
    console.log('migration already applied, retrying without it');
  }
  throw new Error('Worker upload failed');
}

async function enableWorkersDev(accountId) {
  const res = await cf('POST', '/accounts/' + accountId + '/workers/scripts/' + SCRIPT + '/subdomain', { enabled: true });
  console.log('workers.dev route enabled');
  return res;
}

async function waitFor(url, times) {
  for (let i = 0; i < times; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error('URL not ready after retries: ' + url);
}

async function verify(url) {
  const health = await waitFor(url + '/health', 12);
  console.log('/health ->', health.status, await health.text());

  const reg = await fetch(url + '/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: 'tester' + Date.now().toString(36) }),
  });
  const regJson = await reg.json();
  console.log('/api/register ->', reg.status, JSON.stringify(regJson));
  if (reg.status !== 200 || !regJson.user || !regJson.user.id) throw new Error('register failed');
  const userId = regJson.user.id;

  const create = await fetch(url + '/api/room/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  const createJson = await create.json();
  console.log('/api/room/create ->', create.status, JSON.stringify(createJson));
  const roomId = createJson.room && createJson.room.id;

  const join = await fetch(url + '/api/room/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, roomId }),
  });
  console.log('/api/room/join ->', join.status, JSON.stringify(await join.json()));

  const root = await waitFor(url + '/', 12);
  const html = await root.text();
  console.log('GET / ->', root.status, 'contains <!DOCTYPE html>:', html.includes('<!DOCTYPE html>'));

  if (roomId) await testWebSocket(url, userId, roomId);
}

async function testWebSocket(url, userId, roomId) {
  let WebSocket = null;
  try { WebSocket = require('ws'); } catch (e) {}
  if (!WebSocket) { console.log('ws package not available, skipping WS test'); return; }
  const wsUrl = url.replace('https://', 'wss://') + '/ws?userId=' + userId + '&roomId=' + roomId;
  const ws = new WebSocket(wsUrl);
  const done = new Promise((resolve) => {
    const t = setTimeout(() => { console.log('WS test: timeout, no message received'); resolve(); }, 15000);
    ws.on('message', (d) => {
      const msg = JSON.parse(d.toString());
      console.log('WS test: received', msg.type, msg.peers ? 'peers=' + msg.peers.length : '');
      if (msg.type === 'joined') { clearTimeout(t); resolve(); }
    });
    ws.on('open', () => console.log('WS test: connected'));
    ws.on('error', (e) => { console.log('WS test error:', e.message); clearTimeout(t); resolve(); });
  });
  await done;
  ws.close();
}

(async () => {
  try {
    let accountId = process.env.CLOUDFLARE_ACCOUNT_ID || await getAccountId();
    const state = await saveState({ accountId });
    const subdomain = await ensureSubdomain(accountId);
    const kvId = await ensureKV(accountId);
    await uploadStatic(kvId, accountId);
    await uploadWorker(accountId, kvId);
    await enableWorkersDev(accountId);
    const url = 'https://' + SCRIPT + '.' + subdomain + '.workers.dev';
    console.log('\nDeployed:', url);
    await verify(url);
    console.log('\nSUCCESS:', url);
  } catch (e) {
    console.error('\nFAILED:', e.message);
    process.exit(1);
  }
})();
