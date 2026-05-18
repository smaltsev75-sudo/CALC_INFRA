/**
 * Управление активным расчётом: настройки, ответы, синхронизация в localStorage.
 */

import { store } from '../state/store.js';
import { debounce } from '../utils/debounce.js';
import { RECALC_DEBOUNCE_MS } from '../utils/constants.js';
import { commitActiveCalc } from '../services/calcPersistence.js';
import { SEED_QUESTIONS } from '../domain/seed.js';
import { wizardToAnswers } from '../domain/wizardProfiles.js';
import {
    syncActiveScenarioFromRoot,
    syncRootFromActiveScenario,
    buildScenarioFromRoot,
    addScenario as _addScenario,
    duplicateScenario as _duplicateScenario,
    deleteScenario as _deleteScenario,
    renameScenario as _renameScenario,
    switchScenario as _switchScenario
} from '../domain/scenarios.js';
import { getVatRateForDate, isoDateOf, todayIso } from '../domain/vatRateTable.js';

const _persistDebounced = debounce(() => {
    const calc = store.getState().activeCalc;
    /* best-effort: debounced autosave — следующий тик повторит запись;
     * commitActiveCalc на сбое поднимает persistStatus='error' через ядро. */
    if (calc) commitActiveCalc(calc);
}, RECALC_DEBOUNCE_MS);

/* Sprint 3.0 Stage 1: перед каждой записью в localStorage зеркалим root →
   scenarios[active]. Любая правка answers/wizard/answersMeta идёт через
   commit(), значит mirror автоматически держится в актуальном состоянии,
   и persist пишет согласованный snapshot. */
function syncActiveScenarioBeforePersist() {
    const calc = store.getState().activeCalc;
    if (!calc) return;
    if (!Array.isArray(calc.scenarios) || !calc.activeScenarioId) return;
    const synced = syncActiveScenarioFromRoot(calc);
    /* syncActiveScenarioFromRoot возвращает тот же объект если ничего не
       изменилось (no-op), иначе — новый calc с обновлённым scenarios массивом.
       Сравниваем сами scenarios — они referentially изменены при апдейте. */
    if (synced.scenarios !== calc.scenarios) {
        store.updateActiveCalc({ scenarios: synced.scenarios });
    }
}

function commit() {
    syncActiveScenarioBeforePersist();
    // Помечаем «pending» при любом новом изменении — даже если предыдущий
    // статус был 'saved' или 'error', пользователь должен видеть, что приложение
    // снова сохраняет, а не показывать стэйл-индикатор.
    if (store.getState().persistStatus !== 'pending') {
        store.setPersistStatus('pending');
    }
    _persistDebounced();
}

/**
 * Этап 11.1.3: принудительно выполнить отложенный автосейв.
 * Вызывается из app.js на `beforeunload`, чтобы при закрытии вкладки
 * последние правки не потерялись из-за незавершённого debounce-таймера.
 * Если pending-вызова нет — no-op.
 */
export function flushPendingCommit() {
    _persistDebounced.flush();
}

/* ---------- Ответы на вопросы ---------- */

/**
 * 12.U8: индекс актуальных dependsOn по id вопроса. Существующие расчёты в
 * localStorage могли быть созданы до того, как dependsOn появился в seed —
 * читаем как из dictionary, так и из канонического SEED как fallback.
 */
const SEED_DEPS_BY_ID = new Map(SEED_QUESTIONS.map(q => [q.id, q.dependsOn]));

function getDependsOn(q) {
    return q?.dependsOn ?? SEED_DEPS_BY_ID.get(q?.id);
}

/**
 * 12.U8: каскадно собрать id вопросов, зависящих от данного master'а. Учитывает
 * многоуровневые зависимости (RAG-параметры зависят от LLM И от RAG → если
 * выключаем LLM, RAG-параметры тоже должны быть сброшены, потому что rag_needed
 * становится falsy → его собственные зависимые тоже теряют смысл).
 */
function collectCascadeDependents(masterId, questions, visited = new Set()) {
    if (visited.has(masterId)) return [];
    visited.add(masterId);
    const direct = [];
    for (const q of questions) {
        if (q.id === masterId) continue;
        const deps = getDependsOn(q);
        if (Array.isArray(deps) && deps.includes(masterId)) {
            direct.push(q.id);
        }
    }
    const all = [...direct];
    for (const depId of direct) {
        all.push(...collectCascadeDependents(depId, questions, visited));
    }
    return all;
}

