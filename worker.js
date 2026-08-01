'use strict';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

function readBody(request) {
  return request.json().catch(() => ({}));
}

function randomHex(n) {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, nick: u.nick || '', avatar: u.avatar || '', dnd: !!u.dnd, createdAt: u.createdAt || 0 };
}

function chatIdForPair(a, b) {
  const x = Number(a), y = Number(b);
  return 'c' + Math.min(x, y) + '_' + Math.max(x, y);
}

// ---------- users ----------

async function nextUserId(env) {
  const cur = Number((await env.KV.get('meta:nextId')) || '100000');
  const next = cur + 1;
  await env.KV.put('meta:nextId', String(next));
  return String(next);
}

async function getUser(env, id) {
  const raw = await env.KV.get('user:' + id);
  return raw ? JSON.parse(raw) : null;
}

async function apiRegister(env, body) {
  const nick = String(body.nick || '').trim();
  const pass = String(body.password || '');
  if (!nick || nick.length > 24) return json(400, { error: 'Введи ник (до 24 символов)' });
  if (pass.length < 4) return json(400, { error: 'Пароль — минимум 4 символа' });
  const lower = nick.toLowerCase();
  if (await env.KV.get('nick:' + lower)) return json(409, { error: 'Этот ник уже занят' });
  const id = await nextUserId(env);
  const salt = randomHex(8);
  const passHash = await hashPassword(pass, salt);
  const user = { id, nick, avatar: String(body.avatar || '').trim(), salt, passHash, createdAt: Date.now() };
  await env.KV.put('user:' + id, JSON.stringify(user));
  await env.KV.put('nick:' + lower, id);
  return json(200, { user: publicUser(user) });
}

async function apiLogin(env, body) {
  const idOrNick = String(body.id || body.nick || '').trim();
  const pass = String(body.password || '');
  if (!idOrNick || !pass) return json(400, { error: 'Заполни все поля' });
  let user = await getUser(env, idOrNick);
  if (!user) {
    const id = await env.KV.get('nick:' + idOrNick.toLowerCase());
    if (id) user = await getUser(env, id);
  }
  if (!user) return json(404, { error: 'Пользователь не найден' });
  const h = await hashPassword(pass, user.salt || '');
  if (h !== user.passHash) return json(401, { error: 'Неверный пароль' });
  return json(200, { user: publicUser(user) });
}

async function apiMe(env, userId) {
  if (!userId) return json(400, { error: 'Нет userId' });
  const user = await getUser(env, userId);
  if (!user) return json(404, { error: 'Пользователь не найден' });
  return json(200, { user: publicUser(user) });
}

async function apiChangeNick(env, body) {
  const userId = String(body.userId || '');
  const nick = String(body.nick || '').trim();
  const user = await getUser(env, userId);
  if (!user) return json(404, { error: 'Пользователь не найден' });
  if (!nick || nick.length > 24) return json(400, { error: 'Введи ник (до 24 символов)' });
  const lower = nick.toLowerCase();
  const existing = await env.KV.get('nick:' + lower);
  if (existing && existing !== userId) return json(409, { error: 'Этот ник уже занят' });
  await env.KV.delete('nick:' + user.nick.toLowerCase());
  user.nick = nick;
  await env.KV.put('user:' + userId, JSON.stringify(user));
  await env.KV.put('nick:' + lower, userId);
  await notifyUserUpdated(env, user);
  return json(200, { user: publicUser(user) });
}

async function apiChangeAvatar(env, body) {
  const userId = String(body.userId || '');
  const avatar = String(body.avatar || '').trim();
  const user = await getUser(env, userId);
  if (!user) return json(404, { error: 'Пользователь не найден' });
  user.avatar = avatar;
  await env.KV.put('user:' + userId, JSON.stringify(user));
  await notifyUserUpdated(env, user);
  return json(200, { user: publicUser(user) });
}

async function apiSetDnd(env, body) {
  const userId = String(body.userId || '');
  const dnd = !!body.dnd;
  const user = await getUser(env, userId);
  if (!user) return json(404, { error: 'Пользователь не найден' });
  user.dnd = dnd;
  await env.KV.put('user:' + userId, JSON.stringify(user));
  try {
    const stub = env.HUB.get(env.HUB.idFromName('global'));
    await stub.fetch('https://hub/set-dnd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, dnd }),
    });
  } catch (e) {}
  return json(200, { user: publicUser(user) });
}

