export const DETAILS_PRINT_BODY_CLASS = 'printing-details';
export const DETAILS_PRINT_NO_QUANTITY_CLASS = 'printing-details-no-quantity-summary';
export const DETAILS_PRINT_STYLE_ID = 'details-print-page-style';
/* margin: top right bottom left. Левое поле 14мм — контент Деталей с заметным
   отступом от левого края, текст не упирается/не уходит за край листа. Правое 6мм.
   В режиме печати Деталей таблица `table-layout: fixed; width: 100%`
   (css/print.css body.printing-details) → ВСЕГДА сжимается под usable-ширину
   (297-(14+6)=277мм), правый край не переполняет лист (колонки уплотняются
   пропорционально, без горизонтального overflow страницы). */
export const DETAILS_PRINT_PAGE_CSS = '@page { size: A4 landscape; margin: 6mm 6mm 6mm 14mm; }';

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
