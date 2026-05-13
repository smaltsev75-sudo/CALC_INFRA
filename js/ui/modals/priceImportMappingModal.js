/**
 * Stage 16.2 (PATCH 2.9.1) — Price Import Mapping Modal.
 *
 * Четыре шага:
 *   upload   — выбор провайдера + file picker.
 *   preview  — превью первых строк (5-10), кнопки «Дальше» / «Назад».
 *   mapping  — таблица всех строк с auto-match + select для исправления.
 *   validate — summary + errors + кнопка «Применить».
 *
 * Provider-JSON флоу: после upload и detect kind='provider-json' UI пропускает
 * шаг mapping и сразу показывает «Файл уже валиден, можно применить».
 *
 * Все действия — через ctx.* методы. UI не импортирует controller напрямую.
 */

import { el } from '../dom.js';
import { modalShell } from './baseModal.js';

const MAX_PREVIEW_ROWS = 8;

/* ============================================================
 * Главный entry
 * ============================================================ */

export function renderPriceImportMappingModal(state, ctx) {
    const m = state.modals?.priceImportMapping;
    if (!m || !m.open) return null;

    const ui = state.ui?.priceImport;
    const onClose = () => ctx.closePriceImportMappingModal();

    return modalShell({
        title: 'Импорт прайса',
        size: 'lg',
        onClose,
        children: el('div', { class: 'price-import-modal-body' },
            !ui
                ? renderUploadStep(null, ctx)
                : ui.step === 'upload'   ? renderUploadStep(ui, ctx)
                : ui.step === 'preview'  ? renderPreviewStep(ui, state, ctx)
                : ui.step === 'mapping'  ? renderMappingStep(ui, state, ctx)
                : ui.step === 'validate' ? renderValidateStep(ui, state, ctx)
                : renderUploadStep(ui, ctx)
        ),
        footer: renderFooter(ui, ctx, onClose)
    });
}

/* ============================================================
 * Step: upload
 * ============================================================ */

function renderUploadStep(ui, ctx) {
    const providers = ui?.availableProviders || [];
    const providerId = ui?.providerId || '';

    return el('div', { class: 'price-import-step price-import-step-upload' },
        el('h3', { text: 'Шаг 1. Выбор провайдера и файла' }),
        el('p', { class: 'price-import-step-description',
            text: 'Загрузите CSV или JSON с тарифами провайдера. ' +
                'Поддерживаются произвольные форматы — мастер сопоставит строки ' +
                'с внутренними элементами конфигурации.' }),
        renderProviderSelect(providers, providerId, ctx),
        el('div', { class: 'price-import-file-picker' },
            el('button', {
                class: 'btn btn-primary',
                attrs: { type: 'button' },
                onClick: () => ctx.handlePriceImportFile()
            }, 'Выбрать CSV/JSON файл')
        ),
        ui?.error
            ? el('p', { class: 'price-import-error', text: 'Ошибка: ' + ui.error })
            : null
    );
}

function renderProviderSelect(providers, providerId, ctx) {
    if (!providers || providers.length === 0) return null;
    return el('div', { class: 'price-import-provider-row' },
        el('label', {
            class: 'price-import-provider-label',
            attrs: { for: 'price-import-provider-select' },
            text: 'Провайдер: '
        }),
        el('select', {
            class: 'input price-import-provider-select',
            attrs: { id: 'price-import-provider-select' },
            onChange: e => ctx.setPriceImportProvider(e.target.value)
        }, ...providers.map(p =>
            el('option', { attrs: { value: p.id, selected: p.id === providerId ? 'selected' : null } }, p.label)
        ))
    );
}

/* ============================================================
 * Step: preview
 * ============================================================ */

function renderPreviewStep(ui, state, ctx) {
    if (ui.kind === 'provider-json') {
        return renderProviderJsonPreview(ui, ctx);
    }
    return renderTabularPreview(ui, ctx);
}