/**
 * 12.U18: для dau_share_of_registered_percent — hard clamp 0.1..100 + детекция
 * аномальных значений. Возвращает { clamped, anomaly?: { level, message } } для
 * вызывающего (app.js) — он покажет snackbar/warning. Контроллер сам snackbar
 * не вызывает (layer-purity: controllers → ui это нарушение).
 */
function validateDauShare(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return { clamped: 5, anomaly: null };
    /* Hard clamp: > 0% и ≤ 100%. Невозможно иметь 0% активных (тогда и регистрироваться
       незачем) или > 100% (DAU не может быть больше зарегистрированных). */
    if (num <= 0) return { clamped: 0.1, anomaly: { level: 'warn',
        message: 'Доля DAU не может быть 0 или отрицательной — установлено 0.1%. Если у вас правда «спящая» база, оставьте 1-3%.' } };
    if (num > 100) return { clamped: 100, anomaly: { level: 'warn',
        message: 'Доля DAU не может превышать 100% (это значило бы, что активных в день БОЛЬШЕ, чем зарегистрировано) — установлено 100%.' } };
    /* Soft anomaly: предупреждение, но значение принимаем как есть.
       < 1%: «спящая» база, типично для зарегистрировались-ради-купона.
       > 50%: уровень мессенджеров/соцсетей (TikTok, WhatsApp, VK).
       > 80%: практически невозможно — DAU/MAU = 80% считается top-tier engagement даже у Telegram. */
    if (num > 80) return { clamped: num, anomaly: { level: 'warn',
        message: `Доля DAU = ${num.toFixed(1)}% — нереалистично высокая. Даже у Telegram/WhatsApp ≈ 50%. Проверьте: возможно, путаете DAU с total registered.` } };
    if (num > 50) return { clamped: num, anomaly: { level: 'info',
        message: `Доля DAU = ${num.toFixed(1)}% — очень высокая. Это уровень мессенджеров/соцсетей (TikTok, WhatsApp). Для SaaS/e-commerce обычно 5-30%.` } };
    if (num < 1)  return { clamped: num, anomaly: { level: 'info',
        message: `Доля DAU = ${num.toFixed(2)}% — очень низкая. Подходит для «спящих» баз (зарегистрировались ради купона). Для активного продукта ожидается 5%+.` } };
    return { clamped: num, anomaly: null };
}

/**
 * Установить ответ. Возвращает { anomaly } если значение прошло validation
 * с предупреждением — UI-слой показывает snackbar. Без anomaly — undefined.
 */
