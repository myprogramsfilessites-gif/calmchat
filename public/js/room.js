'use strict';

(function () {
  const $ = (id) => document.getElementById(id);

  const user = requireSession();
  if (!user) return;

  const params = new URLSearchParams(location.search);
  const roomCode = params.get('room') || sessionStorage.getItem(ROOM_KEY);
  if (!roomCode) {
    location.replace('lobby.html');
    return;
  }

  const ICE_CONFIG = {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      { urls: ['turn:openrelay.metered.ca:80'], username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: ['turn:openrelay.metered.ca:443'], username: 'openrelayproject', credential: 'openrelayproject' },
    ],
    iceCandidatePoolSize: 5,
  };

  const MIC_BADGE = '<svg viewBox="0 0 24 24"><path d="M12 3.5a3.2 3.2 0 0 0-3.2 3.2v5A3.2 3.2 0 0 0 12 14.9a3.2 3.2 0 0 0 3.2-3.2v-5A3.2 3.2 0 0 0 12 3.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M5.6 11.6a6.4 6.4 0 0 0 12.8 0M12 18.1v2.6M9 20.7h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const EAR_BADGE = '<svg viewBox="0 0 24 24"><path d="M7.5 8.5A4.5 4.5 0 0 1 16.5 8c0 2-1 3-2.3 4-.9.7-1.4 1.3-1.5 2.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12.7 17.5v.1M11 13.5a2.4 2.4 0 0 1 4.6 1c0 1.5-1.6 1.9-1.6 1.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  const WS_URL = ((window.APP_CONFIG && window.APP_CONFIG.signalingUrl) ||
    (location.protocol.replace('http', 'ws') + '//' + location.host + '/ws'));

  let socket = null;
  let localStream = null;
  let muted = false;
  let deaf = false;
  let leaving = false;
  let reconnectAttempts = 0;

  const pcs = new Map();
  const remoteEls = new Map();
  const members = new Map();

  function toast(text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  function setStatus(s) {
    const el = $('conn-status');
    el.classList.remove('online', 'offline');
    if (s === 'online') {
      el.classList.add('online');
      el.textContent = 'В сети';
    } else if (s === 'offline') {
      el.classList.add('offline');
      el.textContent = 'Соединение…';
    } else {
      el.textContent = 'Подключение…';
    }
  }

  async function enterRoom() {
    $('room-code').textContent = roomCode;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      $('room-error').textContent = 'Нужен доступ к микрофону. Разреши его в браузере.';
      return;
    }
    updateMicUI();
    updateSpeakerUI();
    connectSocket();
  }

  function wsUrl() {
    return WS_URL + (WS_URL.indexOf('?') === -1 ? '?' : '&') +
      'userId=' + encodeURIComponent(user.id) + '&roomId=' + encodeURIComponent(roomCode);
  }

  function connectSocket() {
    socket = new WebSocket(wsUrl());
    socket.onopen = () => {
      reconnectAttempts = 0;
      setStatus('online');
    };
    socket.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handleMessage(msg);
    };
    socket.onclose = () => {
      setStatus('offline');
      if (!leaving && reconnectAttempts < 20) {
        reconnectAttempts++;
        setTimeout(connectSocket, 3000);
      }
    };
    socket.onerror = () => { setStatus('offline'); };
  }

  function sendSignal(to, data) {
    if (socket && socket.readyState === 1) {
      socket.send(JSON.stringify({ type: 'signal', to, data }));
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
    members.forEach((m) => {
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

  function cleanup() {
    leaving = true;
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
  }

  function leaveRoom() {
    cleanup();
    sessionStorage.removeItem(ROOM_KEY);
    location.replace('lobby.html');
  }

  $('mic-btn').addEventListener('click', toggleMute);
  $('speaker-btn').addEventListener('click', toggleDeaf);
  $('leave-btn').addEventListener('click', leaveRoom);
  $('copy-btn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      toast('Код скопирован');
    } catch (e) {
      toast(roomCode);
    }
  });

  window.addEventListener('beforeunload', () => {
    if (socket && socket.readyState === 1) {
      socket.send(JSON.stringify({ type: 'leave' }));
    }
  });

  enterRoom();
})();
