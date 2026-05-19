/**
 * Stage 17.4 — Sensitivity Analysis спрятан за «Расширенный режим».
 *
 * Контекст: дашборд уже отвечает на «что дорого?» (Распределение по категориям)
 * и «сколько добавили риски?» (Вклад риск-коэффициентов). Анализ чувствительности —
 * другой вопрос («какую вводную выгоднее изменить?»), но это perturbation-инструмент
 * для архитектора, не для дефолтного пользователя. Он остаётся в коде/IA, но
 * подсказка «Найти драйверы стоимости» в Next Steps скрыта пока
 * advancedModeEnabled = false.
 *
 * Контракт:
 *   1. ADVANCED_ONLY_NEXT_STEP_TARGETS содержит 'sensitivity_analysis'.
 *   2. ctx.getActiveNextSteps() в дефолтном режиме фильтрует advanced-only targets.
 *   3. ctx.getActiveNextSteps() в advancedMode пропускает их.
 *   4. buildRecommendedActions сам по себе НЕ фильтрует — гейт на UI-уровне.
 *      (Так модалка Sensitivity остаётся доступной для прямых вызовов из advanced-IA
 *      и для существующих тестов sensitivity-domain.)
 *   5. UserManual.md помечает Sensitivity как advanced-only.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8');

describe('Stage 17.4 — ADVANCED_ONLY_NEXT_STEP_TARGETS константа', () => {
    it('экспортируется из constants.js и содержит sensitivity_analysis', async () => {
        const mod = await import('../../../js/utils/constants.js');
        assert.ok(Array.isArray(mod.ADVANCED_ONLY_NEXT_STEP_TARGETS),
            'ADVANCED_ONLY_NEXT_STEP_TARGETS должен экспортироваться из constants.js');
        assert.ok(mod.ADVANCED_ONLY_NEXT_STEP_TARGETS.includes('sensitivity_analysis'),
            'sensitivity_analysis должен быть advanced-only target.');
    });

    it('Object.freeze — массив immutable', async () => {
        const mod = await import('../../../js/utils/constants.js');
        assert.equal(Object.isFrozen(mod.ADVANCED_ONLY_NEXT_STEP_TARGETS), true);
    });
});

describe('Stage 17.4 — getActiveNextSteps фильтрует advanced-only по умолчанию', () => {
    const src = stripJsComments(read('js/app.js'));
    const fnMatch = src.match(/getActiveNextSteps\s*\(\s*\)\s*\{[\s\S]+?\n\s{4}\},/);
    assert.ok(fnMatch, 'getActiveNextSteps должен существовать в app.js');
    const body = fnMatch[0];

    it('читает state.ui.advancedModeEnabled', () => {
        assert.match(body, /advancedModeEnabled/,
            'getActiveNextSteps должен читать advancedModeEnabled — иначе гейт не работает.');
    });

    it('фильтрует через ADVANCED_ONLY_NEXT_STEP_TARGETS', () => {
        assert.match(body, /ADVANCED_ONLY_NEXT_STEP_TARGETS/,
            'Фильтр должен использовать константу-whitelist, не хардкод имени target.');
    });

    it('импорт ADVANCED_ONLY_NEXT_STEP_TARGETS добавлен в шапку app.js', () => {
        assert.match(src, /import\s*\{[^}]*ADVANCED_ONLY_NEXT_STEP_TARGETS[^}]*\}\s*from\s*['"][^'"]*constants\.js['"]/);
    });
});

describe('Stage 17.4 — buildRecommendedActions остаётся pure (НЕ читает advancedMode)', () => {
    const src = stripJsComments(read('js/domain/recommendedActions.js'));

    it('domain-функция не знает про advancedModeEnabled', () => {
        assert.equal(src.includes('advancedModeEnabled'), false,
            'Domain-слой не должен знать про UI-флаг — гейт принадлежит UI/ctx.');
    });

    it('sensitivity_analysis target всё ещё формируется domain-функцией', () => {
        assert.match(src, /target:\s*['"]sensitivity_analysis['"]/,
            'Domain должен продолжать предлагать sensitivity — UI решает, показывать или нет.');
    });
});

describe('Stage 17.4 — UserManual.md помечает Sensitivity как advanced-only', () => {
    const src = read('UserManual.md');

    it('заголовок раздела упоминает advanced/расширенный', () => {
        assert.match(src, /Анализ чувствительности[^\n]*расширен/i,
            'Заголовок «Анализ чувствительности» должен включать пометку «(только в расширенном режиме)».');
    });

    it('явно указывает, что основной cost-analysis — на дашборде', () => {
        assert.match(src, /Распределение по категориям/,
            'UserManual должен явно отсылать к категориям как основному анализу.');
        assert.match(src, /Вклад риск-коэффициентов/,
            'UserManual должен явно отсылать к риск-коэффициентам как основному анализу.');
    });
});