export function setAnswer(questionId, value) {
    const calc = store.getState().activeCalc;
    if (!calc) return;

    /* 12.U18: специальная валидация для dau_share_of_registered_percent. */
    let result = { anomaly: null };
    let actualValue = value;
    if (questionId === 'dau_share_of_registered_percent' && value !== null && value !== '' && value !== undefined) {
        const v = validateDauShare(value);
        actualValue = v.clamped;
        result.anomaly = v.anomaly;
    }

    const answers = { ...calc.answers, [questionId]: actualValue };

    // 14.U2: трекинг происхождения ответа. Любой вызов setAnswer = пользовательская
    // правка → source='manual'. Wizard заполняет answersMeta напрямую через
    // wizardToAnswers (минуя setAnswer). UI-бейдж рядом с полем читает meta.source
    // и показывает «Из профиля» / «Из масштаба» / «Вы изменили» и т.д.
    const answersMeta = { ...(calc.answersMeta || {}) };
    const isEmptyValue = actualValue === null || actualValue === '' ||
        (Array.isArray(actualValue) && actualValue.length === 0);
    if (isEmptyValue) {
        // Пустое значение → бейдж рядом с пустым полем бессмыслен. Очищаем meta.
        delete answersMeta[questionId];
    } else {
        answersMeta[questionId] = { source: 'manual' };
    }

    // 12.U8: при выключении master-toggle (boolean false) — каскадно сбрасываем
    // зависимые поля в null. Это чистит «мёртвые» данные: если пользователь
    // выключает LLM, заполненные ai_users_share / ai_model_tier и т.д. больше
    // не имеют смысла. null = «Не знаю» → калькулятор использует defaultIfUnknown,
    // UI показывает поле приглушённым с активной «Не знаю» пилюлей.
    if (actualValue === false || isEmptyValue) {
        const questions = calc.dictionaries?.questions || [];
        const dependents = collectCascadeDependents(questionId, questions);
        for (const depId of dependents) {
            answers[depId] = null;
            // 14.U2: cascade-сброс — поле возвращается в seed-default состояние.
            // Бейджа нет (точно так же, как у непосещённых полей).
            delete answersMeta[depId];
        }
    }

    // 13.U10: симметричный кейс — при ВКЛЮЧЕНИИ master-toggle (boolean true)
    // восстанавливаем seed-defaults у зависимых полей, которые сейчас
    // null/undefined (результат предыдущего каскадного сброса или никогда
    // не задавались). Без этого включение master не «оживляет» формулы:
    // числовые поля остаются null → toNum даёт 0 → формула × 0 = 0.
    // Реальный кейс: пользователь включил ai_agent_mode, но
    // agent_tool_use_share / agent_tool_avg_seconds остались null → AGENT_CPU
    // показывал 0 на всех стендах при «всё вроде включено» в Опроснике.
    // Восстанавливаем ТОЛЬКО пустые поля — введённые пользователем значения
    // не трогаем.
    if (actualValue === true) {
        const questions = calc.dictionaries?.questions || [];
        const dependents = collectCascadeDependents(questionId, questions);
        const qById = new Map(questions.map(q => [q.id, q]));
        for (const depId of dependents) {
            if (answers[depId] !== null && answers[depId] !== undefined) continue;
            const dq = qById.get(depId);
            if (dq && dq.defaultValue !== undefined && dq.defaultValue !== null) {
                answers[depId] = dq.defaultValue;
                // 14.U2: автоматический seed-default — без meta (нет бейджа).
                delete answersMeta[depId];
            }
        }
    }

    store.updateActiveCalc({ answers, answersMeta });
    store.setUi({ recentlyChangedKey: `answer:${questionId}` });
    commit();
    return result;
}

/**
 * 14.U5: Re-apply профиля. Перезапускает wizardToAnswers по сохранённому
 * calc.wizard и мерджит с текущими answers по выбранному режиму.
 *
 * @param {'preserve'|'overwrite'} mode
 *   - 'preserve' — сохранить ручные правки (поля с answersMeta[id].source==='manual'
 *      остаются с прежними значениями и meta='manual'); остальные поля переписываются
 *      из wizard'а с новой meta (profile/scale/derived/...).
 *   - 'overwrite' — все поля переписываются из wizard'а; manual-метки удаляются.
 *
 * Что НЕ трогается:
 *   - calc.settings.* (включая provider и providerSetByWizard) — settings не входят
 *     в wizardToAnswers, это глобальные настройки расчёта.
 *   - calc.wizard сам — остаётся как «снимок исходных параметров». Если wizard
 *     поменялся (через QS edit-mode), вызов сюда уже идёт с новым snapshot'ом
 *     (calcListController.applyWizardChanges обновляет calc.wizard перед reapply).
 *
 * Stage 4.5 — per-scenario семантика:
 *   Re-apply работает на root-уровне (calc.wizard / calc.answers / calc.answersMeta),
 *   но через mirror-pattern (commit() → syncActiveScenarioFromRoot) изменения
 *   применяются ТОЛЬКО к активному scenario. Другие сценарии не затрагиваются —
 *   их answers/answersMeta остаются нетронутыми в `calc.scenarios[other]`.
 *
 *   preserve в режиме multi-scenario:
 *     - Если у пользователя 2 сценария «A» и «B», в A есть manual override на
 *       peak_rps, в B — нет.
 *     - Switch на B → reapplyProfile('preserve') → meta из B (без manual'а на
 *       peak_rps) — поэтому wizard перезапишет peak_rps от scratch. Это OK.
 *     - Switch обратно на A → root перезагружается из scenarios[A] через
 *       syncRootFromActiveScenario. peak_rps в A сохранён с meta='manual'.
 *     - Каждый scenario «помнит» свои manual-метки независимо.
 *
 * Возвращает { changed: number } — сколько полей фактически изменилось (для snackbar).
 * No-op (без изменений) если calc.wizard === null (расчёт без profile'а).
 */