async function apiDeleteAccount(env, body) {
  const userId = String(body.userId || '');
  const pass = String(body.password || '');
  const user = await getUser(env, userId);
  if (!user) return json(404, { error: 'Пользователь не найден' });
  const h = await hashPassword(pass, user.salt || '');
  if (h !== user.passHash) return json(401, { error: 'Неверный пароль' });

  const reqs = await env.KV.list({ prefix: 'req:' });
  for (const { name } of reqs.keys) {
    const parts = name.split(':');
    if (parts.length >= 3 && (parts[1] === userId || parts[2] === userId)) {
      await env.KV.delete(name);
    }
  }

  const raw = await env.KV.get('userchats:' + userId);
  const chatIds = raw ? JSON.parse(raw) : [];
  for (const chatId of chatIds) {
    const rawChat = await env.KV.get('chat:' + chatId);
    if (!rawChat) continue;
    const chat = JSON.parse(rawChat);
    const otherId = chat.a === userId ? chat.b : chat.a;
    await removeUserChat(env, otherId, chatId);
    await env.KV.delete('chat:' + chatId);
    try {
      const stub = env.HUB.get(env.HUB.idFromName('global'));
      await stub.fetch('https://hub/delete-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId }),
      });
    } catch (e) {}
    const media = await env.KV.list({ prefix: 'media/' + chatId + '/' });
    for (const { name } of media.keys) await env.KV.delete(name);
    if (otherId) await notifyUser(env, otherId, { type: 'chat-deleted', chatId });
  }

  await env.KV.delete('userchats:' + userId);
  await env.KV.delete('nick:' + user.nick.toLowerCase());
  await env.KV.delete('user:' + userId);
  return json(200, { ok: true });
}

// ---------- requests & chats ----------

async function notifyUser(env, userId, payload) {
  try {
    const stub = env.HUB.get(env.HUB.idFromName('global'));
    await stub.fetch('https://hub/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, payload }),
    });
  } catch (e) {}
}

async function notifyUserUpdated(env, user) {
  const raw = await env.KV.get('userchats:' + user.id);
  const chatIds = raw ? JSON.parse(raw) : [];
  const pu = publicUser(user);
  for (const chatId of chatIds) {
    const rawChat = await env.KV.get('chat:' + chatId);
    if (!rawChat) continue;
    const chat = JSON.parse(rawChat);
    const otherId = chat.a === user.id ? chat.b : chat.a;
    await notifyUser(env, otherId, { type: 'user-updated', user: pu });
  }
}

async function addUserChat(env, userId, chatId) {
  const key = 'userchats:' + userId;
  let list = [];
  const raw = await env.KV.get(key);
  if (raw) list = JSON.parse(raw);
  if (!list.includes(chatId)) {
    list.push(chatId);
    await env.KV.put(key, JSON.stringify(list));
  }
}

async function removeUserChat(env, userId, chatId) {
  const key = 'userchats:' + userId;
  const raw = await env.KV.get(key);
  if (!raw) return;
  const list = JSON.parse(raw).filter((c) => c !== chatId);
  await env.KV.put(key, JSON.stringify(list));
}

async function apiSendRequest(env, body) {
  const from = String(body.fromId || '');
  const to = String(body.toId || '').trim();
  if (!to || !from) return json(400, { error: 'Введи ID пользователя' });
  if (from === to) return json(400, { error: 'Нельзя добавить себя' });
  const toUser = await getUser(env, to);
  if (!toUser) return json(404, { error: 'Пользователь с таким ID не найден' });
  const chatId = chatIdForPair(from, to);
  if (await env.KV.get('chat:' + chatId)) return json(409, { error: 'Чат с этим пользователем уже есть' });
  if (await env.KV.get('req:' + from + ':' + to)) return json(409, { error: 'Заявка уже отправлена' });
  const req = { from, to, createdAt: Date.now() };
  await env.KV.put('req:' + from + ':' + to, JSON.stringify(req));
  const fromUser = await getUser(env, from);
  await notifyUser(env, to, { type: 'request', request: { from, fromUser: publicUser(fromUser), createdAt: req.createdAt } });
  return json(200, { ok: true });
}

