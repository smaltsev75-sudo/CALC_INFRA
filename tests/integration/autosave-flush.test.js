/**
 * Интеграционный тест Этапа 11.1.3.
 *
 * Сценарий: пользователь правит расчёт → сразу закрывает вкладку
 * (имитация `beforeunload`). flushPendingCommit должен синхронно
 * выполнить отложенный автосейв, чтобы последние правки попали в storage.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

// Установить mock localStorage ДО импорта модулей, использующих storage.
installLocalStorage();

const { store } = await import('../../js/state/store.js');
const calcList = await import('../../js/controllers/calcListController.js');
const calc = await import('../../js/controllers/calcController.js');
const persist = await import('../../js/state/persistence.js');
const { clearCalculationCache } = await import('../../js/domain/calculator.js');

beforeEach(() => {
    installLocalStorage();
    store.setActiveCalc(null);
    store.setCalcList([]);
    clearCalculationCache();
});

describe('Этап 11.1.3: beforeunload flush автосейва', () => {
    it('после правки + flushPendingCommit() — изменения в storage', () => {
        // 1. Создаём расчёт.
        const c = calcList.createCalc('Старое имя');
        const id = c.id;
        // createCalc сразу делает commitNewCalc (синхронный atomic write),
        // так что в storage уже есть запись calc.<id> с именем «Старое имя».
        const beforeEdit = persist.loadCalc(id);
        assert.ok(beforeEdit, 'после createCalc расчёт должен быть в storage');
        assert.equal(beforeEdit.name, 'Старое имя');

        // 2. Имитируем правку — setName ставит persistStatus=pending
        // и запускает _persistDebounced (80мс).
        calc.setName('Новое имя');

        // На этом этапе debounce ещё не сработал, в storage старое имя.
        const duringEdit = persist.loadCalc(id);
        assert.equal(duringEdit.name, 'Старое имя',
            'debounce ещё не отработал — в storage прежнее имя');

        // 3. Имитируем beforeunload — flushPendingCommit СИНХРОННО
        // выполнит отложенный автосейв.
        calc.flushPendingCommit();

        // 4. В storage теперь новое имя — без задержки.
        const afterFlush = persist.loadCalc(id);
        assert.ok(afterFlush, 'расчёт должен остаться в storage');
        assert.equal(afterFlush.name, 'Новое имя',
            'flushPendingCommit должен синхронно записать последние правки');
    });

    it('flushPendingCommit без pending-правок — no-op (не падает)', () => {
        // Нет активного расчёта, нет правок — flush должен быть безопасным.
        assert.doesNotThrow(() => calc.flushPendingCommit());

        // Создаём расчёт, но никаких правок не делаем.
        calcList.createCalc('Без правок');
        // Сразу flush — в storage уже актуальные данные после createCalc,
        // pending'а нет, ничего не должно поменяться или упасть.
        assert.doesNotThrow(() => calc.flushPendingCommit());
    });

    it('flush после серии правок записывает ПОСЛЕДНЮЮ версию', () => {
        const c = calcList.createCalc('v0');
        const id = c.id;

        calc.setName('v1');
        calc.setName('v2');
        calc.setName('v3');

        // Между правками debounce не успевает сработать (вызовы синхронные подряд).
        // flush должен записать v3 (последнее имя).
        calc.flushPendingCommit();

        const reloaded = persist.loadCalc(id);
        assert.equal(reloaded.name, 'v3',
            'flush после серии правок записывает последнее значение');
    });

    it('flush + setAnswer: ответ доходит до storage немедленно', () => {
        const c = calcList.createCalc('Answers test');
        const id = c.id;

        // Меняем ответ на любой существующий вопрос.
        const firstQuestion = c.dictionaries.questions[0];
        assert.ok(firstQuestion, 'в seed должны быть вопросы');
        const qid = firstQuestion.id;

        calc.setAnswer(qid, 12345);

        // До flush — ответ в store, но не в storage (debounce не отработал).
        assert.equal(store.getState().activeCalc.answers[qid], 12345);

        calc.flushPendingCommit();

        // После flush — ответ в storage.
        const reloaded = persist.loadCalc(id);
        assert.equal(reloaded.answers[qid], 12345,
            'flushPendingCommit должен синхронно записать ответ');
    });
});
