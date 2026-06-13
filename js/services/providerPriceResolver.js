/**
 * Stage 8.1.4: layer-функция, которая объединяет frozen-default цены провайдера
 * (из `js/domain/providerOverlay.js`) с user override из localStorage
 * (через `loadProviderOverrides()` в `js/state/persistence.js`).
 *
 * Domain-чистота: `applyProviderOverlay` в providerOverlay.js НЕ трогает
 * persistence — он остаётся pure. Эта прослойка живёт в services и читает
 * storage. Контроллеры/сервисы, которым нужны актуальные эффективные цены
 * (Stage 8.3 «Пересчитать на новом прайсе» / UI «Тарифы провайдера»), берут
 * map отсюда.
 *
 * Вызов из domain calculator.js намеренно НЕ делается — иначе линтер слоёв
 * упадёт. Override становится «применённым» в момент явной операции в UI
 * (`applyNewProviderPrices(calcId)` в Stage 8.3): контроллер забирает merged
 * map отсюда, патчит `calc.dictionaries.items`, persist'ит — после чего
 * applyProviderOverlay видит обновлённые цены через PROVIDER_OVERLAYS как
 * раньше (frozen) И через item.pricePerUnit в snapshot dictionary calc'а.
 */

import { getEffectivePrices, PROVIDER_OVERLAYS } from '../domain/providerOverlay.js';
import { loadProviderOverrides } from '../state/persistence.js';

/**
 * Эффективные цены провайдера = frozen-default ∪ user override.
 *
 * - Если provider unknown / inactive — `{}` (как `getEffectivePrices`).
 * - Если override отсутствует / corrupt / structural-invalid — fallback на frozen.
 * - Override.prices перетирает frozen-цены ЭК с тем же id; остальные ЭК остаются.
 *
 * @param {string} providerId
 * @returns {Object<string, { pricePerUnit, vendor, priceSource }>}
 */
export function getEffectivePricesForProvider(providerId) {
    const frozen = getEffectivePrices(providerId);
    /* unknown / inactive → frozen уже = {} → возврат {}. */
    if (!frozen || Object.keys(frozen).length === 0) return frozen;

    const overrides = loadProviderOverrides();
    if (!overrides) return frozen;

    const override = overrides[providerId];
    if (!override) return frozen;

    /* Защита от мусора в storage (минимально достаточная: тип `prices`).
       Полная валидация — `validateProviderPriceJson` в providerPriceFetch.js;
       здесь только защита от corrupt состояния, в которое override мог
       прийти не через нашу запись (например, миграция из старой версии
       приложения, которая ещё не знала про эту схему). */
    if (!override.prices || typeof override.prices !== 'object' || Array.isArray(override.prices)) {
        console.warn(
            `[providerPriceResolver] override для "${providerId}" имеет невалидную ` +
            `структуру prices — fallback на frozen-default.`
        );
        return frozen;
    }

    /* Если provider присутствует в storage, но удалён из PROVIDER_OVERLAYS —
       frozen уже = {} и мы вернули {} раньше. Этот guard — на случай, если
       getEffectivePrices в будущем будет возвращать что-то для unknown. */
    if (!PROVIDER_OVERLAYS[providerId]) return {};

    const merged = { ...frozen };
    for (const id of Object.keys(override.prices)) {
        const entry = override.prices[id];
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        /* T-RISK-7 (data-safety review 2026-06-13): числовая ре-валидация
           pricePerUnit на apply-пути — тот же контракт, что у import-валидатора
           (providerPriceFetch.js: pricePerUnit должен быть положительным
           конечным числом). Невалидный (отрицательный / NaN / 0 / нечисловой)
           override из подделанного или legacy storage НЕ попадает в расчёт —
           fallback на frozen-default для этого ЭК (иначе toNum coerce'ил бы его
           в тихо-неверный/отрицательный итог). */
        if (typeof entry.pricePerUnit !== 'number'
            || !Number.isFinite(entry.pricePerUnit)
            || entry.pricePerUnit <= 0) {
            console.warn(
                `[providerPriceResolver] override "${providerId}".prices.${id}.pricePerUnit ` +
                `невалиден (${entry.pricePerUnit}) — fallback на frozen-default.`
            );
            continue;
        }
        merged[id] = entry;
    }
    return merged;
}
