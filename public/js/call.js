'use strict';

const Call = (() => {
  const $ = (id) => document.getElementById(id);

  const ICE_CONFIG = {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      { urls: ['turn:openrelay.metered.ca:80'], username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: ['turn:openrelay.metered.ca:443'], username: 'openrelayproject', credential: 'openrelayproject' },
    ],
    iceCandidatePoolSize: 5,
  };

  let pc = null;
  let localStream = null;
  let videoMode = false;
  let otherId = null;
  let chatId = null;
  let outgoing = false;
  let pendingOffer = null;
  let timer = null;
  let startTs = 0;
  let micOn = true;
  let camOn = false;

  const MEDIA_KEY = 'cc-media';

  function send(obj) {
    const c = window.__chat;
    if (c) c.wsSend(obj);
  }

  function loadMediaPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(MEDIA_KEY) || '{}');
      return { mic: p.mic || '', speaker: p.speaker || '' };
    } catch (e) {
      return { mic: '', speaker: '' };
    }
  }

  function saveMediaPrefs(p) {
    localStorage.setItem(MEDIA_KEY, JSON.stringify({ mic: p.mic || '', speaker: p.speaker || '' }));
  }

  let activeSpeaker = '';

  function normLabel(s) {
    return (s || '')
      .toLowerCase()
      .replace(/[\(\[\]\)]/g, ' ')
      .replace(/[0-9]/g, ' ')
      .replace(/\b(microphone|mic|speakers?|speaker|headset|headphones?|headphone|audio|sound|device|input|output|monitor|usb)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async function findSpeakerForMic(micId) {
    if (!micId) return '';
    let devices = [];
    try { devices = await navigator.mediaDevices.enumerateDevices(); } catch (e) { return ''; }
    const mics = devices.filter((d) => d.kind === 'audioinput');
    const spks = devices.filter((d) => d.kind === 'audiooutput');
    if (spks.length <= 1) return '';
    const mic = mics.find((d) => d.deviceId === micId);
    if (!mic) return '';
    const key = normLabel(mic.label);
    if (!key) return '';
    const exact = spks.find((d) => normLabel(d.label) === key);
    if (exact) return exact.deviceId;
    const partial = spks.find((d) => {
      const k = normLabel(d.label);
      return !!k && (k.includes(key) || key.includes(k));
    });
    return partial ? partial.deviceId : '';
  }

  async function applySink(el) {
    const target = el || $('call-remote-video');
    if (!target || typeof target.setSinkId !== 'function') return;
    if (!activeSpeaker) return;
    try { await target.setSinkId(activeSpeaker); } catch (e) {}
  }

  async function populateMediaDevices() {
    const micSel = $('mic-select');
    const spkSel = $('speaker-select');
    if (!micSel || !spkSel) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      micSel.innerHTML = '<option value="">Устройства не поддерживаются</option>';
      spkSel.innerHTML = '<option value="">Устройства не поддерживаются</option>';
      return;
    }
    try { await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) {}
    let devices = [];
    try { devices = await navigator.mediaDevices.enumerateDevices(); } catch (e) { devices = []; }
    const mics = devices.filter((d) => d.kind === 'audioinput');
    const spks = devices.filter((d) => d.kind === 'audiooutput');
    const prefs = loadMediaPrefs();
    fillSelect(micSel, mics, prefs.mic, 'Микрофон по умолчанию');
    fillSelect(spkSel, spks, prefs.speaker, 'Динамик по умолчанию');
  }

  function fillSelect(sel, list, current, defLabel) {
    sel.innerHTML = '';
    const def = document.createElement('option');
    def.value = '';
    def.textContent = defLabel;
    sel.appendChild(def);
    list.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || (d.kind === 'audioinput' ? 'Микрофон ' + (i + 1) : 'Динамик ' + (i + 1));
      sel.appendChild(o);
    });
    sel.value = list.some((d) => d.deviceId === current) ? current : '';
  }

  function show(status) {
    $('call-overlay').hidden = false;
    $('call-status').textContent = status;
  }

  function hide() {
    $('call-overlay').hidden = true;
    $('call-status').textContent = '';
    $('call-video-wrap').hidden = true;
    $('call-local-video').srcObject = null;
    $('call-remote-video').srcObject = null;
  }

  function setActiveUI() {
    $('call-incoming-actions').hidden = true;
    $('call-actions').hidden = false;
  }

  function setIncomingUI() {
    $('call-incoming-actions').hidden = false;
    $('call-actions').hidden = true;
  }

  function renderNames(other) {
    renderAvatar($('call-avatar'), other);
    $('call-nick').textContent = other ? other.nick : '';
  }

  function bannerShow(other, video) {
    renderAvatar($('call-banner-avatar'), other);
    $('call-banner-nick').textContent = other ? other.nick : '';
    $('call-banner-sub').textContent = video ? 'Видеозвонок' : 'Входящий звонок';
    $('call-banner').hidden = false;
  }

  function bannerHide() {
    $('call-banner').hidden = true;
  }

  function startTimer() {
    startTs = Date.now();
    clearInterval(timer);
    timer = setInterval(() => {
      const s = Math.floor((Date.now() - startTs) / 1000);
      $('call-status').textContent =
        String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timer);
  }

  function updateMediaButtons() {
    $('call-mic-btn').classList.toggle('off', !micOn);
    $('call-mic-btn').textContent = micOn ? 'Микрофон' : 'Выключен';
    $('call-cam-btn').textContent = camOn ? 'Выкл. камеру' : 'Вкл. камеру';
  }

  async function getMedia(video) {
    const prefs = loadMediaPrefs();
    const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    const constraints = () => ({
      audio: { ...base },
      video: video ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } : false,
    });
    let stream;
    try {
      if (prefs.mic) {
        stream = await navigator.mediaDevices.getUserMedia({ ...constraints(), audio: { ...base, deviceId: { exact: prefs.mic } } });
      } else {
        stream = await navigator.mediaDevices.getUserMedia(constraints());
      }
    } catch (e) {
      if (prefs.mic) stream = await navigator.mediaDevices.getUserMedia(constraints());
      else throw e;
    }
    localStream = stream;
    activeSpeaker = prefs.speaker || '';
    if (!activeSpeaker) {
      const track = stream.getAudioTracks()[0];
      const micId = track && track.getSettings ? (track.getSettings().deviceId || '') : '';
      activeSpeaker = await findSpeakerForMic(micId);
    }
    if (video) {
      $('call-video-wrap').hidden = false;
      $('call-local-video').srcObject = stream;
    }
    return stream;
  }

  function createPC() {
    pc = new RTCPeerConnection(ICE_CONFIG);
    pc.onicecandidate = (e) => {
      if (e.candidate) send({ type: 'call-ice', to: otherId, chatId, data: { candidate: e.candidate } });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        $('call-status').textContent = 'Соединение установлено';
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        $('call-status').textContent = 'Соединение прервано';
      }
    };
    pc.ontrack = (e) => {
      const videoEl = $('call-remote-video');
      if (!videoEl) return;
      if (!videoEl.srcObject) videoEl.srcObject = new MediaStream();
      videoEl.srcObject.addTrack(e.track);
      if (e.track.kind === 'audio') {
        applySink(videoEl);
        try { videoEl.play(); } catch (err) {}
      }
    };
    if (localStream) localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
    return pc;
  }

  async function start(chatIdArg, other, video) {
    if (otherId) return;
    chatId = chatIdArg;
    otherId = other ? other.id : null;
    videoMode = !!video;
    outgoing = true;
    renderNames(other);
    show('Звонок…');
    setActiveUI();
    micOn = true;
    camOn = video;
    updateMediaButtons();
    $('call-video-wrap').hidden = !video;
    try {
      await getMedia(video);
      const p = createPC();
      const offer = await p.createOffer();
      await p.setLocalDescription(offer);
      send({ type: 'call-offer', to: otherId, chatId, data: { sdp: p.localDescription.sdp, video, name: (other && other.nick) || '' } });
    } catch (e) {
      $('call-status').textContent = 'Нет доступа к микрофону или камере';
      cleanup(true);
    }
  }

  async function accept() {
    bannerHide();
    outgoing = false;
    setActiveUI();
    show('Соединение…');
    try {
      await getMedia(videoMode);
      const p = createPC();
      await p.setRemoteDescription({ type: 'offer', sdp: pendingOffer.sdp });
      const answer = await p.createAnswer();
      await p.setLocalDescription(answer);
      send({ type: 'call-answer', to: otherId, chatId, data: { sdp: p.localDescription.sdp } });
      pendingOffer = null;
      startTimer();
    } catch (e) {
      $('call-status').textContent = 'Не получилось ответить';
      cleanup(true);
    }
  }

  function decline() {
    send({ type: 'call-decline', to: otherId, chatId, data: {} });
    cleanup(false);
  }

  function hangup() {
    send({ type: 'call-end', to: otherId, chatId, data: {} });
    cleanup(false);
  }

  async function handleMessage(msg) {
    if (msg.type === 'call-offer') {
      if (otherId) return;
      chatId = msg.chatId;
      otherId = msg.from;
      videoMode = !!(msg.data && msg.data.video);
      pendingOffer = msg.data;
      outgoing = false;
      const c = window.__chat && window.__chat.state.chats.find((x) => x.id === chatId);
      const other = c ? c.other : { id: msg.from, nick: (msg.data && msg.data.name) || 'Звонок' };
      renderNames(other);
      micOn = true;
      camOn = videoMode;
      updateMediaButtons();
      $('call-video-wrap').hidden = !videoMode;
      const st = window.__chat && window.__chat.state;
      if (st && st.activeChatId === chatId) {
        show('Входящий звонок…');
        setIncomingUI();
      } else {
        bannerShow(other, videoMode);
      }
    } else if (msg.type === 'call-answer') {
      if (pc && pc.signalingState !== 'stable') {
        await pc.setRemoteDescription({ type: 'answer', sdp: msg.data.sdp });
        startTimer();
      }
    } else if (msg.type === 'call-ice') {
      if (pc && msg.data && msg.data.candidate) {
        try { await pc.addIceCandidate(msg.data.candidate); } catch (e) {}
      }
    } else if (msg.type === 'call-reneg-offer') {
      if (pc && msg.data && msg.data.sdp) {
        try {
          await pc.setRemoteDescription({ type: 'offer', sdp: msg.data.sdp });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send({ type: 'call-reneg-answer', to: otherId, chatId, data: { sdp: pc.localDescription.sdp } });
        } catch (e) {}
      }
    } else if (msg.type === 'call-reneg-answer') {
      if (pc && msg.data && msg.data.sdp && pc.signalingState !== 'stable') {
        try { await pc.setRemoteDescription({ type: 'answer', sdp: msg.data.sdp }); } catch (e) {}
      }
    } else if (msg.type === 'call-decline') {
      $('call-status').textContent = 'Звонок отклонён';
      setTimeout(() => cleanup(false), 1200);
    } else if (msg.type === 'call-end') {
      $('call-status').textContent = 'Звонок завершён';
      setTimeout(() => cleanup(false), 1200);
    }
  }

  function toggleMic() {
    micOn = !micOn;
    if (localStream) localStream.getAudioTracks().forEach((t) => (t.enabled = micOn));
    updateMediaButtons();
  }

  async function renegotiate() {
    if (!pc || pc.signalingState !== 'stable' || pc.connectionState !== 'connected') return;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ type: 'call-reneg-offer', to: otherId, chatId, data: { sdp: pc.localDescription.sdp } });
    } catch (e) {}
  }

  async function toggleCam() {
    camOn = !camOn;
    updateMediaButtons();
    const vtracks = localStream ? localStream.getVideoTracks() : [];
    if (camOn) {
      if (vtracks.length === 0) {
        try {
          const vstream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          });
          const vt = vstream.getVideoTracks()[0];
          if (!localStream) {
            localStream = new MediaStream();
          }
          localStream.addTrack(vt);
          if (pc) pc.addTrack(vt, localStream);
          $('call-local-video').srcObject = localStream;
          $('call-video-wrap').hidden = false;
          await renegotiate();
        } catch (e) {
          camOn = false;
          updateMediaButtons();
        }
      } else {
        vtracks.forEach((t) => (t.enabled = true));
        $('call-local-video').srcObject = localStream;
        $('call-video-wrap').hidden = false;
      }
    } else {
      vtracks.forEach((t) => {
        if (pc) {
          const sender = pc.getSenders().find((s) => s.track === t);
          if (sender) { try { pc.removeTrack(sender); } catch (e) {} }
        }
        t.stop();
        if (localStream) localStream.removeTrack(t);
      });
      $('call-video-wrap').hidden = true;
      $('call-local-video').srcObject = null;
    }
  }

  function cleanup(delay) {
    try { if (pc) pc.close(); } catch (e) {}
    pc = null;
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    $('call-local-video').srcObject = null;
    $('call-remote-video').srcObject = null;
    $('call-video-wrap').hidden = true;
    stopTimer();
    outgoing = false;
    pendingOffer = null;
    otherId = null;
    chatId = null;
    activeSpeaker = '';
    bannerHide();
    if (delay) setTimeout(hide, 1000);
    else hide();
  }

  function dnd() {
    if (outgoing && (!pc || pc.connectionState !== 'connected')) {
      $('call-status').textContent = 'Режим «Не беспокоить»';
      setTimeout(() => cleanup(true), 2000);
    }
  }

  $('call-mic-btn').addEventListener('click', toggleMic);
  $('call-cam-btn').addEventListener('click', toggleCam);
  $('call-hangup-btn').addEventListener('click', hangup);
  $('call-decline-btn').addEventListener('click', decline);
  $('call-accept-btn').addEventListener('click', accept);
  $('call-banner-accept-btn').addEventListener('click', accept);
  $('call-banner-reject-btn').addEventListener('click', decline);

  const micSel = $('mic-select');
  const spkSel = $('speaker-select');
  if (micSel) micSel.addEventListener('change', () => {
    const p = loadMediaPrefs();
    p.mic = micSel.value;
    saveMediaPrefs(p);
  });
  if (spkSel) spkSel.addEventListener('change', () => {
    const p = loadMediaPrefs();
    p.speaker = spkSel.value;
    saveMediaPrefs(p);
    activeSpeaker = spkSel.value;
    applySink($('call-remote-video'));
  });

  return { start, handleMessage, dnd, populateMediaDevices, loadMediaPrefs };
})();
