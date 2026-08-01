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

  function send(obj) {
    const c = window.__chat;
    if (c) c.wsSend(obj);
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
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: video ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } : false,
    });
    localStream = stream;
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
      if (e.streams[0]) $('call-remote-video').srcObject = e.streams[0];
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

  return { start, handleMessage, dnd };
})();
