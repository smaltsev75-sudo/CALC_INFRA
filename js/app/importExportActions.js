export function importCalcAction({
    triggerEvent,
    store,
    calcList,
    snackbar,
    withLoadingButton,
    lintFormulas
}) {
    const runImport = (opts) =>
        withLoadingButton(triggerEvent, () =>
            calcList.importCalcFromFile(opts).then(res => handleImportResult(res))
        );

    const handleImportResult = (res) => {
        if (res?.ok) {
            store.setActiveTab('questionnaire');
            snackbar.success(res.replaced ? 'Расчёт обновлён' : 'Расчёт загружен');

            const calc = store.getState().activeCalc;
            if (calc) {
                const warnings = lintFormulas(calc.dictionaries.items, calc.dictionaries.questions);
                if (warnings.length > 0) {
                    const sample = warnings.slice(0, 6).map(w => {
                        const item = calc.dictionaries.items.find(i => i.id === w.itemId);
                        const itemName = item?.name || w.itemId;
                        return `  • ${itemName} (${w.stand}): ${w.message}`;
                    }).join('\n');
                    const more = warnings.length > 6 ? `\n  … и ещё ${warnings.length - 6}` : '';
                    store.openModal('message', {
                        title: `Замечания к формулам (${warnings.length})`,
                        message:
                            'В загруженном расчёте обнаружены формулы со ссылками на ' +
                            'отсутствующие вопросы или ошибками парсинга. Затронутые ЭК ' +
                            'будут возвращать qty=0 на соответствующих стендах.\n\n' +
                            sample + more + '\n\n' +
                            'Откройте «Элементы» → «Изменить» → «Формулы количества» для исправления.'
                    });
                }
            }
        } else if (res?.reason === 'cancelled') {
            /* пользователь отменил */
        } else if (res?.reason === 'duplicate') {
            store.openModal('duplicateImport', {
                existingName: res.existingName,
                importedName: res.importedName,
                onReplace: () => runImport({ onDuplicate: 'replace', preloaded: res.preloaded }),
                onClone:   () => runImport({ onDuplicate: 'clone',   preloaded: res.preloaded }),
                onCancel:  () => { /* пользователь отменил */ }
            });
        } else if (res?.reason === 'validation') {
            snackbar.error('Файл не прошёл валидацию');
            store.openModal('message', {
                title: 'Ошибки валидации',
                message: res.errors.slice(0, 5).map(e => `${e.path || ''}: ${e.message}`).join('\n')
            });
        } else {
            snackbar.error('Не удалось загрузить: ' + (res?.message || 'неизвестная ошибка'));
        }
    };

    return runImport();
}

export function exportCalcAction({
    triggerEvent,
    calcList,
    snackbar,
    withLoadingButton
}) {
    return withLoadingButton(triggerEvent, async () => {
        const ok = calcList.exportActiveCalc();
        if (ok) snackbar.success('Файл сохранён');
        else snackbar.warning('Нет активного расчёта');
    });
}

export function exportStateBundleAction({
    triggerEvent,
    store,
    calcList,
    snackbar,
    withLoadingButton
}) {
    return withLoadingButton(triggerEvent, async () => {
        try {
            const result = await calcList.exportStateBundle();
            if (result && Array.isArray(result.errors) && result.errors.length > 0) {
                const reasons = result.errors.reduce((acc, e) => {
                    const key = e.reason || 'unknown';
                    acc[key] = (acc[key] || 0) + 1;
                    return acc;
                }, {});
                const parts = [];
                if (reasons.migration) parts.push(`${reasons.migration} миграц.`);
                if (reasons.pipeline)  parts.push(`${reasons.pipeline} pipeline`);
                if (reasons.validation) parts.push(`${reasons.validation} невалид.`);
                if (reasons.missing)    parts.push(`${reasons.missing} не найдено`);
                if (reasons.unknown)    parts.push(`${reasons.unknown} прочих`);
                snackbar.warning(
                    `Snapshot сохранён (${result.exported} расч.); ` +
                    `${result.errors.length} пропущено: ${parts.join(', ')}. ` +
                    `Откройте проблемные расчёты для исправления.`
                );
            } else {
                snackbar.success(`Полный snapshot сохранён (${result?.exported ?? store.getState().calcList.length} расч.)`);
            }
        } catch (e) {
            snackbar.error('Не удалось экспортировать: ' + e.message);
        }
    });
}

