'use strict';

(function () {
  if (loadSession()) {
    location.replace('app.html');
    return;
  }

  const $ = (id) => document.getElementById(id);
  const errEl = $('auth-error');

  function showError(text) {
    errEl.textContent = text || '';
  }

  function switchTab(which) {
    $('tab-login').classList.toggle('active', which === 'login');
    $('tab-reg').classList.toggle('active', which === 'reg');
    $('login-form').hidden = which !== 'login';
    $('reg-form').hidden = which !== 'reg';
    showError('');
  }

  $('tab-login').addEventListener('click', () => switchTab('login'));
  $('tab-reg').addEventListener('click', () => switchTab('reg'));

  let chosenAvatar = null;
  const getChosen = buildIconGrid($('reg-avatars'), (k) => { chosenAvatar = k; });
  if (typeof getChosen === 'function') chosenAvatar = getChosen();

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const idOrNick = $('login-id').value.trim();
    const pass = $('login-pass').value;
    if (!idOrNick || !pass) { showError('Заполни все поля'); return; }
    try {
      const data = await api('POST', '/api/login', { id: idOrNick, nick: idOrNick, password: pass });
      saveSession(data.user);
      location.replace('app.html');
    } catch (err) {
      showError(err.message);
    }
  });

  $('reg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const nick = $('reg-nick').value.trim();
    const pass = $('reg-pass').value;
    if (!nick) { showError('Введи ник'); return; }
    if (pass.length < 4) { showError('Пароль — минимум 4 символа'); return; }
    try {
      const data = await api('POST', '/api/register', { nick, password: pass, avatar: chosenAvatar || '' });
      saveSession(data.user);
      $('success-id').textContent = data.user.id;
      $('auth-success').hidden = false;
      showError('');
      $('reg-form').hidden = true;
      setTimeout(() => location.replace('app.html'), 1600);
    } catch (err) {
      showError(err.message);
    }
  });
})();
