import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { upsertById, mergeById, removeById } from '../../../js/utils/collections.js';
import { LruCache } from '../../../js/utils/lru.js';
import { deepFreeze } from '../../../js/utils/freeze.js';
import { escapeHtml, escapeAttr } from '../../../js/utils/escapeHtml.js';
import { uuid } from '../../../js/utils/uuid.js';
import { debounce } from '../../../js/utils/debounce.js';

describe('collections.upsertById', () => {
    it('inserts when id not present', () => {
        const r = upsertById([{ id: 'a' }], { id: 'b' });
        assert.equal(r.length, 2);
    });
    it('replaces when id present', () => {
        const r = upsertById([{ id: 'a', v: 1 }], { id: 'a', v: 2 });
        assert.equal(r.length, 1);
        assert.equal(r[0].v, 2);
    });
    it('does not mutate input', () => {
        const list = [{ id: 'a', v: 1 }];
        upsertById(list, { id: 'a', v: 2 });
        assert.equal(list[0].v, 1);
    });
});

describe('collections.mergeById', () => {
    it('merges multiple entries', () => {
        const r = mergeById([{ id: 'a', v: 1 }], [{ id: 'a', v: 2 }, { id: 'b', v: 3 }]);
        assert.equal(r.length, 2);
        assert.equal(r.find(x => x.id === 'a').v, 2);
    });
});

describe('collections.removeById', () => {
    it('removes by id', () => {
        const r = removeById([{ id: 'a' }, { id: 'b' }], 'a');
        assert.equal(r.length, 1);
        assert.equal(r[0].id, 'b');
    });
    it('no-op when id not found', () => {
        const r = removeById([{ id: 'a' }], 'z');
        assert.equal(r.length, 1);
    });
});

describe('LruCache', () => {
    it('stores and retrieves', () => {
        const c = new LruCache(3);
        c.set('a', 1); c.set('b', 2);
        assert.equal(c.get('a'), 1);
        assert.equal(c.get('b'), 2);
    });
    it('evicts least-recently-used', () => {
        const c = new LruCache(2);
        c.set('a', 1); c.set('b', 2); c.set('c', 3);
        assert.equal(c.get('a'), undefined);
        assert.equal(c.get('b'), 2);
        assert.equal(c.get('c'), 3);
    });
    it('LRU touch on get', () => {
        const c = new LruCache(2);
        c.set('a', 1); c.set('b', 2);
        c.get('a'); // touch a
        c.set('c', 3); // evicts b, not a
        assert.equal(c.get('a'), 1);
        assert.equal(c.get('b'), undefined);
    });
    it('clear empties cache', () => {
        const c = new LruCache(2);
        c.set('a', 1);
        c.clear();
        assert.equal(c.get('a'), undefined);
    });
});

describe('deepFreeze', () => {
    it('freezes nested objects', () => {
        const obj = { a: { b: { c: 1 } } };
        deepFreeze(obj);
        assert.ok(Object.isFrozen(obj));
        assert.ok(Object.isFrozen(obj.a));
        assert.ok(Object.isFrozen(obj.a.b));
    });
    it('handles arrays', () => {
        const arr = [{ a: 1 }, { b: 2 }];
        deepFreeze(arr);
        assert.ok(Object.isFrozen(arr));
        assert.ok(Object.isFrozen(arr[0]));
    });
    it('handles primitives gracefully', () => {
        assert.equal(deepFreeze(null), null);
        assert.equal(deepFreeze(42), 42);
        assert.equal(deepFreeze('s'), 's');
    });
    it('skips already-frozen', () => {
        const obj = Object.freeze({ a: 1 });
        const r = deepFreeze(obj);
        assert.equal(r, obj);
    });
});

describe('escapeHtml', () => {
    it('escapes HTML special chars', () => {
        assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
        assert.equal(escapeHtml('& <>'), '&amp; &lt;&gt;');
        assert.equal(escapeHtml('"quoted"'), '&quot;quoted&quot;');
        assert.equal(escapeHtml("a 'b' c"), 'a &#39;b&#39; c');
    });
    it('handles empty/null', () => {
        assert.equal(escapeHtml(''), '');
        assert.equal(escapeHtml(null), '');
        assert.equal(escapeHtml(undefined), '');
    });
    it('escapeAttr is alias', () => {
        assert.equal(escapeAttr('"x"'), escapeHtml('"x"'));
    });
});

