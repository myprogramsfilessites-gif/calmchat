'use strict';

window.APP_CONFIG = window.APP_CONFIG || {};
const API_BASE = window.APP_CONFIG.apiUrl || '';
const WS_BASE = window.APP_CONFIG.signalingUrl ||
  (location.protocol.replace('http', 'ws') + '//' + location.host);

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(API_BASE + path, opts);
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error((data && data.error) || 'Ошибка ' + res.status);
  return data;
}

async function apiUpload(formData) {
  const res = await fetch(API_BASE + '/api/upload', { method: 'POST', body: formData });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error((data && data.error) || 'Ошибка загрузки ' + res.status);
  return data;
}

function mediaUrl(key, userId) {
  return API_BASE + '/media/' + encodeURIComponent(key) + '?userId=' + encodeURIComponent(userId);
}
