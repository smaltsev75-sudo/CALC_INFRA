/**
 * Stage 15.1 — Модалка «Качество расчёта».
 *
 * Содержимое:
 *   1. Шапка: score chip (X / 100) + одна строка с counts.
 *   2. 4 severity-вкладки (error / warning / recommendation / info). Пустые
 *      severity отображаются как disabled-вкладки (с пометкой «—»).
 *   3. Список finding-карточек выбранной вкладки. Каждая карточка содержит:
 *        title, message, suggestedAction, fieldIds (clickable → перейти в опросник).
 *   4. Footer: «Закрыть» (Esc).
 *
 * Persist последней открытой вкладки — через ctx.setHealthLastTab(severity)
 * (subscriber в app.js пишет в STORAGE_KEYS.HEALTH_LAST_TAB).
 *
 * Pricing-метаданные (для трёх pricing-checks) подтягиваются опционально через
 * ctx.getCurrentOverrideVersion(providerId) + ctx.isActiveCalcStale() — если
 * методы доступны. На текущей сборке (calc без provider override) они вернут
 * null/false → pricing-checks не сработают.
 */

import { el } from '../dom.js';
import { modalShell } from './baseModal.js';
import { icon } from '../icons.js';
import {
    evaluateCalculationHealth,
    groupHealthFindings
} from '../../domain/calculationHealth.js';
import { HEALTH_SEVERITIES, HEALTH_SCORE_THRESHOLDS } from '../../utils/constants.js';
import { renderHealthScoreTrend } from '../healthScoreTrend.js';

const SEVERITY_LABELS = Object.freeze({
    error: 'Ошибки',
    warning: 'Предупреждения',
    recommendation: 'Рекомендации',
    info: 'Заметки'
});

const SEVERITY_DESCRIPTIONS = Object.freeze({
    error: 'Критические противоречия в данных — расчёт не может быть достоверен.',
    warning: 'Сценарий технически возможен, но даст инфраструктуру с риском.',
    recommendation: 'Полезные доработки — повышают точность и обоснованность.',
    info: 'Информационные заметки — не требуют действий.'
});

function scoreColorClass(score) {
    if (score >= HEALTH_SCORE_THRESHOLDS.good) return 'health-score-good';
    if (score >= HEALTH_SCORE_THRESHOLDS.warning) return 'health-score-warning';
    return 'health-score-critical';
}

/* ---------- Helper: достать pricing-меты из ctx (опционально) ---------- */

function buildBundleMeta(calc, ctx) {
    if (!calc?.providerVersion) return null;
    const pv = calc.providerVersion;
    let isStale = false;
    if (ctx && typeof ctx.isActiveCalcStale === 'function') {
        try { isStale = !!ctx.isActiveCalcStale(); } catch (_e) { /* */ }
    }
    return {
        providerId: pv.id || '',
        version: pv.version || '',
        timestamp: pv.timestamp || '',
        isStale
    };
}

/* ---------- Главный entry ---------- */

export function renderCalculationHealthModal(state, ctx) {
    const m = state.modals?.calculationHealth;
    if (!m || !m.open) return null;

    const onClose = () => ctx.closeModal('calculationHealth');
    const calc = state.activeCalc;
    const isGate = !!m.gate;

    return modalShell({
        title: isGate ? 'Проверка расчёта перед использованием' : 'Качество расчёта',
        size: 'lg',
        closeable: !isGate,
        onClose,
        children: el('div', { class: 'health-modal-body' },
            isGate ? renderGateNotice(m) : null,
            calc ? renderBody(calc, state, ctx, onClose) : renderEmpty()
        ),
        footer: el('div', { class: 'health-modal-footer' },
            // Stage 16.1: точка входа в мастер уточнения из Health-модалки.
            // Закрываем эту модалку и открываем guidedCompletion.
            typeof ctx.openGuidedCompletion === 'function'
                ? el('button', {
                    class: 'btn btn-ghost',
                    title: 'Пройти мастер уточнения по найденным проблемам',
                    onClick: () => {
                        ctx.closeModal('calculationHealth');
                        ctx.openGuidedCompletion();
                    }
                }, 'Исправить через мастер →')
                : null,
            // Stage 15.5: точка входа в Decision Memo из Health-модалки.
            typeof ctx.openDecisionMemoModal === 'function'
                ? el('button', {
                    class: 'btn btn-ghost',
                    title: 'Сформировать обоснование расчёта (Markdown)',
                    onClick: () => {
                        ctx.closeModal('calculationHealth');
                        ctx.openDecisionMemoModal();
                    }
                }, 'Сформировать memo →')
                : null,
            el('button', {
                class: 'btn btn-primary',
                title: isGate
                    ? 'Продолжить с текущими допущениями после просмотра Health Check'
                    : 'Закрыть (Esc)',
                onClick: onClose
            }, isGate ? 'Проверил, продолжить' : 'Закрыть')
        )
    });
}

