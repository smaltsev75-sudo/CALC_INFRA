export function createAppInstanceLockRuntime({
    storageKey,
    acquireAppInstanceLock,
    releaseAppInstanceLock,
    startAppInstanceHeartbeat,
    renderInstanceBlockedScreen,
    /* T-RISK-8 (data-safety review 2026-06-13): callback при сбое записи
       heartbeat'а (quota mid-session). Раньше startAppInstanceHeartbeat
       поддерживал onWriteFailed, но runtime его НЕ передавал → сбой проглатывался
       молча, lock протухал через TTL, другая вкладка перехватывала. */
    onWriteFailed = null,
    /* T-RISK-8: перечитать state из storage после BFCache-restore. Раньше
       handlePageshow re-acquire'ил lock, но НЕ звал initFromStorage → держал
       stale in-memory activeCalc, первая правка перезаписывала внешние изменения. */
    reinitFromStorage = null
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
            },
            /* T-RISK-8: подключаем onWriteFailed (раньше не передавался → мёртвый
               callback в appInstanceLock). Сигнал поднимает app.js (snackbar). */
            ...(typeof onWriteFailed === 'function' ? { onWriteFailed } : {})
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
        /* T-RISK-8: перечитать state из storage — за время BFCache-заморозки
           другая вкладка могла отредактировать calc.<id>; без re-init первая
           правка перезаписала бы внешние изменения stale-снапшотом. */
        if (typeof reinitFromStorage === 'function') {
            try { reinitFromStorage(); } catch { /* best-effort: re-init не должен ронять restore */ }
        }
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
