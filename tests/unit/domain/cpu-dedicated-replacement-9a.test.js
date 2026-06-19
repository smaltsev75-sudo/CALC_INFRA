/**
 * Package 9A — CPU dedicated = REPLACEMENT semantics (Codex decision after verification).
 *
 * Before 9A: cpu-vcpu-shared counted the FULL peak_rps/50 on every stand, and
 * cpu-vcpu-dedicated ADDITIONALLY counted (peak_rps-100)/50 on PSI/PROD/LOAD — the
 * 100→peak RPS band was paid twice when RPS dominated the shared base.
 *
 * 9A model (replacement): on the stands where dedicated exists (PSI/PROD/LOAD) the shared
 * SIMPLE RPS term is capped at 100 (min(peak,100)/50); the >100 overage is carried by
 * cpu-vcpu-dedicated. DEV/IFT shared stay on the FULL base (no dedicated there). RAM stays
 * sized from the FULL CPU base (dedicated vCPUs still need RAM) — ram-gb is untouched.
 * Advanced CPU model follows the same split: shared carries the first 100 RPS using
 * cpu_ms/target_util conversion, dedicated carries the >100 RPS overage using the
 * same conversion. This prevents the same double-count behind the advanced toggle.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SEED_ITEMS, SEED_SETTINGS, enrichLegacyDictionaryWithAgentSeed } from '../../../js/domain/seed.js';
import { parseFormula } from '../../../js/domain/formula/parser.js';
import { evaluate } from '../../../js/domain/formula/evaluator.js';

const byId = (id) => SEED_ITEMS.find(i => i.id === id);

function qty(itemId, stand, Q) {
    const it = byId(itemId);
    const f = it.qtyFormulas[stand];
    if (!f) return 0;
    return evaluate(parseFormula(f), { Q, S: SEED_SETTINGS, STAND: stand });
}

// Controlled answer set; only the fields a formula reads matter (rest → 0 via toNum).
function answers(extra) {
    return {
        peak_rps: 0, pcu_target: 0, microservices_count: 0, async_workers_count: 0,
        realtime_required: false, min_instances_per_stand: 0, cpu_advanced_model: false,
        cpu_ms_per_request: 0, cpu_target_utilization_percent: 50,
        ram_per_vcpu_ratio: 4, cache_size_gb: 8, ram_advanced_model: false,
        ram_app_baseline_gb_per_service: 0, ram_per_realtime_connection_kb: 0,
        ...extra
    };
}

describe('9A: cpu-vcpu-dedicated replacement semantics', () => {
    it('RPS-dominated peak_rps=200 (pcu=0): PROD shared capped + dedicated = full RPS, no double-count', () => {
        const Q = answers({ peak_rps: 200 }); // pcu/200=0, RPS dominates
        const sh = qty('cpu-vcpu-shared', 'PROD', Q);
        const de = qty('cpu-vcpu-dedicated', 'PROD', Q);
        assert.equal(sh, 2, 'shared PROD = ceil(min(200,100)/50) = 2');
        assert.equal(de, 2, 'dedicated PROD = ceil((200-100)/50) = 2');
        assert.equal(sh + de, 4, 'shared+dedicated = full peak_rps/50 = 4 (no double-count)');
    });

    it('DEV/IFT shared stay on FULL base (no dedicated there) — peak_rps=600', () => {
        const Q = answers({ peak_rps: 600 }); // full base = 12; capped would be 2
        assert.equal(qty('cpu-vcpu-shared', 'DEV', Q), 3, 'DEV = ceil(12 * 0.20) = 3 (full base)');
        assert.equal(qty('cpu-vcpu-shared', 'IFT', Q), 5, 'IFT = ceil(12 * 0.40) = 5 (full base)');
        // dedicated must not apply on DEV/IFT
        assert.equal(qty('cpu-vcpu-dedicated', 'DEV', Q), 0, 'dedicated has no DEV formula');
        assert.equal(qty('cpu-vcpu-dedicated', 'IFT', Q), 0, 'dedicated has no IFT formula');
    });

    it('RAM stays sized from FULL CPU base (ram-gb untouched) — peak_rps=200', () => {
        const Q = answers({ peak_rps: 200, ram_per_vcpu_ratio: 4, cache_size_gb: 8 });
        // full base PROD = ceil(4); RAM = ceil(4*4 + 8) = 24. Capped base (2) would give 16.
        assert.equal(qty('ram-gb', 'PROD', Q), 24, 'RAM PROD uses full CPU base (24, not 16)');
    });

    it('PCU-dominated (pcu/200 > peak_rps/50): shared unchanged, dedicated still overage', () => {
        const Q = answers({ peak_rps: 120, pcu_target: 40000 }); // pcu/200 = 200 dominates
        assert.equal(qty('cpu-vcpu-shared', 'PROD', Q), 200, 'shared PROD dominated by pcu (cap is a no-op)');
        assert.equal(qty('cpu-vcpu-dedicated', 'PROD', Q), 1, 'dedicated = ceil((120-100)/50) = 1');
    });

    it('peak_rps <= 100: no double-count, shared unchanged, dedicated zero', () => {
        const Q = answers({ peak_rps: 80 });
        assert.equal(qty('cpu-vcpu-shared', 'PROD', Q), 2, 'shared PROD = ceil(80/50) = 2 (cap no-op at <=100)');
        assert.equal(qty('cpu-vcpu-dedicated', 'PROD', Q), 0, 'dedicated = 0 at peak_rps <= 100');
    });

    it('advanced CPU mode: shared first 100 RPS + dedicated overage = full advanced RPS CPU', () => {
        const Q = answers({
            cpu_advanced_model: true,
            peak_rps: 200,
            cpu_ms_per_request: 50,
            cpu_target_utilization_percent: 50
        });
        const sh = qty('cpu-vcpu-shared', 'PROD', Q);
        const de = qty('cpu-vcpu-dedicated', 'PROD', Q);
        assert.equal(sh, 10, 'shared PROD = ceil(100 * 50ms / 1000 / 0.5) = 10');
        assert.equal(de, 10, 'dedicated PROD = ceil((200-100) * 50ms / 1000 / 0.5) = 10');
        assert.equal(sh + de, 20, 'shared+dedicated = full advanced RPS CPU, no double-count');
    });

    it('advanced CPU mode at <=100 RPS: dedicated zero and shared equals full advanced base', () => {
        const Q = answers({
            cpu_advanced_model: true,
            peak_rps: 80,
            cpu_ms_per_request: 50,
            cpu_target_utilization_percent: 50
        });
        assert.equal(qty('cpu-vcpu-shared', 'PROD', Q), 8, 'shared PROD = ceil(80 * 50ms / 1000 / 0.5) = 8');
        assert.equal(qty('cpu-vcpu-dedicated', 'PROD', Q), 0, 'dedicated = 0 at peak_rps <= 100');
    });

    it('legacy enrichment refreshes cpu-vcpu-dedicated formula (it is in the refresh list)', () => {
        const seedDedicated = byId('cpu-vcpu-dedicated');
        const calc = {
            dictionaries: {
                questions: [],
                items: [
                    // legacy stale dedicated formula (pre-9A / pre-existence)
                    { id: 'cpu-vcpu-dedicated', name: 'x', unit: 'шт.', category: 'HW',
                      resourceClass: 'CPU', billingInterval: 'monthly', pricePerUnit: 550,
                      applicableStands: ['PROD'], qtyFormulas: { PROD: '0' } }
                ]
            }
        };
        enrichLegacyDictionaryWithAgentSeed(calc);
        const refreshed = calc.dictionaries.items.find(i => i.id === 'cpu-vcpu-dedicated');
        assert.deepEqual(refreshed.qtyFormulas, seedDedicated.qtyFormulas,
            'legacy cpu-vcpu-dedicated formula refreshed to current seed (must be in _AGENT_FORMULA_REFRESH_IDS)');
    });

    it('shared capped base differs from full base only in the RPS term (simple and advanced)', () => {
        const sh = byId('cpu-vcpu-shared');
        // PROD (capped) contains the capped RPS terms; DEV (full) contains the uncapped terms.
        assert.ok(sh.qtyFormulas.PROD.includes('min(Q.peak_rps, 100) / 50'),
            'PROD shared caps simple RPS at 100');
        assert.ok(sh.qtyFormulas.PROD.includes('min(Q.peak_rps, 100) * Q.cpu_ms_per_request'),
            'PROD shared caps advanced RPS at 100');
        assert.ok(sh.qtyFormulas.PSI.includes('min(Q.peak_rps, 100) / 50'), 'PSI shared capped');
        assert.ok(sh.qtyFormulas.LOAD.includes('min(Q.peak_rps, 100) / 50'), 'LOAD shared capped');
        assert.ok(sh.qtyFormulas.DEV.includes('Q.peak_rps / 50') && !sh.qtyFormulas.DEV.includes('min(Q.peak_rps, 100) / 50'),
            'DEV shared keeps full uncapped RPS term');
        assert.ok(sh.qtyFormulas.DEV.includes('Q.peak_rps * Q.cpu_ms_per_request') &&
            !sh.qtyFormulas.DEV.includes('min(Q.peak_rps, 100) * Q.cpu_ms_per_request'),
            'DEV shared keeps full uncapped advanced RPS term');
        assert.ok(sh.qtyFormulas.IFT.includes('Q.peak_rps / 50') && !sh.qtyFormulas.IFT.includes('min(Q.peak_rps, 100) / 50'),
            'IFT shared keeps full uncapped RPS term');
        assert.ok(sh.qtyFormulas.IFT.includes('Q.peak_rps * Q.cpu_ms_per_request') &&
            !sh.qtyFormulas.IFT.includes('min(Q.peak_rps, 100) * Q.cpu_ms_per_request'),
            'IFT shared keeps full uncapped advanced RPS term');
    });
});
