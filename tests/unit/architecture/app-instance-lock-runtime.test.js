import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createAppInstanceLockRuntime } from '../../../js/app/instanceLockRuntime.js';

function createRuntime(overrides = {}) {
    const calls = {
        acquire: [],
        release: [],
        heartbeatStarts: [],
        heartbeatStops: 0,
        blocked: []
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
        }
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
});
