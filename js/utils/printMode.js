export const DETAILS_PRINT_BODY_CLASS = 'printing-details';
export const DETAILS_PRINT_NO_QUANTITY_CLASS = 'printing-details-no-quantity-summary';
export const DETAILS_PRINT_STYLE_ID = 'details-print-page-style';
/* margin: top right bottom left. Левое поле 10мм (было 6мм со всех сторон) —
   контент Деталей не прижимается к левому краю листа. Правое оставлено 6мм →
   правый край таблицы не двигается (нет риска обрезки). usable-ширина A4
   landscape = 297-(10+6) = 281мм — документированный безопасный минимум для
   14 видимых колонок при 6.5pt (см. css/print.css). */
export const DETAILS_PRINT_PAGE_CSS = '@page { size: A4 landscape; margin: 6mm 6mm 6mm 10mm; }';

export function beginDetailsPrintMode({
    doc = globalThis.document,
    win = globalThis.window,
    includeQuantitySummary = true
} = {}) {
    if (!doc?.body) return () => {};

    const previous = doc.getElementById?.(DETAILS_PRINT_STYLE_ID);
    previous?.remove?.();

    const style = doc.createElement?.('style');
    if (style) {
        style.id = DETAILS_PRINT_STYLE_ID;
        style.setAttribute('media', 'print');
        style.textContent = DETAILS_PRINT_PAGE_CSS;
        (doc.head || doc.documentElement)?.appendChild(style);
    }

    doc.body.classList?.add?.(DETAILS_PRINT_BODY_CLASS);
    if (!includeQuantitySummary) {
        doc.body.classList?.add?.(DETAILS_PRINT_NO_QUANTITY_CLASS);
    }

    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        doc.body?.classList?.remove?.(DETAILS_PRINT_BODY_CLASS, DETAILS_PRINT_NO_QUANTITY_CLASS);
        doc.getElementById?.(DETAILS_PRINT_STYLE_ID)?.remove?.();
        win?.removeEventListener?.('afterprint', cleanup);
    };

    win?.addEventListener?.('afterprint', cleanup, { once: true });
    return cleanup;
}

export function printWithDetailsMode(printWindow, options = {}) {
    const cleanup = beginDetailsPrintMode(options);
    try {
        return printWindow();
    } catch (error) {
        cleanup();
        throw error;
    }
}