describe('uuid', () => {
    it('returns valid UUID v4', () => {
        const u = uuid();
        assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
    it('returns unique values', () => {
        const set = new Set();
        for (let i = 0; i < 100; i++) set.add(uuid());
        assert.equal(set.size, 100);
    });
    it('throws when crypto API is unavailable (Этап 10.4.4)', () => {
        // Проверяем, что Math.random-фоллбек убран и при отсутствии crypto
        // uuid бросает понятную ошибку, а не молча возвращает слабый id.
        const original = globalThis.crypto;
        try {
            // На Node 20+ crypto — non-configurable readonly; используем
            // defineProperty для временной подмены, восстанавливаем в finally.
            Object.defineProperty(globalThis, 'crypto', {
                value: undefined,
                configurable: true,
                writable: true
            });
            assert.throws(() => uuid(), /crypto API not available/);
        } finally {
            Object.defineProperty(globalThis, 'crypto', {
                value: original,
                configurable: true,
                writable: true
            });
        }
    });
});

describe('debounce', () => {
    it('coalesces rapid calls', async () => {
        let n = 0;
        const fn = debounce(() => n++, 30);
        fn(); fn(); fn();
        await new Promise(r => setTimeout(r, 50));
        assert.equal(n, 1);
    });
    it('passes latest args', async () => {
        let last;
        const fn = debounce(v => { last = v; }, 30);
        fn(1); fn(2); fn(3);
        await new Promise(r => setTimeout(r, 50));
        assert.equal(last, 3);
    });
});

describe('debounce: flush/cancel (Этап 11.1.3)', () => {
    it('flush до истечения таймера → callback вызван НЕМЕДЛЕННО с последними args', async () => {
        let calls = 0;
        let lastArg;
        const fn = debounce(v => { calls++; lastArg = v; }, 100);
        fn('a');
        fn('b');
        // Сразу flush — должен сработать синхронно, не ждать 100мс.
        fn.flush();
        assert.equal(calls, 1, 'flush должен вызвать callback ровно один раз');
        assert.equal(lastArg, 'b', 'flush должен передать ПОСЛЕДНИЕ args');
        // Убеждаемся, что таймер сброшен — за время debounce ещё одного вызова нет.
        await new Promise(r => setTimeout(r, 130));
        assert.equal(calls, 1, 'после flush таймер сброшен — повторного вызова нет');
    });

    it('cancel до истечения → callback НЕ вызван, таймер сброшен', async () => {
        let calls = 0;
        const fn = debounce(() => { calls++; }, 50);
        fn();
        fn();
        fn.cancel();
        await new Promise(r => setTimeout(r, 80));
        assert.equal(calls, 0, 'cancel должен предотвратить вызов callback');
    });

    it('flush без pending → no-op (callback не вызван)', () => {
        let calls = 0;
        const fn = debounce(() => { calls++; }, 50);
        // Ни одного fn() — pending'а нет.
        fn.flush();
        assert.equal(calls, 0, 'flush без pending не должен вызывать callback');
    });

    it('flush после нескольких быстрых вызовов → callback вызван 1 раз с последними args', async () => {
        const seen = [];
        const fn = debounce((...args) => { seen.push(args); }, 100);
        fn(1);
        fn(2);
        fn(3, 'x');
        fn.flush();
        assert.equal(seen.length, 1, 'flush должен вызвать callback ровно один раз');
        assert.deepEqual(seen[0], [3, 'x'], 'flush должен передать ПОСЛЕДНИЕ args');
        // Убедимся, что после flush таймер сброшен — пер-проверка через ожидание.
        await new Promise(r => setTimeout(r, 130));
        assert.equal(seen.length, 1, 'после flush таймер сброшен');
    });

    it('cancel после flush — no-op (нет двойного вызова)', () => {
        let calls = 0;
        const fn = debounce(() => { calls++; }, 50);
        fn();
        fn.flush();
        fn.cancel();
        assert.equal(calls, 1, 'cancel после flush не должен влиять на счётчик');
    });

    it('повторный flush после первого — no-op', () => {
        let calls = 0;
        const fn = debounce(() => { calls++; }, 50);
        fn();
        fn.flush();
        fn.flush();
        assert.equal(calls, 1, 'повторный flush без новых вызовов — no-op');
    });
});
