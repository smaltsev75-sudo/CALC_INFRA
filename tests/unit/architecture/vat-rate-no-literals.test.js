/**
 * Stage VAT-1 Phase 6: linter — VAT rate literals.
 *
 * Архитектурный инвариант: ставки НДС РФ (0.18 / 0.20 / 0.22 / любая будущая)
 * НЕ должны быть разбросаны по коду как числовые литералы. Единственный
 * source of truth — `js/domain/vatRateTable.js` (VAT_RATE_HISTORY + helpers).
 *
 * Прозрачность правила:
 *   1) Whitelist по файлам: только `js/domain/vatRateTable.js` имеет право
 *      содержать числовые ставки (это его смысл существования).
 *   2) Контекст-фильтр: литерал `0.20` ловится только если в радиусе ±120 chars
 *      есть слово vat / НДС / VAT (тогда это VAT-литерал, а не например
 *      `LOAD: { min: 0.20 }` из standSizeRatio или `floor: 0.20` из optimizer'а).
 *      Это даёт чёткую семантику: «литерал в VAT-контексте — нарушение».
 *   3) Комментарии срезаются через stripJsComments — VAT-литералы в JSDoc /
 *      пояснениях разрешены.
 *
 * При появлении новой ставки в `VAT_RATE_HISTORY` (например 2028-01-01: 22→24)
 * этот линтер продолжает работать без правок: добавление в whitelisted-файл
 * допустимо, остальные файлы должны брать ставку через `getVatRateForDate(date)`
 * или `getCurrentVatRate()`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const JS_ROOT = join(REPO_ROOT, 'js');

/* Только этот файл имеет право содержать VAT-литералы — это справочник. */
const WHITELIST = new Set([
    'js/domain/vatRateTable.js'
]);

/* Stage VAT-2 Phase 3: pattern-исключение для auto-generated data files.
 * `*.generated.js` — это не source code, а свёртка внешних данных
 * (например, `js/data/providers-bundled.generated.js` собирается из
 * `data/providers/*-latest.json`, где ставка пришла из VAT_RATE_HISTORY
 * через `getVatRateForDate(timestamp)` в migration-script'е).
 * Ручная правка таких файлов всё равно перезатрётся следующим regen, поэтому
 * они НЕ могут быть primary source of truth для ставки — только зеркало. */
function isGeneratedDataFile(rel) {
    return rel.endsWith('.generated.js');
}

/* Контекст-окно ±120 chars вокруг литерала. Слово-маркер: vat, НДС, VAT.
 * ВАЖНО: используем word-boundary для латиницы — иначе `/vat/i` ловит
 * подстроку `vat` в `conservative` / `private` / `cultivator` / `gravity`
 * и т.п. (false positive). Кириллица — `\b` не работает per spec, поэтому
 * для «НДС» предваряем границей по символьному классу. */
const VAT_CONTEXT_RE = /\bvat\w*\b|(?:^|[^а-яё])НДС/i;
const CTX_RADIUS = 120;

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

