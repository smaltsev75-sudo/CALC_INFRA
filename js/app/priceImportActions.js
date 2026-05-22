function formatImportRows(rows, formatter) {
    return rows.slice(0, 10).map(formatter).join('\n') +
        (rows.length > 10 ? `\n  …и ещё ${rows.length - 10}` : '');
}

function formatAnomalies(anomalies) {
    return formatImportRows(
        anomalies,
        a => `  • ${a.name} (${a.id}): ${a.reason}`
    );
}

function formatRejectedRows(rejected) {
    return formatImportRows(
        rejected,
        r => `  • строка ${r.rowIndex}${r.id ? ` (${r.id})` : ''}: ${r.reason}`
    );
}

export async function handlePriceImportFileAction({
    file = null,
    priceImportCtl,
    snackbar
}) {
    const result = await priceImportCtl.handlePriceImportFile(file);
    if (!result.ok && result.reason === 'parse') {
        snackbar.error('Не удалось разобрать файл — проверьте формат.');
    }
    return result;
}

export function applyPriceImportAction({
    priceImportCtl,
    snackbar
}) {
    const result = priceImportCtl.applyPriceImport();
    if (result.ok) {
        const s = result.summary;
        /* Внешний аудит #7 (2026-05-18, P3) + #8 (P2-1): refresh-фаза
         * могла оставить partial-state — либо per-calc quota (refreshErrors),
         * либо full refresh-failure (refreshReason='locked-by-other-tab' /
         * 'no-override'). Показываем warning с конкретной причиной. */
        if (s.partial) {
            if (s.refreshReason === 'locked-by-other-tab') {
                snackbar.warning(
                    `Прайс ${s.providerId} сохранён (${s.priceCount} тарифов), ` +
                    `но расчёты не обновлены: ${s.refreshMessage || 'обновляются в другой вкладке'}. ` +
                    `Закройте параллельную вкладку и повторите «Пересчитать на новый прайс».`
                );
            } else if (s.refreshErrors.length > 0) {
                snackbar.warning(
                    `Прайс ${s.providerId} применён (${s.priceCount} тарифов), ` +
                    `но ${s.refreshErrors.length} расчёт(ов) не обновлено — освободите место и повторите ` +
                    `«Пересчитать на новый прайс».`
                );
            } else {
                snackbar.warning(
                    `Прайс ${s.providerId} сохранён (${s.priceCount} тарифов), ` +
                    `но расчёты не обновлены: ${s.refreshMessage || s.refreshReason || 'неизвестная причина'}.`
                );
            }
        } else {
            snackbar.success(`Прайс применён: ${s.priceCount} тарифов для ${s.providerId}.`);
        }
    } else {
        snackbar.error('Apply не удался: ' + (result.message || result.reason));
    }
    return result;
}

export function importItemPricesAction({
    triggerEvent,
    itemCtl,
    store,
    snackbar,
    withLoadingButton,
    confirmAsync
}) {
    // Этап 11.2.1: аномалии (× ≥ 10) НЕ применяются автоматически — спрашиваем
    // пользователя через 2-кнопочную confirm-модалку (confirmAsync).
    // Безопасные обновления применяются сразу, до confirm.
    const confirmAnomalies = (anomalies) => {
        const sample = formatAnomalies(anomalies);
        return confirmAsync({
            title: `Аномальные цены: ${anomalies.length}`,
            message:
                `Найдено ${anomalies.length} цен, изменённых более чем в 10×. ` +
                `Это часто опечатки (лишний ноль, не та запятая). Применить их?\n\n` +
                sample,
            danger: true,
            confirmLabel: 'Применить'
        });
    };

    return withLoadingButton(triggerEvent, () =>
        itemCtl.importItemPrices({ confirmAnomalies }).then(res =>
            handleItemPricesImportResult({ res, store, snackbar })
        )
    );
}

export function handleItemPricesImportResult({
    res,
    store,
    snackbar
}) {
    if (!res?.ok) {
        if (res?.reason === 'cancelled') return;
        if (res?.reason === 'noActiveCalc') { snackbar.warning(res.message); return; }
        if (res?.reason === 'invalid')     { snackbar.error('Файл не подходит: ' + res.message); return; }
        if (res?.reason === 'parse')       { snackbar.error('Не удалось разобрать CSV: ' + res.message); return; }
        /* Внешний аудит #5 (2026-05-18, P2): persist-fail в applyPriceUpdates —
         * цены применены в store, но не сохранены. UI должен сообщить честно. */
        if (res?.reason === 'persist')     { snackbar.error(res.message || 'Цены не сохранены в хранилище (quota?)'); return; }
        snackbar.error('Импорт не выполнен');
        return;
    }

    const safeCount = res.safeUpdatesCount ?? 0;
    const anomaliesTotal = res.anomalies?.length ?? 0;
    const anomaliesApplied = res.anomaliesApplied ?? 0;
    const anomaliesSkipped = anomaliesTotal - anomaliesApplied;

    const lines = [];
    lines.push(`Файл: ${res.fileName}`);
    lines.push(`Обновлено цен: ${res.updatesCount}` +
        (anomaliesApplied > 0 ? ` (включая аномалий: ${anomaliesApplied})` : ''));
    lines.push(`Без изменений: ${res.unchanged}`);
    if (res.rejected?.length) lines.push(`Отклонено строк: ${res.rejected.length}`);
    if (anomaliesSkipped > 0) {
        lines.push(`Аномальные изменения, не применены (отказ пользователя): ${anomaliesSkipped}`);
    }
    const anomaliesText = anomaliesSkipped > 0
        ? '\n\nАНОМАЛЬНЫЕ ИЗМЕНЕНИЯ (НЕ применены — пользователь отказался):\n' +
          formatAnomalies(res.anomalies)
        : '';
    const rejectedText = res.rejected?.length
        ? '\n\nОТКЛОНЁННЫЕ СТРОКИ:\n' + formatRejectedRows(res.rejected)
        : '';
    const summary = lines.join('\n') + anomaliesText + rejectedText;

    if (anomaliesSkipped > 0 || res.rejected?.length) {
        store.openModal('message', {
            title: anomaliesSkipped > 0
                ? 'Импорт цен — аномалии пропущены'
                : 'Импорт цен — есть отклонённые строки',
            message: summary
        });
    }
    if (res.updatesCount > 0) {
        snackbar.success(`Обновлено цен: ${res.updatesCount}` +
            (anomaliesApplied > 0 ? ` (вкл. аномалий: ${anomaliesApplied})` : ''));
    } else if (anomaliesSkipped > 0 && safeCount === 0) {
        snackbar.info('Аномальные цены не применены');
    } else if (res.unchanged > 0) {
        snackbar.info('Цены в файле совпадают с текущими — обновлять нечего');
    }
}
