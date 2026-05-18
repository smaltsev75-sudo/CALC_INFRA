/**
 * Управление списком расчётов: создание, открытие, дублирование,
 * переименование, удаление, экспорт/импорт.
 */

import { store } from '../state/store.js';
import * as persist from '../state/persistence.js';
import { uuid } from '../utils/uuid.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS, enrichLegacyDictionaryWithAgentSeed } from '../domain/seed.js';
import { calculate, clearCalculationCache } from '../domain/calculator.js';
import { validateCalculation } from '../domain/validation.js';
import { downloadJson, readJsonFile, pickFile, buildCalcFilename } from '../services/json.js';
import { CURRENT_SCHEMA_VERSION } from '../utils/constants.js';
import { clearReadmeCache } from './helpController.js';
import { migrateCalculation, MigrationError } from '../state/migrations.js';
import { commitNewCalc, commitCalcRename, commitMigratedCalc } from '../services/calcPersistence.js';
import { getTemplateById } from '../domain/templates.js';
import { wizardToAnswers } from '../domain/wizardProfiles.js';
import { buildScenarioFromRoot, syncActiveScenarioFromRoot } from '../domain/scenarios.js';
import { applyVatResolver } from '../domain/vatResolver.js';
import { getVatRateForDate, isoDateOf, getCurrentVatRate } from '../domain/vatRateTable.js';

/* ---------- Внутреннее ---------- */

function makeNewCalculation(name, templateId = null) {
    const dict = (() => {
        const stored = persist.loadDefaultDictionary();
        return stored && stored.items && stored.questions ? stored : buildSeedDictionaries();
    })();
    /* 12.U16: если задан templateId — мерджим answers/settings из шаблона поверх дефолтов.
       Если шаблон не найден (id невалиден) — silent fallback на пустые дефолты. */
    const template = templateId ? getTemplateById(templateId) : null;
    const baseAnswers = defaultAnswersFrom(dict.questions);
    const answers = template ? { ...baseAnswers, ...template.answers } : baseAnswers;
    const settings = template?.settings
        ? { ...SEED_SETTINGS, ...template.settings }
        : { ...SEED_SETTINGS };

    /* Stage VAT-1 Phase 3: новый calc сразу получает auto-by-date режим с
       эффективной датой = createdAt. vatRate взят из справочника на этот день
       (НЕ из module-load DEFAULT_VAT_RATE — иначе при работе приложения
       несколько дней подряд новые расчёты получали бы устаревший today).
       isoDateOf(now) согласован с createdAt — оба получены из одного объекта. */
    const now = new Date();
    const createdAtIso = now.toISOString();
    const vatEffectiveDate = isoDateOf(now);
    const vatRate = getVatRateForDate(vatEffectiveDate);
    /* Template может явно задать свой vatRateMode (например, frozen-бюджет —
       т.е. шаблон уже зафиксирован под определённую ставку). В этом случае
       НЕ перетираем — уважаем шаблон. */
    const templateSpecifiesVat = template?.settings && template.settings.vatRateMode !== undefined;

    const calc = {
        version: '1.0',
        id: uuid(),
        name: name || 'Новый расчёт',
        createdAt: createdAtIso,
        updatedAt: createdAtIso,
        settings: {
            ...settings,
            provider: settings.provider || 'sbercloud',
            /* 14.U4: false для нового расчёта без wizard'а — provider пришёл из
               default settings, не от мастера. createCalcFromWizard ниже
               перезапишет в true. */
            providerSetByWizard: false,
            ...(templateSpecifiesVat ? {} : {
                vatRateMode: 'auto-by-date',
                vatEffectiveDate,
                vatRate
            })
        },
        answers,
        // 14.U1: wizard=null означает «расчёт создан вручную, не через Quick Start».
        // wizardController.createFromWizard() заменит null на объект 7 ответов.
        wizard: null,
        // 14.U1: parallel к answers, описывает источник каждого значения для UI-бейджей.
        // Пустой объект для template/empty-расчётов; наполняется в createFromWizard.
        answersMeta: {},
        // view — настройки отображения, привязанные к конкретному расчёту
        // (передаются вместе с JSON-экспортом).
        view: { disabledStands: [] },
        dictionaries: {
            items: dict.items.map(it => ({ ...it, qtyFormulas: { ...it.qtyFormulas }, applicableStands: [...it.applicableStands] })),
            questions: dict.questions.map(q => ({ ...q, options: q.options ? q.options.map(o => ({ ...o })) : undefined }))
        }
    };
    /* Sprint 3.0 Stage 1: новый calc сразу получает scenarios[0] из root-полей.
       activeScenarioId = id первого scenario. Mirror на root остаётся —
       calculator.js и UI читают calc.answers/wizard/answersMeta напрямую. */
    const scenario = buildScenarioFromRoot(calc, { label: 'Базовый' });
    calc.scenarios = [scenario];
    calc.activeScenarioId = scenario.id;
    return calc;
}