async function apiListRequests(env, userId) {
  if (!userId) return json(400, { error: 'Нет userId' });
  const res = await env.KV.list({ prefix: 'req:' });
  const requests = [];
  for (const { name } of res.keys) {
    if (!name.endsWith(':' + userId)) continue;
    const raw = await env.KV.get(name);
    if (!raw) continue;
    const req = JSON.parse(raw);
    const fromUser = await getUser(env, req.from);
    requests.push({ from: req.from, createdAt: req.createdAt, fromUser: fromUser ? publicUser(fromUser) : null });
  }
  requests.sort((x, y) => y.createdAt - x.createdAt);
  return json(200, { requests });
}

async function apiAcceptRequest(env, body) {
  const userId = String(body.userId || '');
  const from = String(body.from || '');
  const to = userId;
  const reqRaw = await env.KV.get('req:' + from + ':' + to);
  if (!reqRaw) return json(404, { error: 'Заявка не найдена' });
  await env.KV.delete('req:' + from + ':' + to);
  const chatId = chatIdForPair(from, to);
  let chat = null;
  const rawChat = await env.KV.get('chat:' + chatId);
  if (rawChat) chat = JSON.parse(rawChat);
  if (!chat) {
    chat = { id: chatId, a: from, b: to, createdAt: Date.now() };
    await env.KV.put('chat:' + chatId, JSON.stringify(chat));
    await addUserChat(env, from, chatId);
    await addUserChat(env, to, chatId);
  }
  const fromUser = await getUser(env, from);
  const toUser = await getUser(env, to);
  const chatForFrom = { id: chatId, other: publicUser(toUser), last: null };
  const chatForTo = { id: chatId, other: publicUser(fromUser), last: null };
  await notifyUser(env, from, { type: 'chat-created', chat: chatForFrom });
  await notifyUser(env, to, { type: 'chat-created', chat: chatForTo });
  return json(200, { chat: chatForTo });
}

async function apiDeclineRequest(env, body) {
  const userId = String(body.userId || '');
  const from = String(body.from || '');
  await env.KV.delete('req:' + from + ':' + userId);
  return json(200, { ok: true });
}

async function hubLast(env, chatId) {
  try {
    const stub = env.HUB.get(env.HUB.idFromName('global'));
    const res = await stub.fetch('https://hub/last?chatId=' + encodeURIComponent(chatId));
    const data = await res.json();
    return data.last || null;
  } catch (e) {
    return null;
  }
}

async function apiChats(env, userId) {
  if (!userId) return json(400, { error: 'Нет userId' });
  const raw = await env.KV.get('userchats:' + userId);
  const chatIds = raw ? JSON.parse(raw) : [];
  const chats = [];
  for (const chatId of chatIds) {
    const rawChat = await env.KV.get('chat:' + chatId);
    if (!rawChat) continue;
    const chat = JSON.parse(rawChat);
    const otherId = chat.a === userId ? chat.b : chat.a;
    const other = (await getUser(env, otherId)) || { id: otherId, nick: 'Удалён', avatar: '' };
    const last = await hubLast(env, chatId);
    chats.push({ id: chat.id, other: publicUser(other), last });
  }
  chats.sort((x, y) => (y.last ? y.last.ts : 0) - (x.last ? x.last.ts : 0));
  return json(200, { chats });
}

async function apiDeleteChat(env, body) {
  const userId = String(body.userId || '');
  const chatId = String(body.chatId || '');
  const rawChat = await env.KV.get('chat:' + chatId);
  if (!rawChat) return json(404, { error: 'Чат не найден' });
  const chat = JSON.parse(rawChat);
  if (chat.a !== userId && chat.b !== userId) return json(403, { error: 'Нет доступа' });
  await removeUserChat(env, chat.a, chatId);
  await removeUserChat(env, chat.b, chatId);
  await env.KV.delete('chat:' + chatId);
  try {
    const stub = env.HUB.get(env.HUB.idFromName('global'));
    await stub.fetch('https://hub/delete-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId }),
    });
  } catch (e) {}
  const otherId = chat.a === userId ? chat.b : chat.a;
  await notifyUser(env, otherId, { type: 'chat-deleted', chatId });
  return json(200, { ok: true });
}

