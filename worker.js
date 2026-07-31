'use strict';

const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function genId(prefix, n) {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  let s = prefix;
  for (let i = 0; i < n; i++) s += CHARS[arr[i] % CHARS.length];
  return s;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

async function makeUserId(env) {
  for (let i = 0; i < 8; i++) {
    const id = genId('U', 10);
    if (!(await env.KV.get('user:' + id))) return id;
  }
  return genId('U', 12);
}

async function makeRoomId(env) {
  for (let i = 0; i < 8; i++) {
    const id = genId('C', 8);
    if (!(await env.KV.get('room:' + id))) return id;
  }
  return genId('C', 10);
}

async function apiRegister(env, body) {
  const nickname = String(body.nickname || '').trim();
  if (!nickname) return json(400, { error: 'Введи ник' });
  if (nickname.length > 20) return json(400, { error: 'Ник слишком длинный' });
  if (await env.KV.get('nick:' + nickname)) return json(409, { error: 'Этот ник уже занят' });
  const avatar = body.avatar || null;
  const id = await makeUserId(env);
  const user = { id, nickname, avatar };
  await env.KV.put('user:' + id, JSON.stringify(user));
  await env.KV.put('nick:' + nickname, id);
  return json(200, { user });
}

async function apiGetUser(env, id) {
  const raw = await env.KV.get('user:' + id);
  if (!raw) return json(404, { error: 'not found' });
  return json(200, { user: JSON.parse(raw) });
}

async function apiCreateRoom(env, body) {
  const raw = await env.KV.get('user:' + String(body.userId || ''));
  if (!raw) return json(404, { error: 'Пользователь не найден' });
  const user = JSON.parse(raw);
  const id = await makeRoomId(env);
  const room = { id, owner_id: user.id, created_at: Date.now() };
  await env.KV.put('room:' + id, JSON.stringify(room));
  return json(200, { room });
}

async function apiRoomExists(env, body) {
  const roomId = String(body.roomId || '').trim();
  if (!roomId) return json(400, { error: 'Введи код комнаты' });
  const room = await env.KV.get('room:' + roomId);
  return json(200, { exists: !!room });
}

async function apiJoinRoom(env, body) {
  const roomId = String(body.roomId || '').trim();
  const user = await env.KV.get('user:' + String(body.userId || ''));
  if (!user) return json(404, { error: 'Пользователь не найден' });
  if (!roomId) return json(400, { error: 'Введи код комнаты' });
  const room = await env.KV.get('room:' + roomId);
  if (!room) return json(404, { error: 'Комната с таким кодом не найдена' });
  return json(200, { room: JSON.parse(room) });
}

async function wsHandler(request, env) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');
  const roomId = url.searchParams.get('roomId');
  if (!userId || !roomId) return new Response('bad request', { status: 400 });
  const [u, r] = await Promise.all([env.KV.get('user:' + userId), env.KV.get('room:' + roomId)]);
  if (!u || !r) return new Response('invalid session', { status: 404 });
  const id = env.ROOMS.idFromName(roomId);
  const stub = env.ROOMS.get(id);
  return stub.fetch(request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (path === '/health') return json(200, { ok: true });

    if (path === '/api/register' && method === 'POST') return apiRegister(env, await readBody(request));

    const userMatch = path.match(/^\/api\/users\/([^/]+)$/);
    if (userMatch && method === 'GET') return apiGetUser(env, userMatch[1]);

    if (path === '/api/room/create' && method === 'POST') return apiCreateRoom(env, await readBody(request));
    if (path === '/api/room/exists' && method === 'POST') return apiRoomExists(env, await readBody(request));
    if (path === '/api/room/join' && method === 'POST') return apiJoinRoom(env, await readBody(request));

    if (path === '/ws') return wsHandler(request, env);

    return env.ASSETS.fetch(request);
  },
};

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.members = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');

    const rawUser = await this.env.KV.get('user:' + userId);
    if (!rawUser) return new Response('invalid', { status: 404 });
    const user = JSON.parse(rawUser);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const self = { ws: server, muted: false, deaf: false, nickname: user.nickname, avatar: user.avatar };
    this.members.set(userId, self);

    const peers = [];
    for (const [id, m] of this.members) {
      if (id === userId) continue;
      peers.push({ userId: id, nickname: m.nickname, avatar: m.avatar, muted: m.muted, deaf: m.deaf });
    }

    server.send(JSON.stringify({ type: 'joined', peers }));

    this.broadcast(userId, {
      type: 'peer-joined',
      peer: { userId, nickname: user.nickname, avatar: user.avatar, muted: false, deaf: false },
    });

    server.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      if (msg.type === 'signal') {
        const target = this.members.get(msg.to);
        if (target && target.ws.readyState === 1) {
          target.ws.send(JSON.stringify({ type: 'signal', from: userId, data: msg.data }));
        }
      } else if (msg.type === 'mute') {
        self.muted = !!msg.muted;
        this.broadcast(userId, { type: 'peer-mute', userId, muted: self.muted });
      } else if (msg.type === 'deaf') {
        self.deaf = !!msg.deaf;
        this.broadcast(userId, { type: 'peer-deaf', userId, deaf: self.deaf });
      }
    });

    server.addEventListener('close', () => {
      this.members.delete(userId);
      this.broadcast(userId, { type: 'peer-left', userId });
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(exceptUserId, msg) {
    const data = JSON.stringify(msg);
    for (const [id, m] of this.members) {
      if (id !== exceptUserId && m.ws.readyState === 1) m.ws.send(data);
    }
  }
}