export function reapplyProfile(mode = 'preserve') {
    const calc = store.getState().activeCalc;
    if (!calc || !calc.wizard) return { changed: 0 };
    return _doReapply(calc, mode);
}

function _doReapply(calc, mode) {
    const { answers: wizAnswers, meta: wizMeta } = wizardToAnswers(calc.wizard);

    const oldAnswers = calc.answers || {};
    const oldMeta    = calc.answersMeta || {};

    const newAnswers = { ...oldAnswers, ...wizAnswers };
    const newMeta    = { ...wizMeta };

    let changed = 0;
    if (mode === 'preserve') {
        /* Возвращаем manual-поля поверх wizard'а: значения и метку 'manual'.
           Поля, которые wizard не задаёт, остаются от oldAnswers (они уже в newAnswers
           через spread). Поля, у которых wizard задал NEW значение, но meta был
           'manual' — оставляем старое. */
        for (const [id, m] of Object.entries(oldMeta)) {
            if (m && m.source === 'manual') {
                newAnswers[id] = oldAnswers[id];
                newMeta[id] = { source: 'manual' };
            }
        }
    }
    /* В режиме 'overwrite' newMeta = wizMeta — manual-метки удалены, как и просили. */

    /* Подсчёт реально изменённых полей (для snackbar «Применено N изменений»). */
    for (const id of new Set([...Object.keys(oldAnswers), ...Object.keys(newAnswers)])) {
        if (oldAnswers[id] !== newAnswers[id]) changed++;
    }

    store.updateActiveCalc({ answers: newAnswers, answersMeta: newMeta });
    commit();
    return { changed };
}

export function resetAnswers() {
    const calc = store.getState().activeCalc;
    if (!calc) return;
    const answers = {};
    for (const q of calc.dictionaries.questions) {
        if (q.defaultValue !== undefined && q.defaultValue !== null) {
            answers[q.id] = q.defaultValue;
        } else if (q.type === 'boolean') answers[q.id] = false;
        else if (q.type === 'multiselect') answers[q.id] = [];
        else if (q.type === 'number') answers[q.id] = 0;
    }
    // 14.U2: сброс ответов = сброс происхождения. Все поля возвращаются в seed-state,
    // бейджи «Из профиля / масштаба / Вы изменили» исчезают.
    store.updateActiveCalc({ answers, answersMeta: {} });
    commit();
}

/* ---------- Настройки ---------- */

export function setSetting(key, value) {
    const calc = store.getState().activeCalc;
    if (!calc) return;
    const settings = { ...calc.settings, [key]: value };
    store.updateActiveCalc({ settings });
    store.setUi({ recentlyChangedKey: `setting:${key}` });
    commit();
}

/**
 * 14.U4: атомарно обновить provider + сбросить providerSetByWizard в false.
 * Любая ручная правка через dropdown в Опроснике = source 'manual' → бейдж
 * «Вы изменили». Wizard-flag поднимается в true только при createCalcFromWizard
 * (calcListController) или при re-apply профиля (Sprint 2.2 пункт 5 / 14.U5).
 *
 * Граничные:
 *   value не строка / пустое → no-op (валидация на уровне UI должна не пускать).
 *   calc=null → no-op.
 */
export function setProvider(value) {
    const calc = store.getState().activeCalc;
    if (!calc) return;
    if (typeof value !== 'string' || !value) return;
    const settings = { ...calc.settings, provider: value, providerSetByWizard: false };
    store.updateActiveCalc({ settings });
    store.setUi({ recentlyChangedKey: 'setting:provider' });
    commit();
}

/**
 * 12.U12: атомарно обновить per-resource множитель размера стенда.
 * Структура: settings.resourceRatio = { STAND: { CPU, GPU, RAM, SSD, HDD, S3 } }.
 * Глубокий immutable update — клонируем ВСЁ дерево resourceRatio + тронутый
 * stand-объект, чтобы deepFreeze в store не споткнулся о попытку мутации.
 * PROD НЕ должен меняться — эталон фиксированно 1.00; вызывающий UI это
 * соблюдает (поля для PROD не рендерятся), но на всякий случай молча игнорим.
 */
