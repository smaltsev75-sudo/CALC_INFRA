import { getCalculationProviderPriceActuality } from '../domain/providerPriceTrust.js';
import { el } from './dom.js';
import { icon } from './icons.js';

export function getCalculationPriceActualityInfo(calc) {
    return getCalculationProviderPriceActuality(calc);
}

export function renderCalculationProviderPriceActuality(calc, options = {}) {
    if (!calc) return null;
    const info = getCalculationPriceActualityInfo(calc);
    const className = options.className || 'price-actuality-banner';
    const label = options.withProvider === false
        ? info.label
        : `${info.providerLabel} — ${info.label}`;
    return el('div', {
        class: [className, options.compact && `${className}--compact`],
        attrs: {
            role: 'status',
            'data-testid': options.testId || undefined
        }
    },
        icon('clock', { size: options.iconSize || 16 }),
        el('div', { class: `${className}-text` },
            options.title
                ? el('strong', { text: options.title })
                : null,
            el('span', { text: options.title ? ` — ${label}` : label })
        )
    );
}
