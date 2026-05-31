# Запуск приложения


Приложение — статический web (ES-модули). **Требуется HTTP-сервер** (file:// блокирует модули).

## Быстрый запуск

| ОС | Команда |
|----|---------|
| Windows | `start-server.bat` (двойной клик) |
| Linux/macOS | `bash start-server.sh` |

Авто: Python3 → Node → PHP. Порт 8000, браузер откроется: **http://localhost:8000**. Браузеры: Chrome/Yandex/Safari (мажорные).

## Вручную

```bash
python3 -m http.server 8000      # Рекоменд.
npx http-server -p 8000 -c-1     # Node
php -S localhost:8000            # PHP
```

**Другой порт**: `PORT=8080 bash start-server.sh`.

## Сеть (Wi-Fi)

1. IP: `ipconfig` (Win) / `ip addr` (Linux) / `ifconfig` (macOS).
2. `python3 -m http.server 8000 --bind 0.0.0.0`.
3. `http://<IP>:8000` на устройстве.
4. Firewall: `sudo ufw allow 8000` (Linux); netsh (Win). ⚠️ 0.0.0.0 публичный — не используйте в недоверенных сетях.

## IDE / Docker

| Способ | Команда |
|--------|---------|
| VS Code | Live Server → правый клик index.html |
| Docker | `docker run -p 8000:80 -v .:/usr/share/nginx/html nginx:alpine` |

## Автозапуск

**Linux systemd** (`/etc/systemd/system/calc.service`):
```ini
[Unit] After=network.target
[Service] WorkingDirectory=/путь ExecStart=python3 -m http.server 8000 Restart=on-failure
[Install] WantedBy=multi-user.target
```
`sudo systemctl enable --now calc.service`.

**macOS launchd** (`~/Library/LaunchAgents/com.user.calc.plist`): XML с `ProgramArguments` python3 -m http.server 8000. `launchctl load`.

## Проблемы

| Симптом | Решение |
|---------|---------|
| Module script failed | HTTP-сервер (не file://) |
| python3 not found | `sudo apt install python3` / py -3 |
| Порт занят | `PORT=8080 start-server.*` / `netstat -ano \| findstr :8000` (Win) |
| Permission denied | `chmod +x start-server.sh` |
| Кэш | Ctrl+Shift+R |
| Данные пропали | Обычный режим / экспорт JSON |
| «Приложение уже открыто» во втором окне | Защита от двойного запуска: одновременно работает только 1 экземпляр в одном браузере. Закройте лишнюю вкладку → «Проверить снова». После краха первого окна lock сам протухает за 90 с. |

## Требования

- Python 3.7+ / Node 18+ / PHP 7.4+
- Chrome 90+ / Yandex / Safari 14+
- ≥1280×720

**Старт**: «Quick Start» (8 параметров — готовый расчёт за пару минут) → при необходимости уточните детали в Опроснике → Дашборд. F1 — справка.

## Рекомендуемая CSP

Приложение полностью статическое: один `index.html` + ES-модули из `js/` + CSS из `css/`. Никаких внешних CDN, inline-скриптов, eval/new Function. При этом для рендера UI ему нужны: динамические inline-стили (`width: ${pct}%` у прогресс-баров, категорийные цвета `background: ...`, grid-разметка подгрупп опросника), favicon как `data:`-URI и локальный `fetch` markdown-справочников.

Реальная политика в `index.html` (продублируйте её HTTP-заголовком, если ставите reverse-proxy):

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
```

**Обязательно добавьте `frame-ancestors 'none'` именно как HTTP-заголовок.** Эта директива защищает от clickjacking, не давая встроить страницу в `<iframe>` стороннего сайта (эквивалент `X-Frame-Options: DENY`). По CSP-spec `frame-ancestors` **игнорируется в `<meta http-equiv>`**, поэтому в `index.html` её нет — только в заголовках ниже.

Расшифровка директив:

- `default-src 'self'` — любые ресурсы (XHR, fetch, шрифты, изображения) только с того же origin.
- `script-src 'self'` — JS только из локальных файлов; inline `<script>` и `eval` запрещены. Калькулятор использует свой DSL-парсер вместо `eval` (`js/domain/formula/`).
- `style-src 'self' 'unsafe-inline'` — стили из локальных файлов плюс динамические inline-стили (прогресс-бары, категорийные цвета, grid-разметка). `'unsafe-inline'` — осознанный архитектурный компромисс на статической HTML-странице без серверного nonce; защита от user-input в `style:` обеспечивается архитектурным линтером `tests/unit/architecture/style-no-user-input.test.js`.
- `img-src 'self' data:` — изображения с того же origin плюс favicon, встроенный как `data:image/svg+xml`.
- `connect-src 'self'` — `fetch()` только на тот же origin (запрос `UserManual.md` для in-app help).
- `object-src 'none'` — отключает legacy-плагины (`<object>`, `<embed>`, Flash).
- `base-uri 'self'` — запрещает менять базовый URL страницы инъекцией `<base>`.
- `form-action 'none'` — приложение не использует `<form action="...">`.

**Не убирайте `'unsafe-inline'` из `style-src` и `data:` из `img-src` без отдельной правки кода** — иначе сломаются прогресс-бары, категорийные цвета, grid-разметка опросника и favicon.

### Примеры настройки

**Nginx** (`/etc/nginx/sites-enabled/calc.conf` → `server { ... }`):

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "no-referrer" always;
```

**Apache** (`.htaccess` рядом с `index.html`):

```apache
Header always set Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'"
Header always set X-Content-Type-Options "nosniff"
Header always set X-Frame-Options "DENY"
```

**Caddy** (`Caddyfile`):

```caddy
calc.example.com {
    root * /srv/calc
    file_server
    header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'"
    header X-Content-Type-Options "nosniff"
    header X-Frame-Options "DENY"
}
```

**Reverse-proxy перед `python -m http.server`** — CSP ставит фронт-прокси (Nginx/Caddy выше); сам Python-сервер заголовки не добавляет.

**Self-hosting через GitHub Pages / Netlify / Vercel** — CSP задаётся в `_headers` (Netlify) или `vercel.json` (`headers: [...]`); GitHub Pages фиксированных заголовков не позволяет, ставьте Cloudflare/Fastly перед ним и настраивайте CSP там.

### Проверка

После применения откройте DevTools → Network → выберите запрос `index.html` → Response Headers → должна быть строка `content-security-policy`. Если в консоли появятся ошибки `Refused to load ...` — какой-то ресурс пробует загрузиться извне; для базовой сборки калькулятора этого быть не должно.
