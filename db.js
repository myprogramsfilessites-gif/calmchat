'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'calmchat.db');
const JSON_PATH = path.join(DATA_DIR, 'db.json');

const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function genId(prefix, n) {
  const bytes = crypto.randomBytes(n);
  let s = prefix;
  for (let i = 0; i < n; i++) s += CHARS[bytes[i] % CHARS.length];
  return s;
}

let mode = 'sqlite';
let db = null;

try {
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      nickname TEXT UNIQUE NOT NULL,
      avatar TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
} catch (e) {
  mode = 'json';
  console.warn('[db] node:sqlite недоступен, используется JSON-хранилище');
}

function loadJSON() {
  try {
    return JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  } catch (e) {
    return { users: [], rooms: [] };
  }
}

function saveJSON(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = JSON_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, JSON_PATH);
}

function sqliteUniqueId(prefix, n, table) {
  for (;;) {
    const id = genId(prefix, n);
    const hit = db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id);
    if (!hit) return id;
  }
}

function jsonUniqueId(prefix, n, list) {
  for (;;) {
    const id = genId(prefix, n);
    if (!list.some((r) => r.id === id)) return id;
  }
}

function toUser(row) {
  if (!row) return null;
  return { id: row.id, nickname: row.nickname, avatar: row.avatar };
}

const store = {
  createUser(nickname, avatar) {
    const createdAt = Date.now();
    if (mode === 'sqlite') {
      const exists = db.prepare('SELECT 1 FROM users WHERE nickname = ?').get(nickname);
      if (exists) return { error: 'taken' };
      const id = sqliteUniqueId('U', 10, 'users');
      db.prepare('INSERT INTO users (id, nickname, avatar, created_at) VALUES (?, ?, ?, ?)')
        .run(id, nickname, avatar, createdAt);
      return { user: { id, nickname, avatar } };
    }
    const data = loadJSON();
    if (data.users.some((u) => u.nickname === nickname)) return { error: 'taken' };
    const id = jsonUniqueId('U', 10, data.users);
    data.users.push({ id, nickname, avatar, created_at: createdAt });
    saveJSON(data);
    return { user: { id, nickname, avatar } };
  },

  findUserById(id) {
    if (mode === 'sqlite') {
      return toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
    }
    const row = loadJSON().users.find((u) => u.id === id);
    return row ? { id: row.id, nickname: row.nickname, avatar: row.avatar } : null;
  },

  findUserByNickname(nickname) {
    if (mode === 'sqlite') {
      return toUser(db.prepare('SELECT * FROM users WHERE nickname = ?').get(nickname));
    }
    const row = loadJSON().users.find((u) => u.nickname === nickname);
    return row ? { id: row.id, nickname: row.nickname, avatar: row.avatar } : null;
  },

  createRoom(ownerId) {
    const createdAt = Date.now();
    if (mode === 'sqlite') {
      const id = sqliteUniqueId('C', 8, 'rooms');
      db.prepare('INSERT INTO rooms (id, owner_id, created_at) VALUES (?, ?, ?)')
        .run(id, ownerId, createdAt);
      return { id, owner_id: ownerId, created_at: createdAt };
    }
    const data = loadJSON();
    const id = jsonUniqueId('C', 8, data.rooms);
    data.rooms.push({ id, owner_id: ownerId, created_at: createdAt });
    saveJSON(data);
    return { id, owner_id: ownerId, created_at: createdAt };
  },

  findRoom(id) {
    if (mode === 'sqlite') {
      const row = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
      return row || null;
    }
    return loadJSON().rooms.find((r) => r.id === id) || null;
  },
};

module.exports = store;
