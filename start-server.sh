#!/usr/bin/env bash
# ============================================================
# Калькулятор инфраструктуры — запуск локального HTTP-сервера
# Кроссплатформенный скрипт для Linux и macOS.
# ============================================================

set -euo pipefail

PORT="${PORT:-8000}"
URL="http://localhost:${PORT}"

echo
echo "=== Калькулятор инфраструктуры ==="
echo "Запуск локального HTTP-сервера на ${URL}"
echo "Для остановки нажмите Ctrl+C."
echo

# Кроссплатформенное открытие URL
open_browser() {
    local url="$1"
    if command -v xdg-open >/dev/null 2>&1; then
        (xdg-open "$url" >/dev/null 2>&1 &) || true
    elif command -v open >/dev/null 2>&1; then
        # macOS
        (open "$url" >/dev/null 2>&1 &) || true
    fi
}

# Перейти в каталог скрипта (чтобы сервер обслуживал правильные файлы)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Попытка 1: Python 3
if command -v python3 >/dev/null 2>&1; then
    echo "Найден Python 3. Запускаю http.server на порту ${PORT}..."
    open_browser "$URL"
    exec python3 -m http.server "$PORT"
fi

# Попытка 2: Python (если python указывает на Python 3)
if command -v python >/dev/null 2>&1; then
    PY_VER="$(python -c 'import sys; print(sys.version_info[0])' 2>/dev/null || echo 0)"
    if [ "$PY_VER" = "3" ]; then
        echo "Найден python (v3). Запускаю http.server..."
        open_browser "$URL"
        exec python -m http.server "$PORT"
    fi
fi

# Попытка 3: Node.js
if command -v node >/dev/null 2>&1; then
    echo "Найден Node.js. Запускаю http-server на порту ${PORT} через npx..."
    open_browser "$URL"
    exec npx --yes http-server -p "$PORT" -c-1
fi

# Попытка 4: PHP
if command -v php >/dev/null 2>&1; then
    echo "Найден PHP. Запускаю встроенный сервер на порту ${PORT}..."
    open_browser "$URL"
    exec php -S "localhost:${PORT}"
fi

echo
echo "ОШИБКА: Не найден ни Python 3, ни Node.js, ни PHP."
echo "Установите один из них:"
echo "  - Python 3: https://www.python.org/downloads/"
echo "  - Node.js:  https://nodejs.org/"
echo "  - PHP:      https://www.php.net/"
echo
exit 1
