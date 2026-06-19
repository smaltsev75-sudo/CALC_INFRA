/**
 * Архитектурный инвариант (Stage 4 + Package 9A).
 *
 * Stage 4: база vCPU ПРОМ — единый источник, без расходящихся копий.
 *
 * Package 9A (CPU dedicated = replacement semantics): база теперь СВЯЗАННАЯ пара —
 *   - ПОЛНАЯ база (CPU_BASE_VCPU): RPS-член = full peak_rps (simple или advanced);
 *   - capped база (CPU_BASE_VCPU_SHARED_CAPPED): тот же текст, но RPS-член
 *     = first 100 RPS (simple или advanced); RPS сверх 100 несёт cpu-vcpu-dedicated.
 * Контракт:
 *   - ram-gb во ВСЕХ стендах выводит RAM из ПОЛНОЙ базы (RAM сайзится от суммарной
 *     нагрузки shared+dedicated — выделенным ядрам тоже нужна память);
 *   - cpu-vcpu-shared DEV/ИФТ — ПОЛНАЯ база (выделенных ядер на этих стендах нет);
 *   - cpu-vcpu-shared ПСИ/ПРОМ/НТ — capped база;
 *   - capped база отличается от полной РОВНО RPS-компонентом (full peak vs first 100),
 *     иначе кто-то отредактировал одну базу и забыл другую — тест падает at-commit.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_ITEMS } from '../../../js/domain/seed.js';

describe('CPU base single source (Stage 4 + Package 9A split)', () => {
    const cpu = SEED_ITEMS.find(i => i.id === 'cpu-vcpu-shared');
    const ram = SEED_ITEMS.find(i => i.id === 'ram-gb');

    it('cpu-vcpu-shared и ram-gb существуют', () => {
        assert.ok(cpu && ram);
    });

    it('cpu-vcpu-shared/PROD = ceil(<capped база>), DEV = ceil((<полная база>) * ratio)', () => {
        assert.ok(cpu.qtyFormulas.PROD.startsWith('ceil(') && cpu.qtyFormulas.PROD.endsWith(')'),
            `PROD-формула CPU должна быть ceil(...): ${cpu.qtyFormulas.PROD}`);
        assert.ok(cpu.qtyFormulas.DEV.startsWith('ceil((') && cpu.qtyFormulas.DEV.endsWith(') * S.standSizeRatio.DEV)'),
            `DEV-формула CPU должна быть ceil((<база>) * ratio): ${cpu.qtyFormulas.DEV}`);
    });

    // ПОЛНАЯ база — из DEV-формулы shared (DEV использует полную базу).
    const fullBase = cpu.qtyFormulas.DEV.slice('ceil(('.length, -') * S.standSizeRatio.DEV)'.length);
    // capped база — из PROD-формулы shared.
    const cappedBase = cpu.qtyFormulas.PROD.slice('ceil('.length, -1);

    it('полная база нетривиальна и содержит ключевые драйверы + НЕкапнутые RPS-члены', () => {
        for (const drv of ['Q.peak_rps', 'Q.pcu_target', 'Q.microservices_count',
            'Q.async_workers_count', 'Q.realtime_required', 'Q.cpu_advanced_model',
            'Q.min_instances_per_stand']) {
            assert.ok(fullBase.includes(drv), `полная база vCPU должна содержать ${drv}`);
        }
        assert.ok(fullBase.includes('Q.peak_rps / 50'), 'полная база содержит НЕкапнутый простой RPS-член');
        assert.ok(fullBase.includes('Q.peak_rps * Q.cpu_ms_per_request / 1000'),
            'полная база содержит НЕкапнутый advanced RPS-член');
        assert.ok(!fullBase.includes('min(Q.peak_rps, 100) / 50'), 'полная база НЕ капает простой RPS');
        assert.ok(!fullBase.includes('min(Q.peak_rps, 100) * Q.cpu_ms_per_request'),
            'полная база НЕ капает advanced RPS');
    });

    it('capped база = полная база с заменой только RPS-члена (full peak → first 100)', () => {
        const expected = fullBase
            .replace('Q.peak_rps * Q.cpu_ms_per_request', 'min(Q.peak_rps, 100) * Q.cpu_ms_per_request')
            .replace('Q.peak_rps / 50', 'min(Q.peak_rps, 100) / 50');
        assert.equal(cappedBase, expected,
            'capped база должна отличаться от полной РОВНО RPS-членом — иначе базы разошлись');
        assert.ok(cappedBase.includes('min(Q.peak_rps, 100) / 50'), 'capped база капает простой RPS на 100');
        assert.ok(cappedBase.includes('min(Q.peak_rps, 100) * Q.cpu_ms_per_request'),
            'capped база капает advanced RPS на 100');
    });

    it('ram-gb во ВСЕХ стендах выводит RAM из ПОЛНОЙ базы (ceil(<полная база>))', () => {
        for (const stand of ['DEV', 'IFT', 'PSI', 'PROD', 'LOAD']) {
            assert.ok(ram.qtyFormulas[stand].includes(`ceil(${fullBase})`),
                `ram-gb/${stand} должна выводить RAM из ПОЛНОЙ базы vCPU, не из capped`);
        }
    });

    it('cpu-vcpu-shared: DEV/ИФТ — полная база; ПСИ/ПРОМ/НТ — capped база', () => {
        for (const stand of ['DEV', 'IFT']) {
            assert.ok(cpu.qtyFormulas[stand].includes(fullBase),
                `cpu-vcpu-shared/${stand} должна использовать ПОЛНУЮ базу (dedicated там не применяется)`);
            assert.ok(!cpu.qtyFormulas[stand].includes('min(Q.peak_rps, 100) / 50'),
                `cpu-vcpu-shared/${stand} НЕ должна капать RPS`);
        }
        for (const stand of ['PSI', 'PROD', 'LOAD']) {
            assert.ok(cpu.qtyFormulas[stand].includes(cappedBase),
                `cpu-vcpu-shared/${stand} должна использовать capped базу (RPS сверх 100 → dedicated)`);
        }
    });
});
