'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const db = require('./db');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/api/register', (req, res) => {
  const nickname = String(req.body.nickname || '').trim();
  const avatar = req.body.avatar || null;
  if (!nickname) return res.status(400).json({ error: 'Введи ник' });
  if (nickname.length > 20) return res.status(400).json({ error: 'Ник слишком длинный' });
  const result = db.createUser(nickname, avatar);
  if (result.error === 'taken') return res.status(409).json({ error: 'Этот ник уже занят' });
  res.json({ user: result.user });
});

app.get('/api/users/:id', (req, res) => {
  const user = db.findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'not found' });
  res.json({ user });
});

app.post('/api/room/create', (req, res) => {
  const user = db.findUserById(String(req.body.userId || ''));
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  const room = db.createRoom(user.id);
  res.json({ room });
});

app.post('/api/room/exists', (req, res) => {
  const roomId = String(req.body.roomId || '').trim();
  if (!roomId) return res.status(400).json({ error: 'Введи код комнаты' });
  res.json({ exists: !!db.findRoom(roomId) });
});

app.post('/api/room/join', (req, res) => {
  const roomId = String(req.body.roomId || '').trim();
  const user = db.findUserById(String(req.body.userId || ''));
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (!roomId) return res.status(400).json({ error: 'Введи код комнаты' });
  const room = db.findRoom(roomId);
  if (!room) return res.status(404).json({ error: 'Комната с таким кодом не найдена' });
  res.json({ room });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const activeRooms = new Map();

function broadcast(members, exceptUserId, msg) {
  const data = JSON.stringify(msg);
  for (const [id, m] of members) {
    if (id !== exceptUserId && m.ws.readyState === 1) m.ws.send(data);
  }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const userId = url.searchParams.get('userId');
  const roomId = url.searchParams.get('roomId');

  const user = db.findUserById(String(userId || ''));
  const room = db.findRoom(String(roomId || ''));
  if (!user || !room) {
    ws.close(4001, 'invalid session');
    return;
  }

  let members = activeRooms.get(room.id);
  if (!members) {
    members = new Map();
    activeRooms.set(room.id, members);
  }

  const self = { ws, user, muted: false, deaf: false };
  members.set(user.id, self);

  const peers = [...members.entries()]
    .filter(([id]) => id !== user.id)
    .map(([id, m]) => ({
      userId: id,
      nickname: m.user.nickname,
      avatar: m.user.avatar,
      muted: m.muted,
      deaf: m.deaf,
    }));

  ws.send(JSON.stringify({ type: 'joined', peers }));

  broadcast(members, user.id, {
    type: 'peer-joined',
    peer: { userId: user.id, nickname: user.nickname, avatar: user.avatar, muted: false, deaf: false },
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    switch (msg.type) {
      case 'signal': {
        const target = members.get(String(msg.to || ''));
        if (target && target.ws.readyState === 1) {
          target.ws.send(JSON.stringify({ type: 'signal', from: user.id, data: msg.data }));
        }
        break;
      }
      case 'mute':
        self.muted = !!msg.muted;
        broadcast(members, user.id, { type: 'peer-mute', userId: user.id, muted: self.muted });
        break;
      case 'deaf':
        self.deaf = !!msg.deaf;
        broadcast(members, user.id, { type: 'peer-deaf', userId: user.id, deaf: self.deaf });
        break;
    }
  });

  ws.on('close', () => {
    members.delete(user.id);
    broadcast(members, user.id, { type: 'peer-left', userId: user.id });
    if (members.size === 0) activeRooms.delete(room.id);
  });
});

server.listen(PORT, () => {
  console.log(`CalmChat server on http://localhost:${PORT}`);
});