// ---------- media ----------

async function apiUpload(env, request) {
  let form;
  try { form = await request.formData(); } catch (e) { return json(400, { error: 'bad form' }); }
  const userId = String(form.get('userId') || '');
  const chatId = String(form.get('chatId') || '');
  const type = String(form.get('type') || 'file');
  const file = form.get('file');
  if (!file) return json(400, { error: 'Нет файла' });
  const rawChat = await env.KV.get('chat:' + chatId);
  if (!rawChat) return json(404, { error: 'Чат не найден' });
  const chat = JSON.parse(rawChat);
  if (chat.a !== userId && chat.b !== userId) return json(403, { error: 'Нет доступа' });
  const buf = await file.arrayBuffer();
  if (buf.byteLength > 12 * 1024 * 1024) return json(413, { error: 'Файл больше 12 МБ' });
  const name = String(file.name || '');
  const ext = (name.split('.').pop() || (type === 'voice' ? 'webm' : 'bin')).toLowerCase();
  const key = 'media/' + chatId + '/' + randomHex(8) + '.' + ext;
  await env.KV.put(key, buf);
  return json(200, { key });
}

async function apiMedia(env, request, path) {
  const key = decodeURIComponent(path.slice('/media/'.length));
  const userId = new URL(request.url).searchParams.get('userId');
  const parts = key.split('/');
  if (parts.length < 3 || !userId) return new Response('not found', { status: 404 });
  const chatId = parts[1];
  const rawChat = await env.KV.get('chat:' + chatId);
  if (!rawChat) return new Response('not found', { status: 404 });
  const chat = JSON.parse(rawChat);
  if (chat.a !== userId && chat.b !== userId) return new Response('forbidden', { status: 403 });
  const obj = await env.KV.get(key, 'arrayBuffer');
  if (obj === null) return new Response('not found', { status: 404 });
  const dot = key.lastIndexOf('.');
  const ext = dot === -1 ? '' : key.slice(dot);
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'private, max-age=86400',
    ...CORS,
  };
  return new Response(obj, { headers });
}

// ---------- hub proxy ----------

async function hubFetch(request, env) {
  const stub = env.HUB.get(env.HUB.idFromName('global'));
  return stub.fetch(request);
}

// ---------- static ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.webm': 'audio/webm',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mov': 'video/quicktime',
  '.bin': 'application/octet-stream',
};

