/**
 * Архитектурный инвариант (Stage 4, qty-модель ПРОМ, условие 6/7):
 * база vCPU ПРОМ ОДНА — она подставляется (через общий const CPU_BASE_VCPU в seed.js)
 * И в `cpu-vcpu-shared`, И в `ram-gb` (RAM выводится из той же базы). Не должно быть
 * двух расходящихся копий: иначе RAM разойдётся с CPU при правке одной из формул.
 *
 * Этот тест статически проверяет, что PROD-формула `ram-gb` содержит ровно ту же
 * базу vCPU, что и `cpu-vcpu-shared` (обёрнутую в ceil для перевода в целые ядра).
 * Если кто-то отредактирует базу в одном ЭК и забудет другой — тест падает at-commit.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_ITEMS } from '../../../js/domain/seed.js';

describe('CPU base single source (Stage 4)', () => {
    const cpu = SEED_ITEMS.find(i => i.id === 'cpu-vcpu-shared');
    const ram = SEED_ITEMS.find(i => i.id === 'ram-gb');

    it('cpu-vcpu-shared и ram-gb существуют', () => {
        assert.ok(cpu && ram);
    });

    it('cpu-vcpu-shared/PROD = ceil(<база>)', () => {
        const f = cpu.qtyFormulas.PROD;
        assert.ok(f.startsWith('ceil(') && f.endsWith(')'), `PROD-формула CPU должна быть ceil(...): ${f}`);
    });

    it('ram-gb использует ту же базу vCPU (ceil(<база>)) во всех стендах', () => {
        const base = cpu.qtyFormulas.PROD.slice('ceil('.length, -1);
        // база нетривиальна и содержит ключевые драйверы (защита от пустого/выродившегося base)
        for (const drv of ['Q.peak_rps', 'Q.pcu_target', 'Q.microservices_count',
            'Q.async_workers_count', 'Q.realtime_required', 'Q.cpu_advanced_model',
            'Q.min_instances_per_stand']) {
            assert.ok(base.includes(drv), `база vCPU должна содержать ${drv}`);
        }
        // каждая стенд-формула ram-gb должна содержать ceil(<та же база>)
        for (const stand of ['DEV', 'IFT', 'PSI', 'PROD', 'LOAD']) {
            const rf = ram.qtyFormulas[stand];
            assert.ok(rf.includes(`ceil(${base})`),
                `ram-gb/${stand} должна выводить RAM из той же базы vCPU ceil(<база>), иначе CPU и RAM разойдутся`);
        }
    });

    it('каждая стенд-формула cpu-vcpu-shared использует ту же базу', () => {
        const base = cpu.qtyFormulas.PROD.slice('ceil('.length, -1);
        for (const stand of ['DEV', 'IFT', 'PSI', 'PROD', 'LOAD']) {
            assert.ok(cpu.qtyFormulas[stand].includes(base),
                `cpu-vcpu-shared/${stand} должна использовать ту же базу vCPU`);
        }
    });
});
