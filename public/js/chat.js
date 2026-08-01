'use strict';

(function () {
  const user = requireSession();
  if (!user) return;

  const $ = (id) => document.getElementById(id);
  const state = {
    chats: [],
    activeChatId: null,
    activeOther: null,
    socket: null,
    reconnectAttempts: 0,
    leaving: false,
    lastPong: 0,
    pendingEls: [],
  };

  // ---------- WS ----------

  function wsUrl() {
    return WS_BASE + '/ws?userId=' + encodeURIComponent(user.id);
  }

  function connectSocket() {
    state.socket = new WebSocket(wsUrl());
    state.socket.onopen = () => { state.reconnectAttempts = 0; };
    state.socket.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'pong') state.lastPong = Date.now();
      handleWsMessage(msg);
    };
    state.socket.onclose = () => {
      if (!state.leaving && state.reconnectAttempts < 30) {
        state.reconnectAttempts++;
        setTimeout(connectSocket, 3000);
      }
    };
  }

  function startHeartbeat() {
    setInterval(() => {
      if (!state.socket) return;
      if (state.socket.readyState === 1) {
        if (state.lastPong && Date.now() - state.lastPong > 30000) {
          try { state.socket.close(); } catch (e) {}
          return;
        }
        state.lastPong = Date.now();
        try { state.socket.send(JSON.stringify({ type: 'ping' })); } catch (e) {}
      }
    }, 15000);
  }

  function wsSend(obj) {
    if (state.socket && state.socket.readyState === 1) {
      state.socket.send(JSON.stringify(obj));
    }
  }

  function handleWsMessage(msg) {
    if (msg.type === 'msg') {
      receiveMessage(msg.chatId, msg.msg);
    } else if (msg.type === 'msg-ack') {
      ackMessage(msg.chatId, msg.msg);
    } else if (msg.type === 'request') {
      toast('Новый запрос от ' + ((msg.request && msg.request.fromUser && msg.request.fromUser.nick) || 'пользователя'));
      refreshRequestsBadge();
      if (!$('requests-modal').hidden) renderRequests();
    } else if (msg.type === 'user-updated') {
      const u = msg.user || {};
      if (!u.id) return;
      state.chats.forEach((c) => {
        if (c.other && c.other.id === u.id) { c.other.nick = u.nick; c.other.avatar = u.avatar; }
      });
      renderChatList();
      if (state.activeOther && state.activeOther.id === u.id) {
        state.activeOther.nick = u.nick;
        state.activeOther.avatar = u.avatar;
        renderAvatar($('chat-avatar'), state.activeOther);
        $('chat-nick').textContent = u.nick;
      }
    } else if (msg.type === 'chat-created') {
      const ch = msg.chat || {};
      toast('Новый чат: ' + ((ch.other && ch.other.nick) || ''));
      if (ch.id && !state.chats.find((x) => x.id === ch.id)) {
        state.chats.unshift({ id: ch.id, other: ch.other || { id: '', nick: '' }, last: null });
      }
      renderChatList();
    } else if (msg.type === 'chat-deleted') {
      if (state.activeChatId === msg.chatId) {
        state.activeChatId = null;
        state.activeOther = null;
        showChatPlaceholder();
      }
      state.chats = state.chats.filter((x) => x.id !== msg.chatId);
      renderChatList();
    } else if (msg.type === 'call-dnd') {
      const name = msg.callerName || (state.activeOther && state.activeOther.nick) || '';
      toast(name ? 'У «' + name + '» включён режим «Не беспокоить»' : 'Пользователь не может принять звонок');
      Call.dnd();
    } else if (msg.type === 'call-offer' || msg.type === 'call-answer' || msg.type === 'call-ice' ||
               msg.type === 'call-decline' || msg.type === 'call-end' ||
               msg.type === 'call-reneg-offer' || msg.type === 'call-reneg-answer') {
      Call.handleMessage(msg);
    }
  }

  // ---------- profile ----------

  function renderProfile() {
    renderAvatar($('profile-avatar'), user);
    $('profile-nick').textContent = user.nick;
    $('profile-id').textContent = user.id;
    renderAvatar($('profile-modal-avatar'), user);
    $('profile-modal-id').textContent = user.id;
  }

  // ---------- chats list ----------

  async function refreshChats() {
    try {
      const data = await api('GET', '/api/chats?userId=' + encodeURIComponent(user.id));
      state.chats = data.chats || [];
      renderChatList();
    } catch (e) {}
  }

  function previewText(m) {
    if (!m) return '';
    if (m.type === 'photo') return 'Фото';
    if (m.type === 'video') return 'Видео';
    if (m.type === 'voice') return 'Голосовое сообщение';
    return m.text || '';
  }

  function renderChatList() {
    const q = $('chat-search').value.trim().toLowerCase();
    const list = state.chats.filter((c) => (c.other.nick || '').toLowerCase().includes(q));
    const wrap = $('chat-list');
    wrap.innerHTML = '';
    $('chat-list-empty').hidden = list.length !== 0;
    list.forEach((c) => {
      const item = document.createElement('div');
      item.className = 'chat-item' + (c.id === state.activeChatId ? ' active' : '');
      item.dataset.chatId = c.id;

      const av = document.createElement('div');
      av.className = 'avatar';
      renderAvatar(av, c.other);

      const info = document.createElement('div');
      info.className = 'chat-item-info';
      const name = document.createElement('div');
      name.className = 'chat-item-name';
      name.textContent = c.other.nick;
      const prev = document.createElement('div');
      prev.className = 'chat-item-prev';
      prev.textContent = c.last ? (c.last.from === user.id ? 'Вы: ' : '') + previewText(c.last) : '';
      info.appendChild(name);
      info.appendChild(prev);

      const time = document.createElement('div');
      time.className = 'chat-item-time';
      time.textContent = c.last ? timeText(c.last.ts) : '';
      time.title = new Date(c.last ? c.last.ts : Date.now()).toLocaleString('ru-RU');

      item.appendChild(av);
      item.appendChild(info);
      item.appendChild(time);
      attachLongPress(item, c);
      item.addEventListener('click', () => selectChat(c.id));
      wrap.appendChild(item);
    });
  }

  function attachLongPress(item, c) {
    let timer = null;
    const start = () => {
      timer = setTimeout(() => {
        showChatContext(c, item);
      }, 600);
    };
    const cancel = () => clearTimeout(timer);
    item.addEventListener('touchstart', start, { passive: true });
    item.addEventListener('touchend', cancel);
    item.addEventListener('touchmove', cancel);
    item.addEventListener('mousedown', start);
    item.addEventListener('mouseup', cancel);
    item.addEventListener('mouseleave', cancel);
  }

  function showChatContext(c, item) {
    document.querySelectorAll('.chat-item.context').forEach((el) => el.classList.remove('context'));
    item.classList.add('context');
    const prev = item.querySelector('.chat-item-prev');
    let menu = item.querySelector('.chat-context');
    if (menu) { menu.remove(); return; }
    menu = document.createElement('div');
    menu.className = 'chat-context';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn danger small';
    del.textContent = 'Удалить чат';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      menu.remove();
      item.classList.remove('context');
      if (!confirm('Удалить чат у обоих вместе с перепиской?')) return;
      try {
        await api('POST', '/api/chats/delete', { userId: user.id, chatId: c.id });
        if (state.activeChatId === c.id) {
          state.activeChatId = null;
          state.activeOther = null;
          showChatPlaceholder();
        }
        refreshChats();
      } catch (err) { toast(err.message); }
    });
    menu.appendChild(del);
    item.appendChild(menu);
  }

  // ---------- chat view ----------

  async function selectChat(chatId) {
    state.activeChatId = chatId;
    const c = state.chats.find((x) => x.id === chatId);
    state.activeOther = c ? c.other : null;
    if (!c) return;
    renderChatList();
    showChatPanel(c.other);
    await loadHistory(chatId);
    scrollToBottom();
  }

  function showChatPanel(other) {
    $('chat-placeholder').hidden = true;
    $('chat-panel').hidden = false;
    document.querySelector('.app').classList.add('chat-open');
    renderAvatar($('chat-avatar'), other);
    $('chat-nick').textContent = other.nick;
    $('chat-sub').textContent = 'ID: ' + other.id;
  }

  function showChatPlaceholder() {
    $('chat-panel').hidden = true;
    $('chat-placeholder').hidden = false;
    document.querySelector('.app').classList.remove('chat-open');
    $('messages').innerHTML = '';
  }

  async function loadHistory(chatId, afterSeq) {
    try {
      const data = await api('GET', '/api/messages?userId=' + encodeURIComponent(user.id) +
        '&chatId=' + encodeURIComponent(chatId) + '&afterSeq=' + (afterSeq || 0));
      const wrap = $('messages');
      (data.messages || []).forEach((m) => {
        if (!document.querySelector('[data-seq="' + m.seq + '"]')) appendMessage(m, false);
      });
    } catch (e) {}
  }

  function appendMessage(m, scroll) {
    const wrap = $('messages');
    const el = renderMessage(m);
    wrap.appendChild(el);
    if (scroll) scrollToBottom();
  }

  function renderMessage(m) {
    const self = m.from === user.id;
    const wrap = document.createElement('div');
    wrap.className = 'msg' + (self ? ' self' : '');
    wrap.dataset.seq = m.seq !== undefined ? m.seq : '';

    if (m.type === 'photo') {
      const img = document.createElement('img');
      img.className = 'msg-media';
      img.loading = 'lazy';
      img.src = mediaUrl(m.mediaKey, user.id);
      img.addEventListener('click', () => window.open(img.src, '_blank'));
      wrap.appendChild(img);
    } else if (m.type === 'video') {
      const video = document.createElement('video');
      video.className = 'msg-media';
      video.controls = true;
      video.preload = 'metadata';
      video.src = mediaUrl(m.mediaKey, user.id);
      wrap.appendChild(video);
    } else if (m.type === 'voice') {
      const voice = document.createElement('div');
      voice.className = 'voice';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'voice-play';
      btn.textContent = '▶';
      const time = document.createElement('span');
      time.className = 'voice-time';
      time.textContent = '0:00';
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.src = mediaUrl(m.mediaKey, user.id);
      const fmt = (s) => {
        s = Math.max(0, Math.round(s || 0));
        return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
      };
      audio.addEventListener('loadedmetadata', () => { time.textContent = fmt(audio.duration); });
      audio.addEventListener('timeupdate', () => {
        time.textContent = fmt(audio.currentTime) + ' / ' + fmt(audio.duration);
      });
      btn.addEventListener('click', () => {
        if (audio.paused) { audio.play().catch(() => {}); btn.textContent = '⏸'; }
        else { audio.pause(); btn.textContent = '▶'; }
      });
      audio.addEventListener('ended', () => { btn.textContent = '▶'; time.textContent = fmt(audio.duration); });
      voice.appendChild(btn);
      voice.appendChild(time);
      wrap.appendChild(voice);
    } else {
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = m.text || '';
      wrap.appendChild(bubble);
    }

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.textContent = timeText(m.ts);
    wrap.appendChild(meta);
    return wrap;
  }

  // ---------- sending ----------

  async function sendMessage(m) {
    const msg = { type: m.type || 'text', text: m.text || '', mediaKey: m.mediaKey || '', mediaType: m.mediaType || '' };
    const tempSeq = -(state.pendingEls.length + 1);
    const el = renderMessage(Object.assign({ seq: tempSeq, from: user.id, ts: Date.now() }, msg));
    $('messages').appendChild(el);
    state.pendingEls.push(el);
    scrollToBottom();
    wsSend({ type: 'msg', chatId: state.activeChatId, msg });
    updateLastPreview();
  }

  function ackMessage(chatId, m) {
    const el = state.pendingEls.shift();
    if (el) el.dataset.seq = m.seq;
    updateLastPreview();
  }

  function updateLastPreview() {
    const c = state.chats.find((x) => x.id === state.activeChatId);
    if (c) refreshChats();
  }

  function receiveMessage(chatId, m) {
    if (chatId === state.activeChatId) {
      if (!document.querySelector('[data-seq="' + m.seq + '"]')) appendMessage(m, true);
    }
    const c = state.chats.find((x) => x.id === chatId);
    if (c) c.last = m;
    renderChatList();
  }

  function scrollToBottom() {
    const wrap = $('messages');
    wrap.scrollTop = wrap.scrollHeight;
  }

  function timeText(ts) {
    const d = new Date(ts || Date.now());
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  // ---------- composer ----------

  function sendText() {
    const input = $('msg-input');
    const text = input.value.trim();
    if (!text || !state.activeChatId) return;
    sendMessage({ type: 'text', text });
    input.value = '';
  }

  async function handleFile(file) {
    if (!state.activeChatId) return;
    const type = file.type && file.type.startsWith('video/') ? 'video' : 'photo';
    try {
      toast('Загружаю…');
      const fd = new FormData();
      fd.append('userId', user.id);
      fd.append('chatId', state.activeChatId);
      fd.append('type', type);
      fd.append('file', file, file.name || ('file.' + (type === 'video' ? 'mp4' : 'jpg')));
      const data = await apiUpload(fd);
      sendMessage({ type, mediaKey: data.key, mediaType: file.type || '' });
    } catch (err) { toast(err.message); }
  }

  // voice recording
  let recorder = null;
  let recChunks = [];
  let recStream = null;

  async function toggleRecord() {
    if (recorder) {
      recorder.stop();
      return;
    }
    try {
      recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recChunks = [];
      recorder = new MediaRecorder(recStream);
      recorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
      recorder.onstop = async () => {
        recorder = null;
        if (recStream) { recStream.getTracks().forEach((t) => t.stop()); recStream = null; }
        $('rec-indicator').hidden = true;
        $('record-btn').classList.remove('recording');
        const blob = new Blob(recChunks, { type: 'audio/webm' });
        if (blob.size < 1000) { toast('Слишком коротко'); return; }
        if (!state.activeChatId) return;
        try {
          const fd = new FormData();
          fd.append('userId', user.id);
          fd.append('chatId', state.activeChatId);
          fd.append('type', 'voice');
          fd.append('file', blob, 'voice.webm');
          const data = await apiUpload(fd);
          sendMessage({ type: 'voice', mediaKey: data.key, mediaType: 'audio/webm' });
        } catch (err) { toast(err.message); }
      };
      recorder.start();
      $('rec-indicator').hidden = false;
      $('record-btn').classList.add('recording');
    } catch (e) {
      toast('Нет доступа к микрофону');
    }
  }

  // ---------- modals ----------

  function openModal(id) {
    $(id).hidden = false;
    $('modal-back').hidden = false;
  }

  function closeModal(id) {
    $(id).hidden = true;
    $('modal-back').hidden = true;
    if (id === 'requests-modal') refreshRequestsBadge();
  }

  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  $('modal-back').addEventListener('click', () => {
    ['add-chat-modal', 'requests-modal', 'profile-modal'].forEach(closeModal);
  });

  async function openAddChat() {
    $('add-chat-error').textContent = '';
    $('add-chat-id').value = '';
    openModal('add-chat-modal');
    $('add-chat-id').focus();
  }

  async function sendInvite() {
    const toId = $('add-chat-id').value.trim();
    if (!toId) { $('add-chat-error').textContent = 'Введи ID'; return; }
    try {
      await api('POST', '/api/requests', { fromId: user.id, toId });
      $('add-chat-error').textContent = '';
      toast('Приглашение отправлено');
      closeModal('add-chat-modal');
    } catch (err) { $('add-chat-error').textContent = err.message; }
  }

  async function refreshRequestsBadge() {
    try {
      const data = await api('GET', '/api/requests?userId=' + encodeURIComponent(user.id));
      const count = (data.requests || []).length;
      const badge = $('requests-badge');
      badge.textContent = count ? String(count) : '';
      badge.hidden = !count;
    } catch (e) {}
  }

  async function openRequests() {
    openModal('requests-modal');
    $('req-search').value = '';
    await renderRequests();
  }

  async function renderRequests() {
    const wrap = $('req-list');
    let requests = [];
    try {
      const data = await api('GET', '/api/requests?userId=' + encodeURIComponent(user.id));
      requests = data.requests || [];
    } catch (e) {}
    const q = $('req-search').value.trim().toLowerCase();
    const filtered = requests.filter((r) => {
      const u = r.fromUser || {};
      return !q || String(r.from).toLowerCase().includes(q) || (u.nick || '').toLowerCase().includes(q);
    });
    wrap.innerHTML = '';
    if (!filtered.length) {
      wrap.innerHTML = '<div class="req-empty">Запросов нет</div>';
      return;
    }
    filtered.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'req';
      const av = document.createElement('div');
      av.className = 'avatar';
      renderAvatar(av, r.fromUser || { nick: '?', id: r.from });
      const info = document.createElement('div');
      info.className = 'req-info';
      const name = document.createElement('div');
      name.className = 'chat-item-name';
      name.textContent = (r.fromUser && r.fromUser.nick) || 'Пользователь ' + r.from;
      const sub = document.createElement('div');
      sub.className = 'chat-item-prev';
      sub.textContent = 'ID: ' + r.from;
      info.appendChild(name);
      info.appendChild(sub);
      const btns = document.createElement('div');
      btns.className = 'req-btns';
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'btn primary small';
      ok.textContent = 'Принять';
      ok.addEventListener('click', async () => {
        try {
          await api('POST', '/api/requests/accept', { userId: user.id, from: r.from });
          toast('Чат создан');
          refreshChats();
          renderRequests();
          refreshRequestsBadge();
        } catch (err) { toast(err.message); }
      });
      const no = document.createElement('button');
      no.type = 'button';
      no.className = 'btn ghost small';
      no.textContent = 'Отклонить';
      no.addEventListener('click', async () => {
        try {
          await api('POST', '/api/requests/decline', { userId: user.id, from: r.from });
          renderRequests();
          refreshRequestsBadge();
        } catch (err) { toast(err.message); }
      });
      btns.appendChild(ok);
      btns.appendChild(no);
      row.appendChild(av);
      row.appendChild(info);
      row.appendChild(btns);
      wrap.appendChild(row);
    });
  }

  // profile / settings
  let chosenAvatar = null;
  let delCaptcha = '';

  function makeCaptcha() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function buildAvatarPicker() {
    buildIconGrid($('avatar-picker'), (k) => {
      chosenAvatar = k;
      renderAvatar($('profile-modal-avatar'), { nick: user.nick, avatar: k || user.avatar });
    }, user.avatar);
  }

  function openProfile() {
    $('nick-input').value = user.nick;
    $('nick-error').textContent = '';
    $('del-error').textContent = '';
    $('del-captcha-input').value = '';
    $('del-password-input').value = '';
    chosenAvatar = null;
    buildAvatarPicker();
    delCaptcha = makeCaptcha();
    $('del-captcha').textContent = delCaptcha;
    $('dnd-toggle').setAttribute('aria-pressed', String(!!user.dnd));
    switchSettingsTab('profile');
    openModal('profile-modal');
  }

  async function saveProfile() {
    const nick = $('nick-input').value.trim();
    try {
      if (nick && nick !== user.nick) {
        const d = await api('POST', '/api/me/nick', { userId: user.id, nick });
        user.nick = d.user.nick;
        saveSession(user);
      }
      if (chosenAvatar && chosenAvatar !== user.avatar) {
        const d = await api('POST', '/api/me/avatar', { userId: user.id, avatar: chosenAvatar });
        user.avatar = d.user.avatar;
        saveSession(user);
      }
      renderProfile();
      refreshChats();
      if (state.activeOther) {
        renderAvatar($('chat-avatar'), state.activeOther);
      }
      closeModal('profile-modal');
      toast('Профиль сохранён');
    } catch (err) { $('nick-error').textContent = err.message; }
  }

  function doLogout() {
    state.leaving = true;
    if (state.socket) { try { state.socket.close(); } catch (e) {} }
    clearSession();
    location.replace('index.html');
  }

  function switchSettingsTab(tab) {
    const profile = tab === 'profile';
    const privacy = tab === 'privacy';
    $('tab-profile').classList.toggle('active', profile);
    $('tab-privacy').classList.toggle('active', privacy);
    $('tab-media').classList.toggle('active', tab === 'media');
    $('tab-profile-content').hidden = !profile;
    $('tab-privacy-content').hidden = !privacy;
    $('tab-media-content').hidden = tab !== 'media';
    if (tab === 'media') {
      Call.populateMediaDevices().catch(() => {});
    }
  }

  async function setDnd(value) {
    const toggle = $('dnd-toggle');
    toggle.setAttribute('aria-pressed', String(!!value));
    try {
      const d = await api('POST', '/api/me/dnd', { userId: user.id, dnd: !!value });
      user.dnd = !!d.user.dnd;
      saveSession(user);
    } catch (e) {
      toggle.setAttribute('aria-pressed', String(!value));
      toast(e.message);
    }
  }

  async function deleteAccount() {
    const code = $('del-captcha-input').value.trim().toUpperCase();
    const pass = $('del-password-input').value;
    $('del-error').textContent = '';
    if (code !== delCaptcha) { $('del-error').textContent = 'Код введён неверно'; return; }
    if (!pass) { $('del-error').textContent = 'Введи пароль'; return; }
    if (!confirm('Точно удалить аккаунт навсегда? Все чаты и сообщения будут стёрты.')) return;
    try {
      await api('POST', '/api/me/delete', { userId: user.id, password: pass });
      doLogout();
    } catch (err) { $('del-error').textContent = err.message; }
  }

  // ---------- toast ----------

  function toast(text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }

  // ---------- events ----------

  $('chat-search').addEventListener('input', renderChatList);
  $('add-chat-btn').addEventListener('click', openAddChat);
  $('send-invite-btn').addEventListener('click', sendInvite);
  $('requests-btn').addEventListener('click', openRequests);
  $('req-search').addEventListener('input', renderRequests);
  $('edit-profile-btn').addEventListener('click', openProfile);
  $('save-profile-btn').addEventListener('click', saveProfile);
  $('logout-btn').addEventListener('click', doLogout);
  $('delete-account-btn').addEventListener('click', deleteAccount);
  $('tab-profile').addEventListener('click', () => switchSettingsTab('profile'));
  $('tab-privacy').addEventListener('click', () => switchSettingsTab('privacy'));
  $('tab-media').addEventListener('click', () => switchSettingsTab('media'));
  $('dnd-toggle').addEventListener('click', () => {
    setDnd($('dnd-toggle').getAttribute('aria-pressed') !== 'true');
  });
  $('send-btn').addEventListener('click', sendText);
  $('msg-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendText(); });
  $('attach-btn').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
    e.target.value = '';
  });
  $('record-btn').addEventListener('click', toggleRecord);
  $('back-btn').addEventListener('click', () => {
    state.activeChatId = null;
    state.activeOther = null;
    showChatPlaceholder();
    renderChatList();
  });
  $('call-voice-btn').addEventListener('click', () => Call.start(state.activeChatId, state.activeOther, false));
  $('call-video-btn').addEventListener('click', () => Call.start(state.activeChatId, state.activeOther, true));

  // ---------- init ----------

  window.__chat = { wsSend, user, state };

  (async function init() {
    renderProfile();
    connectSocket();
    startHeartbeat();
    await Promise.all([refreshChats(), refreshRequestsBadge()]);
    try {
      const me = await api('GET', '/api/me?userId=' + encodeURIComponent(user.id));
      if (me.user) {
        const changed = me.user.nick !== user.nick || me.user.avatar !== user.avatar || !!me.user.dnd !== !!user.dnd;
        user.nick = me.user.nick;
        user.avatar = me.user.avatar;
        user.dnd = !!me.user.dnd;
        $('dnd-toggle').setAttribute('aria-pressed', String(user.dnd));
        if (changed) {
          saveSession(user);
          renderProfile();
          refreshChats();
        }
      }
    } catch (e) {
      clearSession();
      location.replace('index.html');
    }
  })();
})();
