let lastCreateAt = 0;
let lastDuplicateAt = 0;

function isRepeatedClick(lastAt, now = Date.now()) {
    return lastAt && (now - lastAt) < 500;
}

export function createCalcAction({
    name,
    templateId = null,
    calcList,
    store,
    snackbar,
    now = Date.now()
}) {
    // Защита от двойного клика: если предыдущий вызов выполнился < 500 мс назад,
    // игнорируем повторный — иначе быстрый double-click создаст два расчёта.
    if (isRepeatedClick(lastCreateAt, now)) return null;
    lastCreateAt = now;
    const c = calcList.createCalc(name, templateId);
    /* Внешний аудит #3 (2026-05-18, P2): null = quota-fail в commitNewCalc,
     * показываем error вместо лживого success. */
    if (!c) {
        snackbar.error('Не удалось создать расчёт. Возможно, переполнено локальное хранилище браузера. Скачайте JSON-снимок и удалите старые расчёты.');
        return null;
    }
    store.setActiveTab('questionnaire');
    snackbar.success(templateId
        ? 'Расчёт создан из шаблона'
        : 'Расчёт создан');
    return c;
}

export function createCalcFromWizardAction({
    name,
    wizardInput,
    calcList,
    store,
    snackbar,
    now = Date.now()
}) {
    if (isRepeatedClick(lastCreateAt, now)) return null;
    lastCreateAt = now;
    const c = calcList.createCalcFromWizard(name, wizardInput);
    /* Внешний аудит #3 (2026-05-18, P2): null = quota-fail. */
    if (!c) {
        snackbar.error('Не удалось создать расчёт. Возможно, переполнено локальное хранилище. Скачайте JSON-снимок и удалите старые расчёты.');
        return null;
    }
    store.setActiveTab('dashboard');
    return c;
}

export function duplicateCalcAction({
    id,
    calcList,
    snackbar,
    now = Date.now()
}) {
    if (isRepeatedClick(lastDuplicateAt, now)) return;
    lastDuplicateAt = now;
    const c = calcList.duplicateCalc(id);
    /* Внешний аудит #3 (2026-05-18, P2): null = quota-fail в commitNewCalc. */
    if (!c) {
        snackbar.error('Не удалось скопировать расчёт. Возможно, переполнено локальное хранилище.');
        return;
    }
    snackbar.success('Расчёт скопирован');
}

export function renameCalcAction({
    id,
    currentName,
    calcList,
    snackbar,
    input
}) {
    input({
        title: 'Переименовать расчёт',
        label: 'Название',
        defaultValue: currentName || '',
        placeholder: 'Например: SaaS-платформа MVP',
        confirmLabel: 'Сохранить',
        onConfirm: next => {
            const trimmed = (next || '').trim();
            if (trimmed) {
                /* Внешний аудит #6 (2026-05-18, P2-2): persist-fail → имя
                 * не изменено (storage и in-memory consistent), snackbar.error. */
                const r = calcList.renameCalc(id, trimmed);
                if (r && r.ok === false) {
                    snackbar.error(r.message || 'Не удалось переименовать расчёт');
                }
            }
        }
    });
}

export function deleteCalcAction({
    id,
    name,
    calcList,
    snackbar,
    confirm
}) {
    confirm({
        title: 'Удалить расчёт',
        message: `Удалить расчёт «${name}»?\n\nДействие можно отменить в течение нескольких секунд через кнопку «Отменить» в уведомлении.`,
        danger: true,
        confirmLabel: 'Удалить',
        onConfirm: () => {
            // Backup перед удалением — для undo
            const backup = calcList.snapshotCalc(id);
            /* Внешний аудит #6 (2026-05-18, P3-1): deleteCalc возвращает
             * {ok, reason}. При persist-fail НЕ показываем undo-snackbar
             * (расчёт не удалён) — показываем error. */
            const r = calcList.deleteCalc(id);
            if (r && r.ok === false) {
                snackbar.error(r.message || 'Не удалось удалить расчёт');
                return;
            }
            if (backup) {
                snackbar.showUndoableSnackbar(
                    `Расчёт «${name}» удалён`,
                    () => {
                        /* Внешний аудит #6 (2026-05-18, P2-3): restoreCalc
                         * возвращает boolean — игнорировался, лживо
                         * показывали «Расчёт восстановлен» при quota. */
                        if (calcList.restoreCalc(backup)) {
                            snackbar.success('Расчёт восстановлен');
                        } else {
                            snackbar.error('Не удалось восстановить расчёт (quota?). Откройте JSON-экспорт и импортируйте вручную.');
                        }
                    }
                );
            }
        }
    });
}
