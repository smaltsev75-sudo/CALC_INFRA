/**
 * Линтер RU-формата дат/времени в пользовательских строках.
 *
 * Правило: даты в UI / выгрузках / именах файлов / справочной информации
 * должны быть в формате `dd.mm.yyyy`, время — `hh:mi`. Внутренние timestamp'ы
 * (`createdAt`, `updatedAt`, `priceUpdatedAt`, `exportedAt`) — ISO для
 * сериализации, это нормально.
 *
 * Конкретно линтер запрещает паттерн `new Date().toISOString().slice(0, N)`
 * (где N = 10 для даты или 16 для даты+время) — это типичный «короткий путь»
 * к ISO-формату для имени файла или строки в CSV. Заменять на:
 *   - `dateForFilename()` для имён файлов;
 *   - `formatDate(...)` / `formatDateTime(...)` для UI/CSV-тел/PDF.
 *
 * Также проверяем, что в `UserManual.md` (грузится в F1-справку, PATCH 2.7.2)
 * нет ISO-дат формата `2026-05-02` в видимых пользователю местах.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const JS_ROOT   = join(REPO_ROOT, 'js');

/* ---------- Обход *.js ---------- */

function walkJs(rootDir) {
    const out = [];
    const stack = [rootDir];
    while (stack.length > 0) {
        const dir = stack.pop();
        let entries;
        try { entries = readdirSync(dir); }
        catch { continue; }
        for (const name of entries) {
            const full = join(dir, name);
            let s;
            try { s = statSync(full); }
            catch { continue; }
            if (s.isDirectory()) stack.push(full);
            else if (s.isFile() && full.endsWith('.js')) out.push(full);
        }
    }
    return out;
}

describe('date format: dd.mm.yyyy / hh:mi в UI и выгрузках', () => {
    it('нет `toISOString().slice(0, 10|16)` в js/ (используйте dateForFilename / formatDate*)', () => {
        const files = walkJs(JS_ROOT);
        const offenders = [];

        /* Whitelist: модули, где ISO-формат `YYYY-MM-DD` — domain-контракт,
           а не UI-формат. Stage VAT-1: vatRateTable.js работает с ISO-датами
           справочника НДС для лексикографического сравнения — `'2026-05-12' >=
           '2026-01-01'`. Это НЕ показывается пользователю, формат — внутренний. */
        const WHITELIST_FILES = new Set([
            'js/domain/vatRateTable.js'
        ]);

        for (const file of files) {
            const relPath = file.replace(REPO_ROOT, '').replace(/\\/g, '/').replace(/^\//, '');
            if (WHITELIST_FILES.has(relPath)) continue;

            const src = stripJsComments(readFileSync(file, 'utf8'));
            // Паттерн: .toISOString().slice(0, 10) или .slice(0, 16)
            // Срез 19 (full ISO без миллисекунд) встречается реже, но тоже подозрителен.
            const re = /\.toISOString\(\)\s*\.slice\s*\(\s*0\s*,\s*(10|16|19)\s*\)/g;
            let m;
            while ((m = re.exec(src)) !== null) {
                offenders.push(`${file.replace(REPO_ROOT, '').replace(/\\/g, '/')} : .slice(0, ${m[1]})`);
            }
        }
        assert.deepEqual(
            offenders, [],
            'найдено `toISOString().slice(0, N)` — заменить на dateForFilename() / formatDate() / formatDateTime():\n' +
            offenders.join('\n')
        );
    });

    it('Stage 18.1.6: decisionMemoExport.js НЕ выводит generatedAt напрямую — только через formatDateTime', () => {
        /* Жертва: в Stage 18.1.4 строку «Сформировано: ${memo.generatedAt}» вывел
           без форматирования — пользователь видел ISO `2026-05-11T16:02:51.897Z`
           вместо RU-формата. Линтер `toISOString().slice(0, N)` это не ловил, т.к.
           `new Date().toISOString()` целиком — легитимный паттерн для metadata.
           Усиливаем: в `decisionMemoExport.js` подстрока `generatedAt}` в
           template-literal допускается ТОЛЬКО как аргумент `formatDateTime(...)`. */
        const src = readFileSync(join(JS_ROOT, 'services', 'decisionMemoExport.js'), 'utf8');
        const clean = stripJsComments(src);
        // Все вхождения `${...generatedAt}` или `${...generatedAt }` в template-literal'ах.
        const re = /\$\{([^}]*generatedAt[^}]*)\}/g;
        const offenders = [];
        let m;
        while ((m = re.exec(clean)) !== null) {
            const expr = m[1];
            // Допустимо: внутри expr встречается `formatDateTime(` или `formatDate(`.
            if (!/formatDate(?:Time)?\s*\(/.test(expr)) {
                offenders.push(`\${${expr}}`);
            }
        }
        assert.deepEqual(
            offenders, [],
            'найдены raw-выводы generatedAt без formatDateTime/formatDate — пользователь увидит ISO-timestamp. ' +
            'Обернуть в formatDateTime(...) из services/format.js:\n' + offenders.join('\n')
        );
    });

    it('UserManual.md не содержит ISO-дат `yyyy-mm-dd` в текстовом контенте', () => {
        // UserManual.md грузится в F1-справку (PATCH 2.7.2), поэтому ISO-даты
        // там читаются пользователем и нарушают правило RU-формата.
        const manual = readFileSync(join(REPO_ROOT, 'UserManual.md'), 'utf8');
        // Игнорируем code blocks (```) — там могут быть HTTP-логи / ISO-таймстампы
        // как часть кода/примера.
        const withoutCodeBlocks = manual.replace(/```[\s\S]*?```/g, '');
        const isoDateRe = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;
        const matches = withoutCodeBlocks.match(isoDateRe);
        assert.equal(
            matches,
            null,
            'UserManual.md содержит ISO-дату(ы): ' + (matches || []).join(', ') +
            ' — переписать в `dd.mm.yyyy` (RU-формат, единообразно с UI/PDF/CSV).'
        );
    });
});
