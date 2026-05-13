/**
 * Stage 16.2 (PATCH 2.9.1) — Price Import Mapping Controller.
 *
 * Оркестрирует жизненный цикл модалки импорта произвольных CSV/JSON-прайсов.
 *
 * Шаги (state.ui.priceImport.step):
 *   1. 'upload'   — пустое состояние, кнопка «Выбрать файл».
 *   2. 'preview'  — файл прочитан, kind определён. Если kind='provider-json' —
 *                    можно сразу применить (skip mapping).
 *   3. 'mapping'  — таблица строк с auto-match suggestions; пользователь правит.
 *   4. 'validate' — summary, ошибки, кнопка «Применить».
 *
 * Apply pipeline (общий с Stage 8 / file-picker flow):
 *   - validateProviderPriceJson(data, providerId)
 *   - snapshot prior override (loadProviderOverrides)
 *   - saveProviderOverride(providerId, data)
 *   - pushProviderOverrideHistory(providerId, snapshot) если был
 *   - applyOverrideToAllCalcsForProvider — refresh open calcs
 *
 * Никакой собственной rollback-логики: использует существующий
 * rollbackProviderPriceOverride. Cross-tab lock в MVP не используется
 * (операция multi-step и пользовательски управляемая; конфликты редки и
 * обработаются на этапе save через persist.saveProviderOverride).
 */

import { store } from '../state/store.js';
import {
    detectShape,
    normalizeRows,
    suggestItemMappings,
    validatePriceMappings,
    buildProviderPriceJson,
    getMappingSummary
} from '../domain/priceImportMapping.js';
import { readPriceImportFile } from '../services/priceImportParser.js';
import { validateProviderPriceJson } from '../services/providerPriceFetch.js';
import {
    loadProviderOverrides,
    saveProviderOverride,
    pushProviderOverrideHistory
} from '../state/persistence.js';
import { applyOverrideToAllCalcsForProvider } from './providerController.js';
import { listProviders, DEFAULT_PROVIDER } from '../domain/providerOverlay.js';
import { pickFile } from '../services/json.js';

/* ============================================================
 * State accessors
 * ============================================================ */

function ui() {
    return store.getState().ui?.priceImport || null;
}

function setUi(patch) {
    const cur = ui();
    if (patch === null) {
        store.setUi({ priceImport: null });
        return;
    }
    store.setUi({ priceImport: { ...(cur || {}), ...patch } });
}

/* ============================================================
 * Public API
 * ============================================================ */

/**
 * Открыть модалку. Дефолтный providerId = провайдер активного calc или
 * DEFAULT_PROVIDER (sbercloud).
 */
export function openPriceImportMappingModal() {
    const calc = store.getState().activeCalc;
    const defaultProvider = calc?.settings?.provider || DEFAULT_PROVIDER;
    setUi({
        step: 'upload',
        providerId: defaultProvider,
        fileName: null,
        kind: null,
        providerJsonData: null,
        rows: null,
        normalizedRows: null,
        mappings: {},
        validationResult: null,
        error: null,
        applyResult: null,
        availableProviders: listProviders().filter(p => p.active).map(p => ({
            id: p.id, label: p.label
        }))
    });
    store.openModal('priceImportMapping');
}

/**
 * Сменить провайдера. Допустимо до или после загрузки. После смены валидация
 * сбрасывается — provider mismatch может возникнуть для уже валидированного
 * provider-JSON.
 */
export function setPriceImportProvider(providerId) {
    if (!providerId || typeof providerId !== 'string') return;
    setUi({ providerId, validationResult: null, applyResult: null, error: null });
}

/**
 * Прочитать файл (через File-объект или file picker), определить kind,
 * перейти к шагу 'preview'.
 *
 * @param {File} [file] — если не передан, используется pickFile из services/json
 * @param {Object} [opts] — DI для тестов: _readFile, _pickFile
 */
