export function deleteItemAction({
    id,
    store,
    itemCtl,
    snackbar,
    lintFormulas
}) {
    const calc = store.getState().activeCalc;
    const backup = calc?.dictionaries?.items?.find(i => i.id === id);
    const res = itemCtl.deleteItem(id);
    /* Внешний аудит #5 (2026-05-18, P2): при persist-fail НЕ показываем
     * undo-snackbar — он лжёт, что элемент сохранён в хранилище. Показываем
     * error-snackbar и НЕ закрываем правку (она в store, но F5 вернёт). */
    if (res && res.ok === false) {
        snackbar.error(res.message || 'Не удалось удалить элемент');
        return;
    }
    if (backup) {
        snackbar.showUndoableSnackbar(
            `Элемент «${backup.name}» удалён`,
            () => {
                /* Внешний аудит #6 (2026-05-18, P2-3): saveItem возвращает
                 * {ok, errors} — игнорировалось, лживо «Восстановлено» при
                 * persist-fail. */
                const r = itemCtl.saveItem(backup);
                if (r && r.ok === false) {
                    snackbar.error(r.errors?.[0]?.message || 'Не удалось восстановить элемент');
                    return;
                }
                // После undo проверим, не осталось ли висящих ссылок Q.<id>:
                // справочник вопросов мог измениться за время snackbar'а.
                const cur = store.getState().activeCalc;
                if (cur) {
                    const w = lintFormulas([backup], cur.dictionaries.questions);
                    if (w.length > 0) {
                        snackbar.warning(
                            `Восстановлено, но в формулах ${w.length} висящих ссылок — ` +
                            `проверьте в детализации (кнопка-подсказка рядом со значением).`
                        );
                        return;
                    }
                }
                snackbar.success('Восстановлено');
            }
        );
    }
}

export function duplicateItemAction({
    id,
    itemCtl,
    snackbar
}) {
    /* Внешний аудит #8 (2026-05-18, P1-2): duplicateItem теперь возвращает
     * {ok, id?, reason?, message?}. Раньше при quota caller получал
     * copy.id и лживо рапортовал «Элемент дублирован», хотя ничего не
     * сохранилось ни в store, ни в storage. */
    const res = itemCtl.duplicateItem(id);
    if (res && res.ok === true) {
        snackbar.success('Элемент дублирован');
    } else if (res && res.reason === 'persist') {
        snackbar.error(res.message || 'Не удалось дублировать элемент (quota?)');
    }
    /* reason='noActiveCalc'/'notFound' — пользователь видит, что ничего
     * не произошло (кнопка должна была быть disabled, race). Молча. */
}

export function deleteQuestionAction({
    id,
    store,
    questionCtl,
    snackbar,
    findQuestionUsages,
    commitActiveCalc,
    confirm
}) {
    const calc = store.getState().activeCalc;
    const backup = calc?.dictionaries?.questions?.find(q => q.id === id);
    const backupAnswer = calc?.answers?.[id];
    if (!backup) return;

    const usages = findQuestionUsages(id, calc.dictionaries.items);

    const proceed = () => {
        const res = questionCtl.deleteQuestion(id);
        /* Внешний аудит #5 (2026-05-18, P2): persist-fail — error-snackbar
         * без undo (см. deleteItem). */
        if (res && res.ok === false) {
            snackbar.error(res.message || 'Не удалось удалить вопрос');
            return;
        }
        snackbar.showUndoableSnackbar(
            `Вопрос «${backup.title}» удалён`,
            () => {
                /* Внешний аудит #6 (2026-05-18, P1): saveQuestion persist'ит
                 * вопрос с default answer; восстановление прежнего ответа
                 * требует ОТДЕЛЬНОГО commit'а — без него store покажет
                 * backupAnswer, но F5 вернёт default. */
                const r = questionCtl.saveQuestion(backup);
                if (r && r.ok === false) {
                    snackbar.error(r.errors?.[0]?.message || 'Восстановление не сохранено');
                    return;
                }
                if (backupAnswer !== undefined) {
                    const cur = store.getState().activeCalc;
                    if (cur) {
                        /* Внешний аудит #8 (2026-05-18, P3-1): inverse
                         * pattern — построить newCalc, commit ПЕРВЫМ,
                         * только при ok мутировать store. Раньше:
                         * store.updateActiveCalc → потом commit. При quota
                         * UI показывал backupAnswer, в storage оставался
                         * default-answer от saveQuestion(backup) — F5
                         * терял прежний ответ без visible warning. */
                        const restored = {
                            ...cur,
                            answers: { ...cur.answers, [id]: backupAnswer }
                        };
                        if (!commitActiveCalc(restored)) {
                            snackbar.error('Вопрос восстановлен, но прежний ответ не сохранён в хранилище (quota?).');
                            return;
                        }
                        store.setActiveCalc(restored);
                    }
                }
                snackbar.success('Восстановлено');
            }
        );
    };

    if (usages.length === 0) {
        proceed();
        return;
    }

    // Есть формулы, ссылающиеся на этот вопрос — предупреждаем явно.
    const lines = usages.slice(0, 8).map(u => `  • ${u.itemName} (${u.stand})`).join('\n');
    const more = usages.length > 8 ? `\n  … и ещё ${usages.length - 8}` : '';
    confirm({
        title: 'Вопрос используется в формулах',
        message:
            `На вопрос «${backup.title}» (id=${id}) ссылаются формулы ` +
            `следующих элементов конфигурации:\n\n${lines}${more}\n\n` +
            `После удаления Q.${id} будет возвращать 0, что приведёт к занижению qty в этих формулах.\n` +
            `Удалить вопрос всё равно?`,
        danger: true,
        confirmLabel: 'Удалить',
        onConfirm: proceed
    });
}

export function duplicateQuestionAction({
    id,
    questionCtl,
    snackbar
}) {
    /* Внешний аудит #8 (2026-05-18, P1-2): см. duplicateItem. */
    const res = questionCtl.duplicateQuestion(id);
    if (res && res.ok === true) {
        snackbar.success('Вопрос дублирован');
    } else if (res && res.reason === 'persist') {
        snackbar.error(res.message || 'Не удалось дублировать вопрос (quota?)');
    }
}