function renderGateNotice(modalState) {
    const sourceText = modalState?.source === 'quickStart'
        ? 'Расчёт создан через Quick Start и сразу прогнан через Health Check.'
        : 'JSON загружен и перед использованием прогнан через Health Check.';
    const repairCount = Array.isArray(modalState?.repairs) ? modalState.repairs.length : 0;
    const formulaWarningCount = Array.isArray(modalState?.formulaWarnings)
        ? modalState.formulaWarnings.length
        : 0;
    const details = [];
    if (repairCount > 0) details.push(`безопасно автозаполнено полей: ${repairCount}`);
    if (formulaWarningCount > 0) details.push(`замечаний к формулам: ${formulaWarningCount}`);
    return el('div', { class: 'health-gate-notice', attrs: { role: 'note' } },
        el('strong', { text: sourceText }),
        details.length > 0
            ? el('span', { text: ` Дополнительно: ${details.join(' · ')}.` })
            : null,
        el('span', { text: ' Проверьте ошибки и предупреждения ниже; кнопки в карточках применяют только явные исправления или фиксируют подтверждённое допущение.' })
    );
}

/* ---------- Тело: header + tabs + список ---------- */

function renderBody(calc, state, ctx, onClose) {
    const bundleMeta = buildBundleMeta(calc, ctx);
    const evalResult = evaluateCalculationHealth(calc, { bundleMeta });
    const { findings, score, counts } = evalResult;
    const groups = groupHealthFindings(findings);

    // Выбираем активную severity-вкладку:
    //   1. Если в state.ui.healthLastTab сохранено и в этой группе есть findings — она.
    //   2. Иначе первая непустая severity по приоритету (error → warning → ...).
    //   3. Иначе 'error' (отображается как пустая).
    const lastTab = state.ui?.healthLastTab;
    let activeTab = lastTab && groups[lastTab]?.length > 0 ? lastTab : null;
    if (!activeTab) {
        for (const sev of HEALTH_SEVERITIES) {
            if (groups[sev].length > 0) { activeTab = sev; break; }
        }
    }
    if (!activeTab) activeTab = 'error';

    // Stage 16.5: секция с динамикой health score за прошлые проверки.
    // Опциональная — рендерится только если ctx предоставляет историю.
    let trendSection = null;
    if (typeof ctx.getHealthScoreTrendForActiveCalc === 'function') {
        const history = ctx.getHealthScoreTrendForActiveCalc() || [];
        const onClear = typeof ctx.clearHealthScoreTrendForActiveCalc === 'function'
            && history.length > 0
            ? () => ctx.clearHealthScoreTrendForActiveCalc()
            : null;
        trendSection = renderHealthScoreTrend(history, onClear ? { onClear } : {});
    }

    return el('div', null,
        renderHeader(score, counts),
        trendSection,
        renderTabs(groups, activeTab, ctx),
        renderFindingsList(groups[activeTab], activeTab, calc, ctx, onClose)
    );
}

function renderHeader(score, counts) {
    const cls = scoreColorClass(score);
    const summary = [];
    if (counts.error > 0) summary.push(`${counts.error} ошибок`);
    if (counts.warning > 0) summary.push(`${counts.warning} предупреждений`);
    if (counts.recommendation > 0) summary.push(`${counts.recommendation} рекомендаций`);
    if (counts.info > 0) summary.push(`${counts.info} заметок`);
    const summaryText = summary.length > 0 ? summary.join(' · ') : 'Критичных проблем не найдено';

    return el('header', { class: 'health-modal-header' },
        el('div', { class: 'health-modal-header-left' },
            el('span', {
                class: ['health-score-chip', 'health-score-chip-lg', cls],
                attrs: { 'aria-label': `Score ${score} из 100` }
            }, `${score} / 100`),
            el('span', { class: 'health-modal-header-summary', text: summaryText })
        )
    );
}

function renderTabs(groups, activeTab, ctx) {
    return el('nav', { class: 'health-modal-tabs', attrs: { role: 'tablist' } },
        ...HEALTH_SEVERITIES.map(sev => {
            const list = groups[sev] || [];
            const isActive = sev === activeTab;
            const isEmpty = list.length === 0;
            return el('button', {
                class: ['health-modal-tab', `health-modal-tab--${sev}`,
                    isActive ? 'health-modal-tab-active' : '',
                    isEmpty ? 'health-modal-tab-empty' : ''],
                attrs: {
                    type: 'button',
                    role: 'tab',
                    'aria-selected': isActive ? 'true' : 'false'
                },
                title: SEVERITY_DESCRIPTIONS[sev] || '',
                onClick: () => ctx.setHealthLastTab(sev)
            },
                el('span', { class: 'health-modal-tab-label', text: SEVERITY_LABELS[sev] }),
                el('span', { class: 'health-modal-tab-count', text: isEmpty ? '—' : String(list.length) })
            );
        })
    );
}