export function setResourceRatio(stand, resource, value) {
    const calc = store.getState().activeCalc;
    if (!calc) return;
    if (stand === 'PROD') return;  // PROD = эталон, неизменяем.
    if (!Number.isFinite(value)) return;
    /* Инвариант «стенд ≤ ПРОМ»: per-resource ratio в [0, 1]. PROD = 1.00 эталон,
       любой другой стенд — доля от ПРОМ. Симметрично setAiStandFactor. */
    if (value < 0 || value > 1) return;

    const current = (calc.settings.resourceRatio && typeof calc.settings.resourceRatio === 'object')
        ? calc.settings.resourceRatio
        : {};
    const standMap = { ...(current[stand] || {}) };
    standMap[resource] = value;
    const nextResourceRatio = { ...current, [stand]: standMap };

    const settings = { ...calc.settings, resourceRatio: nextResourceRatio };
    store.updateActiveCalc({ settings });
    store.setUi({ recentlyChangedKey: `setting:resourceRatio.${stand}.${resource}` });
    commit();
}

/* AI-фактор на стенд: правит settings.aiStandFactor[<STAND>] (множитель
   AI-расходов на стенде, 0..1).

   Граничные:
     value < 0     → отвергается (молча, ничего не меняем).
     value > 1     → отвергается.
     stand=PROD    → запрещено (PROD = эталон 1.00); UI сам не рендерит инпут.
     calc=null     → no-op (нет активного расчёта).

   Пример: setAiStandFactor('DEV', 0) — AI на DEV выключен полностью.
   Использование из UI — onInput процентного слайдера в Опросник→AI/LLM. */
export function setAiStandFactor(stand, value) {
    const calc = store.getState().activeCalc;
    if (!calc) return;
    if (stand === 'PROD') return;
    if (!Number.isFinite(value)) return;
    if (value < 0 || value > 1) return;

    const current = (calc.settings.aiStandFactor && typeof calc.settings.aiStandFactor === 'object')
        ? calc.settings.aiStandFactor
        : {};
    const next = { ...current, [stand]: value, PROD: 1.00 };
    const settings = { ...calc.settings, aiStandFactor: next };
    store.updateActiveCalc({ settings });
    store.setUi({ recentlyChangedKey: `setting:aiStandFactor.${stand}` });
    commit();
}

/* ---------- Stage VAT-1 Phase 4: VAT mode controllers ---------- */

/* Allowed VAT modes (см. миграция 16→17 + applyVatResolver). */
const _VAT_MODES = new Set(['auto-by-date', 'manual', 'frozen']);

/* Универсальный atomic-апдейт VAT-полей. Все 4 setters ниже разделяют
   эту запись: получить активный, патчить settings, расставить ui-recently-key,
   commit() — стандартный путь как у setProvider / setResourceRatio. */
function _patchVatSettings(patch, keySuffix) {
    const calc = store.getState().activeCalc;
    if (!calc) return;
    const settings = { ...calc.settings, ...patch };
    store.updateActiveCalc({ settings });
    store.setUi({ recentlyChangedKey: `setting:vat.${keySuffix}` });
    commit();
}

/**
 * Stage VAT-1 Phase 4: переключить режим определения ставки НДС.
 *
 *   - 'auto-by-date': vatRate пересчитывается из справочника по
 *     vatEffectiveDate (или calc.createdAt, или today как fallback).
 *   - 'manual': vatRate сохраняется как есть (явная пользовательская ставка),
 *     vatEffectiveDate обнуляется (manual не привязан к дате).
 *   - 'frozen': vatRate и vatEffectiveDate сохраняются (или today, если был null).
 *
 * Любой invalid mode → silent no-op (соглашение проекта, см. setResourceRatio).
 */
