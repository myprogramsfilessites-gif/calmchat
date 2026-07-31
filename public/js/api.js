'use strict';

function apiBase() {
  return (window.APP_CONFIG && window.APP_CONFIG.apiUrl) || '';
}

async function apiPost(path, body) {
  const res = await fetch(apiBase() + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}

async function apiGet(path) {
  const res = await fetch(apiBase() + path);
  return res.json();
}

function serverErrorText() {
  return 'Сервер недоступен. Если сервис только что запустили — подожди 30–60 секунд и попробуй снова.';
}