export function importStateBundleAction({
    triggerEvent,
    store,
    calcList,
    snackbar,
    withLoadingButton,
    confirm
}) {
    const currentList = store.getState().calcList;
    const proceed = () => withLoadingButton(triggerEvent, async () => {
        const result = await calcList.importStateBundleFromFile();
        if (result.ok) {
            const a = result.applied;
            snackbar.success(
                `Состояние заменено: ${a.calculations} расч., ` +
                `${a.items} ЭК, ${a.questions} вопр.`
            );
            store.setActiveTab('calculations');
        } else if (result.reason === 'cancelled') {
            /* пользователь отменил */
        } else if (result.reason === 'validation') {
            store.openModal('message', {
                title: 'Файл не прошёл валидацию',
                message:
                    'Bundle-файл содержит ошибки структуры. Состояние не изменено.\n\n' +
                    result.errors.slice(0, 6).map(e => `• ${e.path || ''}: ${e.message}`).join('\n')
            });
        } else if (result.reason === 'parse') {
            snackbar.error('Файл не является корректным JSON: ' + (result.message || ''));
        } else {
            snackbar.error('Ошибка импорта: ' + (result.error || result.reason));
        }
    });

    if (currentList.length === 0) {
        return proceed();
    }
    confirm({
        title: 'Заменить состояние полностью?',
        message:
            `Текущие данные (${currentList.length} расч.) будут УДАЛЕНЫ и заменены ` +
            `содержимым выбранного bundle-файла. Действие необратимо.\n\n` +
            `Совет: перед импортом сделайте «Полный экспорт» для backup.`,
        danger: true,
        confirmLabel: 'Заменить',
        onConfirm: proceed
    });
}

export function exportCsvAction({
    triggerEvent,
    store,
    snackbar,
    withLoadingButton
}) {
    const calc = store.getState().activeCalc;
    if (!calc) {
        snackbar.warning('Нет активного расчёта');
        return;
    }
    return withLoadingButton(triggerEvent, async () => {
        const [{ calculate }, csvMod] = await Promise.all([
            import('../domain/calculator.js'),
            import('../services/csvExport.js')
        ]);
        const result = calculate(calc, store.getState().calcRevision);
        const content = csvMod.buildDetailsCsv(calc, result);
        csvMod.downloadCsv(csvMod.buildCalcCsvFilename(calc), content);
        snackbar.success('CSV сохранён');
    });
}

export function exportComparisonCsvAction({
    triggerEvent,
    store,
    calcList,
    snackbar,
    withLoadingButton
}) {
    const ids = store.getState().comparisonIds || [];
    if (ids.length === 0) { snackbar.warning('Нечего экспортировать'); return; }
    return withLoadingButton(triggerEvent, async () => {
        /* Внешний аудит #13 (P1#1, 2026-05-19): берём calc через
         * calcList.loadCalcPrepared (full pipeline) вместо raw persistMod.loadCalc.
         * Иначе CSV для auto-by-date legacy calc'а содержал stale vatRate. */
        const [{ calculate }, csvMod] = await Promise.all([
            import('../domain/calculator.js'),
            import('../services/csvExport.js')
        ]);
        const calcs = ids.map(i => calcList.loadCalcPrepared(i)).filter(Boolean);
        if (calcs.length === 0) return;
        const content = csvMod.buildComparisonCsv(calcs, calcs.map(c => calculate(c)));
        csvMod.downloadCsv(csvMod.buildComparisonCsvFilename(), content);
        snackbar.success('Сравнение экспортировано');
    });
}
