/**
 * Unit-тесты для wizard engine.
 *
 * Проверяем:
 *   1. wizardToAnswers возвращает валидный объект для всех комбинаций.
 *   2. SLA preset правильно применяется (sla_target → DR-поля).
 *   3. Compliance rules ведут себя предсказуемо (fintech ≫ corporate).
 *   4. pcu_target вычисляется по правильной формуле.
 *   5. Geography multipliers работают (global ×3 на egress).
 *   6. Activity multiplier (low ×0.5, high ×2.0).
 *   7. AI-блок только при ai_used=true.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    wizardToAnswers,
    SCALE_RULES,
    PCU_SHARE_BY_TYPE,
    SLA_PRESETS,
    INDUSTRY_PROFILES,
    PRODUCT_TYPE_OVERRIDES,
    snapSlaToPreset,
    computeCompliance
} from '../../../js/domain/wizardProfiles.js';
import { SEED_QUESTIONS } from '../../../js/domain/seed.js';
import { validateAnswersConsistency } from '../../../js/domain/validation.js';

const SCALES = ['xs', 's', 'm', 'l', 'xl'];
const INDUSTRIES = Object.keys(INDUSTRY_PROFILES);  // ['corporate', 'edtech', 'fintech']
const PRODUCT_TYPES = Object.keys(PRODUCT_TYPE_OVERRIDES);  // ['internal', 'b2b', 'b2c', 'b2g']

describe('wizardProfiles — структура данных', () => {
    it('SCALE_RULES имеет все 5 уровней', () => {
        SCALES.forEach(s => {
            assert.ok(SCALE_RULES[s], `SCALE_RULES.${s} отсутствует`);
            assert.ok(typeof SCALE_RULES[s].registered_users_total === 'number');
            assert.ok(typeof SCALE_RULES[s].peak_rps === 'number');
        });
    });

    it('PCU_SHARE_BY_TYPE покрывает все 4 типа × 5 масштабов', () => {
        PRODUCT_TYPES.forEach(t => {
            assert.ok(PCU_SHARE_BY_TYPE[t], `PCU_SHARE_BY_TYPE.${t} отсутствует`);
            SCALES.forEach(s => {
                const v = PCU_SHARE_BY_TYPE[t][s];
                assert.ok(v > 0 && v <= 1, `PCU_SHARE_BY_TYPE.${t}.${s} = ${v}, ожидаем 0 < x ≤ 1`);
            });
        });
    });

    it('SLA_PRESETS покрывает 9 канонических уровней', () => {
        const expected = [93, 95, 96, 98, 99.0, 99.5, 99.9, 99.95, 99.99];
        expected.forEach(lvl => {
            assert.ok(SLA_PRESETS[lvl], `SLA_PRESETS[${lvl}] отсутствует`);
            const p = SLA_PRESETS[lvl];
            assert.ok(typeof p.rto_hours === 'number');
            assert.ok(typeof p.rpo_minutes === 'number');
            assert.ok(typeof p.georedundancy_required === 'boolean');
        });
    });

    it('SLA_PRESETS — RTO монотонно убывает с ростом SLA', () => {
        // 93→24, 99.99→0.25 — должна быть монотонная цепочка
        const levels = Object.keys(SLA_PRESETS).map(Number).sort((a, b) => a - b);
        let prevRto = Infinity;
        levels.forEach(lvl => {
            const rto = SLA_PRESETS[lvl].rto_hours;
            assert.ok(rto <= prevRto, `RTO для SLA ${lvl} = ${rto} > предыдущего ${prevRto}`);
            prevRto = rto;
        });
    });

    it('SLA_PRESETS — georedundancy включается с 99.9 и выше', () => {
        assert.strictEqual(SLA_PRESETS[99.5].georedundancy_required, false);
        assert.strictEqual(SLA_PRESETS[99.9].georedundancy_required, true);
        assert.strictEqual(SLA_PRESETS[99.95].georedundancy_required, true);
        assert.strictEqual(SLA_PRESETS[99.99].georedundancy_required, true);
    });

    it('INDUSTRY_PROFILES — все 4 (MVP) имеют label, defaults, ai', () => {
        ['corporate', 'edtech', 'fintech', 'consumer'].forEach(id => {
            const p = INDUSTRY_PROFILES[id];
            assert.ok(p.label, `${id}: label`);
            assert.ok(p.defaults, `${id}: defaults`);
            assert.ok(p.ai, `${id}: ai`);
            assert.ok(typeof p.defaults.sla_target === 'number', `${id}: sla_target должен быть number`);
        });
    });

    it('INDUSTRY_PROFILES — fintech.sla_target = 99.9, остальные = 98', () => {
        assert.strictEqual(INDUSTRY_PROFILES.fintech.defaults.sla_target, 99.9);
        assert.strictEqual(INDUSTRY_PROFILES.corporate.defaults.sla_target, 98);
        assert.strictEqual(INDUSTRY_PROFILES.edtech.defaults.sla_target, 98);
        assert.strictEqual(INDUSTRY_PROFILES.consumer.defaults.sla_target, 98);
    });

    it('INDUSTRY_PROFILES.consumer — UGC-heavy: file_storage scale × 10, traffic × 5', () => {
        const p = INDUSTRY_PROFILES.consumer;
        // На xs пустой UGC = 1 ТБ; на xl = 20 000 ТБ (миллионы пользователей × контент)
        assert.strictEqual(p.scaleOverrides.file_storage_volume_tb.xs, 1);
        assert.strictEqual(p.scaleOverrides.file_storage_volume_tb.xl, 20000);
        assert.strictEqual(p.scaleMultipliers.traffic_egress_tb_month, 5.0);
        assert.strictEqual(p.defaults.realtime_required, true);
    });
});

describe('snapSlaToPreset', () => {
    it('точные значения возвращаются как есть', () => {
        assert.strictEqual(snapSlaToPreset(98), 98);
        assert.strictEqual(snapSlaToPreset(99.9), 99.9);
        assert.strictEqual(snapSlaToPreset(99.99), 99.99);
    });

    it('промежуточные округляются вверх до канонического', () => {
        assert.strictEqual(snapSlaToPreset(97), 98);
        assert.strictEqual(snapSlaToPreset(99.3), 99.5);
        assert.strictEqual(snapSlaToPreset(99.93), 99.95);
    });

    it('значения выше 99.99 — clamp до 99.99', () => {
        assert.strictEqual(snapSlaToPreset(99.999), 99.99);
        assert.strictEqual(snapSlaToPreset(100), 99.99);
    });
});

describe('computeCompliance', () => {
    it('fintech ВСЕГДА — все compliance-флаги true (с любым типом)', () => {
        for (const product_type of PRODUCT_TYPES) {
            for (const scale of SCALES) {
                const c = computeCompliance({ product_type, industry: 'fintech', scale, pdn: false });
                assert.strictEqual(c.pdn_152fz, true, `fintech.${product_type}.${scale} pdn_152fz`);
                assert.strictEqual(c.fstec_certification_required, true);
                assert.strictEqual(c.iso_27001_required, true);
                assert.strictEqual(c.db_commercial_license_required, true);
                assert.strictEqual(c.waf_required, true);
                assert.strictEqual(c.ddos_protection_required, true);
                assert.strictEqual(c.siem_integration_required, true);
                assert.strictEqual(c.dlp_required, true);
                assert.strictEqual(c.audit_logging_required, true);
                assert.strictEqual(c.payment_gateway, true);
                assert.strictEqual(c.antifraud_required, true);
            }
        }
    });

    it('internal × corporate × xs — минимум compliance', () => {
        const c = computeCompliance({ product_type: 'internal', industry: 'corporate', scale: 'xs', pdn: false });
        assert.strictEqual(c.pdn_152fz, false);
        assert.strictEqual(c.fstec_certification_required, false);
        assert.strictEqual(c.db_commercial_license_required, false);
        assert.strictEqual(c.dlp_required, false);
        assert.strictEqual(c.waf_required, false);
        assert.strictEqual(c.pentest_external, false);
    });

    it('b2c × corporate × m — WAF и pentest включаются', () => {
        const c = computeCompliance({ product_type: 'b2c', industry: 'corporate', scale: 'm', pdn: true });
        assert.strictEqual(c.waf_required, true);  // b2c всегда waf
        assert.strictEqual(c.sso_required, true);  // b2c всегда sso (соц-логины)
        assert.strictEqual(c.pentest_external, true);  // b2c × m
        assert.strictEqual(c.payment_gateway, true);  // b2c × m+
    });

    it('b2g × any — fstec и audit всегда включены', () => {
        const c = computeCompliance({ product_type: 'b2g', industry: 'corporate', scale: 'xs', pdn: false });
        assert.strictEqual(c.pdn_152fz, true);  // b2g — pdn всегда
        assert.strictEqual(c.fstec_certification_required, true);
        assert.strictEqual(c.db_commercial_license_required, true);
        assert.strictEqual(c.audit_logging_required, true);
    });
});

describe('wizardToAnswers — smoke по всем комбинациям', () => {
    it('не падает на любой комбинации (4 type × 4 industry × 5 scale × 3 geo × 2 pdn × 3 act × 2 ai = 2880 кейсов)', () => {
        let count = 0;
        for (const product_type of PRODUCT_TYPES) {
            for (const industry of INDUSTRIES) {
                for (const scale of SCALES) {
                    for (const geography of ['ru', 'ru_cis', 'global']) {
                        for (const pdn of [false, true]) {
                            for (const activity of ['low', 'medium', 'high']) {
                                for (const ai_used of [false, true]) {
                                    const result = wizardToAnswers({
                                        product_type, industry, scale, geography,
                                        pdn, activity, ai_used
                                    });
                                    assert.ok(result.answers, `answers пустой для ${product_type}.${industry}.${scale}`);
                                    assert.ok(result.meta, 'meta пустой');
                                    assert.ok(typeof result.answers.peak_rps === 'number');
                                    assert.ok(typeof result.answers.sla_target === 'number');
                                    assert.ok(result.answers.peak_rps > 0);
                                    const errors = [];
                                    validateAnswersConsistency({
                                        dictionaries: { questions: SEED_QUESTIONS },
                                        answers: result.answers
                                    }, errors);
                                    assert.deepEqual(errors, [],
                                        `wizard answers должны проходить seed options/range validation для ${product_type}.${industry}.${scale}.${geography}.pdn=${pdn}.activity=${activity}.ai=${ai_used}`);
                                    count++;
                                }
                            }
                        }
                    }
                }
            }
        }
        assert.strictEqual(count, 2880);
    });

    it('масштаб xs всегда даёт меньшие числа чем xl (для одинаковой комбинации)', () => {
        for (const product_type of PRODUCT_TYPES) {
            for (const industry of INDUSTRIES) {
                const xs = wizardToAnswers({
                    product_type, industry, scale: 'xs',
                    geography: 'ru', pdn: false, activity: 'medium', ai_used: false
                });
                const xl = wizardToAnswers({
                    product_type, industry, scale: 'xl',
                    geography: 'ru', pdn: false, activity: 'medium', ai_used: false
                });
                assert.ok(xs.answers.registered_users_total < xl.answers.registered_users_total);
                assert.ok(xs.answers.peak_rps < xl.answers.peak_rps);
                assert.ok(xs.answers.db_size_initial_gb < xl.answers.db_size_initial_gb);
            }
        }
    });
});

describe('wizardToAnswers — SLA каскад', () => {
    it('fintech.m → sla_target=99.9 → georedundancy=true, RTO=1ч, RPO=5мин, drills=4', () => {
        const r = wizardToAnswers({
            product_type: 'b2b', industry: 'fintech', scale: 'm',
            geography: 'ru', pdn: true, activity: 'medium', ai_used: false
        });
        assert.strictEqual(r.answers.sla_target, 99.9);
        assert.strictEqual(r.answers.georedundancy_required, true);
        assert.strictEqual(r.answers.rto_hours, 1);
        assert.strictEqual(r.answers.rpo_minutes, 5);
        assert.strictEqual(r.answers.dr_drills_per_year, 4);
    });

    it('corporate.m → sla_target=98 → georedundancy=false, RTO=8ч, drills=1', () => {
        const r = wizardToAnswers({
            product_type: 'b2b', industry: 'corporate', scale: 'm',
            geography: 'ru', pdn: true, activity: 'medium', ai_used: false
        });
        assert.strictEqual(r.answers.sla_target, 98);
        assert.strictEqual(r.answers.georedundancy_required, false);
        assert.strictEqual(r.answers.rto_hours, 8);
        assert.strictEqual(r.answers.rpo_minutes, 240);
        assert.strictEqual(r.answers.dr_drills_per_year, 1);
    });
});

describe('wizardToAnswers — pcu_target формула', () => {
    it('b2c × xl — pcu_share=15% → pcu_target = registered × dau_share/100 × 0.15', () => {
        const r = wizardToAnswers({
            product_type: 'b2c', industry: 'corporate', scale: 'xl',
            geography: 'ru', pdn: true, activity: 'medium', ai_used: false
        });
        const dau = r.answers.registered_users_total * r.answers.dau_share_of_registered_percent / 100;
        const expected = Math.round(dau * 0.15);
        assert.strictEqual(r.answers.pcu_target, expected);
    });

    it('internal × xs — pcu_share=30% (синхронные рабочие часы)', () => {
        const r = wizardToAnswers({
            product_type: 'internal', industry: 'corporate', scale: 'xs',
            geography: 'ru', pdn: false, activity: 'medium', ai_used: false
        });
        const dau = r.answers.registered_users_total * r.answers.dau_share_of_registered_percent / 100;
        const expected = Math.round(dau * 0.30);
        assert.strictEqual(r.answers.pcu_target, expected);
    });
});

describe('wizardToAnswers — geography multipliers', () => {
    it('global → traffic_egress ×3', () => {
        const ru = wizardToAnswers({
            product_type: 'b2c', industry: 'corporate', scale: 'm',
            geography: 'ru', pdn: true, activity: 'medium', ai_used: false
        });
        const global = wizardToAnswers({
            product_type: 'b2c', industry: 'corporate', scale: 'm',
            geography: 'global', pdn: true, activity: 'medium', ai_used: false
        });
        // global egress = ru egress × 3 (после product_type b2c-multiplier)
        assert.strictEqual(global.answers.traffic_egress_tb_month, ru.answers.traffic_egress_tb_month * 3);
        assert.strictEqual(global.answers.external_api_calls_per_month,
            ru.answers.external_api_calls_per_month * 3);
    });
});

describe('wizardToAnswers — activity multiplier', () => {
    it('high → DAU удваивается, low → DAU вдвое меньше medium', () => {
        const med = wizardToAnswers({
            product_type: 'b2c', industry: 'corporate', scale: 'm',
            geography: 'ru', pdn: true, activity: 'medium', ai_used: false
        });
        const hi = wizardToAnswers({
            product_type: 'b2c', industry: 'corporate', scale: 'm',
            geography: 'ru', pdn: true, activity: 'high', ai_used: false
        });
        const lo = wizardToAnswers({
            product_type: 'b2c', industry: 'corporate', scale: 'm',
            geography: 'ru', pdn: true, activity: 'low', ai_used: false
        });
        // medium DAU=20 → high=40, low=10 (× 2 / × 0.5)
        assert.strictEqual(hi.answers.dau_share_of_registered_percent,
            Math.min(100, Math.round(med.answers.dau_share_of_registered_percent * 2)));
        assert.strictEqual(lo.answers.dau_share_of_registered_percent,
            Math.round(med.answers.dau_share_of_registered_percent * 0.5));
    });
});

describe('wizardToAnswers — AI блок', () => {
    it('ai_used=false → ai_llm_used=false, других AI-полей нет', () => {
        const r = wizardToAnswers({
            product_type: 'b2b', industry: 'edtech', scale: 'm',
            geography: 'ru', pdn: true, activity: 'medium', ai_used: false
        });
        assert.strictEqual(r.answers.ai_llm_used, false);
        assert.strictEqual(r.answers.ai_users_share, undefined);
        assert.strictEqual(r.answers.rag_needed, undefined);
    });

    it('ai_used=true × edtech → ai_llm_used=true, RAG включён', () => {
        const r = wizardToAnswers({
            product_type: 'b2c', industry: 'edtech', scale: 'm',
            geography: 'ru', pdn: true, activity: 'medium', ai_used: true
        });
        assert.strictEqual(r.answers.ai_llm_used, true);
        assert.strictEqual(r.answers.rag_needed, true);
        assert.strictEqual(r.answers.rag_corpus_size_gb, 50);  // edtech.m = 50 GB
        assert.strictEqual(r.answers.ai_users_share, 40);
    });

    it('ai_used=true × fintech → safety_layer=true, sensitivity=pdn', () => {
        const r = wizardToAnswers({
            product_type: 'b2b', industry: 'fintech', scale: 'm',
            geography: 'ru', pdn: true, activity: 'medium', ai_used: true
        });
        assert.strictEqual(r.answers.ai_safety_layer, true);
        assert.strictEqual(r.answers.ai_data_sensitivity, 'pdn');
        assert.strictEqual(r.answers.ai_model_tier, 'heavy');
    });
});

describe('wizardToAnswers — meta показывает источник каждого значения', () => {
    it('каждое поле в answers имеет parallel запись в meta', () => {
        const r = wizardToAnswers({
            product_type: 'b2b', industry: 'fintech', scale: 'm',
            geography: 'ru', pdn: true, activity: 'medium', ai_used: true
        });
        Object.keys(r.answers).forEach(id => {
            assert.ok(r.meta[id], `meta.${id} отсутствует`);
            assert.ok(typeof r.meta[id].source === 'string');
        });
    });

    it('SLA-производные поля имеют source="sla_preset" (если compliance их не перебивает)', () => {
        // Для fintech/b2g compliance принудительно выставляет georedundancy_required=true
        // и source становится 'compliance' (это семантически верно — приоритет compliance
        // выше SLA-пресета). Для остальных тестируем на b2b × corporate, где compliance
        // не трогает georedundancy.
        const fin = wizardToAnswers({
            product_type: 'b2b', industry: 'fintech', scale: 'm',
            geography: 'ru', pdn: true, activity: 'medium', ai_used: false
        });
        assert.strictEqual(fin.meta.rto_hours.source, 'sla_preset');
        assert.strictEqual(fin.meta.rpo_minutes.source, 'sla_preset');
        // georedundancy для fintech: compliance перебивает sla_preset
        assert.strictEqual(fin.meta.georedundancy_required.source, 'compliance');

        const corp = wizardToAnswers({
            product_type: 'b2b', industry: 'corporate', scale: 'm',
            geography: 'ru', pdn: true, activity: 'medium', ai_used: false
        });
        // Для corporate compliance НЕ трогает georedundancy → source = sla_preset
        assert.strictEqual(corp.meta.georedundancy_required.source, 'sla_preset');
    });

    it('§5.1: internal × corporate отключает external compliance flags', () => {
        const r = wizardToAnswers({
            product_type: 'internal', industry: 'corporate', scale: 'm',
            geography: 'ru', pdn: true, activity: 'medium', ai_used: false
        });
        assert.strictEqual(r.answers.waf_required, false, 'internal: WAF не нужен');
        assert.strictEqual(r.answers.ddos_protection_required, false, 'internal: DDoS не нужен');
        assert.strictEqual(r.answers.pentest_external, false, 'internal: external pentest не нужен');
    });

    it('§5.1: internal × fintech всё равно требует waf/ddos (industry перебивает type)', () => {
        const r = wizardToAnswers({
            product_type: 'internal', industry: 'fintech', scale: 's',
            geography: 'ru', pdn: false, activity: 'medium', ai_used: false
        });
        assert.strictEqual(r.answers.waf_required, true, 'fintech-internal: WAF обязателен');
        assert.strictEqual(r.answers.ddos_protection_required, true, 'fintech-internal: DDoS обязателен');
        assert.strictEqual(r.answers.pentest_external, true);
    });

    it('§5.1: b2g × any × any → georedundancy=true, waf=true, fstec=true', () => {
        const r = wizardToAnswers({
            product_type: 'b2g', industry: 'corporate', scale: 'xs',
            geography: 'ru', pdn: false, activity: 'medium', ai_used: false
        });
        assert.strictEqual(r.answers.georedundancy_required, true);
        assert.strictEqual(r.answers.waf_required, true);
        assert.strictEqual(r.answers.fstec_certification_required, true);
        assert.strictEqual(r.answers.db_commercial_license_required, true);
        assert.strictEqual(r.answers.pdn_152fz, true);
    });

    it('compliance-флаги имеют source="compliance"', () => {
        const r = wizardToAnswers({
            product_type: 'b2b', industry: 'fintech', scale: 'm',
            geography: 'ru', pdn: true, activity: 'medium', ai_used: false
        });
        assert.strictEqual(r.meta.pdn_152fz.source, 'compliance');
        assert.strictEqual(r.meta.fstec_certification_required.source, 'compliance');
        assert.strictEqual(r.meta.db_commercial_license_required.source, 'compliance');
    });
});

describe('wizardToAnswers — error handling', () => {
    it('бросает для unknown scale', () => {
        assert.throws(() => wizardToAnswers({
            product_type: 'b2b', industry: 'corporate', scale: 'xxx',
            geography: 'ru', pdn: false, activity: 'medium', ai_used: false
        }), /Unknown scale/);
    });

    it('бросает для unknown industry', () => {
        assert.throws(() => wizardToAnswers({
            product_type: 'b2b', industry: 'unknown_vert', scale: 'm',
            geography: 'ru', pdn: false, activity: 'medium', ai_used: false
        }), /Unknown industry/);
    });

    it('бросает для unknown product_type', () => {
        assert.throws(() => wizardToAnswers({
            product_type: 'b2x', industry: 'corporate', scale: 'm',
            geography: 'ru', pdn: false, activity: 'medium', ai_used: false
        }), /Unknown product_type/);
    });
});