/**
 * 14.U1: создание расчёта через Quick Start Wizard.
 *
 * Берёт 7 ответов wizard'а, прогоняет через `wizardToAnswers`, мерджит в
 * базовый calc + сохраняет originals (calc.wizard) и meta (calc.answersMeta).
 *
 * @param {string} name - название расчёта
 * @param {Object} wizardInput - { product_type, industry, scale, geography, pdn, activity, ai_used }
 * @returns {Object} новый calc
 */
export function createCalcFromWizard(name, wizardInput) {
    const calc = makeNewCalculation(name, null);
    const { answers: wizardAnswers, meta } = wizardToAnswers(wizardInput);
    // Мерджим: wizard-ответы поверх дефолтов опросника.
    calc.answers = { ...calc.answers, ...wizardAnswers };
    calc.answersMeta = meta;
    calc.wizard = { ...wizardInput };  // freeze-snapshot для retroactive перерасчёта
    /* 14.U4: provider у wizard-расчёта пришёл из мастера (default sbercloud),
       UI-бейдж рядом с dropdown показывает «Из мастера» до первой ручной правки. */
    calc.settings = { ...calc.settings, providerSetByWizard: true };
    /* Sprint 3.0 Stage 1: после применения wizard'а на root — синхронизируем
       scenarios[0] (созданный в makeNewCalculation с пустым answers/wizard).
       Без этого scenarios[0] остался бы со старым snapshot-ом до wizard'а,
       и при первом switchScenario root перезатёрся бы пустыми ответами. */
    const synced = syncActiveScenarioFromRoot(calc);
    calc.scenarios = synced.scenarios;
    /* Внешний аудит #3 (2026-05-18, P2): см. createCalc — explicit check. */
    if (!commitNewCalc(calc, { id: calc.id, name: calc.name, updatedAt: calc.updatedAt })) {
        return null;
    }
    persist.saveActiveCalcId(calc.id); // best-effort
    store.setActiveCalc(calc);
    refreshCalcList();
    return calc;
}

/**
 * Перестроить список расчётов: вытащить из localStorage, посчитать totalMonthly у каждого.
 * Каждый расчёт мигрируется на лету; обновлённую версию используем для расчёта totalMonthly.
 */
export function refreshCalcList() {
    const list = persist.loadCalcList();
    const enriched = list.map(meta => {
        const calc = persist.loadCalc(meta.id);
        let totalMonthly = 0;
        let totalAnnual = 0;
        let applyRiskFactors = true;
        let vatEnabled = true;
        let vatRate = getCurrentVatRate();
        let disabledStands = [];
        let scenarioCount = 1;
        if (calc) {
            // Миграция в карточке списка — best-effort: если упала, оставляем
            // дефолты, чтобы один битый расчёт не уронил весь список «Расчёты».
            // Реальную ошибку увидит пользователь, когда попробует открыть calc.
            try {
                const migrated = migrateCalculation(calc);
                enrichLegacyDictionaryWithAgentSeed(migrated);
                try {
                    const r = calculate(migrated);
                    totalMonthly = r.totalMonthly;
                    totalAnnual = r.totalAnnual;
                } catch {
                    totalMonthly = 0;
                    totalAnnual = 0;
                }
                applyRiskFactors = migrated.settings?.applyRiskFactors !== false;
                vatEnabled = migrated.settings?.vatEnabled !== false;
                if (Number.isFinite(migrated.settings?.vatRate)) {
                    vatRate = migrated.settings.vatRate;
                }
                if (Array.isArray(migrated.view?.disabledStands)) {
                    disabledStands = migrated.view.disabledStands.slice();
                }
                if (Array.isArray(migrated.scenarios) && migrated.scenarios.length > 0) {
                    scenarioCount = migrated.scenarios.length;
                }
            } catch {
                totalMonthly = 0;
                totalAnnual = 0;
                applyRiskFactors = true;
            }
        }
        return { ...meta, totalMonthly, totalAnnual, applyRiskFactors, vatEnabled, vatRate, disabledStands, scenarioCount };
    });
    enriched.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    store.setCalcList(enriched);
}

