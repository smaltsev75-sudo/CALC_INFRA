import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, getTemplateById, listTemplates } from '../../../js/domain/templates.js';
import { calculate } from '../../../js/domain/calculator.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../../js/domain/seed.js';

describe('templates: structure', () => {
    it('экспортирует ровно 5 шаблонов в правильном порядке', () => {
        assert.equal(TEMPLATES.length, 5);
        assert.equal(TEMPLATES[0].id, 'tier1-mvp');
        assert.equal(TEMPLATES[1].id, 'tier2-small-saas');
        assert.equal(TEMPLATES[2].id, 'tier3-medium-saas');
        assert.equal(TEMPLATES[3].id, 'tier4-large-saas');
        assert.equal(TEMPLATES[4].id, 'tier5-enterprise');
    });

    it('каждый шаблон имеет id/label/rangeText/summary/answers', () => {
        for (const t of TEMPLATES) {
            assert.ok(t.id, `template missing id`);
            assert.ok(t.label, `template ${t.id} missing label`);
            assert.ok(t.rangeText, `template ${t.id} missing rangeText`);
            assert.ok(t.summary && t.summary.length > 30, `template ${t.id} summary too short`);
            assert.ok(t.answers && typeof t.answers === 'object', `template ${t.id} missing answers`);
            assert.ok(Number.isFinite(t.answers.registered_users_total),
                `template ${t.id} missing registered_users_total`);
        }
    });

    it('registered_users_total монотонно растёт по шаблонам', () => {
        const totals = TEMPLATES.map(t => t.answers.registered_users_total);
        for (let i = 1; i < totals.length; i++) {
            assert.ok(totals[i] > totals[i - 1],
                `tier ${i} (${totals[i]}) должен быть > tier ${i - 1} (${totals[i - 1]})`);
        }
    });

    it('peak_rps монотонно растёт (масштаб нагрузки)', () => {
        const rps = TEMPLATES.map(t => t.answers.peak_rps);
        for (let i = 1; i < rps.length; i++) {
            assert.ok(rps[i] > rps[i - 1], `peak_rps tier ${i} должен расти`);
        }
    });

    it('compliance-флаги монотонны (никогда не убывают по тиру)', () => {
        // pdn_152fz: false → true начиная с tier2
        assert.equal(TEMPLATES[0].answers.pdn_152fz, false);
        for (let i = 1; i < TEMPLATES.length; i++) {
            assert.equal(TEMPLATES[i].answers.pdn_152fz, true, `tier ${i} должен иметь pdn_152fz=true`);
        }
        // fstec — только в tier5
        for (let i = 0; i < 4; i++) {
            assert.equal(TEMPLATES[i].answers.fstec_certification_required, false);
        }
        assert.equal(TEMPLATES[4].answers.fstec_certification_required, true);
    });

    it('rangeText содержит «5 000» / «50 000» / «100 000» / «500 000» по тирам', () => {
        assert.match(TEMPLATES[0].rangeText, /5 ?000/);
        assert.match(TEMPLATES[1].rangeText, /50 ?000/);
        assert.match(TEMPLATES[2].rangeText, /100 ?000/);
        assert.match(TEMPLATES[3].rangeText, /500 ?000/);
        assert.match(TEMPLATES[4].rangeText, /500 ?000|более/);
    });

    it('tier1 не содержит «от» в rangeText (только верхняя граница)', () => {
        assert.ok(!TEMPLATES[0].rangeText.includes('от'),
            `tier1 должен быть только "до X", без "от" — получено: "${TEMPLATES[0].rangeText}"`);
    });
});

describe('templates: helpers', () => {
    it('getTemplateById возвращает шаблон по id', () => {
        const t = getTemplateById('tier1-mvp');
        assert.equal(t?.id, 'tier1-mvp');
    });
    it('getTemplateById возвращает undefined для несуществующего id', () => {
        assert.equal(getTemplateById('nonexistent'), undefined);
    });
    it('listTemplates возвращает массив с обязательными полями для UI', () => {
        const list = listTemplates();
        assert.equal(list.length, 5);
        for (const t of list) {
            assert.ok(t.id && t.label && t.rangeText && t.summary);
        }
    });
});

describe('templates: integration с calculator', () => {
    /* Smoke: для каждого шаблона строим calc, прогоняем calculate(),
       проверяем, что totalMonthly > 0 и финитен (никаких NaN/Infinity). */
    const buildCalcWithTemplate = (template) => {
        const dict = buildSeedDictionaries();
        const baseAns = defaultAnswersFrom(dict.questions);
        const answers = { ...baseAns, ...template.answers };
        const settings = template.settings
            ? { ...SEED_SETTINGS, ...template.settings }
            : { ...SEED_SETTINGS };
        return {
            version: '1.0', id: 't', name: template.label, schemaVersion: 3,
            createdAt: '2026', updatedAt: '2026',
            settings, answers, dictionaries: dict
        };
    };

    for (const tmpl of TEMPLATES) {
        it(`шаблон «${tmpl.label}» даёт финитный totalMonthly > 0`, () => {
            const calc = buildCalcWithTemplate(tmpl);
            const r = calculate(calc);
            assert.ok(Number.isFinite(r.totalMonthly), `totalMonthly не финитен`);
            assert.ok(r.totalMonthly > 0, `totalMonthly должен быть > 0, получено ${r.totalMonthly}`);
        });
    }

    it('totalMonthly монотонно растёт по тирам (масштаб инфраструктуры)', () => {
        const totals = TEMPLATES.map(t => calculate(buildCalcWithTemplate(t)).totalMonthly);
        for (let i = 1; i < totals.length; i++) {
            assert.ok(totals[i] > totals[i - 1],
                `tier ${i} стоимость (${totals[i]}) должна быть > tier ${i - 1} (${totals[i - 1]})`);
        }
    });
});
