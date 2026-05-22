/**
 * Stage VAT-1 Phase 5 architecture invariants.
 *
 * Защищает 3 acceptance-вещи в коде, которые легко сломать регрессией:
 *   1. Legacy snackbar — session-only (`state.ui.shownLegacyVatBanners`),
 *      НИКАКОГО STORAGE_KEYS / persistence / localStorage.
 *   2. В UI нет hardcoded числовых VAT-литералов (0.18 / 0.20 / 0.22)
 *      кроме `vatRateTable.js`/`vatResolver.js` — UI должен брать ставку
 *      из настроек calc и из справочника динамически.
 *   3. UI vat-блоки используют только ctx-методы (setVatRateMode /
 *      setVatEffectiveDate / setVatRateManual / freezeVatRate) — никаких
 *      импортов из state/ или controllers/ напрямую.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const UI_ROOT = join(REPO_ROOT, 'js', 'ui');

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

/* ---------- 1. Legacy snackbar — session-only ---------- */

describe('VAT-1 Phase 5 / 3: legacy snackbar — session-only, без STORAGE_KEYS', () => {
    it('shownLegacyVatBanners — НЕ в STORAGE_KEYS', () => {
        const constants = readFileSync(join(REPO_ROOT, 'js', 'utils', 'constants.js'), 'utf8');
        assert.doesNotMatch(constants, /shownLegacyVatBanners/i,
            'shownLegacyVatBanners НЕ должен быть в STORAGE_KEYS — это session-only state.ui');
        assert.doesNotMatch(constants, /LEGACY_VAT/i,
            'нет STORAGE_KEYS.LEGACY_VAT_BANNER — session-only поле');
    });

    it('persistence.js не сохраняет/не восстанавливает shownLegacyVatBanners', () => {
        const persistence = readFileSync(
            join(REPO_ROOT, 'js', 'state', 'persistence.js'), 'utf8');
        assert.doesNotMatch(persistence, /shownLegacyVatBanners/);
    });

    it('vatBanners.js maybeShowLegacyVatBanner читает state.ui (session) — не persist', () => {
        const app = stripJsComments(readFileSync(join(REPO_ROOT, 'js', 'app', 'vatBanners.js'), 'utf8'));
        /* Источник флага — state.ui.shownLegacyVatBanners. */
        assert.match(app, /state\.ui\?\.shownLegacyVatBanners/);
        /* Запись — через store.setUi (session), не через persist. */
        assert.match(app, /store\.setUi\(\{\s*shownLegacyVatBanners/);
    });

    it('vatBanners.js НЕ импортирует persistence для legacy banner', () => {
        /* Это структурный smell: если бы кто-то решил persist'ить banner,
           он бы добавил persist-импорт. Не строгая проверка — текстовая. */
        const app = stripJsComments(readFileSync(join(REPO_ROOT, 'js', 'app', 'vatBanners.js'), 'utf8'));
        /* Не существует функции saveLegacyVatBanners / loadLegacyVatBanners. */
        assert.doesNotMatch(app, /saveLegacyVatBanners|loadLegacyVatBanners/);
    });
});

/* ---------- 2. Нет hardcoded VAT-литералов в UI ---------- */

describe('VAT-1 Phase 5 / 2: UI не содержит hardcoded числовых VAT-литералов', () => {
    /* Исключения — НЕ UI-файлы или whitelisted: vatRateTable.js /
       vatResolver.js / migrations.js — там литералы ставок присутствуют
       обоснованно (справочник, миграция legacy ставок). */
    const WHITELIST = new Set([
        /* нет UI-исключений */
    ]);

    it('Нет 0.20/0.22/0.18 литералов в js/ui/ vat-блоках', () => {
        const files = walkJs(UI_ROOT);
        const offenders = [];
        for (const file of files) {
            const rel = file.replace(REPO_ROOT, '').replace(/\\/g, '/').replace(/^\//, '');
            if (WHITELIST.has(rel)) continue;
            const src = stripJsComments(readFileSync(file, 'utf8'));
            /* Ищем literal-значения 0.18/0.20/0.22 в коде, не в строках. */
            const re = /(?<![\d.])0\.(18|20|22)(?!\d)/g;
            let m;
            while ((m = re.exec(src)) !== null) {
                /* Допустимо `0.22` если оно НЕ относится к НДС (например,
                   некоторый risk-coefficient). Чтобы не зашуметь — фильтруем
                   по контексту: считаем VAT-литералом только если в радиусе
                   100 символов до/после есть слово vat/НДС. */
                const start = Math.max(0, m.index - 100);
                const end = Math.min(src.length, m.index + 100);
                const ctx = src.slice(start, end);
                if (/vat|НДС|VAT/i.test(ctx)) {
                    offenders.push(`${rel}:${src.slice(0, m.index).split('\n').length} → 0.${m[1]} в VAT-контексте`);
                }
            }
        }
        assert.deepEqual(offenders, [], offenders.join('\n'));
    });
});

/* ---------- 3. UI vat-блоки используют только ctx-методы ---------- */

describe('VAT-1 Phase 5 / 3: UI vat-блоки используют ctx, не state/controllers напрямую', () => {
    it('questionnaireVatSettings.js использует ctx.setVatRateMode/setVatRateManual/freezeVatRate', () => {
        const src = stripJsComments(readFileSync(
            join(REPO_ROOT, 'js', 'ui', 'questionnaireVatSettings.js'), 'utf8'));
        /* Покрываются три метода. */
        assert.match(src, /ctx\.setVatRateMode\(/);
        assert.match(src, /ctx\.setVatRateManual\(/);
        assert.match(src, /ctx\.freezeVatRate\(/);
    });

    it('questionnaire UI modules не импортируют calcController напрямую', () => {
        const src = [
            join(REPO_ROOT, 'js', 'ui', 'questionnaire.js'),
            join(REPO_ROOT, 'js', 'ui', 'questionnaireSettings.js'),
            join(REPO_ROOT, 'js', 'ui', 'questionnaireVatSettings.js')
        ].map(file => readFileSync(file, 'utf8')).join('\n');
        assert.doesNotMatch(src,
            /import\s+[^;]*\s+from\s+['"][^'"]*controllers\/calcController/);
    });
});

/* ---------- 4. VAT не называется риском ---------- */

describe('VAT-1 Phase 5: VAT не презентуется как риск', () => {
    it('Нет фразы «VAT risk» / «риск НДС» / «НДС-риск» в UI', () => {
        const files = walkJs(UI_ROOT);
        const offenders = [];
        for (const file of files) {
            const src = readFileSync(file, 'utf8');
            const m = src.match(/риск\s+НДС|НДС[-\s]риск|VAT\s+risk/i);
            if (m) offenders.push(`${file}: ${m[0]}`);
        }
        assert.deepEqual(offenders, []);
    });
});
