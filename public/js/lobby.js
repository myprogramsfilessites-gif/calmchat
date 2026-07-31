'use strict';

(function () {
  const $ = (id) => document.getElementById(id);

  const user = requireSession();
  if (!user) return;

  $('lobby-nick').textContent = user.nickname;
  renderAvatar($('lobby-avatar'), user);

  function gotoRoom(code) {
    sessionStorage.setItem(ROOM_KEY, code);
    location.replace('room.html?room=' + encodeURIComponent(code));
  }

  async function createRoom() {
    $('lobby-error').textContent = '';
    const btn = $('create-btn');
    btn.disabled = true;
    try {
      const data = await apiPost('/api/room/create', { userId: user.id });
      if (data.error) {
        $('lobby-error').textContent = data.error;
        return;
      }
      gotoRoom(data.room.id);
    } catch (e) {
      $('lobby-error').textContent = serverErrorText();
    } finally {
      btn.disabled = false;
    }
  }

  async function joinRoom() {
    $('lobby-error').textContent = '';
    const code = $('room-input').value.trim().toUpperCase();
    if (!code) {
      $('lobby-error').textContent = 'Введи код комнаты';
      return;
    }
    const btn = $('join-btn');
    btn.disabled = true;
    try {
      const data = await apiPost('/api/room/join', { userId: user.id, roomId: code });
      if (data.error) {
        $('lobby-error').textContent = data.error;
        return;
      }
      gotoRoom(code);
    } catch (e) {
      $('lobby-error').textContent = serverErrorText();
    } finally {
      btn.disabled = false;
    }
  }

  $('create-btn').addEventListener('click', createRoom);
  $('join-btn').addEventListener('click', joinRoom);
  $('room-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
  $('logout-btn').addEventListener('click', () => {
    clearSession();
    location.replace('index.html');
  });
})();
