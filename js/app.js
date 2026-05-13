/**
 * Точка входа приложения. Связывает store, UI, контроллеры и горячие клавиши.
 * Архитектура слоёв:
 *   ui → controllers → state/store → domain (чистая логика)
 *   services — IO (storage, json, format, markdown)
 *   utils — нижний уровень (constants, escapeHtml, debounce, uuid)
 */

import { store } from './state/store.js';
import * as persist from './state/persistence.js';
import { debounce } from './utils/debounce.js';
import { STORAGE_KEYS, CALC_LIST_REFRESH_DEBOUNCE_MS, STAND_IDS, ADVANCED_ONLY_NEXT_STEP_TARGETS } from './utils/constants.js';
import { loadPdfHintShown, markPdfHintShown } from './services/storage.js';
import * as calcList from './controllers/calcListController.js';
import * as calc from './controllers/calcController.js';
import { flushPendingCommit } from './controllers/calcController.js';
import * as itemCtl from './controllers/itemController.js';
import * as questionCtl from './controllers/questionController.js';
import * as providerCtl from './controllers/providerController.js';
import * as budgetCtl from './controllers/budgetGuardrailsController.js';
import * as memoCtl from './controllers/decisionMemoController.js';
import * as guidedCompletionCtl from './controllers/guidedCompletionController.js';
import * as priceImportCtl from './controllers/priceImportMappingController.js';
import { buildRecommendedActions } from './domain/recommendedActions.js';
import * as costOptimizationCtl from './controllers/costOptimizationPlannerController.js';
import * as healthScoreTrendCtl from './controllers/healthScoreTrendController.js';
import { startCrossTabSync } from './state/crossTabSync.js';
import { subscribe as subscribeCrossTabNotifier } from './state/crossTabNotifier.js';
import { loadReadmeHtml } from './controllers/helpController.js';
import { bindHotkeys } from './controllers/keyboardController.js';
import { mountUi, renderApp } from './ui/index.js';
import * as snackbar from './ui/snackbar.js';
import { setButtonLoading } from './ui/dom.js';
import { findQuestionUsages, lintFormulas } from './domain/validation.js';
import { VAT_RATE_HISTORY } from './domain/vatRateTable.js';

/* ---------- Защита от двойных кликов ---------- */

let _lastCreateAt = 0;
let _lastDuplicateAt = 0;

/* ---------- Loading-state обёртка ----------
 * Helper для длительных async-операций (импорт/экспорт/печать).
 * Если onClick прокинул Event как первый аргумент, currentTarget
 * получает класс .btn-loading на время выполнения (CSS-spinner +
 * disabled). По завершении (включая throw) состояние снимается.
 */
/* Общий handler результата обновления прайса (snackbar success/info/error по reason). */
function _handleUpdateProviderResult(result) {
    if (result.ok) {
        const ver = result.applied?.version || '';
        snackbar.success(`Прайс провайдера обновлён${ver ? ' до ' + ver : ''}.`);
    } else if (result.reason === 'in-progress') {
        snackbar.info('Обновление уже выполняется.');
    } else if (result.reason === 'cancelled') {
        /* Тихая отмена — без toast'а. */
    } else if (result.reason === 'vat-policy-required') {
        /* Stage VAT-2 Phase 5: v1 JSON без vatPolicy → модалка уже открыта
         * контроллером; toast'а не показываем (модалка сама объясняет flow). */
    } else {
        snackbar.error(result.message || 'Не удалось обновить прайс.');
    }
    return result;
}

async function withLoadingButton(triggerEvent, asyncFn) {
    const target = triggerEvent && typeof triggerEvent === 'object'
        ? triggerEvent.currentTarget : null;
    const btn = target && typeof target.classList !== 'undefined' &&
                target.tagName === 'BUTTON'
                ? target : null;
    if (btn) setButtonLoading(btn, true);
    try {
        return await asyncFn();
    } finally {
        if (btn) setButtonLoading(btn, false);
    }
}

/* ---------- Тема приложения (12.U33) ---------- */

import { THEME_IDS, DEFAULT_THEME } from './utils/constants.js';

/**
 * Применить тему как атрибут data-theme на <html>. Невалидное значение
 * игнорируется и заменяется DEFAULT_THEME, чтобы не оставить страницу
 * без палитры. Идемпотентно.
 */
/* Phase 3: показать snackbar по result-объекту от applyOptimizationDraftAction/
   confirmOptimizationApply. Controller возвращает форму
   { ok: true, applied, failed, savingPercent } или
   { ok: false, reason: 'high_risk_pending'|'no_changes'|'recompute_failed'|... }.
   high_risk_pending — это нормальная промежуточная ветка (UI открыл confirm-
   panel), snackbar не показываем. */
function _showOptimizationApplyResult(r) {
    if (!r) return;
    if (r.ok) {
        const pct = Number.isFinite(r.savingPercent) ? r.savingPercent : 0;
        const word = _pluralizeParamRu(r.applied);
        const partial = r.failed > 0 ? ` (${r.failed} не прошло)` : '';
        snackbar.success(
            `Изменения применены: ${r.applied} ${word}, экономия −${pct.toFixed(1)}%.${partial}`
        );
        return;
    }
    switch (r.reason) {
        case 'high_risk_pending':
            /* Inline-confirmation открыта, snackbar не нужен. */
            return;
        case 'no_changes':
            snackbar.warning('Нет изменений для применения.');
            return;
        case 'recompute_failed':
            snackbar.error('Не удалось применить: ошибка пересчёта.');
            return;
        case 'invalid_total':
            snackbar.error('Не удалось применить: невалидная итоговая стоимость.');
            return;
        case 'no_draft':
        case 'no_calc':
        case 'not_confirming':
        case 'modal_closed':
            return; /* defensive — UI до этого не должен пускать */
        default:
            snackbar.warning('Не удалось применить изменения.');
    }
}

function _pluralizeParamRu(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'параметр';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'параметра';
    return 'параметров';
}

/* Цвета meta[name=theme-color] для mobile browser-chrome / PWA frame.
   Соответствуют --bg-panel в base.css (#0a0f1a в dark, #f5e9cb в light).
   При расхождении токенов в base.css — обновить здесь синхронно. */
const THEME_COLOR_BY_THEME = {
    dark: '#0a0f1a',
    light: '#f5e9cb'
};

function applyThemeAttribute(theme) {
    const safe = THEME_IDS.includes(theme) ? theme : DEFAULT_THEME;
    if (typeof document !== 'undefined' && document.documentElement) {
        if (safe === DEFAULT_THEME) {
            // Дефолт — без атрибута, чтобы CSS :root применялся напрямую
            // (минус один матч в каскаде, мелочь, но ОК).
            document.documentElement.removeAttribute('data-theme');
        } else {
            document.documentElement.setAttribute('data-theme', safe);
        }
        // Stage 18.2.x: синхронизация <meta name="theme-color"> с выбранной
        // темой — пользовательский выбор может расходиться с системным
        // prefers-color-scheme, поэтому media-варианты meta недостаточно.
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta && THEME_COLOR_BY_THEME[safe]) {
            meta.setAttribute('content', THEME_COLOR_BY_THEME[safe]);
        }
    }
}

/* ---------- VAT-1 Phase 5: legacy frozen snackbar ----------
 * Один раз за сессию показывает info-snackbar для расчёта, который был создан
 * по исторической ставке НДС (например, 20% до 2026-01-01). Триггерится из
 * ctx.openCalc после загрузки calc. Session-only — state.ui.shownLegacyVatBanners
 * НЕ сохраняется в localStorage и обнуляется на следующей сессии (так и задумано:
 * пользователь должен видеть это напоминание после каждого reboot приложения,
 * пока не примет решение — frozen оставить или сменить на manual / auto). */
function maybeShowLegacyVatBanner() {
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

/* ---------- VAT-2 Phase 5: legacy provider double-VAT warning ----------
 * Расчёт, который был создан до Phase 4 (нет `vatNormalized` на items.
 * dictionaries), мог содержать gross-price snapshot. Calculator применит
 * VAT поверх → потенциальный двойной учёт. Banner — non-blocking warning
 * с CTA «Перейти к тарифам» (раскрывает provider summary, где пользователь
 * увидит маркер «v1, политика неизвестна» и сможет переимпортировать прайс).
 *
 * Не auto-apply: только напоминание + path к ручному действию.
 *
 * Session-only — `state.ui.shownLegacyProviderVatBanners[calcId]` НЕ
 * сохраняется в localStorage (Q4 решение: после reboot показывается снова,
 * пока пользователь не переимпортирует прайс с явной vatPolicy). */
function maybeShowLegacyProviderVatBanner() {
    const state = store.getState();
    const calc = state.activeCalc;
    if (!calc || !calc.settings) return;
    /* НДС выключен → нет риска двойного учёта. */
    if (!calc.settings.vatEnabled) return;
    /* Items без `vatNormalized` = legacy snapshot до Phase 4. */
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
            /* Раскрываем provider summary — там же доступна кнопка
             * «Обновить прайс из файла». */
            store.setUi({ providerOverlayExpanded: true });
        }
    });
    store.setUi({ shownLegacyProviderVatBanners: { ...shown, [calc.id]: true } });
}

/* ---------- Контекст для UI: набор всех действий ---------- */