/* ---------- Действия ---------- */

export function createCalc(name, templateId = null) {
    const calc = makeNewCalculation(name, templateId);
    /* Внешний аудит #3 (2026-05-18, P2): commitNewCalc false означает quota —
     * раньше я помечал «best-effort через banner», но calc ставился в store
     * и возвращался → UI показывал success-snackbar для несохранённого calc'а.
     * Теперь — return null, caller обязан проверить и показать error-toast. */
    if (!commitNewCalc(calc, { id: calc.id, name: calc.name, updatedAt: calc.updatedAt })) {
        return null;
    }
    persist.saveActiveCalcId(calc.id); // best-effort: id восстановится из first-of-list
    store.setActiveCalc(calc);
    refreshCalcList();
    return calc;
}

export function openCalc(id) {
    const stored = persist.loadCalc(id);
    if (!stored) return null;
    // Атомарная миграция (10.1.3): если упала — не открываем calc, не трогаем
    // activeCalc, выводим snackbar. Иначе пользователь увидел бы partial-mutated
    // calc или необработанное исключение, которое уронит app.js subscriber.
    let calc;
    try {
        calc = migrateCalculation(stored);
        // Этап 13: подмешать новые agent-вопросы / ЭК / обновить LLM-формулы
        // (избегаем circular import seed ↔ migrations через post-migration enrich).
        enrichLegacyDictionaryWithAgentSeed(calc);
    } catch (e) {
        const name = stored?.name || id;
        const reason = e instanceof MigrationError ? e.message : (e?.message || String(e));
        store.setPersistStatus('error', `Не удалось мигрировать расчёт «${name}»: ${reason}`);
        return null;
    }
    /* Stage VAT-1 Phase 3: после миграции + enrichment — пересчитать эффективную
       ставку НДС для auto-by-date. Manual/frozen — no-op (тот же объект). */
    const beforeVatResolve = calc;
    calc = applyVatResolver(calc);
    const vatChanged = calc !== beforeVatResolve;

    // migrateCalculation всегда возвращает новый объект (deep clone), поэтому
    // сравнивать ссылки бесполезно. Сохраняем только если изменилась версия
    // схемы или resolver реально пересчитал vatRate (auto-by-date после
    // обновления справочника или legacy с null vatEffectiveDate) — иначе на
    // каждом open плодили бы лишние записи в localStorage.
    // 11.1.1: пишем через commitMigratedCalc — calc + list атомарно,
    // вместо прямого persist.saveCalc, чтобы list[i].updatedAt согласовался.
    const storedVersion = Number.isFinite(stored.schemaVersion) ? stored.schemaVersion : 0;
    /* Внешний аудит #7 (2026-05-18, P2): commitMigratedCalc проверяется.
     * При quota раньше store получал мигрированный calc, а storage оставался
     * legacy — на F5 миграция повторялась (идемпотентно), но в текущей
     * сессии любая правка через обычный commit тоже падала бы, что вводило
     * пользователя в заблуждение «calc открыт». Теперь при persist-fail
     * миграции — calc НЕ открывается, явный error-banner с инструкцией. */
    if (calc.schemaVersion !== storedVersion || vatChanged) {
        if (!commitMigratedCalc(calc)) {
            const name = stored.name || id;
            store.setPersistStatus('error',
                `Не удалось сохранить мигрированный расчёт «${name}» (quota?). ` +
                `Освободите место (экспорт JSON + удаление старых расчётов) и повторите открытие.`);
            return null;
        }
    }
    /* best-effort: saveActiveCalcId на сбое quota → activeId не записан, но
     * сам calc уже сохранён (commitMigratedCalc выше); на следующем boot
     * откроется первый из списка. */
    persist.saveActiveCalcId(id);
    store.setActiveCalc(calc);
    return calc;
}

