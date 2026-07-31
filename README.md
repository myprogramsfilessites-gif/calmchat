# CalmChat

Созвон с другом через браузер. Без паролей, только ник и код комнаты.

## Возможности

- Регистрация по нику — ник проверяется в базе данных, пароли не нужны
- У каждого пользователя генерируется уникальный id
- Кружок-аватар: можно выбрать SVG-иконку или останется первая буква ника
- Создание комнаты — код звонка генерируется и **никогда не повторяется** (хранится в БД навсегда)
- Вход в комнату только по коду
- Кнопки: выключить микрофон, выключить наушники, выйти
- Подавление эха: звук из наушников не попадает обратно в микрофон (echoCancellation + noiseSuppression)
- WebRTC-звонок между участниками (до ~6 человек, mesh)

## Запуск локально

```bash
npm install
npm start
```

Открой http://localhost:3000. Нужен современный браузер с поддержкой WebRTC.

Данные хранятся в `data/calmchat.db` (SQLite, встроенный в Node.js 22.5+). Если SQLite недоступен — автоматически используется `data/db.json`.

## Структура

```
calmchat/
├── server.js          # HTTP API + WebSocket-сервер сигналинга
├── db.js              # Хранилище (SQLite / JSON-фолбэк)
├── render.yaml        # Blueprint для деплоя бэкенда на Render
└── public/            # Фронтенд (разворачивается на GitHub Pages)
    ├── index.html     # Страница регистрации (ник + иконка)
    ├── lobby.html     # Страница комнат (создать / войти по коду)
    ├── room.html      # Страница звонка (WebRTC, mute/deaf)
    ├── style.css
    ├── config.js      # Настройка адресов бэкенда
    └── js/
        ├── avatars.js # SVG-иконки и отрисовка кружков-аватаров
        ├── auth.js    # Сессия пользователя (localStorage)
        ├── api.js     # Обёртка над HTTP API
        ├── register.js
        ├── lobby.js
        └── room.js    # WebRTC-логика звонка
```

Сессия сохраняется в `localStorage` — после обновления страницы пользователь остаётся в своём аккаунте, а в комнату возвращается автоматически.

## Деплой на Cloudflare (доступно из России без VPN)

GitHub Pages и Render часто блокируются в российских сетях. Чтобы всё работало без VPN, приложение целиком разворачивается на **Cloudflare Workers** — один домен `*.workers.dev`, фронтенд и бэкенд вместе, связность с Россией хорошая.

```
calmchat/
├── worker.js        # Cloudflare Worker: API + WebSocket-сигналинг (Durable Objects)
├── wrangler.toml    # Конфиг Cloudflare: статика, KV, Durable Objects
├── server.js        # Локальный Node-сервер (для разработки)
├── db.js            # Хранилище для локальной версии
└── public/          # Фронтенд (одна и та же папка для обоих вариантов)
```

### Разовые шаги (нужно сделать один раз)

1. Создай аккаунт Cloudflare: https://dash.cloudflare.com/sign-up
2. Получи API-токен: https://dash.cloudflare.com/profile/api-tokens
   → **Create Token** → шаблон **Edit Cloudflare Workers** → **Continue** → **Create Token** → скопируй токен
3. Пришли мне токен — я сам создам KV-хранилище и запущу деплой.

### Деплой (команды)

```bash
npm i -D wrangler
npx wrangler kv namespace create KV   # получить id KV-хранилища
# вписать id в wrangler.toml вместо REPLACE_WITH_KV_ID
CLOUDFLARE_API_TOKEN=xxxx CLOUDFLARE_ACCOUNT_ID=xxxx npx wrangler deploy
```

После деплоя адрес вида `https://calmchat.<поддомен>.workers.dev` — он и для фронтенда, и для API, и для WebSocket. Ничего в `public/config.js` менять не нужно (всё на одном домене).

## Деплой на GitHub

1. Фронтенд разворачивается на GitHub Pages автоматически через `Actions` при пуше в `main`.
2. Бэкенд (WebSocket-сервер сигналинга) GitHub Pages **не может** запускать — Node.js там не работает. Поэтому для звонков нужен отдельный бесплатный хостинг, например **Render**:

   - Зарегистрируйся на https://render.com (через GitHub)
   - New → Blueprint → выбери этот репозиторий
   - Render сам прочитает `render.yaml` и поднимет сервис (free plan)
   - Получишь адрес вида `https://calmchat.onrender.com`

3. После развёртывания бэкенда впиши его адрес в `public/config.js`:

   ```js
   window.APP_CONFIG = {
     signalingUrl: 'wss://calmchat.onrender.com/ws',
     apiUrl: 'https://calmchat.onrender.com',
   };
   ```

4. Закоммить и запушить — фронтенд на Pages пересоберётся и заработает с бэкендом.

> Если фронтенд и бэкенд лежат на одном хосте (локально или на Render), `config.js` можно оставить пустым — всё подтянется само.

## API

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/register` | `{nickname, avatar}` — регистрация, проверка ника |
| GET | `/api/users/:id` | информация о пользователе |
| POST | `/api/room/create` | создать комнату, `{userId}` → `{room.id}` |
| POST | `/api/room/join` | проверить и войти, `{userId, roomId}` |
| POST | `/api/room/exists` | существует ли комната |
| WS | `/ws?userId=&roomId=` | сигналинг WebRTC (offer/answer/ice, mute/deaf) |