function renderFindingsList(list, severity, calc, ctx, onClose) {
    if (!list || list.length === 0) {
        return el('div', { class: 'health-modal-empty' },
            icon('check-circle', { size: 18 }),
            el('span', { text: severity === 'error'
                ? 'Ошибок нет — критичных противоречий не выявлено.'
                : `В категории «${SEVERITY_LABELS[severity] || severity}» пока пусто.` })
        );
    }
    return el('div', { class: 'health-findings-list' },
        ...list.map(f => renderFindingCard(f, calc, ctx, onClose))
    );
}

function renderFindingCard(f, calc, ctx, onClose) {
    const fieldButtons = (f.fieldIds || []).map(fid =>
        el('button', {
            class: 'health-finding-fieldlink',
            attrs: { type: 'button' },
            title: 'Перейти к этому полю в опроснике',
            onClick: () => {
                onClose();
                if (typeof ctx.focusQuestion === 'function') ctx.focusQuestion(fid);
                else if (typeof ctx.setActiveTab === 'function') ctx.setActiveTab('questionnaire');
            }
        }, fid)
    );

    const repairActions = renderFindingRepairActions(f, calc, ctx);

    return el('article', {
        class: ['health-finding-card', `health-finding-${f.severity}`]
    },
        el('header', { class: 'health-finding-card-header' },
            el('h4', { class: 'health-finding-title', text: f.title })
        ),
        el('p', { class: 'health-finding-message', text: f.message }),
        f.suggestedAction
            ? el('p', { class: 'health-finding-action' },
                el('span', { class: 'health-finding-action-label', text: 'Что сделать: ' }),
                el('span', { text: f.suggestedAction }))
            : null,
        fieldButtons.length > 0
            ? el('div', { class: 'health-finding-fields' },
                el('span', { class: 'health-finding-fields-label', text: 'Связанные поля: ' }),
                ...fieldButtons,
                el('button', {
                    class: 'health-finding-assumptions-link',
                    attrs: { type: 'button' },
                    title: 'Посмотреть допущения по связанным полям',
                    onClick: () => {
                        onClose();
                        ctx.openAssumptionsRegisterModal(f.fieldIds);
                    }
                }, 'Допущения →'))
            : null,
        repairActions
    );
}

function renderFindingRepairActions(f, calc, ctx) {
    const actions = [];
    if (f.id === 'consistency-avg-rps-gt-peak') {
        const avg = Number(calc?.answers?.avg_rps);
        if (Number.isFinite(avg) && avg > 0 && typeof ctx.setAnswer === 'function') {
            actions.push(el('button', {
                class: 'btn btn-ghost health-finding-repair-btn',
                attrs: { type: 'button' },
                title: 'Подтвердить исправление: пиковый RPS станет не меньше среднего',
                onClick: () => ctx.setAnswer('peak_rps', avg)
            }, `Поднять peak RPS до ${avg}`));
        }
    }
    if (f.id === 'risk-seasonal-activity-not-applied') {
        if (typeof ctx.setSetting === 'function') {
            actions.push(el('button', {
                class: 'btn btn-ghost health-finding-repair-btn',
                attrs: { type: 'button' },
                title: 'Включить риск-коэффициенты и задать сезонную надбавку 15%',
                onClick: () => {
                    ctx.setSetting('applyRiskFactors', true);
                    const current = Number(calc?.settings?.kSeasonal);
                    if (!Number.isFinite(current) || current <= 0) ctx.setSetting('kSeasonal', 0.15);
                }
            }, 'Учесть сезонность 15%'));
        }
        if (typeof ctx.acknowledgeHealthFinding === 'function') {
            actions.push(el('button', {
                class: 'btn btn-ghost health-finding-repair-btn',
                attrs: { type: 'button' },
                title: 'Зафиксировать, что сезонный пик уже включён в параметры нагрузки',
                onClick: () => ctx.acknowledgeHealthFinding(f.id, f.fieldIds)
            }, 'Пик уже учтён в нагрузке'));
        }
    }
    if (f.id === 'consistency-dau-share-lower-than-1-percent'
            && typeof ctx.acknowledgeHealthFinding === 'function') {
        actions.push(el('button', {
            class: 'btn btn-ghost health-finding-repair-btn',
            attrs: { type: 'button' },
            title: 'Подтвердить низкую ежедневную активность как осознанное допущение',
            onClick: () => ctx.acknowledgeHealthFinding(f.id, f.fieldIds)
        }, 'Подтвердить 0,7%'));
    }
    if (actions.length === 0) return null;
    return el('div', { class: 'health-finding-repair-actions' },
        el('span', { class: 'health-finding-repair-label', text: 'Действия: ' }),
        ...actions
    );
}

function renderEmpty() {
    return el('div', { class: 'health-modal-empty' },
        el('p', { text: 'Откройте расчёт, чтобы увидеть проверку качества.' })
    );
}
