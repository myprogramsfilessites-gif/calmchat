window.APP_CONFIG = {
  // Фронтенд на GitHub Pages -> используем бэкенд на Render.
  // Если страница открыта не с github.io (локально или на самом Render) —
  // работает тот же хост, откуда открыта страница.
  signalingUrl: location.hostname.indexOf('github.io') !== -1
    ? 'wss://calmchat.onrender.com/ws'
    : '',
  apiUrl: location.hostname.indexOf('github.io') !== -1
    ? 'https://calmchat.onrender.com'
    : '',
};