async function serveStatic(env, url) {
  let path = url.pathname;
  if (path === '/') path = '/index.html';
  if (path.startsWith('/')) path = path.slice(1);
  const raw = await env.KV.get('asset:' + path);
  if (raw === null) return new Response('Not found', { status: 404 });
  const dot = path.lastIndexOf('.');
  const ext = dot === -1 ? '' : path.slice(dot);
  return new Response(raw, { headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (path === '/health') return json(200, { ok: true });

    if (path === '/api/register' && method === 'POST') return apiRegister(env, await readBody(request));
    if (path === '/api/login' && method === 'POST') return apiLogin(env, await readBody(request));
    if (path === '/api/me' && method === 'GET') return apiMe(env, url.searchParams.get('userId'));
    if (path === '/api/me/nick' && method === 'POST') return apiChangeNick(env, await readBody(request));
    if (path === '/api/me/avatar' && method === 'POST') return apiChangeAvatar(env, await readBody(request));
    if (path === '/api/me/delete' && method === 'POST') return apiDeleteAccount(env, await readBody(request));
    if (path === '/api/me/dnd' && method === 'POST') return apiSetDnd(env, await readBody(request));

    if (path === '/api/requests' && method === 'POST') return apiSendRequest(env, await readBody(request));
    if (path === '/api/requests' && method === 'GET') return apiListRequests(env, url.searchParams.get('userId'));
    if (path === '/api/requests/accept' && method === 'POST') return apiAcceptRequest(env, await readBody(request));
    if (path === '/api/requests/decline' && method === 'POST') return apiDeclineRequest(env, await readBody(request));

    if (path === '/api/chats' && method === 'GET') return apiChats(env, url.searchParams.get('userId'));
    if (path === '/api/chats/delete' && method === 'POST') return apiDeleteChat(env, await readBody(request));

    if (path === '/api/messages' && method === 'GET') return hubFetch(request, env);
    if (path === '/api/upload' && method === 'POST') return apiUpload(env, request);

    if (path === '/ws') return hubFetch(request, env);

    if (path.startsWith('/media/')) return apiMedia(env, request, path);

    return serveStatic(env, url);
  },
};

export class Hub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = new Map();
    this.dndMap = new Map();
    try {
      state.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS messages (chat_id TEXT NOT NULL, seq INTEGER NOT NULL, from_id TEXT, type TEXT, text TEXT, media_key TEXT, media_type TEXT, ts INTEGER, PRIMARY KEY (chat_id, seq))'
      );
    } catch (e) {}
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') return this.handleWs(request, url);
    if (url.pathname === '/notify' && request.method === 'POST') return this.handleNotify(request);
    if (url.pathname === '/api/messages' && request.method === 'GET') return this.handleHistory(url);
    if (url.pathname === '/last' && request.method === 'GET') return this.handleLast(url);
    if (url.pathname === '/delete-chat' && request.method === 'POST') return this.handleDeleteChat(request);
    if (url.pathname === '/set-dnd' && request.method === 'POST') return this.handleSetDnd(request);
    return new Response('not found', { status: 404 });
  }

  async handleWs(request, url) {
    const userId = url.searchParams.get('userId');
    if (!userId || !(await this.env.KV.get('user:' + userId))) return new Response('invalid', { status: 404 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const existing = this.sockets.get(userId);
    if (existing && existing !== server) {
      try { existing.close(4001, 'replaced'); } catch (e) {}
    }
    this.sockets.set(userId, server);
    server.addEventListener('message', (event) => {
      this.onMessage(userId, event).catch(() => {});
    });
    const cleanup = () => {
      if (this.sockets.get(userId) === server) this.sockets.delete(userId);
    };
    server.addEventListener('close', cleanup);
    server.addEventListener('error', cleanup);
    return new Response(null, { status: 101, webSocket: client });
  }

  async handleNotify(request) {
    let body;
    try { body = await request.json(); } catch (e) { return json(400, { error: 'bad' }); }
    const ws = this.sockets.get(String(body.userId || ''));
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(body.payload));
    return json(200, { ok: true });
  }

  async onMessage(userId, event) {
    let msg;
    try { msg = JSON.parse(event.data); } catch (e) { return; }
    if (msg.type === 'ping') {
      const ws = this.sockets.get(userId);
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
      return;
    }
    if (msg.type === 'msg') {
      await this.storeMessage(userId, msg);
    } else if (msg.type === 'call-offer') {
      const targetId = String(msg.to || '');
      let blocked;
      if (this.dndMap.has(targetId)) {
        blocked = !!this.dndMap.get(targetId);
      } else {
        const rawTarget = await this.env.KV.get('user:' + targetId);
        const targetUser = rawTarget ? JSON.parse(rawTarget) : null;
        blocked = !!(targetUser && targetUser.dnd);
        if (targetUser) this.dndMap.set(targetId, !!targetUser.dnd);
      }
      if (blocked) {
        const caller = this.sockets.get(userId);
        if (caller && caller.readyState === 1) {
          caller.send(JSON.stringify({
            type: 'call-dnd',
            chatId: String(msg.chatId || ''),
            callerName: '',
          }));
        }
        return;
      }
      const target = this.sockets.get(targetId);
      if (target && target.readyState === 1) {
        target.send(JSON.stringify({ type: msg.type, from: userId, chatId: String(msg.chatId || ''), data: msg.data || null }));
      }
    } else if (msg.type === 'call-answer' || msg.type === 'call-ice' ||
               msg.type === 'call-decline' || msg.type === 'call-end' ||
               msg.type === 'call-reneg-offer' || msg.type === 'call-reneg-answer') {
      const target = this.sockets.get(String(msg.to || ''));
      if (target && target.readyState === 1) {
        target.send(JSON.stringify({ type: msg.type, from: userId, chatId: String(msg.chatId || ''), data: msg.data || null }));
      }
    }
  }

  async storeMessage(userId, msg) {
    const chatId = String(msg.chatId || '');
    const rawChat = await this.env.KV.get('chat:' + chatId);
    if (!rawChat) return;
    const chat = JSON.parse(rawChat);
    if (chat.a !== userId && chat.b !== userId) return;
    const m = msg.msg || {};
    const type = String(m.type || 'text');
    const text = String(m.text || '').trim();
    const mediaKey = String(m.mediaKey || '');
    const mediaType = String(m.mediaType || '');
    if (type === 'text' && !text) return;
    if (type !== 'text' && !mediaKey) return;
    const ts = Date.now();
    let seq = 1;
    try {
      const cur = this.state.storage.sql.exec('SELECT COALESCE(MAX(seq),0) AS m FROM messages WHERE chat_id=?', chatId).raw().toArray();
      seq = (cur && cur[0] && cur[0][0] != null) ? Number(cur[0][0]) + 1 : 1;
    } catch (e) {}
    const row = { seq, from: userId, type, text, mediaKey, mediaType, ts };
    try {
      this.state.storage.sql.exec(
        'INSERT INTO messages (chat_id, seq, from_id, type, text, media_key, media_type, ts) VALUES (?,?,?,?,?,?,?,?)',
        chatId, seq, userId, type, text, mediaKey, mediaType, ts
      );
    } catch (e) { return; }
    const otherId = chat.a === userId ? chat.b : chat.a;
    const sender = this.sockets.get(userId);
    if (sender && sender.readyState === 1) {
      sender.send(JSON.stringify({ type: 'msg-ack', chatId, msg: row }));
    }
    const target = this.sockets.get(otherId);
    if (target && target.readyState === 1) {
      target.send(JSON.stringify({ type: 'msg', chatId, msg: row }));
    }
  }

  async handleHistory(url) {
    const userId = url.searchParams.get('userId');
    const chatId = url.searchParams.get('chatId');
    const afterSeq = Number(url.searchParams.get('afterSeq')) || 0;
    const rawChat = await this.env.KV.get('chat:' + chatId);
    if (!rawChat) return json(404, { error: 'Чат не найден' });
    const chat = JSON.parse(rawChat);
    if (chat.a !== userId && chat.b !== userId) return json(403, { error: 'Нет доступа' });
    try {
      const cur = this.state.storage.sql.exec(
        'SELECT seq, from_id, type, text, media_key, media_type, ts FROM messages WHERE chat_id=? AND seq>? ORDER BY seq ASC LIMIT 200',
        chatId, afterSeq
      ).toArray();
      const messages = cur.map((r) => ({
        seq: r.seq, from: r.from_id, type: r.type, text: r.text,
        mediaKey: r.media_key, mediaType: r.media_type, ts: r.ts,
      }));
      return json(200, { messages });
    } catch (e) {
      return json(200, { messages: [] });
    }
  }

  async handleLast(url) {
    const chatId = url.searchParams.get('chatId');
    try {
      const cur = this.state.storage.sql.exec(
        'SELECT seq, from_id, type, text, media_key, media_type, ts FROM messages WHERE chat_id=? ORDER BY seq DESC LIMIT 1',
        chatId
      ).toArray();
      const row = cur[0];
      const last = row
        ? { seq: row.seq, from: row.from_id, type: row.type, text: row.text, mediaKey: row.media_key, mediaType: row.media_type, ts: row.ts }
        : null;
      return json(200, { last });
    } catch (e) {
      return json(200, { last: null });
    }
  }

  async handleDeleteChat(request) {
    let body;
    try { body = await request.json(); } catch (e) { return json(400, {}); }
    try {
      this.state.storage.sql.exec('DELETE FROM messages WHERE chat_id=?', String(body.chatId || ''));
    } catch (e) {}
    return json(200, { ok: true });
  }

  async handleSetDnd(request) {
    let body;
    try { body = await request.json(); } catch (e) { return json(400, {}); }
    this.dndMap.set(String(body.userId || ''), !!body.dnd);
    return json(200, { ok: true });
  }
}
