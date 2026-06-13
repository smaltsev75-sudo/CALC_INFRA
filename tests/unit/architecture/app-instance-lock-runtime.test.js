import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createAppInstanceLockRuntime } from '../../../js/app/instanceLockRuntime.js';

function createRuntime(overrides = {}, extraDeps = {}) {
    const calls = {
        acquire: [],
        release: [],
        heartbeatStarts: [],
        heartbeatStops: 0,
        blocked: [],
        reinit: 0
    };
    const heartbeatHandle = {
        stop() { calls.heartbeatStops++; }
    };
    const runtime = createAppInstanceLockRuntime({
        storageKey: 'calc.appInstanceLock',
        acquireAppInstanceLock: () => {
            calls.acquire.push(true);
            return overrides.acquireResult || { ok: true, ownerId: 'owner-new' };
        },
        releaseAppInstanceLock: ownerId => {
            calls.release.push(ownerId);
            return { ok: true };
        },
        startAppInstanceHeartbeat: (ownerId, opts) => {
            calls.heartbeatStarts.push({ ownerId, opts });
            return heartbeatHandle;
        },
        renderInstanceBlockedScreen: lockResult => {
            calls.blocked.push(lockResult);
        },
        reinitFromStorage: () => { calls.reinit++; },
        ...extraDeps
    });
    return { runtime, calls };
}

describe('createAppInstanceLockRuntime', () => {
    it('BFCache pageshow re-acquire игнорирует обычный pageshow', () => {
        const { runtime, calls } = createRuntime();

        runtime.handlePageshow({ persisted: false });

        assert.equal(calls.acquire.length, 0);
        assert.equal(calls.heartbeatStarts.length, 0);
    });

    it('BFCache pageshow re-acquire перезапускает heartbeat', () => {
        const { runtime, calls } = createRuntime();

        runtime.start('owner-old');
        runtime.handlePageshow({ persisted: true });

        assert.equal(calls.heartbeatStops, 1);
        assert.deepEqual(calls.acquire, [true]);
        assert.deepEqual(calls.heartbeatStarts.map(x => x.ownerId), ['owner-old', 'owner-new']);
        assert.deepEqual(calls.blocked, []);
    });

    it('BFCache pageshow показывает blocked screen, если re-acquire не прошёл', () => {
        const failed = { ok: false, reason: 'occupied', existing: { ownerId: 'other' } };
        const { runtime, calls } = createRuntime({ acquireResult: failed });

        runtime.start('owner-old');
        runtime.handlePageshow({ persisted: true });

        assert.equal(calls.heartbeatStops, 1);
        assert.deepEqual(calls.blocked, [failed]);
        assert.deepEqual(calls.heartbeatStarts.map(x => x.ownerId), ['owner-old']);
    });

    it('storage-event от чужого owner переводит runtime в blocked-state', () => {
        const { runtime, calls } = createRuntime();

        runtime.start('owner-current');
        runtime.handleStorageEvent({
            key: 'calc.appInstanceLock',
            newValue: JSON.stringify({ ownerId: 'owner-other' })
        });

        assert.equal(calls.heartbeatStops, 1);
        assert.equal(calls.blocked.length, 1);
        assert.equal(calls.blocked[0].reason, 'occupied');
        assert.equal(calls.blocked[0].existing.ownerId, 'owner-other');
    });

    it('release останавливает heartbeat и освобождает только текущего owner', () => {
        const { runtime, calls } = createRuntime();

        runtime.start('owner-current');
        runtime.release();

        assert.equal(calls.heartbeatStops, 1);
        assert.deepEqual(calls.release, ['owner-current']);
    });

    /* T-RISK-8 (data-safety review): heartbeat onWriteFailed подключён в runtime;
       BFCache-restore перечитывает state из storage. */
    it('start передаёт onWriteFailed в heartbeat (раньше callback был мёртв)', () => {
        let writeFailed = 0;
        const { runtime, calls } = createRuntime({}, { onWriteFailed: () => { writeFailed++; } });

        runtime.start('o1');

        const opts = calls.heartbeatStarts[0].opts;
        assert.equal(typeof opts.onWriteFailed, 'function', 'onWriteFailed проброшен в heartbeat');
        opts.onWriteFailed('write-failed');
        assert.equal(writeFailed, 1, 'callback вызывается при write-failed');
    });

    it('handlePageshow(persisted) после успешного re-acquire перечитывает state из storage', () => {
        const { runtime, calls } = createRuntime();

        runtime.start('old');
        runtime.handlePageshow({ persisted: true });

        assert.equal(calls.reinit, 1, 'reinitFromStorage вызван (stale in-memory calc обновлён)');
    });

    it('handlePageshow: при неудачном re-acquire reinitFromStorage НЕ вызывается', () => {
        const failed = { ok: false, reason: 'occupied', existing: { ownerId: 'other' } };
        const { runtime, calls } = createRuntime({ acquireResult: failed });

        runtime.start('old');
        runtime.handlePageshow({ persisted: true });

        assert.equal(calls.reinit, 0, 'blocked-state не должен перечитывать state');
    });
});
