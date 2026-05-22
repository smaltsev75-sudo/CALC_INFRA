/**
 * User-facing trust labels for provider prices.
 *
 * Internal codes stay stable and English-like because they are easier to use in
 * tests/data. UI must render only Russian labels and hints from this module.
 */

import { PROVIDER_OVERLAYS, getProviderPriceBundleMeta } from './providerOverlay.js';

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
    partial: Object.freeze({
        status: 'partial',
        shortLabel: 'Частично',
        fullLabel: 'Частично покрыто прайсом',
        description: 'Часть позиций покрыта прайсом, часть требует КП, ручного прайса или отдельной проверки.'
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

export const PROVIDER_TRUST_MATRIX_CAPABILITIES = Object.freeze([
    Object.freeze({
        key: 'compute',
        label: 'Процессоры',
        title: 'Процессоры: виртуальные ядра для обычных и GPU-нагрузок',
        itemIds: Object.freeze(['cpu-vcpu-shared', 'cpu-vcpu-gpu'])
    }),
    Object.freeze({
        key: 'memory',
        label: 'Память',
        title: 'Оперативная память: цена 1 ГБ в месяц',
        itemIds: Object.freeze(['ram-gb'])
    }),
    Object.freeze({
        key: 'block-storage',
        label: 'Диски',
        title: 'Блочное хранилище: SSD и HDD',
        itemIds: Object.freeze(['storage-ssd-tb', 'storage-hdd-tb'])
    }),
    Object.freeze({
        key: 'object-storage',
        label: 'Объектное',
        title: 'Объектное хранилище: S3-совместимое хранение файлов',
        itemIds: Object.freeze(['storage-object-tb'])
    }),
    Object.freeze({
        key: 'load-balancer',
        label: 'Балансировщик',
        title: 'Балансировщик нагрузки уровня L7: HTTP/HTTPS входной трафик',
        itemIds: Object.freeze(['network-lb-l7'])
    }),
    Object.freeze({
        key: 'waf',
        label: 'WAF',
        title: TERM_HINTS.WAF,
        itemIds: Object.freeze(['network-waf'])
    }),
    Object.freeze({
        key: 'traffic',
        label: 'Трафик',
        title: 'Исходящий интернет-трафик',
        itemIds: Object.freeze(['traffic-egress-tb'])
    }),
    Object.freeze({
        key: 'licenses',
        label: 'Лицензии',
        title: 'Лицензии программного обеспечения: СУБД, ОС, SIEM/EDR',
        itemIds: Object.freeze(['license-db-per-vcpu', 'license-os-per-node', 'license-siem-edr-per-node'])
    })
]);

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
            affectedItemIds: Object.freeze(['network-waf']),
            affectedQuestionIds: Object.freeze(['waf_required', 'ddos_protection_required'])
        })
    ])
});

export function getPriceTrustInfo(status) {
    return PRICE_TRUST_INFO[status] || PRICE_TRUST_INFO.unknown;
}

export function getProviderPriceWarnings(providerId) {
    return PROVIDER_PRICE_WARNINGS[providerId] || [];
}

export function formatProviderPriceDate(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return '';
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = date.getUTCFullYear();
    return `${dd}.${mm}.${yyyy}`;
}

export function getProviderPriceActuality(meta = {}) {
    meta = meta && typeof meta === 'object' ? meta : {};
    const date = formatProviderPriceDate(meta.timestamp);
    const version = typeof meta.version === 'string' ? meta.version.trim() : '';
    const source = typeof meta.source === 'string' ? meta.source.trim() : '';
    const base = date
        ? `Актуальность прайса: ${date}`
        : 'Актуальность прайса: дата не указана';
    const label = [base, version ? `версия ${version}` : ''].filter(Boolean).join(' · ');
    const title = [
        label,
        source ? `Источник: ${source}` : ''
    ].filter(Boolean).join('\n');
    return Object.freeze({
        date,
        version,
        label,
        title
    });
}

function parseProviderVersionMarker(marker) {
    if (!marker) return null;
    if (typeof marker === 'object') {
        return {
            providerId: marker.providerId || marker.id || '',
            version: marker.version || '',
            timestamp: marker.timestamp || '',
            source: marker.source || ''
        };
    }
    if (typeof marker !== 'string') return null;
    const raw = marker.trim();
    if (!raw) return null;
    const match = raw.match(/^([^@]+)@(.+)$/);
    return match
        ? { providerId: match[1], version: match[2], timestamp: '', source: '' }
        : { providerId: '', version: raw, timestamp: '', source: '' };
}