export function renameCalc(id, newName) {
    const calc = persist.loadCalc(id);
    if (!calc) return { ok: false, reason: 'not-found' };
    calc.name = String(newName || '').slice(0, 120);
    calc.updatedAt = new Date().toISOString();
    /* Внешний аудит #6 (2026-05-18, P2-2): commitCalcRename результат
     * раньше игнорировался + store.setActiveCalc(calc) → при persist-fail
     * activeCalc становился с новым именем, в storage — старое (F5 откатит).
     * Теперь inverse pattern: persist первым, store только при ok. */
    if (!commitCalcRename(calc)) {
        return { ok: false, reason: 'persist',
            message: 'Не удалось переименовать (quota?). Имя не изменено.' };
    }
    if (store.getState().activeCalc?.id === id) store.setActiveCalc(calc);
    refreshCalcList();
    return { ok: true };
}

export function duplicateCalc(id) {
    const src = persist.loadCalc(id);
    if (!src) return null;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = uuid();
    copy.name = `${src.name} (копия)`;
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = copy.createdAt;
    // 11.1.1: атомарная запись calc + calc.list через единое ядро.
    /* Внешний аудит #3 (2026-05-18, P2): explicit check для silent-loss защиты. */
    if (!commitNewCalc(copy, { id: copy.id, name: copy.name, updatedAt: copy.updatedAt })) {
        return null;
    }
    refreshCalcList();
    return copy;
}

export function deleteCalc(id) {
    /* Внешний аудит #3 (2026-05-18, P2): РЕАЛЬНАЯ атомарность через инверсию
     * порядка. Раньше: removeCalc(id) → saveCalcList(...). При сбое второго
     * шага calc.<id> был удалён, но list указывал на него → dangling карточка.
     *
     * Теперь: сначала saveCalcList(updated). Если упало — calc.<id> ещё
     * физически есть, состояние согласованно (старый снимок). Если прошло —
     * только тогда removeCalc(id).
     *
     * Внешний аудит #6 (2026-05-18, P3-1): функция теперь возвращает
     * {ok, reason?, message?} — иначе caller (app.js) не знает о persist-fail
     * и показывает undo-snackbar для несуществующего удаления. */
    const list = persist.loadCalcList().filter(m => m.id !== id);
    if (!persist.saveCalcList(list)) {
        store.setPersistStatus('error', 'Не удалось обновить список расчётов (quota?). Расчёт не удалён.');
        return { ok: false, reason: 'persist',
            message: 'Не удалось обновить список расчётов (quota?). Расчёт не удалён.' };
    }
    persist.removeCalc(id);
    const state = store.getState();
    if (state.activeCalc?.id === id) {
        store.setActiveCalc(null);
        if (!persist.saveActiveCalcId(null)) {
            store.setPersistStatus('error', 'Расчёт удалён, но не удалось сбросить активный id (quota?). После F5 откроется первый из списка.');
        }
    }
    refreshCalcList();
    return { ok: true };
}

/**
 * Снять снимок расчёта (для undo).
 */
export function snapshotCalc(id) {
    return persist.loadCalc(id);
}

/**
 * Восстановить расчёт из снимка.
 */
export function restoreCalc(calc) {
    if (!calc?.id) return false;
    // 11.1.1: атомарная запись calc + calc.list через единое ядро.
    // commitNewCalc сам обрабатывает случай, когда запись уже есть в списке
    // (тогда она обновляется, а не дублируется).
    /* Внешний аудит #3 (2026-05-18, P2): explicit check — caller увидит false при quota. */
    if (!commitNewCalc(calc, { id: calc.id, name: calc.name, updatedAt: calc.updatedAt })) {
        return false;
    }
    refreshCalcList();
    return true;
}

/* ---------- Импорт/экспорт ---------- */

export function exportActiveCalc() {
    const calc = store.getState().activeCalc;
    if (!calc) return false;
    downloadJson(buildCalcFilename(calc), calc);
    return true;
}

