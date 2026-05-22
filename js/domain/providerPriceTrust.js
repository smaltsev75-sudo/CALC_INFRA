/**
 * User-facing trust labels for provider prices.
 *
 * Internal codes stay stable and English-like because they are easier to use in
 * tests/data. UI must render only Russian labels and hints from this module.
 */

export const TERM_HINTS = Object.freeze({
    WAF: 'WAF — защита веб-приложений: фильтрует вредоносные HTTP-запросы, например SQL-инъекции, XSS и атаки ботов.',
    DDoS: 'DDoS — распределённая атака отказа в обслуживании: попытка вывести сервис из строя большим потоком запросов.'
});

export const PRICE_TRUST_INFO = Object.freeze({
    verified: Object.freeze({
        status: 'verified',
        shortLabel: 'Проверено',
        fullLabel: 'Проверено по официальным тарифам',
        description: 'Цена сверена с официальными тарифными документами, документацией или прайс-листом провайдера.'
    }),
    'source-level': Object.freeze({
        status: 'source-level',
        shortLabel: 'Публичный прайс',
        fullLabel: 'Взято из публичного прайса',
        description: 'Цена взята из публичного прайс-листа провайдера; для финального бюджета полезно сверить коммерческое предложение.'
    }),
    assumed: Object.freeze({
        status: 'assumed',
        shortLabel: 'Оценка',
        fullLabel: 'Оценка по допущению',
        description: 'Цена основана на допущении или приближении, а не на подтверждённом тарифе провайдера.'
    }),
    'user-declared': Object.freeze({
        status: 'user-declared',
        shortLabel: 'Задано вручную',
        fullLabel: 'Задано вручную',
        description: 'Цена загружена или введена пользователем и имеет приоритет над встроенным прайсом.'
    }),
    'by-request': Object.freeze({
        status: 'by-request',
        shortLabel: 'По запросу',
        fullLabel: 'Цена по запросу у провайдера',
        description: 'Провайдер не публикует открытую цену для этой позиции; перед финальным бюджетом нужно КП или ручной прайс.'
    }),
    missing: Object.freeze({
        status: 'missing',
        shortLabel: 'Нет цены',
        fullLabel: 'Нет публичной цены',
        description: 'В текущем публичном прайсе провайдера нет цены для этой позиции.'
    }),
    unknown: Object.freeze({
        status: 'unknown',
        shortLabel: 'Источник неясен',
        fullLabel: 'Источник цены не определён',
        description: 'Не удалось определить источник и уровень доверия для этой цены.'
    })
});

export const PROVIDER_PRICE_GAPS = Object.freeze({
    vk: Object.freeze({
        'network-waf': Object.freeze({
            status: 'by-request',
            description: 'VK Cloud публикует цену WAF по запросу. В расчёте эта позиция остаётся на базовой оценке, пока не импортирован ручной прайс или КП.'
        })
    })
});

export const PROVIDER_PRICE_WARNINGS = Object.freeze({
    vk: Object.freeze([
        Object.freeze({
            id: 'vk-waf-ddos-by-request',
            label: 'WAF/DDoS по запросу',
            title: `${TERM_HINTS.WAF}\n${TERM_HINTS.DDoS}\n\nУ VK Cloud эти защитные сервисы в публичном прайсе указаны как цена по запросу. Для финального бюджета импортируйте КП или ручной прайс.`,
            affectedItemIds: Object.freeze(['network-waf'])
        })
    ])
});

export function getPriceTrustInfo(status) {
    return PRICE_TRUST_INFO[status] || PRICE_TRUST_INFO.unknown;
}

export function getProviderPriceWarnings(providerId) {
    return PROVIDER_PRICE_WARNINGS[providerId] || [];
}

function trustFromConfidence(confidence) {
    if (confidence === 'verified') return 'verified';
    if (confidence === 'source-level') return 'source-level';
    if (confidence === 'assumed') return 'assumed';
    if (confidence === 'user-declared') return 'user-declared';
    return 'unknown';
}

function isUserOverrideEntry(effectiveEntry, frozenEntry) {
    if (!effectiveEntry || !frozenEntry) return false;
    if (effectiveEntry === frozenEntry) return false;
    if (effectiveEntry.vatPolicyConfidence === 'user-declared') return true;
    if (effectiveEntry.pricePerUnit !== frozenEntry.pricePerUnit) return true;
    if (effectiveEntry.priceSource !== frozenEntry.priceSource) return true;
    if (effectiveEntry.vendor !== frozenEntry.vendor) return true;
    return false;
}

export function getProviderPriceTrust({
    providerId,
    itemId,
    effectiveEntry,
    frozenEntry
} = {}) {
    const knownGap = PROVIDER_PRICE_GAPS[providerId]?.[itemId];
    if (!effectiveEntry && !frozenEntry) {
        const info = getPriceTrustInfo(knownGap?.status || 'missing');
        return Object.freeze({
            ...info,
            description: knownGap?.description || info.description,
            isMissing: true
        });
    }

    if (isUserOverrideEntry(effectiveEntry, frozenEntry)) {
        return getPriceTrustInfo('user-declared');
    }

    const confidence = effectiveEntry?.vatPolicyConfidence || frozenEntry?.vatPolicyConfidence;
    return getPriceTrustInfo(trustFromConfidence(confidence));
}
