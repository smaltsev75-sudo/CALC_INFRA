/**
 * Package 6C-light — text-only honesty PATCH для SSO/IdP/payment ЭК.
 *
 * Дефект был только текстовый: impact вопроса payment_gateway обещал «+ PCI DSS аудит
 * (~500-1500 тыс. ₽/год)», хотя такого ЭК под этим флагом нет (PCI/ИБ-аудит — общий
 * one-security-audit, гейт iso/pdn). Правка: честный impact. Для SSO/IdP — уточнение, что
 * цена фиксированная медианная, крупные федерации требуют отдельной оценки/КП.
 *
 * Формулы, цены, единицы, ekClass, миграции, golden НЕ меняются. Новых scale-драйверов нет.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_QUESTIONS, SEED_ITEMS } from '../../../js/domain/seed.js';

const q = id => SEED_QUESTIONS.find(x => x.id === id);
const item = id => SEED_ITEMS.find(x => x.id === id);
const text = it => `${it.description || ''}\n${it.formulaHelp || ''}`;

describe('6C-light / payment_gateway.impact — честная модель', () => {
    const impact = q('payment_gateway').impact;
    it('не обещает автоматический PCI DSS-аудит 500-1500 тыс. ₽/год', () => {
        assert.ok(!/500\s*-\s*1500/.test(impact), `impact всё ещё несёт цифру PCI-аудита: «${impact}»`);
        assert.ok(!/\+\s*PCI\s*DSS\s*аудит/i.test(impact), `impact всё ещё подаёт PCI-аудит как доп. статью: «${impact}»`);
    });
    it('честно описывает разовую интеграцию + вынос комиссий/аудита за статью', () => {
        assert.ok(/300\s*-\s*800/.test(impact), 'сохранён диапазон разовой интеграции 300-800');
        assert.ok(/вне этой статьи|отдельно|учитыва/i.test(impact), 'комиссии/аудит явно вынесены за статью');
    });
});

describe('6C-light / SSO+IdP текст-уточнение про медианную оценку', () => {
    for (const id of ['one-sso-integration', 'service-identity-provider']) {
        it(`${id} содержит уточнение про фиксированную медианную оценку и крупные федерации`, () => {
            const t = text(item(id));
            assert.ok(/медиан/i.test(t), `${id}: нет слова «медиан…» в описании`);
            assert.ok(/федераци/i.test(t), `${id}: нет упоминания крупных федераций`);
        });
    }
});

describe('6C-light / no-drift инварианты (формулы/цены/единицы не тронуты)', () => {
    const expected = {
        'one-payment-gateway-integration': { f: 'if(Q.payment_gateway, 1, 0)', price: 300000, unit: 'проект', bi: 'oneTime' },
        'one-sso-integration': { f: 'if(Q.sso_required, 1, 0)', price: 600000, unit: 'проект', bi: 'oneTime' },
        'service-identity-provider': { f: 'if(Q.sso_required, 1, 0)', price: 50000, unit: 'контур', bi: 'monthly' }
    };
    for (const [id, e] of Object.entries(expected)) {
        it(`${id}: formula/price/unit/billing/ekClass без изменений`, () => {
            const it = item(id);
            assert.equal(it.qtyFormulas.PROD, e.f);
            assert.equal(it.pricePerUnit, e.price);
            assert.equal(it.unit, e.unit);
            assert.equal(it.billingInterval, e.bi);
            assert.equal(it.ekClass, 'flag-fixed');
        });
    }
});

describe('6C-light / не добавлены scale-драйверы (B/C-модели не реализованы)', () => {
    it('нет idp_users_count / sso_users_count / payment_transactions_per_month / gmv', () => {
        const forbidden = ['idp_users_count', 'sso_users_count', 'payment_transactions_per_month',
            'payment_transactions', 'gmv', 'payment_gmv', 'acquiring_fee_percent'];
        for (const f of forbidden) {
            assert.ok(!q(f), `появился запрещённый scale-драйвер-вопрос: ${f}`);
        }
    });
});
