import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    deleteItemAction,
    duplicateItemAction,
    deleteQuestionAction
} from '../../../js/app/crudActions.js';

function createSnackbarSpy() {
    const calls = [];
    return {
        calls,
        success(message) { calls.push(['success', message]); },
        warning(message) { calls.push(['warning', message]); },
        error(message) { calls.push(['error', message]); },
        showUndoableSnackbar(message, undo) { calls.push(['undo', message, undo]); }
    };
}

describe('app crudActions', () => {
    it('deleteItemAction при persist-fail показывает error и не создаёт undo', () => {
        const snackbar = createSnackbarSpy();

        deleteItemAction({
            id: 'cpu',
            snackbar,
            lintFormulas: () => [],
            store: {
                getState: () => ({
                    activeCalc: {
                        dictionaries: {
                            items: [{ id: 'cpu', name: 'CPU' }],
                            questions: []
                        }
                    }
                })
            },
            itemCtl: {
                deleteItem: () => ({ ok: false, message: 'quota' })
            }
        });

        assert.deepEqual(snackbar.calls, [['error', 'quota']]);
    });

    it('duplicateItemAction не рапортует success при persist-fail', () => {
        const snackbar = createSnackbarSpy();

        duplicateItemAction({
            id: 'cpu',
            snackbar,
            itemCtl: {
                duplicateItem: () => ({ ok: false, reason: 'persist', message: 'full' })
            }
        });

        assert.deepEqual(snackbar.calls, [['error', 'full']]);
    });

    it('deleteQuestionAction сначала спрашивает подтверждение при formula-usages', () => {
        let confirmPayload = null;
        const snackbar = createSnackbarSpy();

        deleteQuestionAction({
            id: 'qps',
            snackbar,
            commitActiveCalc: () => true,
            findQuestionUsages: () => [{ itemName: 'Backend', stand: 'PROD' }],
            confirm: opts => { confirmPayload = opts; },
            store: {
                getState: () => ({
                    activeCalc: {
                        dictionaries: {
                            questions: [{ id: 'qps', title: 'RPS' }],
                            items: []
                        },
                        answers: { qps: 10 }
                    }
                })
            },
            questionCtl: {
                deleteQuestion: () => ({ ok: true }),
                saveQuestion: () => ({ ok: true })
            }
        });

        assert.equal(snackbar.calls.length, 0);
        assert.equal(confirmPayload.title, 'Вопрос используется в формулах');
        assert.equal(confirmPayload.confirmLabel, 'Удалить');
        assert.match(confirmPayload.message, /Backend/);
    });

    it('deleteQuestionAction undo восстанавливает backupAnswer через commit-first', () => {
        const snackbar = createSnackbarSpy();
        const activeCalc = {
            dictionaries: {
                questions: [{ id: 'qps', title: 'RPS' }],
                items: []
            },
            answers: { qps: 42 }
        };
        const committed = [];
        const setActive = [];
        const store = {
            getState: () => ({ activeCalc }),
            setActiveCalc(calc) { setActive.push(calc); }
        };

        deleteQuestionAction({
            id: 'qps',
            store,
            snackbar,
            findQuestionUsages: () => [],
            commitActiveCalc(calc) {
                committed.push(calc);
                return true;
            },
            confirm: () => assert.fail('confirm не нужен без usages'),
            questionCtl: {
                deleteQuestion: () => ({ ok: true }),
                saveQuestion: () => ({ ok: true })
            }
        });

        assert.equal(snackbar.calls[0][0], 'undo');
        snackbar.calls[0][2]();

        assert.equal(committed.length, 1);
        assert.equal(committed[0].answers.qps, 42);
        assert.equal(setActive.length, 1);
        assert.equal(setActive[0], committed[0]);
        assert.equal(snackbar.calls.at(-1)[0], 'success');
    });
});
