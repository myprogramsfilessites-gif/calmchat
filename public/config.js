window.APP_CONFIG = {
  // Фронтенд и бэкенд на одном домене (Cloudflare Workers) — оставляем пустым,
  // чтобы всё шло на тот же хост. Меняй, только если фронтенд хостится отдельно:
  //   signalingUrl: 'wss://calmchat.<твой-поддомен>.workers.dev/ws',
  //   apiUrl: 'https://calmchat.<твой-поддомен>.workers.dev',
  signalingUrl: '',
  apiUrl: '',
};
