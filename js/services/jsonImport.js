/**
 * Универсальный сервис импорта коллекций из JSON.
 * Используется контроллерами CRUD ЭК и вопросов.
 *
 * Сценарий: файл может содержать либо «голый» массив, либо объект
 * { <pluralKey>: [...] } (формат экспорта).
 *
 * Каждый элемент проходит валидатор; накопленные ошибки и принятые элементы
 * возвращаются в результат. Если ни один элемент не прошёл — операция отменяется.
 */

import { pickFile, readJsonFile } from './json.js';

/**
 * @param {Object} opts
 * @param {string} [opts.accept]      MIME/расширение для input[type=file]
 * @param {string} opts.pluralKey     'items' | 'questions' и т.п.
 * @param {Function} opts.validator   (entry, errors[], path) → mutates errors[]
 * @param {Function} opts.onAccepted  (acceptedEntries[]) → применить к state и persist
 * @returns {Promise<{ ok, accepted?, errors?, reason?, message? }>}
 */
export async function importJsonCollection({
    accept = '.json,application/json',
    pluralKey,
    validator,
    onAccepted
}) {
    const file = await pickFile(accept);
    if (!file) return { ok: false, reason: 'cancelled' };

    let data;
    try {
        ({ data } = await readJsonFile(file));
    } catch (e) {
        return { ok: false, reason: 'parse', message: e.message };
    }

    const incoming = Array.isArray(data)
        ? data
        : (Array.isArray(data?.[pluralKey]) ? data[pluralKey] : null);

    if (!incoming) {
        return {
            ok: false,
            reason: 'invalid',
            message: `Ожидался массив или объект { ${pluralKey}: [...] }`
        };
    }

    const errors = [];
    const accepted = [];
    incoming.forEach((entry, i) => {
        const itemErrors = [];
        validator(entry, itemErrors, `${pluralKey}[${i}]`);
        if (itemErrors.length === 0) accepted.push({ ...entry });
        else errors.push(...itemErrors);
    });

    if (accepted.length === 0) {
        return { ok: false, reason: 'validation', errors };
    }

    /* Внешний аудит #5 (2026-05-18, P2): onAccepted применяет элементы и
     * persist'ит через commitActiveCalc. Раньше его возврат игнорировался —
     * при quota импорт возвращал {ok:true, accepted: N}, UI показывал
     * «Импортировано N», но persist падал silent → F5 = всё пропало.
     * Теперь onAccepted может бросить с сообщением — мы пробрасываем как
     * {ok:false, reason:'persist'}. Backward-compatible: если onAccepted
     * вернул void — поведение прежнее. */
    try {
        const r = onAccepted(accepted);
        if (r && r.ok === false) {
            return { ok: false, reason: r.reason || 'persist',
                message: r.message || 'Не удалось сохранить импортированные данные.',
                errors };
        }
    } catch (e) {
        return { ok: false, reason: 'persist',
            message: e?.message || 'Не удалось сохранить импортированные данные (quota?).',
            errors };
    }
    return { ok: true, accepted: accepted.length, errors };
}
