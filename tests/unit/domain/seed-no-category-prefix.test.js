/**
 * Regression-тест к 12.U30 (1.5d): имена ЭК НЕ должны начинаться с
 * слова, дублирующего category-label. Аккордеон уже показывает категорию
 * сверху — повторять её в названии каждой строки = бесполезный дубль.
 *
 * Контракт:
 *   - LICENSE-категория: имя НЕ начинается с «Лицензия »
 *   - TRAFFIC-категория: имя НЕ содержит слова «трафик»/«Трафик»
 *
 * Если в будущем добавятся новые ЭК — сразу ловится этим тестом.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_ITEMS } from '../../../js/domain/seed.js';

describe('seed: имена ЭК не дублируют категорию-аккордеон', () => {
    it('LICENSE: ни одно имя не начинается с «Лицензия »', () => {
        const offenders = SEED_ITEMS
            .filter(it => it.category === 'LICENSE')
            .filter(it => /^Лицензи/i.test(it.name));
        assert.deepEqual(offenders.map(o => o.id), [],
            `LICENSE-ЭК с префиксом «Лицензия» в имени: ${offenders.map(o => o.name).join('; ')}`);
    });

    it('TRAFFIC: имя не содержит слова «трафик» (категория уже называется ТРАФИК)', () => {
        const offenders = SEED_ITEMS
            .filter(it => it.category === 'TRAFFIC')
            .filter(it => /трафик/i.test(it.name));
        assert.deepEqual(offenders.map(o => o.id), [],
            `TRAFFIC-ЭК со словом «трафик» в имени: ${offenders.map(o => o.name).join('; ')}`);
    });
});