function renderProviderJsonPreview(ui, ctx) {
    const data = ui.providerJsonData;
    const priceCount = data?.prices ? Object.keys(data.prices).length : 0;
    const isMatch = data?.providerId === ui.providerId;
    return el('div', { class: 'price-import-step price-import-step-preview' },
        el('h3', { text: 'Шаг 2. Файл — готовый prov ider JSON' }),
        el('p', { class: 'price-import-step-description',
            text: `Файл «${ui.fileName}» содержит уже валидную структуру provider JSON ` +
                `(schemaVersion=1). ${priceCount} тарифов.` }),
        el('div', { class: 'price-import-meta' },
            el('p', { text: `providerId: ${data?.providerId || '—'}` }),
            el('p', { text: `version: ${data?.version || '—'}` }),
            el('p', { text: `timestamp: ${data?.timestamp || '—'}` }),
            !isMatch
                ? el('p', { class: 'price-import-error',
                    text: `Внимание: providerId в файле (${data?.providerId}) не совпадает ` +
                        `с выбранным (${ui.providerId}). Apply будет отклонён.` })
                : null
        )
    );
}

function renderTabularPreview(ui, ctx) {
    const headers = headersOf(ui);
    const rowsToShow = (ui.normalizedRows || []).slice(0, MAX_PREVIEW_ROWS);
    return el('div', { class: 'price-import-step price-import-step-preview' },
        el('h3', { text: 'Шаг 2. Превью файла' }),
        el('p', { class: 'price-import-step-description',
            text: `Файл: ${ui.fileName}. Распознано строк: ${ui.normalizedRows?.length || 0}. ` +
                `Тип: ${ui.kind === 'csv' ? 'CSV' : 'JSON-массив'}.` }),
        el('table', { class: 'price-import-preview-table' },
            el('thead', null,
                el('tr', null,
                    el('th', { text: '#' }),
                    ...headers.map(h => el('th', { text: h })),
                    el('th', { text: 'Авто-маппинг' })
                )
            ),
            el('tbody', null,
                ...rowsToShow.map((row, idx) => renderPreviewRow(row, headers, ui, idx))
            )
        ),
        (ui.normalizedRows?.length || 0) > MAX_PREVIEW_ROWS
            ? el('p', { class: 'price-import-preview-more',
                text: `… и ещё ${ui.normalizedRows.length - MAX_PREVIEW_ROWS} строк (показано первых ${MAX_PREVIEW_ROWS})` })
            : null
    );
}

function headersOf(ui) {
    if (!ui.normalizedRows || ui.normalizedRows.length === 0) return [];
    const first = ui.normalizedRows[0].raw;
    if (!first || typeof first !== 'object') return [];
    return Object.keys(first);
}

function renderPreviewRow(row, headers, ui, idx) {
    const sug = ui.suggestions?.[row.rowId];
    const mapping = ui.mappings?.[row.rowId];
    return el('tr', null,
        el('td', { text: String(idx + 1) }),
        ...headers.map(h => el('td', { text: row.raw?.[h] != null ? String(row.raw[h]) : '' })),
        el('td', null,
            mapping
                ? el('span', { class: ['price-import-confidence',
                    `price-import-confidence-${sug?.confidence || 'low'}`],
                    text: `${mapping} (${sug?.confidence || 'manual'})`
                  })
                : el('span', { class: 'price-import-confidence price-import-confidence-none',
                    text: '—' })
        )
    );
}

/* ============================================================
 * Step: mapping
 * ============================================================ */

function renderMappingStep(ui, state, ctx) {
    const calc = state.activeCalc;
    const items = calc?.dictionaries?.items || [];
    const total = ui.normalizedRows?.length || 0;
    const mappedCount = Object.values(ui.mappings || {}).filter(Boolean).length;

    return el('div', { class: 'price-import-step price-import-step-mapping' },
        el('h3', { text: 'Шаг 3. Сопоставление строк с ЭК' }),
        el('p', { class: 'price-import-step-description',
            text: `Сопоставлено автоматически: ${mappedCount} из ${total}. ` +
                'Проверьте предложенные ЭК и при необходимости поправьте.' }),
        el('table', { class: 'price-import-mapping-table' },
            el('thead', null,
                el('tr', null,
                    el('th', { text: 'Строка' }),
                    el('th', { text: 'Цена' }),
                    el('th', { text: 'ЭК' }),
                    el('th', { text: 'Уверенность' })
                )
            ),
            el('tbody', null,
                ...(ui.normalizedRows || []).map(row =>
                    renderMappingRow(row, ui, items, ctx)
                )
            )
        )
    );
}