/**
 * Импорт расчёта из JSON-файла.
 *
 * @param {object} [opts]
 * @param {'ask'|'replace'|'clone'} [opts.onDuplicate='ask']
 *   Поведение при коллизии id с уже существующим расчётом:
 *     - 'ask'     — вернуть { ok:false, reason:'duplicate', existingId, importedName }.
 *                   UI должен спросить пользователя и повторить импорт с явным выбором.
 *     - 'replace' — перезаписать существующий расчёт (id сохраняется).
 *     - 'clone'   — присвоить новый uuid и импортировать как отдельный расчёт.
 * @param {object} [opts.preloaded] — уже разобранный объект расчёта (без выбора файла).
 *   Используется при повторном вызове из ctx-обёртки после ответа пользователя
 *   на duplicate-модалке: исходный файл уже был прочитан, повторно открывать
 *   диалог выбора файла не нужно.
 */
export async function importCalcFromFile(opts = {}) {
    const onDuplicate = opts.onDuplicate || 'ask';
    /* DI для тестов: подмена picker'а и читалки. Прод-вызов передаёт пустые opts. */
    const pickFn = opts._pickFile || pickFile;
    const readFn = opts._readJsonFile || readJsonFile;

    let data;
    if (opts.preloaded && typeof opts.preloaded === 'object') {
        // Повторный заход после выбора пользователем — данные уже разобраны
        // и провалидированы на предыдущем шаге, но миграция/validate должны
        // выполниться заново на свежей deep-copy, чтобы не зависеть от мутаций.
        data = JSON.parse(JSON.stringify(opts.preloaded));
    } else {
        const file = await pickFn('.json,application/json');
        if (!file) return { ok: false, reason: 'cancelled' };
        try { ({ data } = await readFn(file)); }
        catch (e) { return { ok: false, reason: 'parse', message: e.message }; }
    }

    if (!data || typeof data !== 'object') return { ok: false, reason: 'invalid', message: 'Файл не содержит расчёта' };

    // Если id нет — сгенерируем новый.
    if (!data.id) data.id = uuid();
    if (!data.version) data.version = '1.0';
    if (!data.createdAt) data.createdAt = new Date().toISOString();
    data.updatedAt = new Date().toISOString();

    // Миграция legacy-формата ДО валидации (валидатор уже проверяет phaseDurationMonths).
    // На MigrationError (10.1.3) возвращаем reason='migration' вместо throw,
    // чтобы импорт повёл себя консистентно с остальными ошибочными исходами.
    try {
        data = migrateCalculation(data);
        enrichLegacyDictionaryWithAgentSeed(data);
    } catch (e) {
        const reason = e instanceof MigrationError ? e.message : (e?.message || String(e));
        return {
            ok: false,
            reason: 'migration',
            errors: [{
                calcId: data?.id ?? null,
                step: e instanceof MigrationError ? `${e.from}→${e.to}` : null,
                message: reason
            }]
        };
    }

    // view — опциональный блок; если в файле его нет, дефолтим, чтобы UI имел
    // на чём строиться. При наличии — нормализуем структуру disabledStands.
    if (!data.view || typeof data.view !== 'object') data.view = { disabledStands: [] };
    else if (!Array.isArray(data.view.disabledStands)) data.view.disabledStands = [];

    const errors = [];
    validateCalculation(data, errors);
    if (errors.length) return { ok: false, reason: 'validation', errors };

    // 11.1.4: silent uuid rename устранён. При коллизии id поведение
    // определяется параметром onDuplicate; по умолчанию ('ask') возвращаем
    // ошибку, чтобы UI открыл подтверждающую модалку.
    const existing = persist.loadCalc(data.id);
    if (existing) {
        if (onDuplicate === 'ask') {
            return {
                ok: false,
                reason: 'duplicate',
                existingId: data.id,
                existingName: existing.name || data.id,
                importedName: data.name || data.id,
                // Передаём preloaded-данные обратно в payload, чтобы повторный
                // вызов (replace/clone) не требовал заново открывать file picker.
                preloaded: data
            };
        }
        if (onDuplicate === 'clone') {
            data.id = uuid();
        }
        // 'replace' — оставляем data.id как есть, commitNewCalc перезапишет
        // запись calc.<id> и обновит существующую запись в списке (commitNewCalc
        // имеет защиту от дубликатов в списке: если id уже есть — обновляет, не плодит).
    }

    // 11.1.1: атомарная запись calc + calc.list через единое ядро.
    /* Внешний аудит #2 (2026-05-18, P2-1): раньше commitNewCalc return игнорировался,
     * далее saveActiveCalcId и store.setActiveCalc(data) — UI показывал «Расчёт
     * загружен», после F5 calc.<id> отсутствовал, activeCalcId указывал в пустоту. */
    if (!commitNewCalc(data, { id: data.id, name: data.name, updatedAt: data.updatedAt })) {
        return { ok: false, reason: 'persist', message: 'Не удалось сохранить расчёт (quota?)' };
    }
    if (!persist.saveActiveCalcId(data.id)) {
        /* commit прошёл, но activeId не сохранился — не критично (после F5
         * выберется первый из списка), однако сигналим persistStatus=error. */
        store.setPersistStatus('error', 'Не удалось обновить активный расчёт (quota?)');
    }
    clearCalculationCache();
    store.setActiveCalc(data);
    refreshCalcList();
    return { ok: true, calc: data, replaced: !!existing && onDuplicate === 'replace' };
}

