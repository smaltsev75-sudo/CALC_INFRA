/**
 * Package 9E — text-only honesty pass для антифрод/ЭДО.
 *
 * Эти ЭК остаются фиксированными медианными оценками. Формулы, цены, единицы и
 * ekClass не меняются; мы только явно пишем, что объёмные/сложные контуры
 * требуют отдельной оценки или КП.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_ITEMS, SEED_QUESTIONS } from '../../../js/domain/seed.js';

const item = id => SEED_ITEMS.find(x => x.id === id);
const q = id => SEED_QUESTIONS.find(x => x.id === id);
const itemText = id => `${item(id).description || ''}\n${item(id).formulaHelp || ''}`;

describe('9E / antifraud + EDO descriptions are honest fixed medians', () => {
    for (const id of [
        'one-antifraud-integration',
        'service-antifraud-license',
        'one-edo-integration',
        'service-edo-operator'
    ]) {
        it(`${id}: description says fixed median/typical estimate and directs large volume to КП`, () => {
            const text = itemText(id);
            assert.match(text, /медиан|типов/i, `${id}: нет указания, что это медианная/типовая оценка`);
            assert.match(text, /КП|отдельн/i, `${id}: нет указания на отдельную оценку/КП для сложных случаев`);
        });
    }
});

describe('9E / no-drift invariants', () => {
    const expected = {
        'one-antifraud-integration': {
            formula: 'if(Q.antifraud_required, 1, 0)',
            price: 700000,
            unit: 'проект',
            billing: 'oneTime'
        },
        'service-antifraud-license': {
            formula: 'if(Q.antifraud_required, 1, 0)',
            price: 1000000,
            unit: 'контур/год',
            billing: 'annual'
        },
        'one-edo-integration': {
            formula: 'if(Q.edo_required, 1, 0)',
            price: 600000,
            unit: 'проект',
            billing: 'oneTime'
        },
        'service-edo-operator': {
            formula: 'if(Q.edo_required, 1, 0)',
            price: 50000,
            unit: 'контур/год',
            billing: 'annual'
        }
    };

    for (const [id, expectedValue] of Object.entries(expected)) {
        it(`${id}: formula/price/unit/billing/ekClass unchanged`, () => {
            const it = item(id);
            assert.equal(it.qtyFormulas.PROD, expectedValue.formula);
            assert.equal(it.pricePerUnit, expectedValue.price);
            assert.equal(it.unit, expectedValue.unit);
            assert.equal(it.billingInterval, expectedValue.billing);
            assert.equal(it.ekClass, 'flag-fixed');
        });
    }
});

describe('9E / no new scale-driver questions without domain coefficients', () => {
    it('does not add antifraud/EDO volume drivers yet', () => {
        const forbidden = [
            'antifraud_transactions_per_month',
            'antifraud_tier',
            'edo_documents_per_year',
            'edo_price_per_document'
        ];
        for (const id of forbidden) {
            assert.equal(q(id), undefined, `scale-driver ${id} должен ждать доменных коэффициентов`);
        }
    });
});