const ctx = {
    /* Список расчётов */
    setActiveTab(id) { store.setActiveTab(id); },

    /* Stage 17.3: переход на вкладку «Опросник» с фокусом на конкретное поле.
       Используется из Dashboard-блоков (Budget «Указать бюджет»), модалок
       Health Check / Допущения / Реестр допущений (кнопки «Перейти к полю»).
       До этого ctx.focusQuestion отсутствовал — все 4 call-site'а имели
       `typeof === 'function'` guard и молчаливо no-op'или.
       Реализация: setActiveTab('questionnaire') + recentlyChangedKey запускает
       .field-recent + .section-recent CSS-glow и одновременно раскрывает
       секцию-владельца вопроса (читается в openedSections). */
    focusQuestion(questionId) {
        if (!questionId || typeof questionId !== 'string') return;
        const calc = store.getState().activeCalc;
        if (!calc) return;
        store.setActiveTab('questionnaire');
        const q = (calc.dictionaries?.questions || []).find(x => x.id === questionId);
        if (q?.section) {
            const cur = store.getState().ui.questionnaireOpenSections || [];
            if (!cur.includes(q.section)) {
                store.setUi({ questionnaireOpenSections: [...cur, q.section] });
            }
        }
        store.setUi({ recentlyChangedKey: `answer:${questionId}` });
        // Прокрутка и фокус после рендера. Двойной rAF: первый дожидается
        // scheduleRender(), второй гарантирует, что DOM уже обновлён.
        //
        // Фокус-семантика «Перейти к полю» — это НАВИГАЦИЯ, не мутация:
        //   1) editable input → курсор в input.
        //   2) поле в режиме «Не знаю» (input disabled) → фокус на кнопку
        //      «Не знаю» + info-подсказка. Никакого автоклика — пользователь
        //      сам Enter/Space разблокирует ввод. Иначе навигация молча
        //      меняла бы answer (null → defaultValue) и source расчёта.
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => requestAnimationFrame(() => {
                const node = document.getElementById(`field-${questionId}`);
                if (!node) return;
                try {
                    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } catch { /* старые браузеры без smooth scroll — игнорируем */ }
                const editable = node.querySelector(
                    'input:not([disabled]):not([type="hidden"]):not([type="checkbox"]),' +
                    'select:not([disabled]),textarea:not([disabled])'
                );
                if (editable) {
                    try { editable.focus({ preventScroll: true }); } catch {}
                    return;
                }
                const unknownToggle = node.querySelector('.field-unknown-toggle');
                if (unknownToggle) {
                    try { unknownToggle.focus({ preventScroll: true }); } catch {}
                    snackbar.info('Нажмите «Не знаю», чтобы включить ручной ввод');
                }
            }));
        }
    },
    createCalc(name, templateId = null) {
        // Защита от двойного клика: если предыдущий вызов выполнился < 500 мс назад,
        // игнорируем повторный — иначе быстрый double-click создаст два расчёта.
        const now = Date.now();
        if (_lastCreateAt && (now - _lastCreateAt) < 500) return null;
        _lastCreateAt = now;
        const c = calcList.createCalc(name, templateId);
        store.setActiveTab('questionnaire');
        snackbar.success(templateId
            ? 'Расчёт создан из шаблона'
            : 'Расчёт создан');
        return c;
    },
    /* Stage 4.9/4.14: ctx.openNewCalc удалён вместе с newCalcModal. Создание
       нового расчёта идёт через Quick Start (3 preset'а после Stage 17.2)
       или напрямую через ctx.createCalc(name, null) для пустого расчёта. */
    /* 14.U1: Quick Start Wizard — открыть модалку с 7 макро-вопросами. */
    openQuickStart() {
        store.openModal('quickStart');
    },
    /* 14.U3: открыть Quick Start в режиме просмотра/изменения параметров активного
       расчёта. Draft предзаполнен из calc.wizard, поле «Название» скрыто, submit
       пока no-op (re-apply придёт в Sprint 2.2 пункте 3 с диалогом сохранения правок). */
    openQuickStartForEdit() {
        const calc = store.getState().activeCalc;
        if (!calc || !calc.wizard) return;
        store.openModal('quickStart', {
            mode: 'edit',
            draft: { ...calc.wizard, name: calc.name }
        });
    },
    /* Stage 18.2 (v2.13.1): открыть Quick Start, чтобы задать профиль активного
       сценария, у которого его сейчас нет (`calc.wizard === null` — обычно
       legacy-сценарии до v2.13.1 или сценарии, явно созданные без профиля).
       Submit пойдёт через openReapplyConfirm → applyReapply('overwrite') —
       контракт edit-mode'а. draft предзаполнен defaultDraft внутри модалки
       (модалка сама подставит PRESETS[0].draft, если draft пустой). */
    openQuickStartForActiveScenarioProfile() {
        const calc = store.getState().activeCalc;
        if (!calc) return;
        const draft = calc.wizard
            ? { ...calc.wizard, name: calc.name }
            : { name: calc.name };  /* модалка сама использует defaultDraft() */
        store.openModal('quickStart', { mode: 'edit', draft });
    },
    /* 14.U3: helper-обёртка над snackbar.info для UI-слоя — UI не импортирует snackbar
       напрямую (layer purity), а зовёт через ctx. */
    snackbarInfo(message) { snackbar.info(message); },
    /* 14.U5: открыть диалог подтверждения re-apply профиля.
       draftWizard — новый объект 7 макро-ответов (если юзер поменял их в QS
       edit-mode). Если undefined — re-apply работает по существующему calc.wizard.

       Если manual-полей нет (N=0) — диалог пропускается, сразу выполняем
       overwrite (manual-полей нет значит preserve и overwrite эквивалентны).
       При N>0 — модалка с тремя вариантами (см. reapplyConfirmModal.js). */
    openReapplyConfirm(draftWizard) {
        /* Stage 18.2: guard `|| !c.wizard` убран. Empty-state «Задать профиль
           сценария» вызывает openQuickStartForActiveScenarioProfile → submit QS
           → этот метод. Для сценария без wizard'а manualCount=0 (answersMeta
           пустой), сразу идём в overwrite — applyReapply запишет wizard перед
           reapplyProfile. Семантика «edit» сохранена для wizard-ful сценариев. */
        const c = store.getState().activeCalc;
        if (!c) return;
        let manualCount = 0;
        const meta = c.answersMeta || {};
        for (const m of Object.values(meta)) {
            if (m && m.source === 'manual') manualCount++;
        }
        if (manualCount === 0) {
            this.applyReapply('overwrite', draftWizard);
            return;
        }
        store.openModal('reapplyConfirm', { manualCount, draftWizard });
    },
    applyReapply(mode, explicitDraftWizard) {
        /* Если в state.modals.reapplyConfirm есть draftWizard (юзер шёл через QS edit
           с изменёнными макропараметрами) — сначала обновляем calc.wizard,
           потом re-apply. Иначе reapplyProfile использует existing calc.wizard. */
        const fromModal = store.getState().modals.reapplyConfirm.draftWizard;
        const draftWizard = explicitDraftWizard ?? fromModal;
        if (draftWizard) {
            store.updateActiveCalc({ wizard: { ...draftWizard } });
        }
        const result = calc.reapplyProfile(mode);
        const noun = mode === 'preserve' ? 'с сохранением правок' : 'полная перезапись';
        snackbar.success(`Профиль применён (${noun}). Изменено полей: ${result.changed}.`);
    },
    /* 14.U1: создание расчёта по итогам Quick Start. Вызывается из QuickStart-модалки.
       Аргументы: name (string), wizardInput (объект 7 ответов).

       Stage 18.1.2: больше не показываем success-snackbar — dashboard сам
       отображает результат (новые цифры, имя в TopBar, бейджи «Из профиля»
       на полях опросника). Старый текст «Расчёт создан из профиля «<industry>»»
       перекрывал footer Cost Optimization Planner. */
    createCalcFromWizard(name, wizardInput) {
        const now = Date.now();
        if (_lastCreateAt && (now - _lastCreateAt) < 500) return null;
        _lastCreateAt = now;
        const c = calcList.createCalcFromWizard(name, wizardInput);
        store.setActiveTab('dashboard');
        return c;
    },
    openCalc(id) {
        calcList.openCalc(id);
        store.setActiveTab('questionnaire');
        maybeShowLegacyVatBanner();
        maybeShowLegacyProviderVatBanner();
    },
    duplicateCalc(id) {
        const now = Date.now();
        if (_lastDuplicateAt && (now - _lastDuplicateAt) < 500) return;
        _lastDuplicateAt = now;
        const c = calcList.duplicateCalc(id);
        if (c) snackbar.success('Расчёт скопирован');
    },
    renameCalc(id, currentName) {
        ctx.input({
            title: 'Переименовать расчёт',
            label: 'Название',
            defaultValue: currentName || '',
            placeholder: 'Например: SaaS-платформа MVP',
            confirmLabel: 'Сохранить',
            onConfirm: next => {
                const trimmed = (next || '').trim();
                if (trimmed) calcList.renameCalc(id, trimmed);
            }
        });
    },
    deleteCalc(id, name) {
        ctx.confirm({
            title: 'Удалить расчёт',
            message: `Удалить расчёт «${name}»?\n\nДействие можно отменить в течение нескольких секунд через кнопку «Отменить» в уведомлении.`,
            danger: true,
            confirmLabel: 'Удалить',
            onConfirm: () => {
                // Backup перед удалением — для undo
                const backup = calcList.snapshotCalc(id);
                calcList.deleteCalc(id);
                if (backup) {
                    snackbar.showUndoableSnackbar(
                        `Расчёт «${name}» удалён`,
                        () => { calcList.restoreCalc(backup); snackbar.success('Расчёт восстановлен'); }
                    );
                }
            }
        });
    },
    importCalc(triggerEvent) {
        // Обёртка: запускаем импорт и обрабатываем все возможные исходы.
        // Выделена в функцию, чтобы duplicate-цикл (open modal → повторный
        // вызов с onDuplicate) не дублировал обработку success/validation/parse.
        // triggerEvent — опциональный Event от onClick для loading-state кнопки.
        const runImport = (opts) =>
            withLoadingButton(triggerEvent, () =>
                calcList.importCalcFromFile(opts).then(res => handleImportResult(res))
            );
        const handleImportResult = (res) => {
            if (res?.ok) {
                store.setActiveTab('questionnaire');
                snackbar.success(res.replaced ? 'Расчёт обновлён' : 'Расчёт загружен');

                // После загрузки — прогоняем линтер: если есть висящие ссылки
                // (Q.<id> на отсутствующие вопросы), показываем сводку.
                const calc = store.getState().activeCalc;
                if (calc) {
                    const warnings = lintFormulas(calc.dictionaries.items, calc.dictionaries.questions);
                    if (warnings.length > 0) {
                        const sample = warnings.slice(0, 6).map(w => {
                            const item = calc.dictionaries.items.find(i => i.id === w.itemId);
                            const itemName = item?.name || w.itemId;
                            return `  • ${itemName} (${w.stand}): ${w.message}`;
                        }).join('\n');
                        const more = warnings.length > 6 ? `\n  … и ещё ${warnings.length - 6}` : '';
                        store.openModal('message', {
                            title: `Замечания к формулам (${warnings.length})`,
                            message:
                                'В загруженном расчёте обнаружены формулы со ссылками на ' +
                                'отсутствующие вопросы или ошибками парсинга. Затронутые ЭК ' +
                                'будут возвращать qty=0 на соответствующих стендах.\n\n' +
                                sample + more + '\n\n' +
                                'Откройте «Элементы» → «Изменить» → «Формулы количества» для исправления.'
                        });
                    }
                }
            } else if (res?.reason === 'cancelled') {
                /* пользователь отменил */
            } else if (res?.reason === 'duplicate') {
                // 11.1.4: коллизия id — спрашиваем пользователя явно.
                // preloaded прокидываем обратно в контроллер, чтобы повторный
                // вызов не открывал file picker заново.
                store.openModal('duplicateImport', {
                    existingName: res.existingName,
                    importedName: res.importedName,
                    onReplace: () => runImport({ onDuplicate: 'replace', preloaded: res.preloaded }),
                    onClone:   () => runImport({ onDuplicate: 'clone',   preloaded: res.preloaded }),
                    onCancel:  () => { /* пользователь отменил */ }
                });
            } else if (res?.reason === 'validation') {
                snackbar.error('Файл не прошёл валидацию');
                store.openModal('message', {
                    title: 'Ошибки валидации',
                    message: res.errors.slice(0, 5).map(e => `${e.path || ''}: ${e.message}`).join('\n')
                });
            } else {
                snackbar.error('Не удалось загрузить: ' + (res?.message || 'неизвестная ошибка'));
            }
        };
        runImport();
    },
    exportCalc(triggerEvent) {
        return withLoadingButton(triggerEvent, async () => {
            const ok = calcList.exportActiveCalc();
            if (ok) snackbar.success('Файл сохранён');
            else snackbar.warning('Нет активного расчёта');
        });
    },

    /* Полный экспорт/импорт всего состояния (bundle) */
    exportStateBundle(triggerEvent) {
        return withLoadingButton(triggerEvent, async () => {
            try {
                await calcList.exportStateBundle();
                const list = store.getState().calcList;
                snackbar.success(`Полный snapshot сохранён (${list.length} расч.)`);
            } catch (e) {
                snackbar.error('Не удалось экспортировать: ' + e.message);
            }
        });
    },

    importStateBundle(triggerEvent) {
        const currentList = store.getState().calcList;
        const proceed = () => withLoadingButton(triggerEvent, async () => {
            const result = await calcList.importStateBundleFromFile();
            if (result.ok) {
                const a = result.applied;
                snackbar.success(
                    `Состояние заменено: ${a.calculations} расч., ` +
                    `${a.items} ЭК, ${a.questions} вопр.`
                );
                store.setActiveTab('calculations');
            } else if (result.reason === 'cancelled') {
                /* пользователь отменил */
            } else if (result.reason === 'validation') {
                store.openModal('message', {
                    title: 'Файл не прошёл валидацию',
                    message:
                        'Bundle-файл содержит ошибки структуры. Состояние не изменено.\n\n' +
                        result.errors.slice(0, 6).map(e => `• ${e.path || ''}: ${e.message}`).join('\n')
                });
            } else if (result.reason === 'parse') {
                snackbar.error('Файл не является корректным JSON: ' + (result.message || ''));
            } else {
                snackbar.error('Ошибка импорта: ' + (result.error || result.reason));
            }
        });

        // Если в хранилище уже есть данные — спросить подтверждение.
        if (currentList.length === 0) {
            proceed();
        } else {
            ctx.confirm({
                title: 'Заменить состояние полностью?',
                message:
                    `Текущие данные (${currentList.length} расч.) будут УДАЛЕНЫ и заменены ` +
                    `содержимым выбранного bundle-файла. Действие необратимо.\n\n` +
                    `Совет: перед импортом сделайте «Полный экспорт» для backup.`,
                danger: true,
                confirmLabel: 'Заменить',
                onConfirm: proceed
            });
        }
    },
    exportCsv(triggerEvent) {
        const calc = store.getState().activeCalc;
        if (!calc) { snackbar.warning('Нет активного расчёта'); return; }
        // Динамический импорт — чтобы не тянуть csvExport до первого использования.
        return withLoadingButton(triggerEvent, async () => {
            const [{ calculate }, csvMod] = await Promise.all([
                import('./domain/calculator.js'),
                import('./services/csvExport.js')
            ]);
            const result = calculate(calc, store.getState().calcRevision);
            const content = csvMod.buildDetailsCsv(calc, result);
            csvMod.downloadCsv(csvMod.buildCalcCsvFilename(calc), content);
            snackbar.success('CSV сохранён');
        });
    },
    /* Активный расчёт */
    setName(name)             { calc.setName(name); },
    setSetting(key, value)    { calc.setSetting(key, value); },
    setProvider(value)        { calc.setProvider(value); },
    /* Единственный пользовательский workflow обновления прайса —
       загрузка локального JSON (file-picker → validate → save). */
    updateProviderPricesFromFile(triggerEvent, providerId) {
        return withLoadingButton(triggerEvent, async () => {
            const result = await providerCtl.updateProviderPricesFromFile(providerId);
            return _handleUpdateProviderResult(result);
        });
    },
    clearProviderUpdateStatus(providerId) { providerCtl.clearProviderUpdateStatus(providerId); },
    /* Stage VAT-2 Phase 5: пользователь выбрал политику НДС в vatPolicyChoice
     * modal → закрываем модалку и повторно вызываем validate+save с явной
     * `userVatPolicy`. Допустимые значения: 'net' | 'gross-20' | 'gross-22'. */
    chooseVatPolicy(userVatPolicy) {
        const state = store.getState();
        const m = state.modals.vatPolicyChoice;
        if (!m || !m.open) return;
        const { providerId, preloaded } = m;
        store.closeModal('vatPolicyChoice');
        return providerCtl.applyProviderPricesWithVatPolicy(providerId, preloaded, userVatPolicy)
            .then(_handleUpdateProviderResult);
    },
    /* Stage VAT-2 Phase 5: пользователь отменил импорт legacy v1 → закрываем
     * модалку, prices без изменений. Никакого toast'а — тихая отмена. */
    cancelVatPolicyChoice() {
        store.closeModal('vatPolicyChoice');
    },
    /* Stage 8.3: применить применённый override к активному расчёту
       (swap dictionary.items + запись calc.providerVersion). Вызывается из
       UI кнопки «Пересчитать на новом прайсе» в блоке провайдера. */
    applyProviderOverrideToActiveCalc(triggerEvent) {
        return withLoadingButton(triggerEvent, async () => {
            const result = providerCtl.applyOverrideToActiveCalc();
            if (result.ok) {
                const n = result.deltas?.length || 0;
                snackbar.success(
                    n > 0
                        ? `Расчёт пересчитан на прайс ${result.version}: изменено цен — ${n}.`
                        : `Расчёт уже на прайсе ${result.version}.`
                );
            } else if (result.reason === 'no-override') {
                snackbar.info('Сначала загрузите обновление прайса.');
            } else if (result.reason === 'locked-by-other-tab') {
                /* Stage 11.3: conflict с update в другой вкладке — warning, не error. */
                snackbar.warning(result.message);
            } else {
                snackbar.error(result.message || 'Не удалось применить прайс.');
            }
            return result;
        });
    },
    /* Stage 8.3: read-only геттеры для UI — UI не импортирует controllers
       напрямую (layer purity), а ходит через ctx. Эти геттеры вызываются на
       каждом render'е, поэтому должны быть дешёвыми. */
    isActiveCalcStale() { return providerCtl.isActiveCalcStale(); },
    getCurrentOverrideVersion(providerId) { return providerCtl.getCurrentOverrideVersion(providerId); },
    /* Stage 9.1: эффективные цены провайдера (frozen ∪ user override) для UI.
       UI не импортирует services/providerPriceResolver напрямую — ходит через ctx
       (UI → services тоже layer violation; allowable путь только через ctx). */
    getEffectivePricesForProvider(providerId) {
        return providerCtl.resolveEffectivePricesForProvider(providerId);
    },
    /* Stage 9.5: read-only геттер для UI — top-of-stack history snapshot.
       Возвращает { appliedJSON, appliedAt } | null. UI рендерит кнопку
       «Откатить на предыдущий прайс» только когда есть snapshot. */
    peekPreviousProviderOverride(providerId) {
        return providerCtl.peekPreviousOverride(providerId);
    },
    /* Stage 10.3: read-only геттеры для DeltaHistoryPanel — current override
       (полный JSON) + список history snapshot'ов. */
    getCurrentProviderOverride(providerId) {
        return providerCtl.getCurrentProviderOverride(providerId);
    },
    getProviderOverrideHistory(providerId) {
        return providerCtl.getProviderOverrideHistory(providerId);
    },
    /* Stage 10.3 + 14.4 (PATCH 2.7.2): открыть модалку «История прайсов».
       providerId передаётся как preselected — UI auto-expand'ит этот блок при
       первом open'е, если пользователь не сохранял свой набор раскрытых блоков.
       После Stage 14.4 модалка всегда рендерится как accordion для всех активных
       провайдеров с историей. expandedIds восстанавливается из localStorage;
       null = «не сохранено» → дефолт = [providerId]. */
    openProviderHistoryModal(providerId) {
        const persistedExpanded = persist.loadDeltaHistoryExpandedProviders();
        store.openModal('deltaHistory', {
            providerId: providerId || null,
            expandedIds: persistedExpanded
        });
    },
    /* Stage 14.4: список всех активных провайдеров с историей (current override
       и/или непустая history) для рендера accordion'а. */
    getAllProvidersWithHistory() {
        return providerCtl.getAllProvidersWithHistory();
    },
    /* Stage 14.4: persist раскрытого блока accordion'а. UI вызывает на каждый
       клик по toggle-кнопке провайдера. expandedIds === null означает «снять
       сохранение» (вернуться к дефолту = [providerId]). */
    setDeltaHistoryProviderExpanded(providerId, isExpanded) {
        if (!providerId) return;
        const m = store.getState().modals.deltaHistory;
        const current = Array.isArray(m.expandedIds)
            ? m.expandedIds
            : (m.providerId ? [m.providerId] : []);
        const next = isExpanded
            ? (current.includes(providerId) ? current : [...current, providerId])
            : current.filter(id => id !== providerId);
        store.patchModal('deltaHistory', { expandedIds: next });
        persist.saveDeltaHistoryExpandedProviders(next);
    },
    /* Открыть модалку «Прайс-бенчмарк» (read-only сравнение цен провайдеров).
       visibleCategories восстанавливается из localStorage; null = UI применит
       дефолт (все 5 категорий). */
    openProviderAnalyticsModal() {
        const persistedVisible = persist.loadProviderAnalyticsVisibleCategories();
        store.openModal('providerAnalytics', {
            sortBy: 'total',
            sortDir: 'asc',
            visibleCategories: persistedVisible
        });
    },
    /* Stage 14.1: persist фильтра категорий в localStorage. Вызывается из UI
       при каждом toggle, чтобы F5 не сбрасывал выбор. */
    setProviderAnalyticsVisibleCategories(categories) {
        persist.saveProviderAnalyticsVisibleCategories(categories);
    },
    /* Stage 14.5 (PATCH 2.7.3): cross-provider scenario сравнение — модалка
       items × providers для активного calc. */
    openScenarioComparisonModal() {
        const calc = store.getState().activeCalc;
        if (!calc) {
            snackbar.warning('Сначала откройте расчёт.');
            return;
        }
        const persistedSelected = persist.loadScenarioComparisonSelectedProviders();
        const persistedCats = persist.loadProviderAnalyticsVisibleCategories();
        store.openModal('scenarioComparison', {
            selectedProviderIds: persistedSelected,
            visibleCategories: persistedCats
        });
    },
    setScenarioComparisonSelectedProviders(providerIds) {
        persist.saveScenarioComparisonSelectedProviders(providerIds);
    },
    /* Список active провайдеров для UI чекбоксов. */
    listActiveProvidersForComparison() {
        return providerCtl.listActiveProvidersForComparison();
    },
    /* Cross-provider сравнение для активного calc. */
    getCalcCrossProviderComparison(providerIds) {
        const calc = store.getState().activeCalc;
        if (!calc) return { currentProviderId: null, providers: [] };
        return providerCtl.getCalcCrossProviderComparison(calc, providerIds);
    },
    /* Stage 10.4: pure-domain агрегатор для cross-provider table. UI вызывает
       этот ctx-метод с list providerIds; он сам подгрузит effective-цены и
       передаст в чистый domain helper aggregateProviderPrices. */
    aggregateProviderPrices(providerIds, effectiveByProvider) {
        return providerCtl.aggregateProviderPrices(providerIds, effectiveByProvider);
    },
    /* Stage 11.1: read-only геттер — заблокирован ли провайдер cross-tab'ом.
       UI рендерит fetch/file кнопки disabled + tooltip «обновляется в другой
       вкладке» когда true. Возвращает boolean (true только если live lock от
       другой вкладки). */
    isProviderLockedByOtherTab(providerId) {
        const locks = store.getState().ui.providerCrossTabLocks || {};
        return Boolean(locks[providerId]);
    },
    /* Универсальный snackbar wrapper для использования из модалок (передаётся
       как ctx.snackbar(text, type) — type: 'success'|'error'|'warning'|'info'). */
    snackbar(text, type = 'info') {
        if (!text) return;
        if (type === 'success') snackbar.success(text);
        else if (type === 'error') snackbar.error(text);
        else if (type === 'warning') snackbar.warning(text);
        else snackbar.info(text);
    },
    /* Stage 10.3: восстановить override на конкретный history-индекс.
       После rollback — toast + refresh calcList (totalMonthly могут поменяться,
       если у calc'ов привязан старый providerVersion). */
    restoreProviderOverrideAt(triggerEvent, providerId, idx) {
        return withLoadingButton(triggerEvent, async () => {
            const result = providerCtl.restoreProviderOverrideFromHistory(providerId, idx);
            if (result.ok) {
                snackbar.success(
                    `Прайс восстановлен: ${result.restored.version}.`
                    + (result.hasMoreHistory ? ' В истории есть ещё точки.' : '')
                );
                calcList.refreshCalcList();
            } else if (result.reason === 'no-history') {
                snackbar.info('Нет истории для отката.');
            } else if (result.reason === 'invalid-index') {
                snackbar.error('Некорректный индекс истории.');
            } else if (result.reason === 'locked-by-other-tab') {
                snackbar.warning(result.message);
            } else {
                snackbar.error(result.message || 'Не удалось восстановить прайс.');
            }
            return result;
        });
    },
    /* Stage 9.5: rollback override → предыдущий прайс из history. После
       успешного отката пользователь продолжает работать на старых ценах,
       но calc'и с providerVersion остаются на их применённой версии (могут
       стать stale → появится «Старый прайс» badge). */
    rollbackProviderOverride(triggerEvent, providerId) {
        return withLoadingButton(triggerEvent, async () => {
            const result = providerCtl.rollbackProvider(providerId);
            if (result.ok) {
                if (result.restored) {
                    snackbar.success(
                        `Прайс возвращён к версии ${result.restored.version}.`
                        + (result.hasMoreHistory ? ' В истории есть ещё одна версия.' : '')
                    );
                } else {
                    snackbar.success('Применённый прайс снят. Используются базовые цены провайдера.');
                }
            } else if (result.reason === 'no-override') {
                snackbar.info('Нет применённого прайса для отката.');
            } else if (result.reason === 'locked-by-other-tab') {
                snackbar.warning(result.message);
            } else {
                snackbar.error(result.message || 'Не удалось откатить прайс.');
            }
            return result;
        });
    },
    /* Stage 8.5: применить current override ко ВСЕМ расчётам с этим провайдером.
       После операции — toast c summary («Обновлено N, без изменений M, ошибок K»).
       Использует best-effort iteration: ошибка на одном calc'е не прерывает остальные. */
    applyProviderOverrideToAllCalcs(triggerEvent, providerId) {
        return withLoadingButton(triggerEvent, async () => {
            const result = providerCtl.applyOverrideToAllCalcsForProvider(providerId);
            if (!result.ok) {
                if (result.reason === 'no-override') {
                    snackbar.info('Сначала загрузите обновление прайса.');
                } else if (result.reason === 'locked-by-other-tab') {
                    snackbar.warning(result.message);
                } else {
                    snackbar.error(result.message || 'Не удалось применить прайс ко всем расчётам.');
                }
                return result;
            }
            const parts = [];
            if (result.applied > 0) parts.push(`обновлено ${result.applied}`);
            if (result.alreadyFresh > 0) parts.push(`уже на новом прайсе ${result.alreadyFresh}`);
            if (result.errors.length > 0) parts.push(`ошибок ${result.errors.length}`);
            const message = parts.length > 0
                ? `Расчётов ${parts.join(', ')}.`
                : `Нет расчётов на провайдере ${providerId}.`;
            if (result.errors.length > 0) {
                snackbar.warning(message);
            } else {
                snackbar.success(message);
            }
            /* Refresh calcList — обновляются totalMonthly после применения. */
            calcList.refreshCalcList();
            return result;
        });
    },
    setResourceRatio(stand, resource, value) { calc.setResourceRatio(stand, resource, value); },
    setAiStandFactor(stand, value) { calc.setAiStandFactor(stand, value); },
    /* Stage VAT-1 Phase 4: VAT mode controllers (UI будет подключён в Phase 5). */
    setVatRateMode(mode) { calc.setVatRateMode(mode); },
    setVatEffectiveDate(isoDate) { calc.setVatEffectiveDate(isoDate); },
    setVatRateManual(rate) { calc.setVatRateManual(rate); },
    freezeVatRate() { calc.freezeVatRate(); },
    setAnswer(qid, value) {
        const r = calc.setAnswer(qid, value);
        /* 12.U18: аномалии (например, dau_share > 80%) показываются snackbar'ом.
           Контроллер сам snackbar не вызывает (controllers → ui = layer violation). */
        if (r?.anomaly) {
            const fn = r.anomaly.level === 'warn' ? snackbar.warning : snackbar.info;
            fn(r.anomaly.message);
        }
    },
    setSearch(tabId, q)       { calc.setSearch(tabId, q); },
    setUi(patch)              { store.setUi(patch); },
    toggleStand(standId) { calc.toggleStand(standId); },
    /* 12.U33: переключатель темы dark ↔ light. Subscriber в boot
       применяет state.ui.theme к <html data-theme="..."> и persist'ит. */
    setTheme(theme)           { calc.setTheme(theme); },
    toggleTheme()             { calc.toggleTheme(); },

    /* Stage 17.2 Phase 3c: режим «Расширенные настройки». При выключении
       автоматически уводит с admin-tab (items/questions) на safe-вкладку. */
    setAdvancedMode(enabled)  { calc.setAdvancedMode(enabled); },
    toggleAdvancedMode()      { calc.toggleAdvancedMode(); },

    /* Sprint 3.0 Stage 2: Scenario CRUD — обёртки над calcController с UI-side
       побочными эффектами (auto-open rename modal после Add, snackbar'ы и пр.). */
    switchScenario(scenarioId) {
        const r = calc.switchScenario(scenarioId);
        if (r && r.switched) {
            snackbar.info('Сценарий переключён');
        }
    },
    addScenario(label) {
        const r = calc.addScenario(label);
        if (r && r.scenarioId) {
            /* UX-выбор пользователя (3а): сразу после Add открываем модалку
               Rename — пользователь обычно хочет назвать сценарий. */
            store.openModal('scenarioRename', { scenarioId: r.scenarioId, draft: '' });
        }
    },
    duplicateScenario(scenarioId, customLabel = null) {
        const r = calc.duplicateScenario(scenarioId, customLabel);
        if (r && r.scenarioId) {
            snackbar.success('Сценарий дублирован');
        }
    },
    deleteScenario(scenarioId) {
        /* Перед удалением — confirm-модалка. Берём label для понятного текста. */
        const c = store.getState().activeCalc;
        const sc = c?.scenarios?.find(s => s.id === scenarioId);
        if (!sc) return;
        const label = sc.label || 'без названия';
        store.openModal('confirm', {
            title: 'Удалить сценарий?',
            message: `Сценарий «${label}» и его ответы будут удалены безвозвратно. Глобальные настройки расчёта (НДС, провайдер, риски) сохранятся.`,
            confirmLabel: 'Удалить',
            danger: true,
            onConfirm: () => {
                const result = calc.deleteScenario(scenarioId);
                if (result && result.removed) {
                    snackbar.success('Сценарий удалён');
                }
            }
        });
    },
    renameScenario(scenarioId, newLabel) {
        const r = calc.renameScenario(scenarioId, newLabel);
        if (r && r.renamed) {
            snackbar.success('Сценарий переименован');
        }
    },
    openScenarioMenu(scenarioId) {
        store.openModal('scenarioMenu', { scenarioId });
    },
    openScenarioRename(scenarioId) {
        const c = store.getState().activeCalc;
        const sc = c?.scenarios?.find(s => s.id === scenarioId);
        store.openModal('scenarioRename', {
            scenarioId,
            draft: sc?.label || ''
        });
    },
    /* Stage 4.8: открыть модалку «Дублировать сценарий». draft='' — модалка сама
       подставит default «<label> (копия)» при первом render'е (см.
       scenarioDuplicateModal.js). Это позволяет пользователю либо принять
       default'ный label кликом «Создать копию», либо переписать на своё имя. */
    openScenarioDuplicate(scenarioId) {
        store.openModal('scenarioDuplicate', { scenarioId, draft: '' });
    },
    /* Toggle блока «По категориям» в стенд-карточках дашборда.
     *
     * Хранится как массив sid'ов в state.ui.standCardsCatsExpanded; persist через
     * subscriber → STORAGE_KEYS.STAND_CARDS_CATS_EXPANDED. По умолчанию пусто
     * (все свёрнуты).
     *
     * Семантика: глобальная синхронизация. Один клик на любую карточку
     * (sid передаётся, чтобы не ломать сигнатуру) — раскрывает или сворачивает
     * блок одновременно во ВСЕХ стенд-карточках. Реализовано через массив
     * (а не boolean), чтобы UI остался без изменений: `expandedCats.includes(sid)`
     * → true для всех стендов либо для никого.
     *
     * Решает: пользователь хочет видеть «По категориям» либо везде, либо нигде —
     * чтобы быстро сравнивать стенды одинаковым взглядом, а не открывать пять
     * аккордеонов вручную.
     *
     * Legacy state: если в localStorage частичный массив (раньше раскрывали
     * выборочно) — первый клик глобализует. До клика рендер смешанный, что
     * безопасно: UI просто использует тот же `includes(sid)`. */
    toggleStandCatsExpanded(_standId) {
        const current = store.getState().ui.standCardsCatsExpanded || [];
        const allExpanded = STAND_IDS.every(s => current.includes(s));
        const next = allExpanded ? [] : [...STAND_IDS];
        store.setUi({ standCardsCatsExpanded: next });
    },
    /* 12.U27: toggle категории-аккордеона в «Детализации».
     * Хранится как массив СВЁРНУТЫХ category-id в state.ui.detailsCollapsedCats.
     * Дефолт null = все категории свёрнуты — UI на лету разворачивает массив
     * (CATEGORY_IDS-with-items минус та, которую раскрыли). При повторном
     * клике категория снова сворачивается. Persist через subscriber → STORAGE_KEYS.
     *
     * `presentCats` — список category-id с непустыми списками items (передаётся
     * из UI, чтобы не дублировать логику фильтрации). Используется только при
     * первой инициализации массива из null. */
    toggleDetailsCategory(catId, presentCats = null) {
        const current = store.getState().ui.detailsCollapsedCats;
        let next;
        if (current === null) {
            // Первая инициализация: всё было свёрнуто (дефолт), пользователь
            // раскрыл одну категорию → массив = все остальные категории.
            const all = Array.isArray(presentCats) ? presentCats : [];
            next = all.filter(c => c !== catId);
        } else if (current.includes(catId)) {
            // Свёрнута → раскрыть.
            next = current.filter(c => c !== catId);
        } else {
            // Раскрыта → свернуть.
            next = [...current, catId];
        }
        store.setUi({ detailsCollapsedCats: next });
    },
    openAssumptionsModal()    {
        // 12.U35: модалка «Реестр допущений» подключена к MODAL_RENDERERS
        // ([js/ui/index.js]). Кнопка-триггер живёт в дашборде (renderAssumptionsBtn).
        store.openModal('assumptions');
    },
    // Stage 15.1 (MINOR 2.8.0): модалка «Качество расчёта» — Health Check.
    openCalculationHealthModal() {
        store.openModal('calculationHealth');
        // Stage 16.5: фиксируем точку trend'а при каждом открытии.
        // Dedup в domain отфильтрует повторные открытия в течение 60s
        // с тем же score+counts.
        healthScoreTrendCtl.recordHealthScoreSnapshot(null, null, 'health_check');
    },
    // Stage 16.5: trend для активного calc — для рендера mini-timeline на дашборде
    // и в Health Check модалке.
    getHealthScoreTrendForActiveCalc() {
        return healthScoreTrendCtl.getHealthScoreTrendForActiveCalc();
    },
    clearHealthScoreTrendForActiveCalc() {
        const ok = healthScoreTrendCtl.clearHealthScoreTrendForActiveCalc();
        if (ok) snackbar.success('История качества очищена');
        return ok;
    },
    // Stage 15.2 (PATCH 2.8.1): Реестр допущений расчёта.
    // filterFieldIds — string[]|null; если задан, модалка показывает только эти поля
    // (cross-link из Health Check finding'а).
    openAssumptionsRegisterModal(filterFieldIds = null) {
        store.openModal('assumptionsRegister', { filterFieldIds });
    },
    // Stage 15.3 (PATCH 2.8.2): Анализ чувствительности — топ-драйверы стоимости.
    openSensitivityAnalysisModal() {
        store.openModal('sensitivity');
    },
    // Stage 18.1 Phase 2 (v2.13.0): План оптимизации стоимости — editable draft.
    // CRUD идёт через costOptimizationPlannerController, который дёргает
    // pure-domain мутации (createDraft / switchLevel / toggleConstraint / ...).
    // F5 теряет draft (runtime-only). Apply/Rollback — Phase 3.
    openCostOptimizationPlannerModal()      { costOptimizationCtl.openCostOptimizationPlannerModal(); },
    closeCostOptimizationPlannerModal()     { costOptimizationCtl.closeCostOptimizationPlannerModal(); },
    setOptimizationLevel(level)             { costOptimizationCtl.setOptimizationLevel(level); },
    toggleOptimizationConstraint(key, value){ costOptimizationCtl.toggleOptimizationConstraint(key, value); },
    setOptimizationViewPeriod(period)       { costOptimizationCtl.setOptimizationViewPeriod(period); },
    toggleOptimizationLeverGroup(groupId)   { costOptimizationCtl.toggleOptimizationLeverGroup(groupId); },
    updateOptimizationDraftValue(fieldId, value) {
        costOptimizationCtl.updateOptimizationDraftValue(fieldId, value);
    },
    removeOptimizationDraftChange(fieldId)  { costOptimizationCtl.removeOptimizationDraftChange(fieldId); },
    resetOptimizationDraft()                { costOptimizationCtl.resetOptimizationDraft(); },
    // Phase 3: apply / rollback / inline high-risk confirm.
    // Controller возвращает result-объект; snackbar поднимается тут (контроллер
    // про UI не знает — layer-linter, см. tests/unit/architecture/layer-imports).
    applyOptimizationDraftAction() {
        const r = costOptimizationCtl.applyOptimizationDraftAction();
        _showOptimizationApplyResult(r);
    },
    confirmOptimizationApply() {
        const r = costOptimizationCtl.confirmOptimizationApply();
        _showOptimizationApplyResult(r);
    },
    cancelOptimizationApplyConfirm() {
        costOptimizationCtl.cancelOptimizationApplyConfirm();
        /* Без snackbar — пользователь видит исчезновение confirm-panel. */
    },
    rollbackOptimizationApply() {
        const r = costOptimizationCtl.rollbackOptimizationApply();
        if (r?.ok) {
            snackbar.info('Изменения плана оптимизации отменены.');
        } else if (r?.reason === 'no_snapshot') {
            snackbar.warning('Нет применённых изменений для отката.');
        }
    },
    // Stage 15.3 (PATCH 2.8.2): сохраняет фильтры модалки анализа чувствительности.
    // filters: { costType: 'opex'|'capex'|'total', categories: string[] }
    setSensitivityFilters(filters) {
        if (!filters || typeof filters !== 'object') return;
        store.setUi({ sensitivityFilters: filters });
    },
    // Stage 15.4 (PATCH 2.8.3): Бюджетные ограничения. Тонкие обёртки над
    // budgetGuardrailsController; модалка зовёт evaluateBudgetGuardrails (тяжёлый
    // путь, под капотом sensitivity), dashboard-карточка — getBudgetGuardrailsSummary
    // (только gap, без sensitivity-перебора).
    openBudgetGuardrailsModal() {
        budgetCtl.openBudgetGuardrailsModal();
    },
    evaluateBudgetGuardrails() {
        return budgetCtl.evaluateBudgetGuardrailsForActiveCalc();
    },
    getBudgetGuardrailsSummary() {
        return budgetCtl.getBudgetGuardrailsSummary();
    },
    // Stage 15.5 (PATCH 2.8.4): Decision Memo — управленческое обоснование расчёта.
    // openDecisionMemoModal — открывает модалку (preview + copy/download).
    // buildDecisionMemo — возвращает { memo, markdown, filename, calcName } для UI.
    // copy/download — IO-обёртки. Snackbar вызывается из модалки.
    openDecisionMemoModal() {
        memoCtl.openDecisionMemoModal();
    },
    buildDecisionMemo() {
        return memoCtl.buildDecisionMemoForActiveCalc();
    },
    async copyDecisionMemo() {
        return memoCtl.copyDecisionMemoForActiveCalc();
    },
    downloadDecisionMemo() {
        return memoCtl.downloadDecisionMemoForActiveCalc();
    },
    // Stage 16.1 (MINOR 2.9.0): мастер уточнения расчёта (Guided Data Completion).
    // Все методы — тонкие обёртки над guidedCompletionController.
    // filterFieldIds — опциональный pre-filter (используется при запуске из
    // Assumptions Register для ограничения мастера конкретными полями).
    openGuidedCompletion(filterFieldIds = null) {
        guidedCompletionCtl.openGuidedCompletion(filterFieldIds);
    },
    applyGuidedAnswer(value) {
        guidedCompletionCtl.applyGuidedAnswer(value);
    },
    skipGuidedStep() {
        guidedCompletionCtl.skipGuidedStep();
    },
    goPrevGuidedStep() {
        guidedCompletionCtl.goPrevGuidedStep();
    },
    finishGuidedCompletion() {
        guidedCompletionCtl.finishGuidedCompletion();
    },
    rollbackGuidedCompletion() {
        guidedCompletionCtl.rollbackGuidedCompletion();
    },
    // Stage 16.2 (PATCH 2.9.1): импорт прайса с mapping assistant.
    // Все методы — тонкие обёртки над priceImportMappingController.
    openPriceImportMappingModal() {
        priceImportCtl.openPriceImportMappingModal();
    },
    setPriceImportProvider(providerId) {
        priceImportCtl.setPriceImportProvider(providerId);
    },
    async handlePriceImportFile(file = null) {
        const result = await priceImportCtl.handlePriceImportFile(file);
        if (!result.ok && result.reason === 'parse') {
            snackbar.error('Не удалось разобрать файл — проверьте формат.');
        }
        return result;
    },
    proceedToMappingStep() {
        priceImportCtl.proceedToMappingStep();
    },
    setPriceImportMapping(rowId, itemId) {
        priceImportCtl.setPriceImportMapping(rowId, itemId);
    },
    validatePriceImport() {
        priceImportCtl.validatePriceImport();
    },
    applyPriceImport() {
        const result = priceImportCtl.applyPriceImport();
        if (result.ok) {
            const s = result.summary;
            snackbar.success(`Прайс применён: ${s.priceCount} тарифов для ${s.providerId}.`);
        } else {
            snackbar.error('Apply не удался: ' + (result.message || result.reason));
        }
        return result;
    },
    closePriceImportMappingModal() {
        priceImportCtl.closePriceImportMappingModal();
    },
    goPriceImportBack() {
        priceImportCtl.goPriceImportBack();
    },
    // Domain-вычисление подсказок для composite-сводки Dashboard
    // (js/ui/calculationStateSummary.js — Stage 18.2). navigation-only:
    // первый action из списка идёт в блок «Следующий шаг», остальные доступны
    // через те же ctx-методы из других мест UI.
    //
    // Stage 17.4: некоторые targets — advanced-only (sensitivity_analysis).
    // Дефолтный пользователь получает структуру затрат из дашборда (категории
    // + риск-коэффициенты); perturbation-анализ скрыт за «Расширенными
    // настройками» в sidebar. Модалка остаётся доступной из Advanced-IA —
    // фильтр здесь гейтит ТОЛЬКО suggestion-flow в Next Steps.
    getActiveNextSteps() {
        const calc = store.getState().activeCalc;
        if (!calc) return [];
        const all = buildRecommendedActions(calc);
        const advancedMode = !!store.getState().ui.advancedModeEnabled;
        if (advancedMode) return all;
        return all.filter(a => !ADVANCED_ONLY_NEXT_STEP_TARGETS.includes(a.target));
    },
    setHealthLastTab(tab) {
        // 'error' | 'warning' | 'recommendation' | 'info'. Persist через subscriber.
        if (typeof tab !== 'string') return;
        store.setUi({ healthLastTab: tab });
    },
    resetAnswers() {
        calc.resetAnswers();
        snackbar.success('Ответы сброшены к значениям по умолчанию');
    },

    /* CRUD ЭК */
    openItemEditor(it)        { itemCtl.openItemEditor(it); },
    deleteItem(id) {
        const calc = store.getState().activeCalc;
        const backup = calc?.dictionaries?.items?.find(i => i.id === id);
        itemCtl.deleteItem(id);
        if (backup) {
            snackbar.showUndoableSnackbar(
                `Элемент «${backup.name}» удалён`,
                () => {
                    itemCtl.saveItem(backup);
                    // После undo проверим, не осталось ли висящих ссылок Q.<id>:
                    // справочник вопросов мог измениться за время snackbar'а.
                    const cur = store.getState().activeCalc;
                    if (cur) {
                        const w = lintFormulas([backup], cur.dictionaries.questions);
                        if (w.length > 0) {
                            snackbar.warning(
                                `Восстановлено, но в формулах ${w.length} висящих ссылок — ` +
                                `проверьте в детализации (кнопка-подсказка рядом со значением).`
                            );
                            return;
                        }
                    }
                    snackbar.success('Восстановлено');
                }
            );
        }
    },
    duplicateItem(id) {
        const newId = itemCtl.duplicateItem(id);
        if (newId) snackbar.success('Элемент дублирован');
    },
    exportItems(triggerEvent) {
        return withLoadingButton(triggerEvent, async () => {
            itemCtl.exportItems();
            snackbar.success('Справочник элементов экспортирован');
        });
    },
    importItems(triggerEvent) {
        return withLoadingButton(triggerEvent, async () => {
            const res = await itemCtl.importItems();
            if (res?.ok) snackbar.success(`Импортировано элементов: ${res.accepted}`);
            else if (res?.reason && res.reason !== 'cancelled') snackbar.error('Импорт не выполнен: ' + (res.message || res.reason));
        });
    },
    exportItemPrices(triggerEvent) {
        return withLoadingButton(triggerEvent, async () => {
            const res = await Promise.resolve(itemCtl.exportItemPrices());
            if (res?.ok) snackbar.success(`Цены экспортированы (${res.count} ЭК)`);
            else if (res?.reason === 'empty') snackbar.warning('Справочник пуст — нечего экспортировать');
            else snackbar.error('Не удалось экспортировать цены');
        });
    },
    importItemPrices(triggerEvent) {
        // Этап 11.2.1: аномалии (× ≥ 10) НЕ применяются автоматически — спрашиваем
        // пользователя через 2-кнопочную confirm-модалку (confirmAsync).
        // Безопасные обновления применяются сразу, до confirm.
        const confirmAnomalies = (anomalies) => {
            const sample = anomalies.slice(0, 10)
                .map(a => `  • ${a.name} (${a.id}): ${a.reason}`)
                .join('\n');
            const more = anomalies.length > 10
                ? `\n  …и ещё ${anomalies.length - 10}`
                : '';
            return ctx.confirmAsync({
                title: `Аномальные цены: ${anomalies.length}`,
                message:
                    `Найдено ${anomalies.length} цен, изменённых более чем в 10×. ` +
                    `Это часто опечатки (лишний ноль, не та запятая). Применить их?\n\n` +
                    sample + more,
                danger: true,
                confirmLabel: 'Применить'
            });
        };

        return withLoadingButton(triggerEvent, () => itemCtl.importItemPrices({ confirmAnomalies }).then(res => {
            if (!res?.ok) {
                if (res?.reason === 'cancelled') return;
                if (res?.reason === 'noActiveCalc') { snackbar.warning(res.message); return; }
                if (res?.reason === 'invalid')     { snackbar.error('Файл не подходит: ' + res.message); return; }
                if (res?.reason === 'parse')       { snackbar.error('Не удалось разобрать CSV: ' + res.message); return; }
                snackbar.error('Импорт не выполнен');
                return;
            }
            // Сводка
            const safeCount = res.safeUpdatesCount ?? 0;
            const anomaliesTotal = res.anomalies?.length ?? 0;
            const anomaliesApplied = res.anomaliesApplied ?? 0;
            const anomaliesSkipped = anomaliesTotal - anomaliesApplied;

            const lines = [];
            lines.push(`Файл: ${res.fileName}`);
            lines.push(`Обновлено цен: ${res.updatesCount}` +
                (anomaliesApplied > 0 ? ` (включая аномалий: ${anomaliesApplied})` : ''));
            lines.push(`Без изменений: ${res.unchanged}`);
            if (res.rejected?.length) lines.push(`Отклонено строк: ${res.rejected.length}`);
            if (anomaliesSkipped > 0) {
                lines.push(`Аномальные изменения, не применены (отказ пользователя): ${anomaliesSkipped}`);
            }
            const anomaliesText = anomaliesSkipped > 0
                ? '\n\nАНОМАЛЬНЫЕ ИЗМЕНЕНИЯ (НЕ применены — пользователь отказался):\n' +
                  res.anomalies.slice(0, 10).map(a => `  • ${a.name} (${a.id}): ${a.reason}`).join('\n') +
                  (res.anomalies.length > 10 ? `\n  …и ещё ${res.anomalies.length - 10}` : '')
                : '';
            const rejectedText = res.rejected?.length
                ? '\n\nОТКЛОНЁННЫЕ СТРОКИ:\n' +
                  res.rejected.slice(0, 10).map(r => `  • строка ${r.rowIndex}${r.id ? ` (${r.id})` : ''}: ${r.reason}`).join('\n') +
                  (res.rejected.length > 10 ? `\n  …и ещё ${res.rejected.length - 10}` : '')
                : '';
            const summary = lines.join('\n') + anomaliesText + rejectedText;
            // Если есть пропущенные аномалии или отклонения — показываем модалку, иначе только snackbar.
            if (anomaliesSkipped > 0 || res.rejected?.length) {
                store.openModal('message', {
                    title: anomaliesSkipped > 0
                        ? 'Импорт цен — аномалии пропущены'
                        : 'Импорт цен — есть отклонённые строки',
                    message: summary
                });
            }
            if (res.updatesCount > 0) {
                snackbar.success(`Обновлено цен: ${res.updatesCount}` +
                    (anomaliesApplied > 0 ? ` (вкл. аномалий: ${anomaliesApplied})` : ''));
            } else if (anomaliesSkipped > 0 && safeCount === 0) {
                snackbar.info('Аномальные цены не применены');
            } else if (res.unchanged > 0) {
                snackbar.info('Цены в файле совпадают с текущими — обновлять нечего');
            }
        }));
    },

    /* CRUD вопросов */
    openQuestionEditor(q)     { questionCtl.openQuestionEditor(q); },
    deleteQuestion(id) {
        const calc = store.getState().activeCalc;
        const backup = calc?.dictionaries?.questions?.find(q => q.id === id);
        const backupAnswer = calc?.answers?.[id];
        if (!backup) return;

        const usages = findQuestionUsages(id, calc.dictionaries.items);

        const proceed = () => {
            questionCtl.deleteQuestion(id);
            snackbar.showUndoableSnackbar(
                `Вопрос «${backup.title}» удалён`,
                () => {
                    questionCtl.saveQuestion(backup);
                    if (backupAnswer !== undefined) {
                        const cur = store.getState().activeCalc;
                        if (cur) store.updateActiveCalc({
                            answers: { ...cur.answers, [id]: backupAnswer }
                        });
                    }
                    snackbar.success('Восстановлено');
                }
            );
        };

        if (usages.length === 0) {
            proceed();
            return;
        }

        // Есть формулы, ссылающиеся на этот вопрос — предупреждаем явно.
        const lines = usages.slice(0, 8).map(u => `  • ${u.itemName} (${u.stand})`).join('\n');
        const more = usages.length > 8 ? `\n  … и ещё ${usages.length - 8}` : '';
        ctx.confirm({
            title: 'Вопрос используется в формулах',
            message:
                `На вопрос «${backup.title}» (id=${id}) ссылаются формулы ` +
                `следующих элементов конфигурации:\n\n${lines}${more}\n\n` +
                `После удаления Q.${id} будет возвращать 0, что приведёт к занижению qty в этих формулах.\n` +
                `Удалить вопрос всё равно?`,
            danger: true,
            confirmLabel: 'Удалить',
            onConfirm: proceed
        });
    },
    duplicateQuestion(id) {
        const newId = questionCtl.duplicateQuestion(id);
        if (newId) snackbar.success('Вопрос дублирован');
    },
    exportQuestions(triggerEvent) {
        return withLoadingButton(triggerEvent, async () => {
            questionCtl.exportQuestions();
            snackbar.success('Справочник вопросов экспортирован');
        });
    },
    importQuestions(triggerEvent) {
        return withLoadingButton(triggerEvent, async () => {
            const res = await questionCtl.importQuestions();
            if (res?.ok) snackbar.success(`Импортировано вопросов: ${res.accepted}`);
            else if (res?.reason && res.reason !== 'cancelled') snackbar.error('Импорт не выполнен: ' + (res.message || res.reason));
        });
    },

    /* Сравнение расчётов */
    addComparisonId(id)        { store.addComparisonId(id); },
    removeComparisonId(id)     { store.removeComparisonId(id); },
    clearComparison()          { store.setComparisonIds([]); },
    /* 12.U28: toggle категории-аккордеона в объединённой таблице «Сравнение».
     * Хранится как массив СВЁРНУТЫХ category-id в state.ui.comparisonCollapsedCats.
     * Дефолт null = ВСЕ категории с items свёрнуты — UI на лету разворачивает массив
     * (`presentCats` минус та, которую раскрыли). При повторном клике категория снова
     * сворачивается. Persist через subscriber → STORAGE_KEYS.COMPARISON_COLLAPSED_CATS.
     *
     * `presentCats` — список category-id с непустыми списками items в выбранных
     * для сравнения расчётах. Используется только при первой инициализации из null. */
    toggleComparisonCategory(catId, presentCats = null) {
        const current = store.getState().ui.comparisonCollapsedCats;
        let next;
        if (current === null) {
            const all = Array.isArray(presentCats) ? presentCats : [];
            next = all.filter(c => c !== catId);
        } else if (current.includes(catId)) {
            next = current.filter(c => c !== catId);
        } else {
            next = [...current, catId];
        }
        store.setUi({ comparisonCollapsedCats: next });
    },
    /* 12.U29: toggle категории-аккордеона во вкладке «Элементы конфигурации».
     * Хранится как массив СВЁРНУТЫХ category-id в state.ui.itemsCollapsedCats.
     * Дефолт null = ВСЕ категории свёрнуты — UI на лету разворачивает массив
     * (presentCats минус та, которую раскрыли). При повторном клике категория
     * снова сворачивается. Persist через subscriber → STORAGE_KEYS.ITEMS_COLLAPSED_CATS.
     *
     * `presentCats` — список category-id с непустыми списками items в текущей
     * выборке (с учётом фильтра поиска). Используется только при первой
     * инициализации массива из null. */
    toggleItemsCategory(catId, presentCats = null) {
        const current = store.getState().ui.itemsCollapsedCats;
        let next;
        if (current === null) {
            const all = Array.isArray(presentCats) ? presentCats : [];
            next = all.filter(c => c !== catId);
        } else if (current.includes(catId)) {
            next = current.filter(c => c !== catId);
        } else {
            next = [...current, catId];
        }
        store.setUi({ itemsCollapsedCats: next });
    },
    /* 12.U29: toggle секции-аккордеона во вкладке «Вопросы».
     * Хранится как массив СВЁРНУТЫХ section-id в state.ui.questionsCollapsedSecs.
     * Дефолт null = ВСЕ секции свёрнуты. Симметрично itemsCategory выше. */
    toggleQuestionsSection(sectionId, presentSecs = null) {
        const current = store.getState().ui.questionsCollapsedSecs;
        let next;
        if (current === null) {
            const all = Array.isArray(presentSecs) ? presentSecs : [];
            next = all.filter(s => s !== sectionId);
        } else if (current.includes(sectionId)) {
            next = current.filter(s => s !== sectionId);
        } else {
            next = [...current, sectionId];
        }
        store.setUi({ questionsCollapsedSecs: next });
    },
    exportComparisonCsv(triggerEvent) {
        const ids = store.getState().comparisonIds || [];
        if (ids.length === 0) { snackbar.warning('Нечего экспортировать'); return; }
        return withLoadingButton(triggerEvent, async () => {
            const [{ calculate }, csvMod, persistMod] = await Promise.all([
                import('./domain/calculator.js'),
                import('./services/csvExport.js'),
                import('./state/persistence.js')
            ]);
            const calcs = ids.map(i => persistMod.loadCalc(i)).filter(Boolean);
            if (calcs.length === 0) return;
            const content = csvMod.buildComparisonCsv(calcs, calcs.map(c => calculate(c)));
            csvMod.downloadCsv(csvMod.buildComparisonCsvFilename(), content);
            snackbar.success('Сравнение экспортировано');
        });
    },

    /* Модалки */
    closeModal(name)          { store.closeModal(name); },
    openHelp()                { store.openModal('help'); },
    openReset()               { store.openModal('reset'); },
    openFormula(itemId)       { store.openModal('formula', { itemId }); },
    input(opts)               { store.openModal('input', { draft: opts.defaultValue ?? '', ...opts }); },
    /**
     * Патч полезной нагрузки открытой модалки (errors, activeSubTab и т.п.).
     * Используется UI-модалками вместо прямого импорта store — слой ui ↛ state.
     */
    patchModal(name, patch)   { store.patchModal(name, patch); },
    /**
     * Слияние патча с текущим draft модалки (UI-модалки правят draft через эту обёртку).
     * Читает актуальный draft из store, чтобы избежать гонок между рендерами.
     */
    patchModalDraft(name, patch) {
        const cur = store.getState().modals[name];
        if (!cur?.open) return;
        store.patchModal(name, { draft: { ...(cur.draft || {}), ...patch } });
    },

    /* Действия модалок (обёртки над контроллерами / state — ui ↛ controllers/state) */
    saveItem(item)            { return itemCtl.saveItem(item); },
    saveQuestion(q)           { return questionCtl.saveQuestion(q); },
    resetToDefaults()         { calcList.resetToDefaults(); },
    /** Загрузить расчёт по id из persistence (для сравнения и т.п.). */
    loadCalcById(id)          { return persist.loadCalc(id); },
    /** Содержимое README.md (Markdown → HTML), кэшируется. */
    loadReadmeHtml()          { return loadReadmeHtml(); },
    confirmAsync(opts) {
        return new Promise(resolve => {
            store.openModal('confirm', {
                ...opts,
                onConfirm: () => resolve(true),
                onCancel: () => resolve(false)
            });
        });
    },
    printPdf(triggerEvent) {
        /* 12.U26-fix: единая кнопка PDF в шапке заменяет дублирующую «Печать
           ответов (PDF)» внизу Опросника. Маршрутизация по активной вкладке:
           - questionnaire → табличный PDF опросника (printAnswers)
           - все остальные → window.print() с print.css (skрытие sidebar/topbar). */
        // 12.U31 (E.4): через storage helpers — graceful fallback в Safari Private.
        if (!loadPdfHintShown()) {
            snackbar.info('В диалоге печати выберите «Сохранить как PDF» в качестве принтера.');
            markPdfHintShown();
        }
        const activeTab = store.getState().activeTab;
        if (activeTab === 'questionnaire') {
            return this.printAnswers(triggerEvent);
        }
        window.print();
    },
    printAnswers(triggerEvent) {
        const calc = store.getState().activeCalc;
        if (!calc) { snackbar.warning('Нет активного расчёта'); return; }
        if (!loadPdfHintShown()) {
            snackbar.info('В диалоге печати выберите «Сохранить как PDF» в качестве принтера.');
            markPdfHintShown();
        }
        /* Этап 13.U4: перед запуском печати спрашиваем формат и ориентацию.
           Modal возвращает { extended, landscape } или null при отмене.
           Esc/X закрывают модалку без печати. */
        return withLoadingButton(triggerEvent, async () => {
            const choice = await new Promise(resolve => {
                store.openModal('printAnswersOptions', {
                    draft: { format: 'compact', landscape: true },
                    onChoose: (selection) => resolve(selection),
                    onCancel: () => resolve(null)  // null = пользователь отменил
                });
            });
            if (!choice) return;  // отмена — печать не запускаем
            const m = await import('./ui/printAnswers.js');
            m.printAnswers(calc, choice);
        });
    },
    /* 13.U6: универсальная обёртка для открытия message-модалки. Используется,
       например, info-кнопками в карточке «Метрики AI / RAG / агентов» — каждая
       метрика и сама секция показывают своё описание через эту обёртку. */
    openMessageModal({ title, message }) {
        store.openModal('message', { title, message });
    },
    openSummaryFormula() {
        store.openModal('message', {
            title: 'Итого по расчёту — что это и как считается',
            message:
                '«Итого по расчёту» — общая стоимость всей инфраструктуры за выбранный период ' +
                '(день / месяц / год). Период переключается кнопками вверху Дашборда.\n\n' +
                'Из чего складывается:\n' +
                '  1. Берутся все элементы конфигурации (vCPU, оперативная память, ' +
                'хранилище, лицензии, трафик, сервисы и т.д.) на всех 5 стендах ' +
                '(DEV, ИФТ, ПСИ, ПРОМ, Нагрузка).\n' +
                '  2. По каждому элементу считается базовая стоимость: ' +
                'количество × цена за единицу × длительность периода.\n' +
                '  3. Базовая стоимость умножается на пять риск-коэффициентов: ' +
                'буферы, инфляция, сезонность, сдвиг расписания, резерв на риски.\n' +
                '  4. Отдельно применяется НДС — это налог, а не риск. Он включается ' +
                'независимым переключателем в Параметрах расчёта и не входит в пилюлю «+X% от базы».\n' +
                '  5. Если включён ai_agent_mode (см. Опросник, раздел AI/LLM), стоимость токенов LLM и ' +
                'количество vCPU sandbox дополнительно умножаются на агентский множитель ×3..×45 ' +
                '(сложность пайплайна × число параллельных специалистов в multi-agent).\n' +
                '  6. Сумма всех получившихся стоимостей и есть «Итого по расчёту».\n\n' +
                'Пилюля «+X% от базы» сверху Hero — это наценка от пяти риск-коэффициентов ' +
                'вместе, без НДС. НДС показан отдельным голубым бейджем рядом.\n\n' +
                'Подробная разбивка:\n' +
                '  • По стендам — 5 карточек снизу.\n' +
                '  • По категориям (Аппаратные ресурсы / Лицензии / Сервисы и т.д.) — ' +
                'центральная карточка «Распределение по категориям ИТОГО».\n' +
                '  • По риск-коэффициентам — карточка справа «Вклад риск-коэффициентов» ' +
                '(там же — детали по каждому коэффициенту во всплывающих подсказках).\n' +
                '  • Постатейно — вкладка «Детализация» в левом меню.'
        });
    },
    openStandDetails() {
        store.setActiveTab('details');
    },
    confirm(opts)             { store.openModal('confirm', opts); },
    refresh()                 { scheduleRender(); }
};