/* ---------- Полный экспорт / импорт состояния ---------- */

/**
 * Скачать полный snapshot всего хранилища (все расчёты + справочник + активный id).
 * Возвращает true при успехе.
 */
export async function exportStateBundle() {
    const { buildStateBundle, buildBundleFilename } = await import('../services/bundleExport.js');
    const { downloadJson } = await import('../services/json.js');
    const bundle = buildStateBundle();
    downloadJson(buildBundleFilename(), bundle);
    return true;
}

/**
 * Импортировать полный snapshot. Заменяет ВСЁ состояние.
 * Возвращает результат applyStateBundle: { ok, applied? | reason, errors? }.
 */
export async function importStateBundleFromFile() {
    const { applyStateBundle } = await import('../services/bundleExport.js');
    const { pickFile, readJsonFile } = await import('../services/json.js');

    const file = await pickFile('.json,application/json');
    if (!file) return { ok: false, reason: 'cancelled' };

    let data;
    try {
        ({ data } = await readJsonFile(file));
    } catch (e) {
        return { ok: false, reason: 'parse', message: e.message };
    }

    const result = applyStateBundle(data);

    if (result.ok) {
        // Перечитать всё в store: список, активный, справочник.
        clearCalculationCache();
        const dict = persist.loadDefaultDictionary();
        if (dict) store.setDefaultDictionary(dict);

        const activeId = persist.loadActiveCalcId();
        if (activeId) {
            const stored = persist.loadCalc(activeId);
            if (stored) store.setActiveCalc(stored);
            else store.setActiveCalc(null);
        } else {
            store.setActiveCalc(null);
        }
        refreshCalcList();
    }

    return result;
}

/* ---------- Сброс ---------- */

/**
 * Полный сброс приложения к значениям по умолчанию.
 * Удаляет все расчёты, перезаписывает справочник seed-данными.
 */
