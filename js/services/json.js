/**
 * Импорт / экспорт JSON. Безопасное чтение из File, запись через Blob/anchor.
 */

import {
    JSON_IMPORT_MAX_BYTES,
    URL_REVOKE_DELAY_MS,
    FILE_PICKER_FOCUS_FALLBACK_MS
} from '../utils/constants.js';
import { dateForFilename } from './format.js';

/**
 * Прочитать JSON-файл из input[type=file].
 * Возвращает Promise<{ data, fileName }> или отклоняет с Error.
 */
export function readJsonFile(file) {
    return new Promise((resolve, reject) => {
        if (!file) return reject(new Error('Файл не выбран'));
        if (file.size > JSON_IMPORT_MAX_BYTES) return reject(new Error('Файл слишком большой (> 50 МБ)'));
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result);
                resolve({ data, fileName: file.name });
            } catch (e) {
                reject(new Error('Файл не является корректным JSON: ' + e.message));
            }
        };
        reader.readAsText(file, 'utf-8');
    });
}

/**
 * Скачать данные как JSON-файл.
 */
export function downloadJson(filename, data) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sanitizeFilename(filename);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), URL_REVOKE_DELAY_MS);
}

/**
 * Открыть диалог выбора файла программно.
 * Возвращает Promise<File | null>.
 *
 * Резолв при отмене:
 *   - Современные браузеры (Chrome 113+, Safari 16.4+) поддерживают событие `cancel`.
 *   - В старых браузерах ловим возврат фокуса в окно как сигнал того, что диалог
 *     закрыт без выбора (heuristic). Через 200 мс после фокуса проверяем `files`:
 *     если пусто — резолвим `null`.
 */
export function pickFile(accept = '.json,application/json') {
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.style.display = 'none';

        let resolved = false;
        const finish = (file) => {
            if (resolved) return;
            resolved = true;
            if (input.parentNode) document.body.removeChild(input);
            window.removeEventListener('focus', onWindowFocus);
            resolve(file);
        };

        const onWindowFocus = () => {
            // Heuristic для старых браузеров: после возврата фокуса дождёмся,
            // не сработал ли change. Если нет — считаем, что выбор отменён.
            setTimeout(() => {
                if (!input.files || input.files.length === 0) finish(null);
            }, FILE_PICKER_FOCUS_FALLBACK_MS);
        };

        input.addEventListener('change', () => {
            const file = input.files && input.files[0] ? input.files[0] : null;
            finish(file);
        }, { once: true });

        input.addEventListener('cancel', () => finish(null), { once: true });
        window.addEventListener('focus', onWindowFocus, { once: true });

        document.body.appendChild(input);
        input.click();
    });
}

function sanitizeFilename(name) {
    return String(name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 200);
}

/**
 * Сформировать имя файла для расчёта.
 */
export function buildCalcFilename(calc) {
    const baseName = (calc?.name || 'calc').replace(/\s+/g, '-').slice(0, 80);
    return `${baseName}-${dateForFilename()}.json`;
}
