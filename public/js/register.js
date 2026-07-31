'use strict';

(function () {
  const $ = (id) => document.getElementById(id);

  if (loadSession()) {
    location.replace('lobby.html');
    return;
  }

  let chosenIcon = null;

  function updatePreview() {
    const nick = $('nickname-input').value.trim() || '?';
    renderAvatar($('avatar-preview'), { nickname: nick, avatar: chosenIcon }, 'big');
  }

  function buildIcons() {
    const getChosen = buildIconGrid($('icon-grid'), (icon) => {
      chosenIcon = icon;
      updatePreview();
    });
  }

  async function register() {
    $('register-error').textContent = '';
    const nickname = $('nickname-input').value.trim();
    if (!nickname) {
      $('register-error').textContent = 'Введи ник';
      return;
    }
    const btn = $('register-btn');
    btn.disabled = true;
    btn.textContent = 'Заходим…';
    try {
      const data = await apiPost('/api/register', { nickname, avatar: chosenIcon });
      if (data.error) {
        $('register-error').textContent = data.error;
        return;
      }
      saveSession(data.user);
      showSuccess(data.user);
    } catch (e) {
      $('register-error').textContent = serverErrorText();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Войти';
    }
  }

  function showSuccess(user) {
    $('register-card').classList.add('hidden');
    renderAvatar($('success-avatar'), user, 'big');
    $('success-nick').textContent = user.nickname;
    $('success-card').classList.remove('hidden');
    setTimeout(() => location.replace('lobby.html'), 1400);
  }

  $('register-btn').addEventListener('click', register);
  $('nickname-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') register(); });
  $('nickname-input').addEventListener('input', updatePreview);

  buildIcons();
  updatePreview();
  $('nickname-input').focus();
})();
