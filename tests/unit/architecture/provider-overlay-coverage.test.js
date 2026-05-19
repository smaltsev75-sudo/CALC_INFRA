/**
 * 14.U6 architectural lint: каждый ключ в PROVIDER_OVERLAYS[*].prices обязан
 * существовать в SEED_ITEMS.id. Защита от опечаток ID после переименования
 * элементов в seed.js — applyProviderOverlay silent fallback'ит на seed-цены,
 * и без линтера mismatched id остался бы незамеченным.
 *
 * Также проверяется структура каждой записи: { pricePerUnit: number,
 * vendor: string, priceSource: string }.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDER_OVERLAYS } from '../../../js/domain/providerOverlay.js';
import { SEED_ITEMS } from '../../../js/domain/seed.js';

const seedIds = new Set(SEED_ITEMS.map(i => i.id));

describe('14.U6 PROVIDER_OVERLAYS: id coverage', () => {
    for (const [providerId, overlay] of Object.entries(PROVIDER_OVERLAYS)) {
        const prices = overlay.prices || {};
        const ids = Object.keys(prices);
        if (ids.length === 0) continue;  // stub'ы (cloud_ru/yandex/...) — пропускаем

        describe(`provider=${providerId} (${ids.length} цен)`, () => {
            for (const id of ids) {
                it(`item.id "${id}" существует в SEED_ITEMS`, () => {
                    assert.ok(seedIds.has(id),
                        `id "${id}" в PROVIDER_OVERLAYS.${providerId}.prices не найден ` +
                        `в SEED_ITEMS — возможно, item был переименован в seed.js. ` +
                        `Известные id (первые 5): ${Array.from(seedIds).slice(0, 5).join(', ')}…`);
                });

                it(`запись для "${id}" имеет валидную структуру`, () => {
                    const entry = prices[id];
                    assert.ok(entry && typeof entry === 'object', 'запись должна быть объектом');
                    assert.ok(Number.isFinite(entry.pricePerUnit) && entry.pricePerUnit > 0,
                        `pricePerUnit должен быть положительным числом, получено ${entry.pricePerUnit}`);
                    assert.ok(typeof entry.vendor === 'string' && entry.vendor.length > 0,
                        'vendor должен быть непустой строкой');
                    assert.ok(typeof entry.priceSource === 'string' && entry.priceSource.length > 0,
                        'priceSource должен быть непустой строкой');
                });
            }
        });
    }
});

describe('Stage VAT-2 Phase 4: PROVIDER_OVERLAYS.sbercloud — coverage из bundled JSON', () => {
    /* После Phase 4 source-of-truth = data/providers/sbercloud-latest.json
     * (через js/data/providers-bundled.generated.js). Coverage уже НЕ
     * жёстко-фиксированный список — он отражает текущий contractual прайс
     * Cloud.ru Q3-2026. */

    it('SberCloud содержит непустой набор цен', () => {
        const ids = Object.keys(PROVIDER_OVERLAYS.sbercloud.prices);
        assert.ok(ids.length >= 10,
            `ожидаем минимум 10 ЭК в overlay.sbercloud, получено ${ids.length}: ${ids.join(', ')}`);
    });

    it('core compute/storage SKU присутствуют (общая база для Q3-2026 bundled providers)', () => {
        /* Эти 8 ЭК — core compute/storage/network — должны быть у любого
         * cloud-провайдера, даже после изменений бизнес-фокуса. AI/LLM/RAG и
         * licenses/services — provider-specific, могут отсутствовать. */
        const coreExpected = [
            'cpu-vcpu-shared', 'cpu-vcpu-gpu',
            'ram-gb',
            'storage-ssd-tb', 'storage-hdd-tb', 'storage-object-tb',
            'network-lb-l7', 'network-waf'
        ];
        const actual = Object.keys(PROVIDER_OVERLAYS.sbercloud.prices);
        for (const id of coreExpected) {
            assert.ok(actual.includes(id), `${id} должен быть в SberCloud overlay`);
        }
    });
});