export function resetToDefaults() {
    /* Внешний аудит #3 (2026-05-18, P2): РЕАЛЬНАЯ атомарность. Раньше:
     * removeCalc'ы → saveCalcList([]) — при сбое второго все calc.<id>
     * удалены, list указывает на них (dangling). Аудит #2 я закрыл
     * persistStatus='error'-сигналом без починки order — повтор.
     *
     * Теперь: СНАЧАЛА пишем пустой list + дефолтный dict. Если упало —
     * НИЧЕГО не удаляем, состояние остаётся прежним. Только при успехе
     * пишем activeId=null и зачищаем сами calc.<id>. */
    const list = persist.loadCalcList();
    const seed = buildSeedDictionaries();

    if (!persist.saveCalcList([])) {
        store.setPersistStatus('error',
            'Сброс не выполнен: не удалось обновить список расчётов (quota?). Состояние не изменено.');
        return;
    }
    if (!persist.saveDefaultDictionary(seed)) {
        /* dict-fail после успешного saveCalcList — list пустой, dict старый.
         * Внешний аудит #4 (2026-05-18, P2-1): раньше rollback-возврат
         * игнорировался + сообщение всегда говорило «Состояние восстановлено».
         * Если rollback тоже упал — состояние partial (list пуст, dict старый,
         * calc.<id> живы) — это data inconsistency, сообщение обязано
         * сигнализировать пользователю требование ручной reconciliation. */
        const rollbackOk = persist.saveCalcList(list);
        if (rollbackOk) {
            store.setPersistStatus('error',
                'Сброс не выполнен: не удалось обновить справочник (quota?). Состояние восстановлено.');
        } else {
            store.setPersistStatus('error',
                'Сброс не выполнен И откат не удался: список расчётов противоречит хранилищу. ' +
                'Перезагрузите страницу; если расчёты не появятся — восстановите вручную из JSON-экспорта.');
        }
        return;
    }
    /* Оба критических ключа записаны — теперь зачищаем calc.<id>. removeItem
     * на квоте не бросает, это безопасно. */
    for (const m of list) persist.removeCalc(m.id);
    if (!persist.saveActiveCalcId(null)) {
        store.setPersistStatus('error',
            'Сброс выполнен, но не удалось сбросить активный id (quota?).');
    }

    // Сбросить версию схемы и активный расчёт
    persist.setSchemaVersion(CURRENT_SCHEMA_VERSION);
    clearCalculationCache();
    clearReadmeCache();

    store.batch(() => {
        store.setActiveCalc(null);
        store.setDefaultDictionary(seed);
        store.setCalcList([]);
        store.setActiveTab('calculations');
    });
}

/**
 * Инициализация при старте: загрузка списка, активного расчёта, дефолтного справочника.
 */
