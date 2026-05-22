/**
 * Stage VAT-1 Phase 5 + Phase 7.1 bugfix: multi-period warning в Опроснике.
 *
 * Acceptance:
 *   - Текст warning строится из VAT_RATE_HISTORY динамически (никаких
 *     hardcoded 2026/20%/22%).
 *   - Источник периода — пользовательский `launch_year` + `planningHorizonYears`,
 *     НЕ `vatEffectiveDate` (бугфикс Phase 7.1).
 *   - Сценарии: launchYear=2025+h=2 показывает warning; launchYear=2026+h=2 — нет
 *     (период целиком в текущем периоде справочника).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';
import { getVatPeriodCrossings } from '../../../js/domain/vatRateTable.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const QUESTIONNAIRE_SETTINGS_PATH = join(REPO_ROOT, 'js', 'ui', 'questionnaireVatSettings.js');
const QUEST_SRC = stripJsComments(readFileSync(
    QUESTIONNAIRE_SETTINGS_PATH, 'utf8'));

/* ---------- Source-level контрактные проверки ---------- */

describe('Multi-period warning: использует getVatPeriodCrossings из справочника', () => {
    it('Импорт getVatPeriodCrossings из vatRateTable.js присутствует', () => {
        const src = readFileSync(QUESTIONNAIRE_SETTINGS_PATH, 'utf8');
        assert.match(src,
            /import\s*\{\s*getVatPeriodCrossings\s*\}\s*from\s*['"]\.\.\/domain\/vatRateTable\.js['"]/);
    });

    it('renderVatMultiPeriodWarning принимает (launchYear, planningHorizonYears) — bugfix Phase 7.1', () => {
        /* После bugfix сигнатура — `(launchYear, planningHorizonYears)`. */
        assert.match(QUEST_SRC,
            /function renderVatMultiPeriodWarning\(launchYear,\s*planningHorizonYears\)/);
    });

    it('Внутри функции строится startDate = `${launchYear}-01-01` и передаётся в getVatPeriodCrossings', () => {
        assert.match(QUEST_SRC,
            /const\s+startDate\s*=\s*`\$\{launchYear\}-01-01`/);
        assert.match(QUEST_SRC,
            /getVatPeriodCrossings\(\s*startDate\s*,\s*planningHorizonYears\s*\)/);
    });

    it('renderSettingsGroupVat читает launchYear из calc.answers.launch_year с fallback на SEED defaultIfUnknown', () => {
        /* calc.answers.launch_year — пользовательский ответ.
           Если null → fallback через SEED_BY_ID. */
        assert.match(QUEST_SRC, /calc\?\.answers\?\.launch_year/);
        assert.match(QUEST_SRC, /SEED_BY_ID\.get\(['"]launch_year['"]\)\?\.defaultIfUnknown/);
    });

    it('Никаких hardcode-литералов 2026/2025 в renderVatMultiPeriodWarning', () => {
        const m = QUEST_SRC.match(/function renderVatMultiPeriodWarning\([^)]*\)\s*\{([\s\S]*?)\n\}\n/);
        assert.ok(m, 'функция renderVatMultiPeriodWarning не найдена');
        const body = m[1];
        /* startDate содержит шаблонное `${launchYear}-01-01`, а не литерал. */
        assert.doesNotMatch(body, /['"]\b202[0-9]-/,
            'найден hardcoded литерал ISO-даты `"202x-..."` в теле warning');
    });

    it('Никаких hardcode-литералов 20%/22% в строке warning', () => {
        const m = QUEST_SRC.match(/function renderVatMultiPeriodWarning\([^)]*\)\s*\{([\s\S]*?)\n\}\n/);
        assert.ok(m);
        const body = m[1];
        assert.doesNotMatch(body, /['"`][^'"`]*\b(18|20|22)\s*%/,
            'найден hardcode процента в строке warning — должен браться из crossings.from/to');
    });

    it('Текст warning составляется из шаблонных переменных fromPct/toPct/formatDate(c.date)', () => {
        assert.match(QUEST_SRC, /\$\{formatDate\(c\.date\)\}/);
        assert.match(QUEST_SRC, /\$\{fromPct\}/);
        assert.match(QUEST_SRC, /\$\{toPct\}/);
    });

    it('Warning имеет role="status" + aria-live="polite" (a11y, non-blocking)', () => {
        assert.match(QUEST_SRC,
            /class:\s*'vat-multiperiod-warning'[\s\S]{0,200}role:\s*'status'/);
        assert.match(QUEST_SRC,
            /'aria-live':\s*'polite'/);
    });
});

/* ---------- Condition gating ---------- */

describe('Multi-period warning: condition gating', () => {
    it('Не рендерится при невалидном launchYear', () => {
        assert.match(QUEST_SRC,
            /if\s*\(!Number\.isFinite\(launchYear\)\s*\|\|\s*!Number\.isFinite\(planningHorizonYears\)\)\s*return\s+null/);
    });

    it('Не рендерится при planningHorizonYears ≤ 0', () => {
        assert.match(QUEST_SRC,
            /if\s*\(planningHorizonYears\s*<=\s*0\)\s*return\s+null/);
    });

    it('Не рендерится при crossings.length === 0', () => {
        assert.match(QUEST_SRC,
            /if\s*\(crossings\.length\s*===\s*0\)\s*return\s+null/);
    });
});

/* ---------- Functional: проверяем поведение через getVatPeriodCrossings ---------- */

describe('Multi-period warning: функциональное поведение по сценариям', () => {
    /* Эти тесты проверяют, что справочник возвращает то, что ожидает warning. */

    it('launchYear=2025, planningHorizonYears=2 → crossing на 01.01.2026 (20→22)', () => {
        const cs = getVatPeriodCrossings('2025-01-01', 2);
        assert.equal(cs.length, 1);
        assert.equal(cs[0].date, '2026-01-01');
        assert.equal(cs[0].from, 0.20);
        assert.equal(cs[0].to, 0.22);
    });

    it('launchYear=2025, planningHorizonYears=1 → crossing (период [2025, 2026], включает 01.01.2026)', () => {
        const cs = getVatPeriodCrossings('2025-01-01', 1);
        assert.equal(cs.length, 1);
        assert.equal(cs[0].date, '2026-01-01');
    });

    it('launchYear=2026, planningHorizonYears=2 → нет crossing (целиком в текущем периоде 22%)', () => {
        const cs = getVatPeriodCrossings('2026-01-01', 2);
        assert.equal(cs.length, 0);
    });

    it('launchYear=2026, planningHorizonYears=10 → нет crossing (нет след. смены в справочнике)', () => {
        const cs = getVatPeriodCrossings('2026-01-01', 10);
        assert.equal(cs.length, 0);
    });

    it('launchYear=2018, planningHorizonYears=10 → 2 crossings (2019 и 2026)', () => {
        const cs = getVatPeriodCrossings('2018-01-01', 10);
        assert.equal(cs.length, 2);
        assert.equal(cs[0].date, '2019-01-01');
        assert.equal(cs[1].date, '2026-01-01');
    });

    it('vatEffectiveDate НЕ влияет — справочник работает с любой start-датой', () => {
        /* Sanity: если в bugfix кто-то вернёт vatEffectiveDate как источник —
           для launchYear=2025 и vatEffectiveDate=2026-05-12 поведение РАЗНОЕ.
           Этот тест документирует, что справочник для start=2025-01-01 даёт
           crossing, а для start=2026-05-12 — нет. Источник должен быть launchYear. */
        const csFromLaunchYear = getVatPeriodCrossings('2025-01-01', 2);
        const csFromVatEffectiveDate = getVatPeriodCrossings('2026-05-12', 2);
        assert.equal(csFromLaunchYear.length, 1);
        assert.equal(csFromVatEffectiveDate.length, 0);
    });
});
