/**
 * 12.U32 #2: integration regression на subscriber leak.
 *
 * Long-running session (часы работы) накапливает state-обновления. Каждый
 * `store.subscribe(fn)` без парного `unsubscribe()` копит подписчиков в Set,
 * нотификации становятся O(N) → UI freeze, в худшем — OOM.
 *
 * Vanilla-проект не имеет React-cleanup'а. Единственная защита — явный тест
 * на стабильность `store.getSubscriberCount()` после серии rerender-циклов.
 *
 * Контракт:
 *   - после 50 циклов `store.updateActiveCalc(...)` число подписчиков
 *     остаётся ≤ исходного + небольшая константа (toleranсe для тестового
 *     boot-overhead, который реально может зарегистрировать subscriber).
 *   - subscribe/unsubscribe пары работают симметрично: после `for (let i; i<N; i++) { off=subscribe(); off(); }` count не меняется.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../../js/state/store.js';

describe('store: subscribe/unsubscribe — нет leak (12.U32 #2)', () => {
    it('публичный getSubscriberCount() возвращает 0 на свежем Store', () => {
        const s = new Store();
        assert.equal(s.getSubscriberCount(), 0);
    });

    it('subscribe увеличивает count, unsubscribe возвращает', () => {
        const s = new Store();
        const off1 = s.subscribe(() => {});
        const off2 = s.subscribe(() => {});
        assert.equal(s.getSubscriberCount(), 2);
        off1();
        assert.equal(s.getSubscriberCount(), 1);
        off2();
        assert.equal(s.getSubscriberCount(), 0);
    });

    it('1000 циклов subscribe+unsubscribe → count остаётся 0', () => {
        const s = new Store();
        for (let i = 0; i < 1000; i++) {
            const off = s.subscribe(() => {});
            off();
        }
        assert.equal(s.getSubscriberCount(), 0,
            'Парные subscribe+unsubscribe не должны накапливать подписчиков');
    });

    it('повторный unsubscribe одной и той же функции — no-op', () => {
        const s = new Store();
        const fn = () => {};
        const off = s.subscribe(fn);
        off();
        off(); // повторный вызов — Set.delete возвращает false, не throws
        assert.equal(s.getSubscriberCount(), 0);
    });

    it('rerender-цикл (updateActiveCalc) НЕ добавляет подписчиков', () => {
        const s = new Store();
        // Имитируем 1 «UI-подписку» (например, app.js boot subscriber)
        s.subscribe(() => {});
        const baseline = s.getSubscriberCount();

        // 50 циклов state-обновления — подписчик дёргается, но count не растёт
        for (let i = 0; i < 50; i++) {
            // setState через update API — раз в production state-mutate
            // идёт через store.updateActiveCalc, тут используем низкоуровневый
            // setState чтобы не зависеть от calc-структуры.
            s._state = { ...s._state, _bump: i };
            s._notify();
        }
        assert.equal(s.getSubscriberCount(), baseline,
            `Утечка: subscribers ${baseline} → ${s.getSubscriberCount()} ` +
            `после 50 циклов notify. UI-компонент зарегистрировал subscribe внутри render?`);
    });

    it('subscriber, который вызывает внутренний subscribe в обработчике, НЕ оставляет неотписанные следы при штатном cleanup', () => {
        const s = new Store();
        let innerOff = null;
        const outerOff = s.subscribe(() => {
            // эмулируем «UI-компонент создал короткоживущую подписку»
            if (!innerOff) {
                innerOff = s.subscribe(() => {});
            }
        });
        s._notify();   // outer добавил inner — count = 2
        // Теперь компонент должен отписать inner (как UI делает на cleanup)
        innerOff();
        outerOff();
        assert.equal(s.getSubscriberCount(), 0,
            'после штатного cleanup всех подписок count = 0');
    });
});