export function setVatRateMode(mode) {
    const calc = store.getState().activeCalc;
    if (!calc) return;
    if (typeof mode !== 'string' || !_VAT_MODES.has(mode)) return;

    const s = calc.settings || {};

    if (mode === 'auto-by-date') {
        /* effectiveDate = текущий vatEffectiveDate || createdAt-day || today. */
        let effective = (typeof s.vatEffectiveDate === 'string' && s.vatEffectiveDate)
            ? s.vatEffectiveDate
            : null;
        if (!effective && typeof calc.createdAt === 'string' && calc.createdAt.length >= 10) {
            effective = isoDateOf(new Date(calc.createdAt));
        }
        if (!effective) effective = todayIso();
        const rate = getVatRateForDate(effective);
        _patchVatSettings({
            vatRateMode: 'auto-by-date',
            vatEffectiveDate: effective,
            /* fallback на текущий rate, если дата вне справочника (rate=null). */
            vatRate: rate !== null ? rate : s.vatRate
        }, 'mode');
        return;
    }

    if (mode === 'manual') {
        _patchVatSettings({
            vatRateMode: 'manual',
            vatEffectiveDate: null
            /* vatRate сохраняется (не передаём в patch). */
        }, 'mode');
        return;
    }

    /* mode === 'frozen' */
    const frozenDate = (typeof s.vatEffectiveDate === 'string' && s.vatEffectiveDate)
        ? s.vatEffectiveDate
        : todayIso();
    _patchVatSettings({
        vatRateMode: 'frozen',
        vatEffectiveDate: frozenDate
        /* vatRate сохраняется. */
    }, 'mode');
}

/**
 * Stage VAT-1 Phase 4: установить дату действия ставки для auto-by-date.
 *
 * Только для mode='auto-by-date'. В manual/frozen — silent no-op (UI это блокирует,
 * но контроллер защищён).
 *
 * Невалидная дата (формат не YYYY-MM-DD, несуществующее число, не покрытое
 * справочником) → silent no-op.
 */
export function setVatEffectiveDate(isoDate) {
    const calc = store.getState().activeCalc;
    if (!calc) return;
    if (calc.settings?.vatRateMode !== 'auto-by-date') return;
    /* Принимаем только строки YYYY-MM-DD или полные ISO. isoDateOf нормализует
       и возвращает null для невалидных. */
    if (typeof isoDate !== 'string') return;
    const normalised = isoDateOf(isoDate);
    if (normalised === null) return;
    const rate = getVatRateForDate(normalised);
    if (rate === null) return;  // дата вне справочника — не применяем, чтобы не оставить null vatRate
    _patchVatSettings({
        vatEffectiveDate: normalised,
        vatRate: rate
    }, 'effectiveDate');
}

/**
 * Stage VAT-1 Phase 4: установить ручную ставку НДС.
 *
 * Принимает долю в диапазоне [0, 1] (например, 0.22 = 22%).
 * UI, передавший 22 вместо 0.22 — отвергается, никакой скрытой
 * нормализации деления на 100: domain хранит долю, контракт явный.
 */
export function setVatRateManual(rate) {
    const calc = store.getState().activeCalc;
    if (!calc) return;
    if (typeof rate !== 'number') return;
    if (!Number.isFinite(rate)) return;
    if (rate < 0 || rate > 1) return;
    _patchVatSettings({
        vatRateMode: 'manual',
        vatRate: rate,
        vatEffectiveDate: null
    }, 'manual');
}

/**
 * Stage VAT-1 Phase 4: заморозить текущую ставку.
 *
 * vatRate НЕ пересчитывается — фиксируется ровно та, что сейчас применяется.
 * vatEffectiveDate сохраняется как есть, либо подставляется today (если был null
 * — например, расчёт был в manual режиме без даты).
 */
export function freezeVatRate() {
    const calc = store.getState().activeCalc;
    if (!calc) return;
    const s = calc.settings || {};
    const frozenDate = (typeof s.vatEffectiveDate === 'string' && s.vatEffectiveDate)
        ? s.vatEffectiveDate
        : todayIso();
    _patchVatSettings({
        vatRateMode: 'frozen',
        vatEffectiveDate: frozenDate
        /* vatRate сохраняется (не передаём в patch). */
    }, 'freeze');
}

/* ---------- /Stage VAT-1 Phase 4 ---------- */

export function setName(name) {
    const calc = store.getState().activeCalc;
    if (!calc) return;
    store.updateActiveCalc({ name: String(name || '').slice(0, 120) });
    commit();
}

/**
 * 12.U30-fix: переключатель стендов (chip-toggle на дашборде/детализации).
 * Хранится per-calc в `calc.view.disabledStands: string[]`. Раньше эта
 * функция жила в app.js и вызывала только store.updateActiveCalc(...) без
 * commit() — изменение НЕ сохранялось в localStorage и сбрасывалось при F5.
 * Теперь — через commit(), как все остальные мутации calc.
 */
