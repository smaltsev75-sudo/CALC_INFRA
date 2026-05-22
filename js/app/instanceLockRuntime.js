export function createAppInstanceLockRuntime({
    storageKey,
    acquireAppInstanceLock,
    releaseAppInstanceLock,
    startAppInstanceHeartbeat,
    renderInstanceBlockedScreen
}) {
    let ownerId = null;
    let heartbeatHandle = null;

    function stopHeartbeat() {
        if (heartbeatHandle && typeof heartbeatHandle.stop === 'function') {
            try { heartbeatHandle.stop(); } catch { /* no-op */ }
            heartbeatHandle = null;
        }
    }

    function enterBlockedState(lockResult) {
        stopHeartbeat();
        ownerId = null;
        renderInstanceBlockedScreen(lockResult);
    }

    function start(owner) {
        ownerId = owner;
        heartbeatHandle = startAppInstanceHeartbeat(ownerId, {
            onLost: existing => {
                enterBlockedState({ ok: false, reason: 'occupied', existing });
            }
        });
    }

    function handleStorageEvent(e) {
        if (e.key !== storageKey) return;
        if (!ownerId) return;
        let parsed = null;
        try { parsed = e.newValue ? JSON.parse(e.newValue) : null; }
        catch { /* битый JSON — игнорируем */ }
        if (!parsed) return;
        if (parsed.ownerId && parsed.ownerId !== ownerId) {
            enterBlockedState({ ok: false, reason: 'occupied', existing: parsed });
        }
    }

    function handlePageshow(e) {
        if (!e || !e.persisted) return;
        stopHeartbeat();
        ownerId = null;

        const r = acquireAppInstanceLock();
        if (!r.ok) {
            enterBlockedState(r);
            return;
        }
        start(r.ownerId);
    }

    function release() {
        stopHeartbeat();
        if (ownerId) {
            try { releaseAppInstanceLock(ownerId); } catch { /* no-op */ }
            ownerId = null;
        }
    }

    return {
        start,
        release,
        handleStorageEvent,
        handlePageshow
    };
}
