# Запуск приложения


Приложение — статический web (ES-модули). **Требуется HTTP-сервер** (file:// блокирует модули). [hirehi](https://hirehi.ru/blog/rabota-s-griaznymi-dannymi-kak-chistit-normalizovat-i-ne-poteriat-vazhnuiu-informatsiiu)

## Быстрый запуск

| ОС | Команда |
|----|---------|
| Windows | `start-server.bat` (двойной клик) |
| Linux/macOS | `bash start-server.sh` |

Авто: Python3 → Node → PHP. Порт 8000, браузер откроется: **http://localhost:8000**. Браузеры: Chrome/Yandex/Safari (мажорные). [hirehi](https://hirehi.ru/blog/rabota-s-griaznymi-dannymi-kak-chistit-normalizovat-i-ne-poteriat-vazhnuiu-informatsiiu)

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
4. Firewall: `sudo ufw allow 8000` (Linux); netsh (Win). ⚠️ 0.0.0.0 публичный. [qna.habr](https://qna.habr.com/q/423586)

## IDE/Docker/PWA

| Способ | Команда |
|--------|---------|
| VS Code | Live Server → правый клик index.html |
| Docker | `docker run -p 8000:80 -v .:/usr/share/nginx/html nginx:alpine` |
| PWA (Chrome) | ⊕ в адресной строке → Установить |

## Автозапуск

**Linux systemd** (`/etc/systemd/system/calc.service`):
```ini
[Unit] After=network.target
[Service] WorkingDirectory=/путь ExecStart=python3 -m http.server 8000 Restart=on-failure
[Install] WantedBy=multi-user.target
```
`sudo systemctl enable --now calc.service`.

**macOS launchd** (`~/Library/LaunchAgents/com.user.calc.plist`): XML с `ProgramArguments` python3 -m http.server 8000. `launchctl load`. [cors](https://cors.su/eto-interesno/dokumentatsiya-na-it-proektah-kak-sokratit-kolichestvo-oshibok-na-proekte/)

## Проблемы

| Симптом | Решение |
|---------|---------|
| Module script failed | HTTP-сервер (не file://) |
| python3 not found | `sudo apt install python3` / py -3 |
| Порт занят | `PORT=8080 start-server.*` / `netstat -ano \| findstr :8000` (Win) |
| Permission denied | `chmod +x start-server.sh` |
| Кэш | Ctrl+Shift+R |
| Данные пропали | Обычный режим / экспорт JSON |

## Требования

- Python 3.7+ / Node 14+ / PHP 7.4+
- Chrome 90+ / Yandex / Safari 14+
- ≥1280×720

**Старт**: ➕ Новый расчёт → Опросник → Дэшборд. F1 — справка.

## Рекомендуемая CSP

Приложение полностью статическое: один `index.html` + ES-модули из `js/` + CSS из `css/`. Никаких внешних CDN, inline-скриптов, eval/new Function — поэтому работает на самой строгой Content Security Policy. При публикации за reverse-proxy/Nginx или в self-hosting добавляйте заголовок:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'
```

Расшифровка директив:

- `default-src 'self'` — любые ресурсы (XHR, fetch, шрифты, изображения) только с того же origin.
- `script-src 'self'` — JS только из локальных файлов; inline `<script>` и `eval` запрещены. Калькулятор использует свой DSL-парсер вместо `eval` (`js/domain/formula/`).
- `object-src 'none'` — отключает legacy-плагины (`<object>`, `<embed>`, Flash).
- `base-uri 'self'` — запрещает менять базовый URL страницы инъекцией `<base>`.

### Примеры настройки

**Nginx** (`/etc/nginx/sites-enabled/calc.conf` → `server { ... }`):

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
```

**Apache** (`.htaccess` рядом с `index.html`):

```apache
Header always set Content-Security-Policy "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'"
Header always set X-Content-Type-Options "nosniff"
```

**Caddy** (`Caddyfile`):

```caddy
calc.example.com {
    root * /srv/calc
    file_server
    header Content-Security-Policy "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'"
    header X-Content-Type-Options "nosniff"
}
```

**Reverse-proxy перед `python -m http.server`** — CSP ставит фронт-прокси (Nginx/Caddy выше); сам Python-сервер заголовки не добавляет.

**Self-hosting через GitHub Pages / Netlify / Vercel** — CSP задаётся в `_headers` (Netlify) или `vercel.json` (`headers: [...]`); GitHub Pages фиксированных заголовков не позволяет, ставьте Cloudflare/Fastly перед ним и настраивайте CSP там.

### Проверка

После применения откройте DevTools → Network → выберите запрос `index.html` → Response Headers → должна быть строка `content-security-policy`. Если в консоли появятся ошибки `Refused to load ...` — какой-то ресурс пробует загрузиться извне; для базовой сборки калькулятора этого быть не должно.