export function getProviderPriceMetaForCalc(calc) {
    const selectedProviderId = calc?.settings?.provider || '';
    const marker = parseProviderVersionMarker(calc?.providerVersion);
    const providerId = marker?.providerId || selectedProviderId;
    const bundleMeta = getProviderPriceBundleMeta(providerId);
    const hasAppliedMarker = !!(marker && (marker.version || marker.timestamp || marker.source));

    if (!hasAppliedMarker) {
        return bundleMeta || {
            providerId,
            version: '',
            timestamp: '',
            source: '',
            vatPolicy: null,
            pricesCount: 0
        };
    }

    return {
        ...(bundleMeta || {}),
        providerId,
        version: marker.version || bundleMeta?.version || '',
        timestamp: marker.timestamp || bundleMeta?.timestamp || '',
        source: marker.source || bundleMeta?.source || '',
        vatPolicy: bundleMeta?.vatPolicy || null,
        pricesCount: bundleMeta?.pricesCount || 0,
        applied: true
    };
}

export function getCalculationProviderPriceActuality(calc) {
    const meta = getProviderPriceMetaForCalc(calc);
    const providerId = meta?.providerId || calc?.settings?.provider || '';
    const providerLabel = PROVIDER_OVERLAYS[providerId]?.label || providerId || 'провайдер';
    const actuality = getProviderPriceActuality(meta);
    return Object.freeze({
        ...actuality,
        providerId,
        providerLabel,
        meta,
        labelWithProvider: `Прайс ${providerLabel} — ${actuality.label}`
    });
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

function isCoveredTrustStatus(status) {
    return status === 'verified'
        || status === 'source-level'
        || status === 'user-declared'
        || status === 'assumed';
}

function aggregateCapabilityStatus(itemTrusts) {
    if (!itemTrusts.length) return 'unknown';
    const statuses = itemTrusts.map(item => item.trust.status);
    if (statuses.every(status => status === statuses[0])) return statuses[0];

    const covered = statuses.filter(isCoveredTrustStatus).length;
    const unresolved = statuses.filter(status =>
        status === 'missing' || status === 'by-request' || status === 'unknown'
    ).length;
    if (covered > 0 && unresolved > 0) return 'partial';
    return 'partial';
}

export function getProviderCapabilityTrust({
    providerId,
    itemIds,
    effectivePrices,
    frozenPrices
} = {}) {
    const ids = Array.isArray(itemIds) ? itemIds : [];
    const items = ids.map(itemId => ({
        itemId,
        trust: getProviderPriceTrust({
            providerId,
            itemId,
            effectiveEntry: effectivePrices?.[itemId] || null,
            frozenEntry: frozenPrices?.[itemId] || null
        })
    }));
    const status = aggregateCapabilityStatus(items);
    const info = getPriceTrustInfo(status);
    const coverage = items.reduce((acc, item) => {
        acc.total += 1;
        if (item.trust.status === 'by-request') acc.byRequest += 1;
        else if (item.trust.status === 'missing') acc.missing += 1;
        else if (isCoveredTrustStatus(item.trust.status)) acc.covered += 1;
        return acc;
    }, { total: 0, covered: 0, missing: 0, byRequest: 0 });

    return Object.freeze({
        ...info,
        items: Object.freeze(items),
        coverage: Object.freeze(coverage)
    });
}

export function getProviderSecurityPriceWarningForCalc(calc) {
    const providerId = calc?.settings?.provider;
    const warning = getProviderPriceWarnings(providerId)
        .find(w => w.id === 'vk-waf-ddos-by-request');
    if (!warning) return null;

    const answers = calc?.answers || {};
    const wafRequired = answers.waf_required === true;
    const ddosRequired = answers.ddos_protection_required === true;
    if (!wafRequired && !ddosRequired) return null;

    const fieldIds = [];
    if (wafRequired) fieldIds.push('waf_required');
    if (ddosRequired) fieldIds.push('ddos_protection_required');
    const priceMeta = getProviderPriceBundleMeta(providerId);
    const priceDate = formatProviderPriceDate(priceMeta?.timestamp);
    const dateText = priceDate ? ` Базовый прайс VK в поставке от ${priceDate}.` : '';

    return Object.freeze({
        id: 'pricing-vk-security-by-request',
        providerId,
        label: 'VK: WAF/DDoS по запросу',
        title: warning.title,
        message: `В расчёте выбран VK Cloud, а WAF/DDoS включены. У VK Cloud эти защитные сервисы в публичном прайсе указаны как цена по запросу, поэтому бюджет безопасности предварительный до КП или ручного прайса.${dateText}`,
        suggestedAction: 'Получите КП у VK Cloud или импортируйте ручной прайс перед финальным бюджетом.',
        priceMeta,
        affectedItemIds: warning.affectedItemIds,
        fieldIds: Object.freeze(fieldIds)
    });
}