function renderMappingRow(row, ui, items, ctx) {
    const mapping = ui.mappings?.[row.rowId] || '';
    const sug = ui.suggestions?.[row.rowId];
    const confidence = sug?.confidence || 'none';
    const label = row.sourceName || row.sourceId || `(${row.rowId})`;

    return el('tr', { class: !mapping ? 'price-import-row-unmapped' : '' },
        el('td', null,
            el('div', { class: 'price-import-row-label', text: label }),
            row.sourceCategory
                ? el('div', { class: 'price-import-row-meta',
                    text: `категория: ${row.sourceCategory}` })
                : null,
            row.sourceUnit
                ? el('div', { class: 'price-import-row-meta',
                    text: `единица: ${row.sourceUnit}` })
                : null
        ),
        el('td', null,
            row.price !== null
                ? String(row.price)
                : el('span', { class: 'price-import-error', text: '—' })
        ),
        el('td', null,
            el('select', {
                class: 'input',
                onChange: e => ctx.setPriceImportMapping(row.rowId, e.target.value || null)
            },
                el('option', { attrs: { value: '' } }, '— не сопоставлено —'),
                ...items.map(it =>
                    el('option', {
                        attrs: { value: it.id, selected: it.id === mapping ? 'selected' : null }
                    }, `${it.id} — ${it.name || ''}`)
                )
            )
        ),
        el('td', null,
            el('span', {
                class: ['price-import-confidence', `price-import-confidence-${confidence}`],
                text: confidenceLabel(confidence)
            })
        )
    );
}

function confidenceLabel(c) {
    return c === 'high' ? 'высокая'
        : c === 'medium' ? 'средняя'
        : c === 'low' ? 'низкая'
        : 'нет';
}

/* ============================================================
 * Step: validate
 * ============================================================ */

function renderValidateStep(ui, state, ctx) {
    const v = ui.validationResult;
    const isProviderJson = ui.kind === 'provider-json';
    const summary = !isProviderJson
        ? buildSummary(ui)
        : { mapped: ui.providerJsonData?.prices ? Object.keys(ui.providerJsonData.prices).length : 0,
            total: ui.providerJsonData?.prices ? Object.keys(ui.providerJsonData.prices).length : 0,
            unmapped: 0, withErrors: 0, duplicates: 0 };

    return el('div', { class: 'price-import-step price-import-step-validate' },
        el('h3', { text: 'Шаг 4. Проверка и применение' }),
        el('div', { class: 'price-import-summary' },
            el('p', { text: `Всего строк: ${summary.total}` }),
            el('p', { text: `Сопоставлено: ${summary.mapped}` }),
            summary.unmapped > 0
                ? el('p', { text: `Не сопоставлено: ${summary.unmapped}` })
                : null,
            summary.duplicates > 0
                ? el('p', { class: 'price-import-error', text: `Дубликатов mapping: ${summary.duplicates}` })
                : null,
            summary.withErrors > 0
                ? el('p', { class: 'price-import-error', text: `Со ошибками: ${summary.withErrors}` })
                : null
        ),
        v && !v.ok
            ? renderValidationErrors(v)
            : v && v.ok
                ? el('p', { class: 'price-import-success',
                    text: 'Готово к применению. Нажмите «Применить» внизу.' })
                : null,
        ui.applyResult && ui.applyResult.ok
            ? renderApplySuccess(ui.applyResult)
            : null,
        ui.applyResult && !ui.applyResult.ok
            ? el('p', { class: 'price-import-error',
                text: 'Apply не удался: ' + (ui.applyResult.message || ui.applyResult.reason) })
            : null
    );
}

