'use strict';

const AUTH_KEY = 'calmchat-user';
const ROOM_KEY = 'calmchat-room';

function saveSession(user) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(user));
}

function loadSession() {
  try {
    const s = localStorage.getItem(AUTH_KEY);
    if (!s) return null;
    const u = JSON.parse(s);
    if (!u || !u.id || !u.nickname) return null;
    return u;
  } catch (e) {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem(ROOM_KEY);
}

function requireSession() {
  const user = loadSession();
  if (!user) {
    location.replace('index.html');
    return null;
  }
  return user;
}