/* ---------- Render scheduler (rAF) ---------- */

let _frameScheduled = false;
function scheduleRender() {
    if (_frameScheduled) return;
    _frameScheduled = true;
    requestAnimationFrame(() => {
        _frameScheduled = false;
        renderApp(store.getState(), ctx);
    });
}

/* ---------- Bootstrapping ---------- */

function boot() {
    mountUi();

    // Загрузить состояние из localStorage
    calcList.initFromStorage();

    // Подписка на изменения store
    let lastPersistStatus  = store.getState().persistStatus;
    let lastActiveTab      = store.getState().activeTab;
    let lastPersistedRev   = store.getState().calcRevision;
    let lastQOpenSections  = store.getState().ui.questionnaireOpenSections;
    let lastQSettingsOpen  = store.getState().ui.questionnaireSettingsOpen;
    let lastQCollapsedSubs = store.getState().ui.questionnaireCollapsedSubgroups;
    let lastComparisonSort = store.getState().ui.comparisonSort;
    let lastStandCats      = store.getState().ui.standCardsCatsExpanded;
    let lastDetailsCats    = store.getState().ui.detailsCollapsedCats;
    let lastCmpCollapsedCats = store.getState().ui.comparisonCollapsedCats;
    let lastItemsCats      = store.getState().ui.itemsCollapsedCats;
    let lastQuestionsSecs  = store.getState().ui.questionsCollapsedSecs;
    let lastTheme          = store.getState().ui.theme;
    let lastProviderOverlayExpanded = store.getState().ui.providerOverlayExpanded;
    let lastHealthLastTab  = store.getState().ui.healthLastTab;
    let lastAdvancedMode   = store.getState().ui.advancedModeEnabled;
    // 12.U33: применяем тему сразу на boot, не дожидаясь первого рендера —
    // иначе flash-of-wrong-theme при F5 в светлой теме (страница вспыхивает тёмной).
    applyThemeAttribute(lastTheme);
    // Когда после save'а проходит debounce и persistStatus → 'saved', пересчитываем
    // calcList: сортировка по updatedAt, обновление totalMonthly и applyRiskFactors
    // в карточке. Иначе порядок и сумма в Расчётах остаются устаревшими до F5.
    const refreshAfterSave = debounce(() => {
        calcList.refreshCalcList();
    }, CALC_LIST_REFRESH_DEBOUNCE_MS);
    store.subscribe(state => {
        scheduleRender();
        // Уведомление об ошибках сохранения — реактивно через snackbar.
        if (state.persistStatus !== lastPersistStatus) {
            if (state.persistStatus === 'error' && lastPersistStatus !== 'error') {
                snackbar.error(state.persistMessage || 'Не удалось сохранить расчёт');
            }
            // После успешного save (saved) — обновить карточки в списке Расчётов.
            if (state.persistStatus === 'saved' && lastPersistStatus !== 'saved') {
                refreshAfterSave();
            }
            lastPersistStatus = state.persistStatus;
        }
        // Persist активной вкладки — чтобы при F5 пользователь оставался на той же странице.
        if (state.activeTab !== lastActiveTab) {
            persist.saveActiveTab(state.activeTab);
            lastActiveTab = state.activeTab;
        }
        // Persist accordion-состояний опросника (12.U1).
        const qOpen = state.ui.questionnaireOpenSections;
        if (qOpen !== lastQOpenSections && Array.isArray(qOpen)) {
            persist.saveQuestionnaireOpenSections(qOpen);
            lastQOpenSections = qOpen;
        }
        const qSettings = state.ui.questionnaireSettingsOpen;
        if (qSettings !== lastQSettingsOpen && typeof qSettings === 'boolean') {
            persist.saveQuestionnaireSettingsOpen(qSettings);
            lastQSettingsOpen = qSettings;
        }
        // Stage 6.2.B (PATCH 2.4.23): persist свёрнутых подгрупп.
        const qCollapsedSubs = state.ui.questionnaireCollapsedSubgroups;
        if (qCollapsedSubs !== lastQCollapsedSubs
            && qCollapsedSubs && typeof qCollapsedSubs === 'object') {
            persist.saveQuestionnaireCollapsedSubgroups(qCollapsedSubs);
            lastQCollapsedSubs = qCollapsedSubs;
        }
        // Persist сортировки сравнения (12.U25) — переживает F5.
        const cmpSort = state.ui.comparisonSort;
        if (cmpSort !== lastComparisonSort) {
            persist.saveComparisonSort(cmpSort);
            lastComparisonSort = cmpSort;
        }
        // Persist раскрытых «По категориям» в стенд-карточках (12.U25-fix-17).
        const standCats = state.ui.standCardsCatsExpanded;
        if (standCats !== lastStandCats && Array.isArray(standCats)) {
            persist.saveStandCardsCatsExpanded(standCats);
            lastStandCats = standCats;
        }
        // Persist свёрнутых категорий «Детализации» (12.U27).
        const detailsCats = state.ui.detailsCollapsedCats;
        if (detailsCats !== lastDetailsCats && Array.isArray(detailsCats)) {
            persist.saveDetailsCollapsedCats(detailsCats);
            lastDetailsCats = detailsCats;
        }
        // Persist свёрнутых категорий объединённой таблицы «Сравнение» (12.U28).
        const cmpCats = state.ui.comparisonCollapsedCats;
        if (cmpCats !== lastCmpCollapsedCats && Array.isArray(cmpCats)) {
            persist.saveComparisonCollapsedCats(cmpCats);
            lastCmpCollapsedCats = cmpCats;
        }
        // Persist свёрнутых категорий вкладки «Элементы конфигурации» (12.U29).
        const itemsCats = state.ui.itemsCollapsedCats;
        if (itemsCats !== lastItemsCats && Array.isArray(itemsCats)) {
            persist.saveItemsCollapsedCats(itemsCats);
            lastItemsCats = itemsCats;
        }
        // Persist свёрнутых секций вкладки «Вопросы» (12.U29).
        const questionsSecs = state.ui.questionsCollapsedSecs;
        if (questionsSecs !== lastQuestionsSecs && Array.isArray(questionsSecs)) {
            persist.saveQuestionsCollapsedSecs(questionsSecs);
            lastQuestionsSecs = questionsSecs;
        }
        // 12.U33: тема — применяем атрибут на <html> и сохраняем в storage.
        // applyThemeAttribute идемпотентен; persist через writeJson (graceful).
        const theme = state.ui.theme;
        if (theme !== lastTheme) {
            applyThemeAttribute(theme);
            persist.saveTheme(theme);
            lastTheme = theme;
        }
        // 14.U9: persist раскрытости сводки тарифов overlay в Опроснике.
        const providerOverlayExpanded = state.ui.providerOverlayExpanded;
        if (providerOverlayExpanded !== lastProviderOverlayExpanded
            && typeof providerOverlayExpanded === 'boolean') {
            persist.saveProviderOverlayExpanded(providerOverlayExpanded);
            lastProviderOverlayExpanded = providerOverlayExpanded;
        }
        // Stage 15.1: persist последней открытой вкладки severity в модалке Health.
        const healthLastTab = state.ui.healthLastTab;
        if (healthLastTab !== lastHealthLastTab && typeof healthLastTab === 'string') {
            persist.saveHealthLastTab(healthLastTab);
            lastHealthLastTab = healthLastTab;
        }
        // Stage 17.2 Phase 3c: persist режима «Расширенные настройки».
        const advancedMode = state.ui.advancedModeEnabled;
        if (advancedMode !== lastAdvancedMode && typeof advancedMode === 'boolean') {
            persist.saveAdvancedModeEnabled(advancedMode);
            lastAdvancedMode = advancedMode;
        }
        // Защита от бесконечного цикла: refreshCalcList сам делает store.setCalcList
        // → новый rev — НЕ триггерит persistStatus, поэтому всё ОК.
        lastPersistedRev = state.calcRevision;
    });

    // Глобальные горячие клавиши
    bindHotkeys();

    // Stage 11.1: cross-tab listener — реагируем на изменения провайдер-стораджа
    // в других вкладках (locks, overrides). В node-окружении (тесты) — no-op.
    startCrossTabSync(store);

    // Stage 11.2: subscriber, который следит за derived state (locks/updated)
    // и показывает toast'ы. Передаём snackbar-namespace целиком; helper сам
    // выбирает .info / .success в зависимости от события.
    subscribeCrossTabNotifier(store, snackbar);

    // Первый рендер
    scheduleRender();

    // Глобальная обработка ошибок (для безопасной диагностики)
    window.addEventListener('error', e => {
        console.error('Unhandled error:', e.error);
        snackbar.error('Произошла внутренняя ошибка. Подробности — в консоли (F12).');
    });

    // Этап 11.1.3 + 12.U25-fix-11: при закрытии вкладки/окна — сброс отложенного
    // автосейва. `beforeunload` ненадёжен (особенно при Cmd+Q/закрытии окна
    // через X-кнопку, в bfcache, на мобильных). Добавлены `pagehide` и
    // `visibilitychange` (state='hidden') — спецификация прямо рекомендует их
    // как современную замену beforeunload для автосейв-сценариев. flush —
    // идемпотентный no-op при пустой очереди, дублирующие вызовы безопасны.
    const flushOnExit = () => flushPendingCommit();
    window.addEventListener('beforeunload', flushOnExit);
    window.addEventListener('pagehide', flushOnExit);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushOnExit();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
    boot();
}
