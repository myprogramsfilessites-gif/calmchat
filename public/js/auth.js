'use strict';

const AUTH_KEY = 'calmchat-user';

function saveSession(user) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(user));
}

function loadSession() {
  try {
    const s = localStorage.getItem(AUTH_KEY);
    if (!s) return null;
    const u = JSON.parse(s);
    if (!u || !u.id || !u.nick) return null;
    return u;
  } catch (e) {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(AUTH_KEY);
}

function requireSession() {
  const user = loadSession();
  if (!user) {
    location.replace('index.html');
    return null;
  }
  return user;
}
