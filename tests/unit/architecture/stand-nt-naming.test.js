/**
 * Stage 18.1.3 — i18n: «нагрузочный стенд» → «стенд НТ» / «НТ стенд».
 *
 * По-русски нет идиоматичного словосочетания «нагрузочный стенд» — устойчивая
 * форма для стенда нагрузочного тестирования — «стенд НТ» (определение после
 * определяемого слова, как принято для аббревиатур) или «НТ-стенд» при
 * перечислении наряду с DEV / ИФТ / ПСИ. Само слово «нагрузочный» допустимо
 * в сочетаниях про процесс — «нагрузочное тестирование», «нагрузочные
 * испытания», «нагрузочный тест» — там запрета нет.
 *
 * Линтер ловит фразу «нагрузочн<okончание> <любое слово через пробел>
 * стенд<любая форма>» во всём `js/` — как в user-facing строках, так и в
 * комментариях (для консистентности при чтении кода).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS_ROOT = resolve(__dirname, '../../../js');

function walk(dir) {
    const out = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(p));
        else if (e.isFile() && p.endsWith('.js')) out.push(p);
    }
    return out;
}

/* `\w` в JS-regex по умолчанию = `[A-Za-z0-9_]` — кириллицу НЕ ловит. Используем
   явный кириллический класс с обоими регистрами + ё/Ё, без зависимости от
   `\p{L}` + flag /u (для прозрачности при чтении). */
const FORBIDDEN = /нагрузочн[а-яёА-ЯЁ]*\s+стенд[а-яёА-ЯЁ]*/i;

test('Запрещена фраза «нагрузочн<...> стенд<...>» в js/', () => {
    const files = walk(JS_ROOT);
    const offenders = [];
    for (const f of files) {
        const lines = readFileSync(f, 'utf8').split(/\r?\n/);
        lines.forEach((line, idx) => {
            if (FORBIDDEN.test(line)) {
                offenders.push(`${f}:${idx + 1} :: ${line.trim()}`);
            }
        });
    }
    assert.deepStrictEqual(
        offenders,
        [],
        `Найдена устаревшая форма «нагрузочн* стенд*» — заменить на «стенд НТ» / «НТ-стенд». Список:\n  ${offenders.join('\n  ')}`
    );
});

test('Слово «нагрузочн...» допустимо в сочетании с tests/тестирование/испытания/мероприятие — не ломаем эти случаи', () => {
    /* Контрольная проверка: убедиться, что линтер НЕ ловит легитимные сочетания
       («нагрузочное тестирование», «нагрузочные тесты», «нагрузочные испытания»,
       «нагрузочный тест») — они не про стенд, по-русски нормальны. */
    const samples = [
        'нагрузочное тестирование перед запуском',
        'плановые нагрузочные испытания',
        'нагрузочный тест выявил узкое место',
        'провести нагрузочные тесты',
    ];
    for (const s of samples) {
        assert.ok(!FORBIDDEN.test(s), `Не должно ловить легитимный текст: "${s}"`);
    }
});
