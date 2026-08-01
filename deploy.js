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
      { name: 'HUB', type: 'durable_object_namespace', class_name: 'Hub' },
    ],
  };
  for (const withMigration of [true, false]) {
    const metadata = withMigration
      ? { ...baseMeta, migrations: { tag: 'v2', new_sqlite_classes: ['Hub'], deleted_classes: ['Room'] } }
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
    const alreadyApplied = text.includes('10074') || /already (been )?applied/i.test(text) || /already depended/i.test(text);
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

  const stamp = Date.now().toString(36);
  const nickA = 'alpha' + stamp;
  const nickB = 'beta' + stamp;

  const regA = await fetch(url + '/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nick: nickA, password: 'pass1234', avatar: 'cat' }),
  });
  const a = await regA.json();
  console.log('register A ->', regA.status, JSON.stringify(a.user || a));
  if (regA.status !== 200 || !a.user || !/^\d+$/.test(a.user.id)) throw new Error('register A failed (id must be numeric)');

  const dup = await fetch(url + '/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nick: nickA, password: 'pass1234' }),
  });
  console.log('register dup ->', dup.status);
  if (dup.status !== 409) throw new Error('duplicate nick must be 409');

  const regB = await fetch(url + '/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nick: nickB, password: 'pass5678' }),
  });
  const b = await regB.json();
  console.log('register B ->', regB.status, JSON.stringify(b.user || b));

  const login = await fetch(url + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: a.user.id, password: 'pass1234' }),
  });
  console.log('login by id ->', login.status);

  const loginNick = await fetch(url + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nick: nickA, password: 'pass1234' }),
  });
  console.log('login by nick ->', loginNick.status);

  const badLogin = await fetch(url + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: a.user.id, password: 'wrong' }),
  });
  console.log('login wrong pass ->', badLogin.status);
  if (badLogin.status !== 401) throw new Error('wrong password must be 401');

  const req = await fetch(url + '/api/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromId: a.user.id, toId: b.user.id }),
  });
  console.log('send request ->', req.status);

  const reqs = await fetch(url + '/api/requests?userId=' + b.user.id);
  const reqsJson = await reqs.json();
  console.log('list requests ->', reqs.status, 'count:', reqsJson.requests && reqsJson.requests.length);
  if (!reqsJson.requests || !reqsJson.requests.length) throw new Error('no requests');

  const accept = await fetch(url + '/api/requests/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: b.user.id, from: a.user.id }),
  });
  const acceptJson = await accept.json();
  console.log('accept ->', accept.status, JSON.stringify(acceptJson.chat || acceptJson));
  const chatId = acceptJson.chat && acceptJson.chat.id;
  if (!chatId) throw new Error('accept failed');

  const chatsA = await fetch(url + '/api/chats?userId=' + a.user.id);
  const chatsAJson = await chatsA.json();
  console.log('chats A ->', chatsA.status, 'count:', chatsAJson.chats && chatsAJson.chats.length);

  await testMessages(url, a.user.id, b.user.id, chatId);

  const changeNick = await fetch(url + '/api/me/nick', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: a.user.id, nick: 'alpha' + stamp + 'x' }),
  });
  console.log('change nick ->', changeNick.status);

  const root = await waitFor(url + '/', 12);
  const html = await root.text();
  console.log('GET / ->', root.status, 'contains <!DOCTYPE html>:', html.includes('<!DOCTYPE html>'));
}

async function testMessages(url, userIdA, userIdB, chatId) {
  let WebSocket = null;
  try { WebSocket = require('ws'); } catch (e) {}
  if (!WebSocket || !chatId) { console.log('WS test skipped'); return; }

  const wsa = new WebSocket(url.replace('https://', 'wss://') + '/ws?userId=' + userIdA);
  const wsb = new WebSocket(url.replace('https://', 'wss://') + '/ws?userId=' + userIdB);

  const waitConnected = (ws) => new Promise((res) => {
    const t = setTimeout(() => res('timeout'), 10000);
    ws.on('open', () => { clearTimeout(t); res('open'); });
    ws.on('unexpected-response', (req, r) => { clearTimeout(t); console.log('WS unexpected response:', r.statusCode); res('rejected:' + r.statusCode); });
    ws.on('error', (e) => { clearTimeout(t); res('error:' + (e && e.message)); });
  });

  const okA = await waitConnected(wsa);
  const okB = await waitConnected(wsb);
  console.log('WS A connected:', okA, '| WS B connected:', okB);
  if (okA !== 'open' || okB !== 'open') {
    wsa.close(); wsb.close();
    for (let i = 1; i <= 3; i++) {
      console.log('WS connect failed, retrying in 2s...');
      await new Promise((r) => setTimeout(r, 2000));
      try { await testMessages(url, userIdA, userIdB, chatId); return; } catch (e2) {
        console.log('retry', i, 'failed:', e2.message);
      }
    }
    throw new Error('WS connect failed');
  }

  const gotByB = new Promise((res) => {
    const t = setTimeout(() => res('timeout'), 15000);
    wsb.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'msg' && m.chatId === chatId) { clearTimeout(t); res(m.msg); }
    });
  });

  await new Promise((r) => setTimeout(r, 500));
  wsa.send(JSON.stringify({ type: 'msg', chatId, msg: { type: 'text', text: 'привет из теста' } }));

  const recv = await gotByB;
  console.log('WS message A->B:', recv && recv.text ? 'received: ' + recv.text : recv);
  if (!recv || recv.text !== 'привет из теста') { wsa.close(); wsb.close(); throw new Error('WS message not delivered'); }

  const hist = await fetch(url + '/api/messages?userId=' + userIdB + '&chatId=' + chatId);
  const histJson = await hist.json();
  console.log('history ->', hist.status, 'messages:', histJson.messages && histJson.messages.length);

  wsa.close();
  wsb.close();
}

(async () => {
  try {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || await getAccountId();
    const state = await saveState({ accountId });
    const subdomain = await ensureSubdomain(accountId);
    const kvId = await ensureKV(accountId);
    await uploadStatic(kvId, accountId);
    await uploadWorker(accountId, kvId);
    await enableWorkersDev(accountId);
    const url = 'https://' + SCRIPT + '.' + subdomain + '.workers.dev';
    console.log('\nDeployed:', url);
    if (process.env.SKIP_VERIFY !== '1') await verify(url);
    console.log('\nSUCCESS:', url);
  } catch (e) {
    console.error('\nFAILED:', e.message);
    process.exit(1);
  }
})();