export async function handlePriceImportFile(file, opts = {}) {
    const cur = ui();
    if (!cur) return { ok: false, reason: 'modal-closed', message: 'Модалка не открыта.' };

    const readFn = opts._readFile || readPriceImportFile;
    const pickFn = opts._pickFile || pickFile;

    let actualFile = file;
    if (!actualFile) {
        actualFile = await pickFn('.csv,.json,text/csv,application/json');
        if (!actualFile) {
            return { ok: false, reason: 'cancelled' };
        }
    }

    const result = await readFn(actualFile);
    if (!result.ok) {
        setUi({ error: result.message, step: 'upload' });
        return result;
    }

    if (result.kind === 'provider-json') {
        setUi({
            step: 'preview',
            kind: 'provider-json',
            fileName: result.fileName,
            providerJsonData: result.data,
            rows: null,
            normalizedRows: null,
            mappings: {},
            validationResult: null,
            error: null
        });
        return { ok: true, kind: 'provider-json' };
    }

    // CSV или JSON-array → normalize и suggest auto-match сразу
    const normalized = normalizeRows(result.rows);
    const calc = store.getState().activeCalc;
    const knownItems = calc?.dictionaries?.items || [];
    const suggestions = suggestItemMappings(normalized, knownItems);
    // Применяем suggestions с confidence ≥ 'medium' автоматически.
    const autoMappings = {};
    for (const [rowId, sug] of Object.entries(suggestions)) {
        if (sug && (sug.confidence === 'high' || sug.confidence === 'medium')) {
            autoMappings[rowId] = sug.itemId;
        }
    }

    setUi({
        step: 'preview',
        kind: result.kind,
        fileName: result.fileName,
        providerJsonData: null,
        rows: result.rows,
        normalizedRows: normalized,
        suggestions,
        mappings: autoMappings,
        validationResult: null,
        error: null
    });
    return { ok: true, kind: result.kind };
}

/**
 * Перейти от preview к mapping. Если kind='provider-json' — сразу к validate.
 */
export function proceedToMappingStep() {
    const cur = ui();
    if (!cur) return;
    if (cur.kind === 'provider-json') {
        // Validate the provider JSON immediately.
        const validated = validateProviderPriceJson(cur.providerJsonData, cur.providerId);
        if (!validated.ok) {
            setUi({
                step: 'validate',
                validationResult: {
                    ok: false,
                    errors: [{
                        reason: validated.reason,
                        message: validated.message
                    }],
                    warnings: []
                }
            });
            return;
        }
        setUi({ step: 'validate', validationResult: { ok: true, errors: [], warnings: [] } });
        return;
    }
    setUi({ step: 'mapping' });
}

/**
 * Установить mapping для одной строки. itemId=null/'' → удалить mapping.
 */
export function setPriceImportMapping(rowId, itemId) {
    const cur = ui();
    if (!cur) return;
    const next = { ...(cur.mappings || {}) };
    if (!itemId) delete next[rowId];
    else next[rowId] = itemId;
    setUi({ mappings: next, validationResult: null });
}

/**
 * Прогнать validatePriceMappings (для CSV/JSON-array) или
 * validateProviderPriceJson (для provider-json) и переключить шаг.
 */
export function validatePriceImport() {
    const cur = ui();
    if (!cur) return;
    const calc = store.getState().activeCalc;
    const knownItems = calc?.dictionaries?.items || [];

    if (cur.kind === 'provider-json') {
        const v = validateProviderPriceJson(cur.providerJsonData, cur.providerId);
        if (!v.ok) {
            setUi({
                step: 'validate',
                validationResult: {
                    ok: false,
                    errors: [{ reason: v.reason, message: v.message }],
                    warnings: []
                }
            });
            return;
        }
        setUi({ step: 'validate', validationResult: { ok: true, errors: [], warnings: [] } });
        return;
    }

    const result = validatePriceMappings(
        cur.mappings, cur.normalizedRows, knownItems
    );
    setUi({ step: 'validate', validationResult: result });
}

