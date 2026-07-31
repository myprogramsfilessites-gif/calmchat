(function () {
  'use strict';

  const CONFIG = window.APP_CONFIG || {};
  const API = CONFIG.apiUrl || '';
  const WS_URL = CONFIG.signalingUrl || (location.protocol.replace('http', 'ws') + '//' + location.host + '/ws');

  const ICE_CONFIG = {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      { urls: ['turn:openrelay.metered.ca:80'], username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: ['turn:openrelay.metered.ca:443'], username: 'openrelayproject', credential: 'openrelayproject' },
    ],
    iceCandidatePoolSize: 5,
  };

  const ICONS = {
    smile: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="9" cy="10.2" r="1.15" fill="currentColor"/><circle cx="15" cy="10.2" r="1.15" fill="currentColor"/><path d="M8.7 13.6c.9 1.25 2.1 1.9 3.3 1.9s2.4-.65 3.3-1.9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    cat: '<circle cx="12" cy="13.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.6 9.6 7.2 5.8l3.4 2.3M15.4 9.6l1.4-3.8-3.4 2.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9.6" cy="13.6" r=".9" fill="currentColor"/><circle cx="14.4" cy="13.6" r=".9" fill="currentColor"/><path d="M11 15.6h2M11 15.6l-.7 2M13 15.6l.7 2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    robot: '<rect x="5.5" y="8.5" width="13" height="9.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="9.4" y="12" width="2" height="2.6" rx="1" fill="currentColor"/><rect x="12.6" y="12" width="2" height="2.6" rx="1" fill="currentColor"/><path d="M12 8.5V5.5M9.8 5.5h4.4M12 17.8c-.6-.5-1.6-.5-2.2 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    star: '<path d="M12 3.5l2.4 5.4 5.9.6-4.5 3.9 1.3 5.8L12 16.2l-5.1 3 1.3-5.8L3.7 9.5l5.9-.6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    heart: '<path d="M12 20s-7-4.3-7-9.4C5 7.9 7 6 9.2 6c1.3 0 2.3.6 2.8 1.5C12.5 6.6 13.5 6 14.8 6 17 6 19 7.9 19 10.6c0 5.1-7 9.4-7 9.4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    rocket: '<path d="M12 14.5c3.5-3 5-6 5-9.5-3.5 0-6.5 1.5-9.5 5l1.5 4.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M10.8 12.8 8 16.5M14 14l3.7 2.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="11" r="1.1" fill="currentColor"/>',
    crown: '<path d="M4 17h16M5.5 16.5 4 7.8l4.6 3 3.4-5.4 3.4 5.4 4.6-3-1.5 8.7z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    sun: '<circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 4.5v2.4M12 17.1v2.4M4.5 12h2.4M17.1 12h2.4M6.7 6.7l1.7 1.7M15.6 15.6l1.7 1.7M17.3 6.7l-1.7 1.7M8.4 15.6l-1.7 1.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    music: '<path d="M9 17.5V6.2l8-1.6v11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6.8" cy="17.5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="14.8" cy="15.6" r="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  };

  const ICON_KEYS = Object.keys(ICONS);
  const STORAGE_KEY = 'calmchat-user';

  const MIC_BADGE = '<svg viewBox="0 0 24 24"><path d="M12 3.5a3.2 3.2 0 0 0-3.2 3.2v5A3.2 3.2 0 0 0 12 14.9a3.2 3.2 0 0 0 3.2-3.2v-5A3.2 3.2 0 0 0 12 3.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M5.6 11.6a6.4 6.4 0 0 0 12.8 0M12 18.1v2.6M9 20.7h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const EAR_BADGE = '<svg viewBox="0 0 24 24"><path d="M7.5 8.5A4.5 4.5 0 0 1 16.5 8c0 2-1 3-2.3 4-.9.7-1.4 1.3-1.5 2.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12.7 17.5v.1M11 13.5a2.4 2.4 0 0 1 4.6 1c0 1.5-1.6 1.9-1.6 1.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  const $ = (id) => document.getElementById(id);

  let user = null;
  let roomId = null;
  let socket = null;
  let localStream = null;
  let muted = false;
  let deaf = false;
  let chosenIcon = null;

  const pcs = new Map();
  const remoteEls = new Map();
  const members = new Map();

  function hashColor(nickname) {
    let h = 0;
    for (let i = 0; i < nickname.length; i++) h = (h * 31 + nickname.charCodeAt(i)) | 0;
    return 'c' + Math.abs(h) % 10;
  }

  function renderAvatar(container, u, cls) {
    container.innerHTML = '';
    container.className = 'avatar' + (cls ? ' ' + cls : '') + ' ' + hashColor(u.nickname || '?');
    if (u.avatar && ICONS[u.avatar]) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.innerHTML = ICONS[u.avatar];
      container.appendChild(svg);
    } else {
      const span = document.createElement('span');
      span.textContent = (u.nickname || '?').charAt(0).toUpperCase();
      container.appendChild(span);
    }
  }

  function svgIcon(key) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.innerHTML = ICONS[key];
    return svg;
  }

  function showView(name) {
    ['view-register', 'view-lobby', 'view-room'].forEach((v) => $(v).classList.add('hidden'));
    $(name).classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  function clearError() {
    ['register-error', 'lobby-error', 'room-error'].forEach((id) => ($(id).textContent = ''));
  }

  function toast(text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  async function api(path, body) {
    const res = await fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    return res.json();
  }

  /* ---------- регистрация ---------- */

  function buildIconGrid() {
    const grid = $('icon-grid');
    grid.innerHTML = '';
    ICON_KEYS.forEach((key) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'icon-opt';
      btn.appendChild(svgIcon(key));
      btn.addEventListener('click', () => {
        chosenIcon = chosenIcon === key ? null : key;
        grid.querySelectorAll('.icon-opt').forEach((b) => b.classList.remove('selected'));
        if (chosenIcon) btn.classList.add('selected');
        updateAvatarPreview();
      });
      grid.appendChild(btn);
    });
  }

  function updateAvatarPreview() {
    const nick = $('nickname-input').value.trim() || '?';
    renderAvatar($('avatar-preview'), { nickname: nick, avatar: chosenIcon }, 'big');
  }

  async function register() {
    clearError();
    const nickname = $('nickname-input').value.trim();
    if (!nickname) {
      $('register-error').textContent = 'Введи ник';
      return;
    }
    const btn = $('register-btn');
    btn.disabled = true;
    try {
      const data = await api('/api/register', { nickname, avatar: chosenIcon });
      if (data.error) {
        $('register-error').textContent = data.error;
        return;
      }
      user = data.user;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
      enterLobby();
    } catch (e) {
      $('register-error').textContent = 'Сервер недоступен. Проверь, что он запущен.';
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- лобби ---------- */

  function enterLobby() {
    $('lobby-nick').textContent = user.nickname;
    renderAvatar($('lobby-avatar'), user);
    $('room-input').value = '';
    showView('lobby');
  }

  async function createRoom() {
    clearError();
    const data = await api('/api/room/create', { userId: user.id });
    if (data.error) {
      $('lobby-error').textContent = data.error;
      return;
    }
    enterRoom(data.room.id);
  }

  async function joinRoom() {
    clearError();
    const code = $('room-input').value.trim().toUpperCase();
    if (!code) {
      $('lobby-error').textContent = 'Введи код комнаты';
      return;
    }
    const data = await api('/api/room/join', { userId: user.id, roomId: code });
    if (data.error) {
      $('lobby-error').textContent = data.error;
      return;
    }
    enterRoom(code);
  }

  function logout() {
    leaveRoom();
    user = null;
    localStorage.removeItem(STORAGE_KEY);
    $('nickname-input').value = '';
    chosenIcon = null;
    $('icon-grid').querySelectorAll('.icon-opt').forEach((b) => b.classList.remove('selected'));
    $('avatar-preview').innerHTML = '';
    showView('register');
  }

  /* ---------- комната / WebRTC ---------- */

  async function enterRoom(code) {
    roomId = code;
    $('room-code').textContent = code;
    clearError();
    members.clear();
    $('participants').innerHTML = '';
    setStatus('connecting');
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      $('room-error').textContent = 'Нужен доступ к микрофону. Разреши его в браузере.';
      setStatus('offline');
      return;
    }
    muted = false;
    deaf = false;
    updateMicUI();
    updateSpeakerUI();
    showView('room');
    connectSocket();
  }

  function connectSocket() {
    const url = WS_URL + (WS_URL.indexOf('?') === -1 ? '?' : '&') + 'userId=' + encodeURIComponent(user.id) + '&roomId=' + encodeURIComponent(roomId);
    socket = new WebSocket(url);
    socket.onopen = () => setStatus('online');
    socket.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handleMessage(msg);
    };
    socket.onclose = () => setStatus('offline');
    socket.onerror = () => setStatus('offline');
  }

  function setStatus(s) {
    const el = $('conn-status');
    el.classList.remove('online', 'offline');
    if (s === 'online') {
      el.classList.add('online');
      el.textContent = 'В сети';
    } else if (s === 'offline') {
      el.classList.add('offline');
      el.textContent = 'Соединение потеряно';
    } else {
      el.textContent = 'Подключение…';
    }
  }

  function handleMessage(msg) {
    if (msg.type === 'joined') {
      members.set(user.id, { nickname: user.nickname, avatar: user.avatar, muted: false, deaf: false, self: true });
      msg.peers.forEach((p) => members.set(p.userId, Object.assign({}, p)));
      renderParticipants();
      msg.peers.forEach((p) => connectAndOffer(p.userId));
    } else if (msg.type === 'peer-joined') {
      members.set(msg.peer.userId, Object.assign({}, msg.peer));
      renderParticipants();
      connectAndOffer(msg.peer.userId);
    } else if (msg.type === 'peer-left') {
      members.delete(msg.userId);
      closePeer(msg.userId);
      renderParticipants();
    } else if (msg.type === 'signal') {
      handleSignal(msg.from, msg.data);
    } else if (msg.type === 'peer-mute') {
      const m = members.get(msg.userId);
      if (m) { m.muted = msg.muted; renderParticipants(); }
    } else if (msg.type === 'peer-deaf') {
      const m = members.get(msg.userId);
      if (m) { m.deaf = msg.deaf; renderParticipants(); }
    }
  }

  function renderParticipants() {
    const wrap = $('participants');
    wrap.innerHTML = '';
    if (members.size === 0) {
      wrap.innerHTML = '<div class="empty-room">Здесь пока никого. Отправь код другу — и он подключится к звонку.</div>';
      return;
    }
    members.forEach((m, id) => {
      const card = document.createElement('div');
      card.className = 'participant';

      const av = document.createElement('div');
      av.className = 'avatar';
      renderAvatar(av, m);

      const info = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'p-name';
      name.textContent = m.nickname;
      info.appendChild(name);
      if (m.self) {
        const selfTag = document.createElement('div');
        selfTag.className = 'p-self';
        selfTag.textContent = 'это ты';
        info.appendChild(selfTag);
      }

      const badges = document.createElement('div');
      badges.className = 'badge-row';
      const micBadge = document.createElement('span');
      micBadge.className = 'badge' + (m.muted ? ' on' : '');
      micBadge.title = m.muted ? 'Микрофон выключен' : 'Микрофон включён';
      micBadge.innerHTML = MIC_BADGE;
      const earBadge = document.createElement('span');
      earBadge.className = 'badge' + (m.deaf ? ' on' : '');
      earBadge.title = m.deaf ? 'Наушники выключены' : 'Наушники включены';
      earBadge.innerHTML = EAR_BADGE;
      badges.appendChild(micBadge);
      badges.appendChild(earBadge);

      card.appendChild(av);
      card.appendChild(info);
      card.appendChild(badges);
      wrap.appendChild(card);
    });
  }

  function sendSignal(to, data) {
    if (socket && socket.readyState === 1) {
      socket.send(JSON.stringify({ type: 'signal', to, data }));
    }
  }

  function createPC(userId) {
    if (pcs.has(userId)) return pcs.get(userId);
    const pc = new RTCPeerConnection(ICE_CONFIG);
    pcs.set(userId, pc);
    pc.onicecandidate = (e) => {
      if (e.candidate) sendSignal(userId, { type: 'candidate', candidate: e.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setTimeout(() => {
          if (pcs.get(userId) === pc && pc.connectionState !== 'connected') pc.restartIce();
        }, 3000);
      }
    };
    pc.ontrack = (e) => {
      let el = remoteEls.get(userId);
      if (!el) {
        el = new Audio();
        el.autoplay = true;
        remoteEls.set(userId, el);
      }
      el.muted = deaf;
      el.srcObject = e.streams[0];
      el.play().catch(() => {});
    };
    if (localStream) {
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
    }
    return pc;
  }

  async function connectAndOffer(userId) {
    const pc = createPC(userId);
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal(userId, { type: 'offer', sdp: pc.localDescription.sdp });
    } catch (e) {}
  }

  async function handleSignal(from, data) {
    try {
      if (data.type === 'offer') {
        let pc = pcs.get(from);
        if (!pc) pc = createPC(from);
        await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal(from, { type: 'answer', sdp: pc.localDescription.sdp });
      } else if (data.type === 'answer') {
        const pc = pcs.get(from);
        if (pc && pc.signalingState !== 'stable') {
          await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        }
      } else if (data.type === 'candidate') {
        const pc = pcs.get(from);
        if (pc && data.candidate) await pc.addIceCandidate(data.candidate);
      }
    } catch (e) {}
  }

  function closePeer(userId) {
    const pc = pcs.get(userId);
    if (pc) { pc.close(); pcs.delete(userId); }
    const el = remoteEls.get(userId);
    if (el) { el.pause(); el.srcObject = null; remoteEls.delete(userId); }
  }

  function toggleMute() {
    muted = !muted;
    if (localStream) localStream.getAudioTracks().forEach((t) => (t.enabled = !muted));
    updateMicUI();
    if (socket && socket.readyState === 1) socket.send(JSON.stringify({ type: 'mute', muted }));
  }

  function toggleDeaf() {
    deaf = !deaf;
    remoteEls.forEach((el) => (el.muted = deaf));
    updateSpeakerUI();
    if (socket && socket.readyState === 1) socket.send(JSON.stringify({ type: 'deaf', deaf }));
  }

  function updateMicUI() {
    $('mic-btn').classList.toggle('muted', muted);
    $('mic-btn').querySelector('.ctl-label').textContent = muted ? 'Выключен' : 'Микрофон';
  }

  function updateSpeakerUI() {
    $('speaker-btn').classList.toggle('deaf', deaf);
    $('speaker-btn').querySelector('.ctl-label').textContent = deaf ? 'Выключены' : 'Наушники';
  }

  function leaveRoom() {
    if (socket) { socket.onclose = null; socket.close(); socket = null; }
    pcs.forEach((pc) => pc.close());
    pcs.clear();
    remoteEls.forEach((el) => { el.pause(); el.srcObject = null; });
    remoteEls.clear();
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    members.clear();
    roomId = null;
  }

  /* ---------- события ---------- */

  $('nickname-input').addEventListener('input', updateAvatarPreview);

  $('register-btn').addEventListener('click', register);
  $('nickname-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') register(); });

  $('create-btn').addEventListener('click', createRoom);
  $('join-btn').addEventListener('click', joinRoom);
  $('room-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
  $('logout-btn').addEventListener('click', logout);

  $('mic-btn').addEventListener('click', toggleMute);
  $('speaker-btn').addEventListener('click', toggleDeaf);
  $('leave-btn').addEventListener('click', () => { leaveRoom(); enterLobby(); });

  $('copy-btn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('room-code').textContent);
      toast('Код скопирован');
    } catch (e) {
      toast($('room-code').textContent);
    }
  });

  /* ---------- старт ---------- */

  buildIconGrid();
  updateAvatarPreview();

  (async function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved) return;
      const res = await fetch(API + '/api/users/' + saved.id);
      if (!res.ok) return;
      const data = await res.json();
      user = data.user;
      enterLobby();
    } catch (e) {}
  })();
})();
