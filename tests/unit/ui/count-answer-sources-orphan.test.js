/**
 * PATCH 2.18.3 (внешний аудит #10, 2026-05-19, P2.1 defensive):
 * `countAnswerSources` обязан пропускать orphan-meta-keys (id, для которого
 * нет ни вопроса в dictionary, ни ответа в answers).
 *
 * До фикса: stale `answersMeta.mau_growth_rate_percent` без соответствующего
 * answer/question давал dashboard-счётчик `manual: 1`, хотя вопрос и ответ
 * уже удалены.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { countAnswerSources } from '../../../js/ui/dashboard.js';

describe('countAnswerSources: orphan-meta-keys пропускаются', () => {
    it('orphan meta (нет вопроса в dict + нет ответа в answers) не учитывается', () => {
        const counts = countAnswerSources(
            { mau_growth_rate_percent: { source: 'manual' } },
            { answers: {}, dictionaries: { questions: [] } }
        );
        assert.equal(counts.manual, 0, 'orphan «manual»-source не должен попадать в счётчик');
    });

    it('живой meta (есть и в answers, и в dictionary) считается', () => {
        const counts = countAnswerSources(
            { foo: { source: 'manual' }, bar: { source: 'profile' } },
            {
                answers: { foo: 1, bar: 'x' },
                dictionaries: {
                    questions: [
                        { id: 'foo', type: 'number', title: 'f', section: 'business', order: 1 },
                        { id: 'bar', type: 'select', title: 'b', section: 'business', order: 2 }
                    ]
                }
            }
        );
        assert.equal(counts.manual, 1);
        assert.equal(counts.profile, 1);
    });

    it('meta без calc — старое поведение для backward compatibility (считает все)', () => {
        // calc=undefined — legacy callers не передают второй аргумент;
        // counter работает в старом «count all keys» режиме.
        const counts = countAnswerSources({
            foo: { source: 'manual' },
            bar: { source: 'profile' }
        });
        assert.equal(counts.manual, 1, 'без calc — не фильтруем orphan-ы');
        assert.equal(counts.profile, 1);
    });

    it('meta-key без соответствующего ответа (есть вопрос, но нет answer) пропускается', () => {
        // Сценарий: вопрос всё ещё в dict, но ответ удалён вручную/миграцией —
        // meta «зависает» и должна игнорироваться.
        const counts = countAnswerSources(
            { foo: { source: 'manual' } },
            {
                answers: {},
                dictionaries: {
                    questions: [{ id: 'foo', type: 'number', title: 'f', section: 'business', order: 1 }]
                }
            }
        );
        assert.equal(counts.manual, 0, 'meta без answer — orphan, не считаем');
    });
});