function relPath(file) {
    return file.replace(REPO_ROOT, '').replace(/\\/g, '/').replace(/^\//, '');
}

function findVatLiterals(src) {
    /* Лексика: число с точкой 0.18 / 0.20 / 0.22, окружённое НЕ цифрами
       (чтобы не ловить 10.20 → второй .20). После stripJsComments кода в
       JSDoc нет; остаются только template-literal'ы со строками, но в них
       VAT-литерал внутри строки = это сам HTML/UI текст, обычно появляется
       у форматирующей функции — не нарушение. Контекст-фильтр VAT_CONTEXT_RE
       отсекает strict numeric usage от строковых упоминаний. */
    const re = /(?<![\d.])0\.(18|20|22)(?!\d)/g;
    const out = [];
    let m;
    while ((m = re.exec(src)) !== null) {
        const start = Math.max(0, m.index - CTX_RADIUS);
        const end = Math.min(src.length, m.index + CTX_RADIUS);
        const ctx = src.slice(start, end);
        if (VAT_CONTEXT_RE.test(ctx)) {
            const lineNo = src.slice(0, m.index).split('\n').length;
            out.push({ value: `0.${m[1]}`, line: lineNo, context: ctx });
        }
    }
    return out;
}

describe('VAT-1 Phase 6: VAT literals linter', () => {
    const files = walkJs(JS_ROOT);

    it('Whitelist по файлам — только js/domain/vatRateTable.js (узкий)', () => {
        assert.deepEqual(Array.from(WHITELIST), ['js/domain/vatRateTable.js']);
    });

    it('Pattern-whitelist: *.generated.js файлы освобождены (auto-generated data)', () => {
        assert.equal(isGeneratedDataFile('js/data/providers-bundled.generated.js'), true);
        assert.equal(isGeneratedDataFile('js/domain/calculator.js'), false);
        assert.equal(isGeneratedDataFile('js/data/anything.generated.js'), true);
    });

    it('vatRateTable.js действительно содержит VAT-литералы (sanity)', () => {
        const src = readFileSync(join(JS_ROOT, 'domain', 'vatRateTable.js'), 'utf8');
        /* Прямой regex без stripJsComments — литералы должны быть в коде. */
        const hits = src.match(/(?<![\d.])0\.(18|20|22)(?!\d)/g) || [];
        assert.ok(hits.length >= 3,
            `vatRateTable.js должен содержать как минимум 3 VAT-литерала (18/20/22), нашлось ${hits.length}`);
    });

    it('Runtime js/ не содержит hardcoded VAT-литералов вне whitelist', () => {
        const offenders = [];
        for (const file of files) {
            const rel = relPath(file);
            if (WHITELIST.has(rel)) continue;
            if (isGeneratedDataFile(rel)) continue;
            const src = stripJsComments(readFileSync(file, 'utf8'));
            const hits = findVatLiterals(src);
            for (const h of hits) {
                offenders.push(`${rel}:${h.line} → ${h.value} (контекст: ${h.context.replace(/\s+/g, ' ').slice(0, 80)}…)`);
            }
        }
        assert.deepEqual(
            offenders, [],
            'Найдены hardcoded VAT-литералы. Замените на getCurrentVatRate() / ' +
            'getVatRateForDate(date) из js/domain/vatRateTable.js:\n' + offenders.join('\n')
        );
    });

    it('constants.js НЕ экспортирует DEFAULT_VAT_RATE', () => {
        const src = readFileSync(join(JS_ROOT, 'utils', 'constants.js'), 'utf8');
        /* Точный паттерн export: `export const DEFAULT_VAT_RATE = ...`. */
        assert.doesNotMatch(src, /export\s+const\s+DEFAULT_VAT_RATE\s*=/);
    });

    it('Runtime js/ не импортирует DEFAULT_VAT_RATE (мёртвый импорт)', () => {
        const offenders = [];
        for (const file of files) {
            const rel = relPath(file);
            const src = stripJsComments(readFileSync(file, 'utf8'));
            /* import { ..., DEFAULT_VAT_RATE, ... } — нарушение. */
            if (/import\s*\{[^}]*\bDEFAULT_VAT_RATE\b[^}]*\}/.test(src)) {
                offenders.push(rel);
            }
        }
        assert.deepEqual(offenders, [],
            'Файлы импортируют удалённый DEFAULT_VAT_RATE — замените на ' +
            'getCurrentVatRate из js/domain/vatRateTable.js:\n' + offenders.join('\n'));
    });
});

describe('VAT-1 Phase 6: layer-direction для vatRateTable.js', () => {
    it('utils/constants.js НЕ импортирует domain/vatRateTable.js (нижний слой)', () => {
        const src = readFileSync(join(JS_ROOT, 'utils', 'constants.js'), 'utf8');
        assert.doesNotMatch(src,
            /from\s+['"][^'"]*vatRateTable/);
    });
});