export function toggleStand(standId) {
    const calc = store.getState().activeCalc;
    if (!calc) return;
    const current = calc.view?.disabledStands || [];
    const next = current.includes(standId)
        ? current.filter(s => s !== standId)
        : [...current, standId];
    store.updateActiveCalc({ view: { ...(calc.view || {}), disabledStands: next } });
    commit();
}

/* ---------- Поиск (per-tab) ---------- */

export function setSearch(tabId, query) {
    store.setSearchForTab(tabId, query);
}

/* ---------- Тема приложения (12.U33) ---------- */

import { THEME_IDS } from '../utils/constants.js';

/**
 * Установить тему ('dark' | 'light'). Невалидное значение игнорируется
 * (защита от подделки localStorage). Persist через app.js subscriber.
 */
export function setTheme(theme) {
    if (!THEME_IDS.includes(theme)) return;
    store.setUi({ theme });
}

/**
 * Переключить тему dark ↔ light. Текущее значение читаем из state.ui.theme;
 * undefined / неизвестное значение трактуется как 'dark' (DEFAULT_THEME).
 */
export function toggleTheme() {
    const current = store.getState().ui.theme;
    const next = current === 'light' ? 'dark' : 'light';
    setTheme(next);
}

/* ---------- Расширенные настройки (Stage 17.2 Phase 3c) ---------- */

/* Вкладки, доступные только в advancedMode = true. При выключении режима
   на одной из них пользователь перенаправляется на safe-вкладку (см. ниже). */
export const ADVANCED_ONLY_TABS = Object.freeze(['items', 'questions']);

/**
 * Установить режим «Расширенные настройки» (boolean).
 * Не-boolean значения игнорируются (защита от подделки localStorage).
 * Persist через app.js subscriber.
 *
 * Если режим выключается, а пользователь сейчас находится на admin-tab —
 * автоматически переключаем его на safe-вкладку, чтобы не остался невидимый
 * активный таб (Phase 3c §5).
 */
export function setAdvancedMode(enabled) {
    if (typeof enabled !== 'boolean') return;
    store.setUi({ advancedModeEnabled: enabled });
    if (!enabled) {
        const tab = store.getState().activeTab;
        if (ADVANCED_ONLY_TABS.includes(tab)) {
            const fallback = store.getState().activeCalc ? 'questionnaire' : 'calculations';
            store.setActiveTab(fallback);
        }
    }
}

export function toggleAdvancedMode() {
    const current = !!store.getState().ui.advancedModeEnabled;
    setAdvancedMode(!current);
}

/* ---------- Sprint 3.0 Stage 1: Scenario CRUD ---------- */

/* Перед любой scenario-CRUD-операцией снимаем root → активный scenario,
   чтобы исходящие изменения answers/wizard, которые ещё не докатились до
   scenarios через debounced commit, не потерялись при переключении или
   дублировании. После CRUD — обычный commit() запускает persist.

   Bootstrap для legacy: если calc загружен из старого localStorage и ещё не
   прошёл миграцию (нет scenarios[]), создаём scenarios[0] из root прямо здесь.
   После этого producer работает с нормальным multi-scenario calc. Persist
   запишет новый shape, при следующем boot миграция увидит scenarios уже на
   месте и no-op'ит. Это аналог lazy-migration в момент первого CRUD-действия. */
function _withSyncedRoot(producer) {
    const calc = store.getState().activeCalc;
    if (!calc) return null;
    let working = calc;
    if (!Array.isArray(calc.scenarios) || calc.scenarios.length === 0) {
        const seed = buildScenarioFromRoot(calc, { label: 'Базовый' });
        working = { ...calc, scenarios: [seed], activeScenarioId: seed.id };
        store.updateActiveCalc({ scenarios: working.scenarios, activeScenarioId: working.activeScenarioId });
    }
    const synced = syncActiveScenarioFromRoot(working);
    /* synced может быть тем же объектом если scenarios отсутствует или mirror
       уже синхронизирован. producer работает с уже-синхронизированной версией. */
    return producer(synced);
}

/**
 * Добавить новый scenario с пустыми answers и переключиться на него.
 * Для legacy-расчётов без scenarios[] — no-op (но миграция v14→v15 уже
 * гарантирует наличие scenarios[0] на любом активном calc).
 *
 * Возвращает { scenarioId } нового scenario или null если calc отсутствует.
 */