function buildSummary(ui) {
    // domain.getMappingSummary живёт в priceImportMapping.js. Контроллер
    // экспортирует ctx.getCurrentMappingSummary, но проще встроить расчёт здесь.
    const total = ui.normalizedRows?.length || 0;
    const mappings = ui.mappings || {};
    const mapped = Object.values(mappings).filter(Boolean).length;
    const errors = ui.validationResult?.errors || [];
    const errorRowIds = new Set();
    let duplicates = 0;
    for (const e of errors) {
        if (e.rowId) errorRowIds.add(e.rowId);
        if (Array.isArray(e.rowIds)) e.rowIds.forEach(r => errorRowIds.add(r));
        if (e.reason === 'duplicate-mapping') duplicates++;
    }
    return {
        total, mapped,
        unmapped: total - mapped,
        withErrors: errorRowIds.size,
        duplicates
    };
}

function renderValidationErrors(v) {
    return el('div', { class: 'price-import-error-list' },
        el('h4', { text: 'Ошибки:' }),
        ...v.errors.map(e =>
            el('p', { class: 'price-import-error',
                text: `${e.reason}: ${e.message}` + (e.rowId ? ` (${e.rowId})` : '') })
        )
    );
}

function renderApplySuccess(result) {
    return el('div', { class: 'price-import-success' },
        el('h4', { text: 'Прайс применён!' }),
        el('p', { text: `${result.summary.priceCount} тарифов сохранено для ${result.summary.providerId}.` }),
        el('p', { text: `Версия: ${result.summary.version}` }),
        result.summary.appliedToCalcs > 0
            ? el('p', { text: `Обновлено расчётов: ${result.summary.appliedToCalcs}` })
            : null
    );
}

/* ============================================================
 * Footer
 * ============================================================ */

function renderFooter(ui, ctx, onClose) {
    if (!ui || ui.step === 'upload') {
        return el('div', { class: 'price-import-footer' },
            el('button', {
                class: 'btn btn-ghost',
                attrs: { type: 'button' },
                onClick: onClose
            }, 'Отмена')
        );
    }

    if (ui.step === 'preview') {
        const isProviderJson = ui.kind === 'provider-json';
        return el('div', { class: 'price-import-footer' },
            el('button', {
                class: 'btn btn-ghost',
                attrs: { type: 'button' },
                onClick: () => ctx.goPriceImportBack()
            }, 'Назад'),
            el('div', { class: 'price-import-footer-spacer' }),
            el('button', {
                class: 'btn btn-primary',
                attrs: { type: 'button' },
                onClick: () => ctx.proceedToMappingStep()
            }, isProviderJson ? 'Перейти к проверке →' : 'Продолжить →')
        );
    }

    if (ui.step === 'mapping') {
        return el('div', { class: 'price-import-footer' },
            el('button', {
                class: 'btn btn-ghost',
                attrs: { type: 'button' },
                onClick: () => ctx.goPriceImportBack()
            }, 'Назад'),
            el('div', { class: 'price-import-footer-spacer' }),
            el('button', {
                class: 'btn btn-primary',
                attrs: { type: 'button' },
                onClick: () => ctx.validatePriceImport()
            }, 'Проверить →')
        );
    }

    // step === 'validate'
    const canApply = ui.validationResult?.ok === true && !ui.applyResult?.ok;
    const isApplied = ui.applyResult?.ok === true;
    return el('div', { class: 'price-import-footer' },
        !isApplied
            ? el('button', {
                class: 'btn btn-ghost',
                attrs: { type: 'button' },
                onClick: () => ctx.goPriceImportBack()
            }, 'Назад')
            : null,
        el('div', { class: 'price-import-footer-spacer' }),
        isApplied
            ? el('button', {
                class: 'btn btn-primary',
                attrs: { type: 'button' },
                onClick: onClose
            }, 'Готово')
            : el('button', {
                class: ['btn', canApply ? 'btn-primary' : 'btn-ghost'],
                attrs: { type: 'button', disabled: canApply ? null : 'disabled' },
                onClick: () => ctx.applyPriceImport()
            }, 'Применить прайс')
    );
}