/**
 * Применить импорт: build provider JSON, save, push history, refresh calcs.
 *
 * @returns {{ ok: true, applied, summary } | { ok: false, reason, message }}
 */
export function applyPriceImport() {
    const cur = ui();
    if (!cur) return { ok: false, reason: 'modal-closed', message: 'Модалка не открыта.' };
    const providerId = cur.providerId;
    if (!providerId) {
        return { ok: false, reason: 'invalid-provider', message: 'Не выбран провайдер.' };
    }

    let data;
    if (cur.kind === 'provider-json') {
        data = cur.providerJsonData;
    } else {
        const built = buildProviderPriceJson({
            providerId,
            normalizedRows: cur.normalizedRows,
            mappings: cur.mappings,
            source: cur.fileName ? `Импорт: ${cur.fileName}` : 'CSV/JSON импорт'
        });
        if (!built.ok) {
            setUi({ applyResult: built });
            return built;
        }
        data = built.data;
    }

    const validated = validateProviderPriceJson(data, providerId);
    if (!validated.ok) {
        setUi({ applyResult: validated });
        return validated;
    }

    // Snapshot prior override
    const map = loadProviderOverrides();
    const snapshot = map && map[providerId] ? map[providerId] : null;

    const saved = saveProviderOverride(providerId, validated.data);
    if (!saved) {
        const result = {
            ok: false, reason: 'persist',
            message: 'Не удалось сохранить overlay в localStorage (quota?).'
        };
        setUi({ applyResult: result });
        return result;
    }

    // Push prior to history (best-effort)
    if (snapshot) {
        pushProviderOverrideHistory(providerId, {
            appliedJSON: snapshot,
            appliedAt: new Date().toISOString()
        });
    }

    // Refresh open calcs (best-effort)
    let calcsResult = null;
    try {
        calcsResult = applyOverrideToAllCalcsForProvider(providerId);
    } catch (e) {
        console.error('[priceImport] applyOverrideToAllCalcsForProvider threw:', e);
    }

    const summary = {
        priceCount: Object.keys(validated.data.prices).length,
        version: validated.data.version,
        providerId,
        appliedToCalcs: calcsResult?.applied ?? 0,
        alreadyFresh: calcsResult?.alreadyFresh ?? 0
    };

    const result = { ok: true, applied: validated.data, snapshot, summary };
    setUi({ applyResult: result });
    return result;
}

/**
 * Закрыть модалку и очистить transient state.
 */
export function closePriceImportMappingModal() {
    setUi(null);
    store.closeModal('priceImportMapping');
}

/**
 * Вернуться на предыдущий шаг (preview → mapping → validate).
 * upload → upload (no-op, очищает текущий файл).
 */
export function goPriceImportBack() {
    const cur = ui();
    if (!cur) return;
    const order = ['upload', 'preview', 'mapping', 'validate'];
    const idx = order.indexOf(cur.step);
    if (idx <= 0) return;
    const prev = order[idx - 1];
    setUi({ step: prev, validationResult: null, applyResult: null });
}

/**
 * Геттер summary для UI step=validate. Возвращает null если данных нет.
 */
export function getCurrentMappingSummary() {
    const cur = ui();
    if (!cur || !cur.normalizedRows) return null;
    return getMappingSummary(cur.normalizedRows, cur.mappings, cur.validationResult);
}

/**
 * Для UI: подсказка confidence-уровня для одной строки.
 * Возвращает 'high' | 'medium' | 'low' | 'none' | undefined.
 */
export function getRowSuggestionConfidence(rowId) {
    const cur = ui();
    if (!cur || !cur.suggestions) return undefined;
    return cur.suggestions[rowId]?.confidence;
}

/* ============================================================
 * Re-export domain helpers для UI (через ctx)
 * ============================================================ */

export { detectShape };
