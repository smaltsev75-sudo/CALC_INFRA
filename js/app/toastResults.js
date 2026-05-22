/* Общий handler результата обновления прайса (snackbar success/info/error по reason). */
export function handleUpdateProviderResult(result, snackbar) {
    if (result.ok) {
        const ver = result.applied?.version || '';
        snackbar.success(`Прайс провайдера обновлён${ver ? ' до ' + ver : ''}.`);
    } else if (result.reason === 'in-progress') {
        snackbar.info('Обновление уже выполняется.');
    } else if (result.reason === 'cancelled') {
        /* Тихая отмена — без toast'а. */
    } else if (result.reason === 'vat-policy-required') {
        /* Stage VAT-2 Phase 5: v1 JSON без vatPolicy → модалка уже открыта
         * контроллером; toast'а не показываем (модалка сама объясняет flow). */
    } else {
        snackbar.error(result.message || 'Не удалось обновить прайс.');
    }
    return result;
}

/* Phase 3: показать snackbar по result-объекту от applyOptimizationDraftAction/
   confirmOptimizationApply. Controller возвращает форму
   { ok: true, applied, failed, savingPercent } или
   { ok: false, reason: 'high_risk_pending'|'no_changes'|'recompute_failed'|... }.
   high_risk_pending — это нормальная промежуточная ветка (UI открыл confirm-
   panel), snackbar не показываем. */
export function showOptimizationApplyResult(r, snackbar) {
    if (!r) return;
    if (r.ok) {
        const pct = Number.isFinite(r.savingPercent) ? r.savingPercent : 0;
        const word = pluralizeParamRu(r.applied);
        const partial = r.failed > 0 ? ` (${r.failed} не прошло)` : '';
        snackbar.success(
            `Изменения применены: ${r.applied} ${word}, экономия −${pct.toFixed(1)}%.${partial}`
        );
        return;
    }
    switch (r.reason) {
        case 'high_risk_pending':
            /* Inline-confirmation открыта, snackbar не нужен. */
            return;
        case 'no_changes':
            snackbar.warning('Нет изменений для применения.');
            return;
        case 'recompute_failed':
            snackbar.error('Не удалось применить: ошибка пересчёта.');
            return;
        case 'invalid_total':
            snackbar.error('Не удалось применить: невалидная итоговая стоимость.');
            return;
        case 'no_draft':
        case 'no_calc':
        case 'not_confirming':
        case 'modal_closed':
            return; /* defensive — UI до этого не должен пускать */
        default:
            snackbar.warning('Не удалось применить изменения.');
    }
}

export function pluralizeParamRu(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'параметр';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'параметра';
    return 'параметров';
}
