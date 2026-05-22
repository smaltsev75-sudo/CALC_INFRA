/**
 * Anchor links внутри модалок (например, TOC в F1-справке) не должны писать
 * hash в глобальный URL приложения. Делегированный handler сам скроллит к
 * нужному заголовку внутри `#app-modals`.
 */
export function installModalHashNavigation(doc = document) {
    doc.addEventListener('click', e => {
        const anchor = e.target.closest && e.target.closest('a[href^="#"]');
        if (!anchor) return;
        const modalsRoot = anchor.closest('#app-modals');
        if (!modalsRoot) return;
        const href = anchor.getAttribute('href');
        if (!href || href === '#') return;
        e.preventDefault();
        try {
            const rawId = decodeURIComponent(href.slice(1));
            if (!rawId) return;
            const escapedId = (typeof CSS !== 'undefined' && CSS.escape)
                ? CSS.escape(rawId)
                : rawId.replace(/([\W])/g, '\\$1');
            const target = modalsRoot.querySelector('#' + escapedId);
            if (target && typeof target.scrollIntoView === 'function') {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        } catch { /* malformed href — игнорируем */ }
    });
}
