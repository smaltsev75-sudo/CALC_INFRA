/**
 * Stage 15.5 — Модалка «Обоснование расчёта» (Decision Memo).
 *
 * Структура:
 *   1. Toolbar: [Скопировать Markdown] [Скачать .md]
 *   2. Preview: HTML-версия memo через services/markdown.js (escape-first).
 *
 * Markdown собирается в controller (`ctx.buildDecisionMemo()`); модалка
 * вызывает один раз на render и показывает HTML-preview. Sensitivity
 * запускается лениво в controller через cache по calcRevision — не на каждый
 * patchModal.
 *
 * Layer compliance: модалка импортирует только domain/services через ctx.
 */

import { el, setTrustedHtml, trustedHtml } from '../dom.js';
import { modalShell } from './baseModal.js';
import { renderMarkdown } from '../../services/markdown.js';
import * as snackbar from '../snackbar.js';

/* ============================================================
 * Helpers
 * ============================================================ */

function renderPreview(markdown) {
    const html = renderMarkdown(String(markdown == null ? '' : markdown));
    const node = el('div', {
        class: 'decision-memo-preview',
        attrs: {
            'aria-label': 'Предпросмотр memo',
            'data-testid': 'decision-memo-preview'
        }
    });
    setTrustedHtml(node, trustedHtml(html));
    return node;
}

/* ============================================================
 * Главный entry
 * ============================================================ */

export function renderDecisionMemoModal(state, ctx) {
    const m = state.modals?.decisionMemo;
    if (!m || !m.open) return null;

    const onClose = () => ctx.closeModal('decisionMemo');
    const calc = state.activeCalc;

    if (!calc) {
        return modalShell({
            title: 'Обоснование расчёта',
            size: 'md',
            onClose,
            children: el('div', {
                class: 'decision-memo-empty',
                attrs: { 'data-testid': 'decision-memo-empty' }
            },
                'Нет активного расчёта для формирования memo.'
            ),
            footer: el('button', {
                class: 'btn btn-primary',
                attrs: { type: 'button', 'data-testid': 'decision-memo-close' },
                onClick: onClose
            }, 'Закрыть')
        });
    }

    const built = ctx.buildDecisionMemo();
    const markdown = built ? built.markdown : '';

    const onCopy = async () => {
        const ok = await ctx.copyDecisionMemo();
        if (ok) snackbar.success('Memo скопировано в буфер обмена.');
        else    snackbar.error('Не удалось скопировать memo.');
    };

    const onDownload = () => {
        const ok = ctx.downloadDecisionMemo();
        if (ok) snackbar.success('Memo скачано как .md');
        else    snackbar.error('Не удалось скачать memo.');
    };

    return modalShell({
        title: 'Обоснование расчёта',
        size: 'lg',
        onClose,
        children: el('div', {
            class: 'decision-memo-modal-body',
            attrs: { 'data-testid': 'decision-memo-modal' }
        },
            el('div', { class: 'decision-memo-actions', attrs: { role: 'toolbar' } },
                el('button', {
                    class: 'btn btn-primary',
                    attrs: { type: 'button', 'data-testid': 'decision-memo-copy' },
                    title: 'Скопировать memo как Markdown',
                    onClick: onCopy
                }, 'Скопировать Markdown'),
                el('button', {
                    class: 'btn btn-ghost',
                    attrs: { type: 'button', 'data-testid': 'decision-memo-download' },
                    title: 'Скачать memo как .md-файл',
                    onClick: onDownload
                }, 'Скачать .md')
            ),
            el('div', {
                class: 'decision-memo-section-title',
                text: 'Предпросмотр'
            }),
            renderPreview(markdown)
        ),
        footer: el('button', {
            class: 'btn btn-ghost',
            attrs: { type: 'button', 'data-testid': 'decision-memo-close' },
            title: 'Закрыть (Esc)',
            onClick: onClose
        }, 'Закрыть')
    });
}