export function addScenario(label) {
    return _withSyncedRoot(calc => {
        if (!Array.isArray(calc.scenarios)) return null;
        const { calc: next, scenario } = _addScenario(calc, label);
        /* Свежий scenario пуст — переключаем на него и подтягиваем root к
           пустым answers. Пользователь начинает редактировать новый сценарий. */
        const switched = { ...next, activeScenarioId: scenario.id };
        const withRoot = syncRootFromActiveScenario(switched);
        store.updateActiveCalc({
            scenarios: withRoot.scenarios,
            activeScenarioId: withRoot.activeScenarioId,
            wizard: withRoot.wizard,
            answers: withRoot.answers,
            answersMeta: withRoot.answersMeta
        });
        commit();
        return { scenarioId: scenario.id };
    });
}

/**
 * Дублировать существующий scenario (по id) и переключиться на копию.
 * Если sourceId не задан — дублирует активный.
 *
 * Stage 4.8: customLabel — пользовательское имя для копии, передаётся из модалки
 * scenarioDuplicate. Если null/пустое — domain подставит default «X (копия)».
 */
export function duplicateScenario(sourceId, customLabel = null) {
    return _withSyncedRoot(calc => {
        if (!Array.isArray(calc.scenarios)) return null;
        const effectiveSourceId = sourceId || calc.activeScenarioId;
        const { calc: next, scenario } = _duplicateScenario(calc, effectiveSourceId, customLabel);
        if (!scenario) return null;
        const switched = { ...next, activeScenarioId: scenario.id };
        const withRoot = syncRootFromActiveScenario(switched);
        store.updateActiveCalc({
            scenarios: withRoot.scenarios,
            activeScenarioId: withRoot.activeScenarioId,
            wizard: withRoot.wizard,
            answers: withRoot.answers,
            answersMeta: withRoot.answersMeta
        });
        commit();
        return { scenarioId: scenario.id };
    });
}

/**
 * Удалить scenario по id. Защита: нельзя удалить последний scenario
 * (UI блокирует кнопку, controller — defensive). Если удаляется активный —
 * активным становится первый из оставшихся, root mirror подтягивается.
 *
 * Возвращает { removed: boolean, newActiveId } или null если calc отсутствует.
 */
export function deleteScenario(scenarioId) {
    return _withSyncedRoot(calc => {
        if (!Array.isArray(calc.scenarios)) return null;
        const { calc: next, removed, newActiveId } = _deleteScenario(calc, scenarioId);
        if (!removed) return { removed: false, newActiveId };
        /* Если удалённый был активным — переключаемся на newActiveId и
           зеркалим. Иначе root остаётся прежним (активный не менялся). */
        const withRoot = calc.activeScenarioId === scenarioId
            ? syncRootFromActiveScenario(next)
            : next;
        store.updateActiveCalc({
            scenarios: withRoot.scenarios,
            activeScenarioId: withRoot.activeScenarioId,
            ...(calc.activeScenarioId === scenarioId
                ? { wizard: withRoot.wizard, answers: withRoot.answers, answersMeta: withRoot.answersMeta }
                : {})
        });
        commit();
        return { removed: true, newActiveId };
    });
}

/** Переименовать scenario (label). No-op если scenarioId не найден или label пустой. */
export function renameScenario(scenarioId, newLabel) {
    return _withSyncedRoot(calc => {
        if (!Array.isArray(calc.scenarios)) return null;
        const next = _renameScenario(calc, scenarioId, newLabel);
        if (next === calc) return { renamed: false };
        store.updateActiveCalc({ scenarios: next.scenarios });
        commit();
        return { renamed: true };
    });
}

/**
 * Переключить активный scenario. Зеркалит scenarios[newId] → root, чтобы
 * calculator.js пересчитал по новым answers. Если scenarioId совпадает с
 * активным или не найден — no-op.
 */
export function switchScenario(scenarioId) {
    return _withSyncedRoot(calc => {
        if (!Array.isArray(calc.scenarios)) return null;
        const next = _switchScenario(calc, scenarioId);
        if (next === calc) return { switched: false };
        store.updateActiveCalc({
            scenarios: next.scenarios,
            activeScenarioId: next.activeScenarioId,
            wizard: next.wizard,
            answers: next.answers,
            answersMeta: next.answersMeta
        });
        commit();
        return { switched: true };
    });
}
