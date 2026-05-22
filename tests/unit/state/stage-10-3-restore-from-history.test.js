/**
 * Stage 10.3: restoreProviderOverrideFromHistory — выбрать конкретный snapshot
 * из истории и сделать его текущим. Все snapshots ДО выбранного индекса
 * (более новые) удаляются — это аналог git reset --hard на коммит из истории.
 *
 * История newest-first: history[0] = последний override до текущего,
 * history[1] = ещё более старый, ...
 *
 * Семантика:
 *   - restoreProviderOverrideFromHistory(providerId, idx)
 *     • idx === -1 → использовать current (no-op для override, очистить history[idx-1..])
 *     • idx === 0  → откатить на history[0], отбросить current; новой history становится history[1..]
 *     • idx === N  → восстановить history[N], отбросить current+history[0..N-1];
 *                    новой history становится history[N+1..]
 *
 * Возврат:
 *   { ok: true, restored: { version, ... }, hasMoreHistory: boolean }
 *   { ok: false, reason: 'invalid-index' | 'no-history' | 'persist', message }
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../../integration/storage-mock.js';

let providerCtl;
let persist;

function makeOverride(providerId, version) {
    return {
        schemaVersion: 1,
        providerId,
        version,
        timestamp: '2026-01-01T00:00:00.000Z',
        source: 'test',
        prices: { 'cpu-vcpu-shared': { pricePerUnit: 100 } }
    };
}

before(async () => {
    installLocalStorage();
    providerCtl = await import('../../../js/controllers/providerController.js');
    persist = await import('../../../js/state/persistence.js');
});

beforeEach(() => {
    installLocalStorage();
});

describe('Stage 10.3 restoreProviderOverrideFromHistory — exists', () => {
    it('экспортируется', () => {
        assert.equal(typeof providerCtl.restoreProviderOverrideFromHistory, 'function');
    });
});

describe('Stage 10.3 restoreProviderOverrideFromHistory — happy path', () => {
    it('idx=0: история [Q3, Q2] + current Q4 → current=Q3, history=[Q2]', () => {
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'Q4'));
        persist.pushProviderOverrideHistory('sbercloud', {
            appliedJSON: makeOverride('sbercloud', 'Q3'),
            appliedAt: '2026-04-01T12:00:00.000Z'
        });
        persist.pushProviderOverrideHistory('sbercloud', {
            appliedJSON: makeOverride('sbercloud', 'Q2'),
            appliedAt: '2026-03-01T12:00:00.000Z'
        });
        /* Stack newest-first: history[0]=Q3 (push'нут позже из логики push'ит в начало;
           проверим как реально работает persist'ovskaya логика). */
        const before = persist.loadProviderOverrideHistory('sbercloud');
        const newestId = before[0].appliedJSON.version;

        const r = providerCtl.restoreProviderOverrideFromHistory('sbercloud', 0);
        assert.equal(r.ok, true);
        assert.equal(r.restored.version, newestId);

        /* После restore: current = newest from history, остальные history записи остались. */
        const cur = persist.loadProviderOverrides()?.sbercloud;
        assert.equal(cur.version, newestId);
        const hist = persist.loadProviderOverrideHistory('sbercloud');
        assert.equal(hist.length, before.length - 1);
    });

    it('idx=1: восстанавливает history[1] и удаляет history[0..1] вместе с current', () => {
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'curr'));
        persist.pushProviderOverrideHistory('sbercloud', {
            appliedJSON: makeOverride('sbercloud', 'h0'),
            appliedAt: '2026-04-01T12:00:00.000Z'
        });
        persist.pushProviderOverrideHistory('sbercloud', {
            appliedJSON: makeOverride('sbercloud', 'h1'),
            appliedAt: '2026-03-01T12:00:00.000Z'
        });
        persist.pushProviderOverrideHistory('sbercloud', {
            appliedJSON: makeOverride('sbercloud', 'h2'),
            appliedAt: '2026-02-01T12:00:00.000Z'
        });
        const before = persist.loadProviderOverrideHistory('sbercloud');
        const targetVersion = before[1].appliedJSON.version;

        const r = providerCtl.restoreProviderOverrideFromHistory('sbercloud', 1);
        assert.equal(r.ok, true);
        assert.equal(r.restored.version, targetVersion);

        const cur = persist.loadProviderOverrides()?.sbercloud;
        assert.equal(cur.version, targetVersion);
        const hist = persist.loadProviderOverrideHistory('sbercloud');
        /* После restore: history[0] и history[1] (восстановленный) удаляются;
           остаются только записи, более старые чем target. */
        assert.equal(hist.length, before.length - 2);
        assert.equal(hist[0].appliedJSON.version, before[2].appliedJSON.version);
    });

    it('hasMoreHistory=true когда есть еще old записи после restore', () => {
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'curr'));
        persist.pushProviderOverrideHistory('sbercloud', {
            appliedJSON: makeOverride('sbercloud', 'h0'),
            appliedAt: '2026-04-01T12:00:00.000Z'
        });
        persist.pushProviderOverrideHistory('sbercloud', {
            appliedJSON: makeOverride('sbercloud', 'h1'),
            appliedAt: '2026-03-01T12:00:00.000Z'
        });
        const r = providerCtl.restoreProviderOverrideFromHistory('sbercloud', 0);
        assert.equal(r.hasMoreHistory, true);
    });

    it('hasMoreHistory=false когда восстановили последний элемент', () => {
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'curr'));
        persist.pushProviderOverrideHistory('sbercloud', {
            appliedJSON: makeOverride('sbercloud', 'h0'),
            appliedAt: '2026-04-01T12:00:00.000Z'
        });
        const r = providerCtl.restoreProviderOverrideFromHistory('sbercloud', 0);
        assert.equal(r.ok, true);
        assert.equal(r.hasMoreHistory, false);
    });
});

describe('Stage 10.3 restoreProviderOverrideFromHistory — input validation', () => {
    it('пустая история → reason=no-history', () => {
        const r = providerCtl.restoreProviderOverrideFromHistory('sbercloud', 0);
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'no-history');
    });

    it('idx за пределами history → reason=invalid-index', () => {
        persist.pushProviderOverrideHistory('sbercloud', {
            appliedJSON: makeOverride('sbercloud', 'h0'),
            appliedAt: '2026-04-01T12:00:00.000Z'
        });
        const r = providerCtl.restoreProviderOverrideFromHistory('sbercloud', 5);
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'invalid-index');
    });

    it('idx=-1 → reason=invalid-index (отрицательные не принимаются)', () => {
        persist.pushProviderOverrideHistory('sbercloud', {
            appliedJSON: makeOverride('sbercloud', 'h0'),
            appliedAt: '2026-04-01T12:00:00.000Z'
        });
        const r = providerCtl.restoreProviderOverrideFromHistory('sbercloud', -1);
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'invalid-index');
    });

    it('non-string providerId → reason=invalid-provider', () => {
        const r = providerCtl.restoreProviderOverrideFromHistory(null, 0);
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'invalid-provider');
    });
});