export function initFromStorage() {
    persist.runMigrations();

    let dict = persist.loadDefaultDictionary();
    if (!dict || !dict.items || !dict.questions) {
        dict = buildSeedDictionaries();
        /* best-effort: seed-dictionary write на boot — на сбое следующий boot
         * снова попытается; in-memory dict уже установлен через store.set ниже. */
        persist.saveDefaultDictionary(dict);
    }
    store.setDefaultDictionary(dict);

    // 12.U1: восстановить accordion-состояния опросника. null = «не было сохранено» —
    // дефолтное поведение (первая секция открыта, settings свёрнут) выбирается в UI.
    const qOpen = persist.loadQuestionnaireOpenSections();
    const qSettings = persist.loadQuestionnaireSettingsOpen();
    // Stage 6.2.B (PATCH 2.4.23): свёрнутые подгруппы внутри секций.
    const qCollapsedSubs = persist.loadQuestionnaireCollapsedSubgroups();
    // 12.U25: сортировка постатейного сравнения (если пользователь её устанавливал).
    const cmpSort = persist.loadComparisonSort();
    // 12.U25-fix-17: раскрытые «По категориям» в стенд-карточках дашборда.
    const standCats = persist.loadStandCardsCatsExpanded();
    // 12.U27: свёрнутые категории в Детализации (accordion).
    const detailsCollapsedCats = persist.loadDetailsCollapsedCats();
    // 12.U28: свёрнутые категории в Сравнении (accordion).
    const comparisonCollapsedCats = persist.loadComparisonCollapsedCats();
    // 12.U29: свёрнутые категории/секции в Элементах и Вопросах (accordion).
    const itemsCollapsedCats = persist.loadItemsCollapsedCats();
    const questionsCollapsedSecs = persist.loadQuestionsCollapsedSecs();
    // 12.U33: тема приложения (dark/light).
    const theme = persist.loadTheme();
    // 14.U9: раскрытость сводки тарифов overlay в Опроснике.
    const providerOverlayExpanded = persist.loadProviderOverlayExpanded();
    // Stage 15.1: последняя открытая вкладка severity в модалке Health Check.
    const healthLastTab = persist.loadHealthLastTab();
    // Stage 17.2 Phase 3c: режим «Расширенные настройки». null = не сохранено
    // (дефолт false). Любые corrupt-значения отбрасываются loader'ом.
    const advancedMode = persist.loadAdvancedModeEnabled();
    if (qOpen !== null || qSettings !== null || qCollapsedSubs !== null
        || cmpSort !== null || standCats !== null
        || detailsCollapsedCats !== null || comparisonCollapsedCats !== null
        || itemsCollapsedCats !== null || questionsCollapsedSecs !== null
        || theme !== null || providerOverlayExpanded !== null
        || healthLastTab !== null || advancedMode !== null) {
        store.setUi({
            ...(qOpen !== null && { questionnaireOpenSections: qOpen }),
            ...(qSettings !== null && { questionnaireSettingsOpen: qSettings }),
            ...(qCollapsedSubs !== null && { questionnaireCollapsedSubgroups: qCollapsedSubs }),
            ...(cmpSort !== null && { comparisonSort: cmpSort }),
            ...(standCats !== null && { standCardsCatsExpanded: standCats }),
            ...(detailsCollapsedCats !== null && { detailsCollapsedCats }),
            ...(comparisonCollapsedCats !== null && { comparisonCollapsedCats }),
            ...(itemsCollapsedCats !== null && { itemsCollapsedCats }),
            ...(questionsCollapsedSecs !== null && { questionsCollapsedSecs }),
            ...(theme !== null && { theme }),
            ...(providerOverlayExpanded !== null && { providerOverlayExpanded }),
            ...(healthLastTab !== null && { healthLastTab }),
            ...(advancedMode !== null && { advancedModeEnabled: advancedMode })
        });
    }

    refreshCalcList();

    const activeId = persist.loadActiveCalcId();
    if (activeId) {
        const calc = persist.loadCalc(activeId);
        if (calc) {
            // Защитная миграция (10.1.3): если schemaVersion расчёта меньше
            // последней — мигрируем здесь же. На MigrationError не кладём
            // битый calc в store, не падаем в boot, выводим snackbar и
            // оставляем activeCalc в null, чтобы пользователь мог хотя бы
            // открыть список и выбрать другой расчёт.
            let migrated;
            try {
                migrated = migrateCalculation(calc);
                enrichLegacyDictionaryWithAgentSeed(migrated);
            } catch (e) {
                const name = calc?.name || activeId;
                const reason = e instanceof MigrationError ? e.message : (e?.message || String(e));
                store.setPersistStatus('error', `Не удалось мигрировать расчёт «${name}»: ${reason}`);
                /* best-effort: уже выставили error выше; сбросить activeId — повторить на следующем boot. */
                persist.saveActiveCalcId(null);
                return;
            }
            // Если миграция изменила версию схемы — переписываем расчёт в storage,
            // чтобы при следующей загрузке миграция не выполнялась повторно (10.2.2).
            // Сравниваем по schemaVersion, а не по ссылке: migrateCalculation
            // всегда возвращает deep clone, поэтому сравнение ссылок бессмысленно.
            // 11.1.1: атомарно через commitMigratedCalc (calc + list одновременно).
            const storedVersion = Number.isFinite(calc.schemaVersion) ? calc.schemaVersion : 0;
            /* Внешний аудит #7 (2026-05-18, P2): commitMigratedCalc проверяется
             * (см. openCalc). При quota НЕ ставим migrated активным —
             * сбрасываем activeCalcId, boot завершается без активного calc'а,
             * пользователь видит persist-error-banner с инструкцией. */
            if (migrated.schemaVersion !== storedVersion) {
                if (!commitMigratedCalc(migrated)) {
                    const name = calc.name || activeId;
                    store.setPersistStatus('error',
                        `Не удалось сохранить мигрированный расчёт «${name}» (quota?). ` +
                        `Освободите место (экспорт JSON + удаление старых расчётов) и перезагрузите страницу.`);
                    /* best-effort: saveActiveCalcId на сбое — следующий boot заново попробует. */
                    persist.saveActiveCalcId(null);
                    return;
                }
            }
            store.setActiveCalc(migrated);
            // При перезагрузке (F5) восстанавливаем сохранённую вкладку.
            // Если её нет — fallback на «Опросник» как стартовый таб для нового пользователя.
            const savedTab = persist.loadActiveTab();
            store.setActiveTab(savedTab || 'questionnaire');
        } else {
            /* best-effort: реактивная очистка activeCalcId — на сбое следующий boot повторит. */
            persist.saveActiveCalcId(null);
        }
    }
}
