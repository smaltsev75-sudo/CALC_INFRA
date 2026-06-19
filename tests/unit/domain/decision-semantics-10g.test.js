import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildSeedDictionaries } from '../../../js/domain/seed.js';

const { items } = buildSeedDictionaries();

function item(id) {
    const found = items.find(entry => entry.id === id);
    assert.ok(found, `ЭК ${id} должен существовать`);
    return found;
}

describe('10G / выбранная семантика спорных ЭК зафиксирована в тексте', () => {
    it('blue-green описан как фиксированный операционный резерв, а не как дублирование ПРОМ', () => {
        const entry = item('res-blue-green-deployment');
        const text = `${entry.description}\n${entry.formulaHelp}`;

        assert.equal(entry.pricePerUnit, 250000);
        assert.equal(entry.qtyFormulas.PROD, 'if(Q.maintenance_window_hours_month <= 1, 1, 0)');
        assert.match(text, /фиксированн[а-яё]+.*операционн[а-яё]+ резерв/i);
        assert.match(text, /не.*копи[яю].*боев/i);
    });

    it('защищённое хранилище явно относится к выбранным защищаемым данным, а не ко всей БД', () => {
        const entry = item('storage-secure-gb');
        const text = `${entry.description}\n${entry.formulaHelp}`;

        assert.match(text, /отдельн[а-яё]+ защищаем[а-яё]+ данн/i);
        assert.match(text, /скан[а-яё]* документ/i);
        assert.match(text, /не.*вс[ея].*БД/i);
        assert.match(text, /груб[а-яё]+ оценк/i);
    });

    it('ЭДО описан как ориентировочная фиксированная оценка без расчёта по документам', () => {
        const entry = item('service-edo-operator');
        const text = `${entry.description}\n${entry.formulaHelp}`;

        assert.equal(entry.pricePerUnit, 50000);
        assert.equal(entry.qtyFormulas.PROD, 'if(Q.edo_required, 1, 0)');
        assert.match(text, /ориентировочн[а-яё]+ фиксированн[а-яё]+ оценк/i);
        assert.match(text, /не считает.*количеств[а-яё]+ документ/i);
    });
});
