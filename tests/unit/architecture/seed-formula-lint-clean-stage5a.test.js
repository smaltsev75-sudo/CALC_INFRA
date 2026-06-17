/**
 * Stage 5A — формула-линтер по РЕАЛЬНОМУ seed возвращает 0 предупреждений.
 *
 * Forcing function против дрейфа KNOWN_SETTINGS: если seed-формула ссылается на
 * новый производный S.* (Stage 1-2 ввёл S.aiInputTokensEffective /
 * S.aiRequestsPerMonth, Stage 5A — S.prodComputeVcpu и др.), а в KNOWN_SETTINGS
 * его забыли — линтер в UI/импорте ложно ругается «не относится к параметрам
 * расчёта». Существующие тесты lintFormulas прогоняли только синтетические
 * фикстуры и этот класс не ловили.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SEED_ITEMS, SEED_QUESTIONS } from '../../../js/domain/seed.js';
import { lintFormulas } from '../../../js/domain/validationFormulaLint.js';

describe('Stage 5A — lint реального seed чист', () => {
    const warnings = lintFormulas(SEED_ITEMS, SEED_QUESTIONS);

    it('0 unknownSetting (все S.* в KNOWN_SETTINGS)', () => {
        const bad = warnings.filter(w => w.type === 'unknownSetting')
            .map(w => `${w.itemId}/${w.stand}: S.${w.ref}`);
        assert.deepEqual(bad, [], `висящие S.*: ${bad.join('; ')}`);
    });
    it('0 unknownQuestion (все Q.* существуют)', () => {
        const bad = warnings.filter(w => w.type === 'unknownQuestion')
            .map(w => `${w.itemId}/${w.stand}: Q.${w.ref}`);
        assert.deepEqual(bad, [], `висящие Q.*: ${bad.join('; ')}`);
    });
    it('0 parseError (все формулы парсятся)', () => {
        const bad = warnings.filter(w => w.type === 'parseError')
            .map(w => `${w.itemId}/${w.stand}: ${w.message}`);
        assert.deepEqual(bad, [], `ошибки парсинга: ${bad.join('; ')}`);
    });
});
