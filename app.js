(() => {
  'use strict';

  const params = new URLSearchParams(location.search);

  // По умолчанию используется бесплатный облачный сигнальный сервер PeerJS.
  // Для своего сервера добавьте к адресу страницы: ?self=1
  const selfHosted = params.get('self') === '1';
  const PEER_CONFIG = selfHosted
    ? { host: location.hostname, port: location.port || 3000, path: '/peerjs' }
    : {};

  const LEADER_PREFIX = 'calmchat-';

  const $ = (id) => document.getElementById(id);

  const els = {
    screenJoin: $('screen-join'),
    screenChat: $('screen-chat'),
    room: $('room'),
    nickname: $('nickname'),
    joinBtn: $('join'),
    leaveBtn: $('leave'),
    muteBtn: $('mute-btn'),
    status: $('status'),
    roomTitle: $('room-title'),
    members: $('members'),
    echoYes: $('echo-yes'),
    echoNo: $('echo-no'),
    mute: $('mute'),
  };

  let peer = null;
  let leaderPeer = null;
  let leaderConn = null;
  let isLeader = false;
  let joined = false;
  let myId = null;
  let room = '';
  let nickname = '';
  let stream = null;
  let muted = false;

  const roster = new Map(); // peerId -> имя
  const calls = new Map();  // peerId -> MediaConnection

  const sanitize = (s) => (s.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40)) || 'room';
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const safeId = (id) => id.replace(/[^a-zA-Z0-9-_]/g, '-');
  const setStatus = (text) => { els.status.textContent = text; };

  async function getUserMediaStream() {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
    } catch (err) {
      alert('Нет доступа к микрофону: ' + (err && err.message ? err.message : err));
      return null;
    }
  }

  function showEchoStatus() {
    const track = stream && stream.getAudioTracks && stream.getAudioTracks()[0];
    const s = track && track.getSettings ? track.getSettings() : {};
    const on = s.echoCancellation !== undefined ? s.echoCancellation : true;
    els.echoYes.classList.toggle('hidden', !on);
    els.echoNo.classList.toggle('hidden', on);
  }

  function renderMembers() {
    els.members.textContent = '';
    const entries = roster.size
      ? Array.from(roster.entries())
      : [[myId, nickname]];
    for (const [id, name] of entries) {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot' + (id === myId ? ' self' : '');
      const label = document.createElement('span');
      label.textContent = (id === myId ? 'Вы — ' : '') + name;
      const role = document.createElement('span');
      role.className = 'role';
      role.textContent = id === myId ? 'вы' : (isLeader && id === LEADER_PREFIX + room ? 'хост' : '');
      li.appendChild(dot);
      li.appendChild(label);
      li.appendChild(role);
      els.members.appendChild(li);
    }
  }

  function attachAudio(peerId, remoteStream) {
    let el = document.getElementById('audio-' + safeId(peerId));
    if (!el) {
      el = new Audio();
      el.id = 'audio-' + safeId(peerId);
      document.body.appendChild(el);
    }
    el.srcObject = remoteStream;
    el.autoplay = true;
    el.play().catch(() => {});
  }

  function removePeer(peerId) {
    const el = document.getElementById('audio-' + safeId(peerId));
    if (el) { el.pause(); el.srcObject = null; el.remove(); }
    calls.delete(peerId);
    roster.delete(peerId);
    renderMembers();
  }

  function callPeer(targetId) {
    if (!stream || !peer || peer.destroyed) return;
    if (calls.has(targetId) || targetId === myId) return;
    let call;
    try {
      call = peer.call(targetId, stream, { metadata: { name: nickname } });
    } catch (e) { return; }
    if (!call) return;
    calls.set(targetId, call);
    call.on('stream', (remoteStream) => attachAudio(targetId, remoteStream));
    call.on('close', () => removePeer(targetId));
    call.on('error', () => removePeer(targetId));
  }

  function applyRoster(membersArr) {
    if (!Array.isArray(membersArr)) return;
    for (const [id, name] of membersArr) {
      if (id === myId) continue;
      if (!roster.has(id)) roster.set(id, name);
      callPeer(id);
    }
    renderMembers();
  }

  function handleData(data) {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'roster') applyRoster(data.members);
  }

  function broadcastRoster() {
    if (!leaderPeer) return;
    const members = [[LEADER_PREFIX + room, nickname]].concat(Array.from(roster.entries()));
    for (const conn of leaderPeer.connections) {
      const dataConns = conn[1] || [];
      for (const c of dataConns) {
        if (c.open && typeof c.send === 'function') {
          try { c.send({ type: 'roster', members }); } catch (e) {}
        }
      }
    }
  }

  function onLeaderConnection(conn) {
    conn.on('open', () => {
      const name = conn.metadata && conn.metadata.name ? String(conn.metadata.name) : conn.peer;
      roster.set(conn.peer, name);
      conn.on('data', (d) => { if (d && d.type === 'hello') { conn.send({ type: 'roster', members: leaderRoster() }); } });
      broadcastRoster();
    });
    conn.on('close', () => { roster.delete(conn.peer); broadcastRoster(); });
    conn.on('error', () => { roster.delete(conn.peer); broadcastRoster(); });
  }

  function leaderRoster() {
    return [[LEADER_PREFIX + room, nickname]].concat(Array.from(roster.entries()));
  }

  function tryConnect(leaderId) {
    return new Promise((resolve) => {
      if (!peer || peer.destroyed) return resolve(false);
      let settled = false;
      const conn = peer.connect(leaderId, { reliable: true, metadata: { name: nickname } });
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        if (ok) {
          leaderConn = conn;
          conn.on('data', handleData);
          conn.on('close', onLeaderGone);
          conn.on('error', onLeaderGone);
          setStatus('В комнате «' + room + '»');
          renderMembers();
        } else {
          try { conn.close(); } catch (e) {}
        }
        resolve(ok);
      };
      conn.once('open', () => finish(true));
      conn.once('error', () => finish(false));
      setTimeout(() => finish(false), 5000);
    });
  }

  function tryBecomeLeader(leaderId) {
    return new Promise((resolve) => {
      const lp = new Peer(leaderId, PEER_CONFIG);
      lp.on('open', () => {
        isLeader = true;
        leaderPeer = lp;
        setStatus('Вы создали комнату «' + room + '»');
        lp.on('connection', onLeaderConnection);
        lp.on('call', onIncomingCall);
        lp.on('error', () => {});
        broadcastRoster();
        for (const id of roster.keys()) {
          if (id === myId || id === leaderId) continue;
          const c = lp.connect(id, { reliable: true });
          c.once('open', () => { try { c.send({ type: 'roster', members: leaderRoster() }); } catch (e) {} });
          c.once('error', () => {});
        }
        resolve(true);
      });
      lp.on('error', (err) => {
        try { lp.destroy(); } catch (e) {}
        resolve(false);
      });
    });
  }

  function onLeaderGone() {
    leaderConn = null;
    if (!joined || isLeader) return;
    setStatus('Хост ушёл. Перевыборы...');
    delay(1000 + Math.random() * 2500).then(() => {
      if (!joined || leaderConn || isLeader) return;
      tryBecomeLeader(LEADER_PREFIX + room).then((ok) => {
        if (!ok) setStatus('Разговор продолжается (хост сменился)');
      });
    });
  }

  function onIncomingCall(call) {
    if (!stream) { try { call.close(); } catch (e) {} return; }
    try { call.answer(stream); } catch (e) { return; }
    const name = call.metadata && call.metadata.name ? String(call.metadata.name) : call.peer;
    if (call.peer !== myId && !roster.has(call.peer)) roster.set(call.peer, name);
    calls.set(call.peer, call);
    call.on('stream', (s) => attachAudio(call.peer, s));
    call.on('close', () => removePeer(call.peer));
    call.on('error', () => removePeer(call.peer));
    renderMembers();
  }

  async function connectToRoom() {
    const leaderId = LEADER_PREFIX + room;
    for (let attempt = 0; attempt < 20 && joined; attempt++) {
      if (await tryConnect(leaderId)) return;
      if (await tryBecomeLeader(leaderId)) return;
      setStatus('Поиск комнаты...');
      await delay(1200 + Math.random() * 2000);
    }
    if (joined) setStatus('Не удалось подключиться к комнате');
  }

  function createMainPeer() {
    return new Promise((resolve) => {
      peer = new Peer(undefined, PEER_CONFIG);
      peer.on('open', (id) => {
        myId = id;
        roster.set(myId, nickname);
        renderMembers();
        resolve();
      });
      peer.on('call', onIncomingCall);
      peer.on('connection', (conn) => {
        conn.on('data', handleData);
        conn.on('error', () => {});
      });
      peer.on('error', (err) => {
        const ignore = ['peer-unavailable', 'browser-incompatible'];
        if (!ignore.includes(err.type) && joined) setStatus('Ошибка связи: ' + err.type);
      });
      peer.on('disconnected', () => {
        if (!joined) return;
        setStatus('Переподключение...');
        setTimeout(() => {
          if (peer && !peer.destroyed && !peer.open) { try { peer.reconnect(); } catch (e) {} }
        }, 1000);
      });
    });
  }

  async function joinRoom() {
    const roomName = els.room.value.trim();
    if (!roomName) return;
    room = sanitize(roomName);
    nickname = (els.nickname.value.trim() || 'Аноним').slice(0, 30);

    stream = await getUserMediaStream();
    if (!stream) return;

    joined = true;
    els.screenJoin.classList.add('hidden');
    els.screenChat.classList.remove('hidden');
    els.roomTitle.textContent = 'Комната «' + room + '»';
    showEchoStatus();

    await createMainPeer();
    await connectToRoom();
  }

  function leave() {
    joined = false;
    for (const c of calls.values()) { try { c.close(); } catch (e) {} }
    calls.clear();
    roster.clear();
    if (leaderConn) { try { leaderConn.close(); } catch (e) {} }
    leaderConn = null;
    if (leaderPeer) { try { leaderPeer.destroy(); } catch (e) {} }
    leaderPeer = null;
    isLeader = false;
    if (peer) { try { peer.destroy(); } catch (e) {} }
    peer = null;
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    muted = false;
    els.mute.classList.add('hidden');
    els.muteBtn.textContent = 'Отключить микрофон';
    document.querySelectorAll('audio[srcObject]').forEach((a) => { a.srcObject = null; a.remove(); });
    els.screenChat.classList.add('hidden');
    els.screenJoin.classList.remove('hidden');
  }

  function toggleMute() {
    if (!stream) return;
    muted = !muted;
    stream.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    els.mute.classList.toggle('hidden', !muted);
    els.muteBtn.textContent = muted ? 'Включить микрофон' : 'Отключить микрофон';
  }

  els.joinBtn.addEventListener('click', joinRoom);
  els.leaveBtn.addEventListener('click', leave);
  els.muteBtn.addEventListener('click', toggleMute);
  els.room.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.joinBtn.click(); });
  els.nickname.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.joinBtn.click(); });

  // volume bar / speaking hint: keep minimal
})();
