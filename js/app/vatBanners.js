import { VAT_RATE_HISTORY } from '../domain/vatRateTable.js';

/**
 * VAT-1 Phase 5: один раз за сессию показывает info-snackbar для расчёта,
 * который был создан по исторической ставке НДС.
 */
export function maybeShowLegacyVatBanner(store, snackbar) {
    const state = store.getState();
    const calc = state.activeCalc;
    if (!calc || !calc.settings) return;
    const s = calc.settings;
    if (s.vatRateMode !== 'frozen') return;
    /* Granularly: показываем ТОЛЬКО для legacy-frozen — где createdAt раньше
       начала текущего периода справочника НДС. frozen-расчёт, созданный
       в 2026, и заморожённый осознанно — не legacy, snackbar не нужен. */
    const currentPeriod = VAT_RATE_HISTORY[VAT_RATE_HISTORY.length - 1];
    const createdAt = typeof calc.createdAt === 'string' ? calc.createdAt.slice(0, 10) : null;
    if (!createdAt || createdAt >= currentPeriod.from) return;
    /* Session-only: проверка флага в state.ui (НЕ в localStorage). */
    const shown = state.ui?.shownLegacyVatBanners || {};
    if (shown[calc.id]) return;
    const ratePct = Math.round((s.vatRate || 0) * 100);
    snackbar.info(
        `Расчёт создан при ставке НДС ${ratePct}%. Ставка зафиксирована, ` +
        `чтобы не изменить согласованные цифры. Сменить режим можно в Опроснике.`
    );
    store.setUi({ shownLegacyVatBanners: { ...shown, [calc.id]: true } });
}

/**
 * VAT-2 Phase 5: legacy provider double-VAT warning.
 * Старый snapshot без `vatNormalized` мог содержать gross-цену, поверх которой
 * calculator добавит VAT ещё раз. Предупреждение non-blocking.
 */
export function maybeShowLegacyProviderVatBanner(store, snackbar) {
    const state = store.getState();
    const calc = state.activeCalc;
    if (!calc || !calc.settings) return;
    if (!calc.settings.vatEnabled) return;
    const items = calc.dictionaries?.items;
    if (!Array.isArray(items) || items.length === 0) return;
    const hasLegacySnapshot = items.some(item =>
        typeof item.priceSource === 'string' && item.priceSource.length > 0
        && item.vatNormalized !== true
        && Number.isFinite(item.pricePerUnit) && item.pricePerUnit > 0
    );
    if (!hasLegacySnapshot) return;
    /* Session-only flag — отдельный от VAT-1 banner. */
    const shown = state.ui?.shownLegacyProviderVatBanners || {};
    if (shown[calc.id]) return;
    snackbar.showSnackbar({
        type: 'warning',
        message: 'Старые расчёты могли учитывать НДС дважды. ' +
                 'Проверьте применённый прайс и при необходимости импортируйте JSON с явной политикой НДС.',
        action: 'Перейти к тарифам',
        onAction: () => {
            store.setUi({ providerOverlayExpanded: true });
        }
    });
    store.setUi({ shownLegacyProviderVatBanners: { ...shown, [calc.id]: true } });
}
