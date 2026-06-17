/**
 * Stage 15.5 (PATCH 2.8.4) — Decision Memo Export.
 *
 * Сервис формирования управленческого memo по расчёту в формате Markdown.
 * Чистая текстовая генерация: НЕ мутирует calc, не запускает расчёты, читает
 * только переданный context (health/assumptions/sensitivity/budgetGuardrails).
 *
 * IO:
 *   - copyDecisionMemoToClipboard(markdown) — async, navigator.clipboard
 *     с fallback на временный textarea.
 *   - downloadDecisionMemoMarkdown(markdown, filename) — Blob + a.download.
 *
 * Безопасность:
 *   - Любые user-input строки (calc.name, q.title, value) экранируются
 *     `sanitizeMemoText` (Markdown-specials + control-chars + длина).
 *   - HTML preview рендерится через существующий `services/markdown.js`
 *     (escape-first), так что raw HTML в memo не попадёт.
 */

import {
    URL_REVOKE_DELAY_MS, CATEGORY_LABELS,
    DEFAULT_BUFFER_TASK, DEFAULT_BUFFER_PROJECT, DEFAULT_K_INFLATION,
    DEFAULT_K_SEASONAL, DEFAULT_K_SCHEDULE_SHIFT, DEFAULT_K_CONTINGENCY
} from '../utils/constants.js';
import { formatDate, formatDateTime, formatNumber } from './format.js';
import { getCurrentVatRate } from '../domain/vatRateTable.js';
import {
    bulletLine,
    formatMarkdownTable,
    formatMemoMoney,
    formatMemoPercent,
    isUuidLike,
    pluralRu,
    sanitizeFilename,
    sanitizeMemoText
} from './decisionMemoFormat.js';

export {
    buildMemoFilename,
    formatMemoMoney,
    formatMemoPercent,
    sanitizeFilename,
    sanitizeMemoText
} from './decisionMemoFormat.js';

/* ============================================================
 * Builders — секции
 * ============================================================ */

function buildSummarySection(calc, ctx) {
    const lines = ['## 1. Краткое резюме', ''];
    lines.push(bulletLine('Расчёт', sanitizeMemoText(calc?.name) || '—'));

    // Активный сценарий: показываем ТОЛЬКО при наличии человеческого имени.
    // Stage 18.1.6 fix: если `name` отсутствует / равен `id` / выглядит как
    // UUID — пропускаем строку вообще. Без этого пользователь видел
    // «Активный сценарий: ea7614ff-da60-4a6e-b09f-9e8bbecff7ec» — UUID-мусор.
    const scenario = ctx?.activeScenario;
    if (scenario && scenario.name && scenario.name !== scenario.id && !isUuidLike(scenario.name)) {
        lines.push(bulletLine('Активный сценарий', sanitizeMemoText(scenario.name)));
    }

    const provider = ctx?.providerInfo;
    if (provider && (provider.providerId || provider.version)) {
        // Pretty-label из PROVIDER_OVERLAYS — trusted, не sanitize.
        const providerDisplay = provider.providerLabel
            || (provider.providerId ? sanitizeMemoText(provider.providerId) : null);
        if (providerDisplay) {
            lines.push(bulletLine('Провайдер', providerDisplay));
        }
        // Stage 18.1.6: «Версия прайса» и «Статус прайса» УБРАНЫ из Summary —
        // они полностью дублировали раздел 3 «Использованные прайсы». В Summary
        // оставляем только pretty-label провайдера как identifier.
    } else {
        lines.push(bulletLine('Провайдер', 'не указан'));
    }

    // Финансовые итоги — берём из budgetGuardrails.actual (там и opex, и capex
    // в готовом виде); если budgetGuardrails отсутствует — пропускаем.
    const bg = ctx?.budgetGuardrails;
    if (bg && bg.actual) {
        if (Number.isFinite(bg.actual.capexTotal)) {
            lines.push(bulletLine('Итоговый CAPEX', formatMemoMoney(bg.actual.capexTotal)));
        }
        if (Number.isFinite(bg.actual.opexMonthly)) {
            lines.push(bulletLine('Итоговый OPEX', `${formatMemoMoney(bg.actual.opexMonthly)}/мес`));
        }
    }

    const health = ctx?.health;
    if (health && Number.isFinite(health.score)) {
        lines.push(bulletLine('Качество расчёта', `${health.score} / 100`));
    }

    /* Stage 18.1.5: ключевые параметры расчёта из calc.settings, без которых
       цифры в memo выглядят оторванными от контекста (читатель не понимает —
       с НДС или без, с рисками или без, какой горизонт CAPEX, какие размеры
       стендов). */
    const s = calc?.settings || {};

    // Режим расчёта (default = applyRiskFactors true → «С рисками»).
    const mode = s.applyRiskFactors === false ? 'Без рисков' : 'С рисками';
    lines.push(bulletLine('Режим расчёта', mode));

    // НДС: если выключен — явно говорим, иначе показываем ставку + режим + дату.
    // VAT-1 Phase 5: расширили строку — она объясняет читателю, КАК ставка
    // получена (авто-из-справочника, вручную или заморожено).
    if (s.vatEnabled === false) {
        lines.push(bulletLine('НДС', 'не учитывается'));
    } else {
        const rate = Number.isFinite(s.vatRate) ? s.vatRate : getCurrentVatRate();
        const ratePct = Math.round(rate * 100);
        const mode = s.vatRateMode || 'auto-by-date';
        const date = (typeof s.vatEffectiveDate === 'string' && s.vatEffectiveDate)
            ? s.vatEffectiveDate
            : null;
        /* VAT-1 Phase 7 (post-Phase 5 fix): дата в RU-формате dd.mm.yyyy — правило
           `date-format-ru` ловит ISO-формат в пользовательских строках. */
        const dateRu = date ? formatDate(date) : null;
        let modeSuffix;
        if (mode === 'manual') {
            modeSuffix = 'вручную';
        } else if (mode === 'frozen') {
            modeSuffix = dateRu ? `заморожено, дата фиксации: ${dateRu}` : 'заморожено';
        } else {
            modeSuffix = dateRu ? `авто, дата ставки: ${dateRu}` : 'авто';
        }
        lines.push(bulletLine('Ставка НДС', `${ratePct}% (${modeSuffix})`));
    }

    // Горизонт планирования (лет) с русским склонением.
    if (Number.isFinite(s.planningHorizonYears)) {
        const n = s.planningHorizonYears;
        lines.push(bulletLine('Горизонт планирования', `${n} ${pluralRu(n, 'год', 'года', 'лет')}`));
    }

    // Длительность фазы (мес) с русским склонением.
    if (Number.isFinite(s.phaseDurationMonths)) {
        const n = s.phaseDurationMonths;
        lines.push(bulletLine('Длительность фазы', `${n} ${pluralRu(n, 'месяц', 'месяца', 'месяцев')}`));
    }

    // Размеры стендов (PROD исключаем — он эталон 1.00).
    if (s.standSizeRatio && typeof s.standSizeRatio === 'object') {
        const parts = [];
        const orderedStands = [
            { id: 'DEV',  label: 'DEV' },
            { id: 'IFT',  label: 'ИФТ' },
            { id: 'PSI',  label: 'ПСИ' },
            { id: 'LOAD', label: 'НТ' }
        ];
        for (const { id, label } of orderedStands) {
            const r = s.standSizeRatio[id];
            if (Number.isFinite(r)) {
                parts.push(`${label} ${Math.round(r * 100)}%`);
            }
        }
        if (parts.length > 0) {
            lines.push(bulletLine('Размеры стендов', `${parts.join(' · ')} (от ПРОМ)`));
        }
    }

    return lines.join('\n');
}

/* Stage 18.1.7: главный раздел memo — отвечает на вопрос «почему именно такая
   стоимость получилась». Top-10 ЭК + Pareto-строка о концентрации.
   Source данных — ctx.costComposition (собирается в decisionMemoController через
   calculate(calc).items[id].totalMonthly). */
function buildCostCompositionSection(ctx) {
    const lines = ['## 2. Состав стоимости: самые дорогие статьи', ''];
    const c = ctx?.costComposition;
    if (!c || !Array.isArray(c.topItems) || c.topItems.length === 0) {
        lines.push('*Состав стоимости не определён.*');
        return lines.join('\n');
    }

    lines.push('Top-10 статей затрат, агрегированных по всем стендам:');
    lines.push('');

    /* Stage 18.1.9: pipe-aligned таблица. Каждая cell padded до ширины колонки —
       таблица читаема в plain-text view, не только при Markdown-рендере. */
    const headers = ['#', 'Статья затрат', 'Категория', '₽/мес', 'Доля'];
    const rows = c.topItems.map((it, i) => {
        const name = sanitizeMemoText(it.name);
        /* Stage 18.1.8: человекочитаемый label категории из CATEGORY_LABELS. */
        const cat = it.category
            ? (CATEGORY_LABELS[it.category] || sanitizeMemoText(it.category))
            : '—';
        const thousands = formatNumber(it.totalMonthly / 1000, { min: 0, max: 1 });
        const share = `${formatNumber((it.share || 0) * 100, { min: 1, max: 1 })} %`;
        return [String(i + 1), name, cat, thousands, share];
    });
    lines.push(formatMarkdownTable(headers, rows, ['right', 'left', 'left', 'right', 'right']));
    lines.push('');

    // Pareto-строка: 2 варианта по требованию пользователя Stage 18.1.7.
    const top10Pct = formatNumber((c.top10Share || 0) * 100, { min: 1, max: 1 });
    if (c.paretoNeeded > 0 && c.paretoNeeded <= 10) {
        // Концентрировано: 80% даёт ≤ 10 статей.
        lines.push(`Стоимость концентрирована: ${c.paretoNeeded} ${pluralRu(c.paretoNeeded, 'статья', 'статьи', 'статей')} формируют 80% месячной стоимости. Top-10 формируют ${top10Pct} %.`);
    } else if (c.paretoNeeded > 10) {
        // Размазана: top-10 даёт <80%, для 80% нужно >10 статей.
        lines.push(`Top-10 статей формируют ${top10Pct} % месячной стоимости; для достижения 80% требуется ${c.paretoNeeded} ${pluralRu(c.paretoNeeded, 'статья', 'статьи', 'статей')}.`);
    } else {
        // paretoNeeded = 0 (нет данных) — fallback.
        lines.push(`Top-${c.topItems.length} статей формируют ${top10Pct} % месячной стоимости.`);
    }

    return lines.join('\n');
}

function buildKeyParamsSection(calc) {
    const lines = ['## 3. Основные параметры', ''];
    const ans = calc?.answers || {};

    // Берём те поля, которые с большой вероятностью ответил пользователь и которые
    // важны для управленческого взгляда. Каждое — опционально.
    /* Stage 18.1.6: per-field единицы измерения + RU-форматирование чисел.
       Без unit'а пользователь не понимает, что значит «50000» (часов? дней?
       пользователей?). Number'ы форматируются через formatNumber (RU-локаль,
       NBSP-разделитель тысяч), boolean — «да/нет», enum/string — sanitize. */
    const fieldsToShow = [
        ['users_total',                     'Накопленная аудитория',           'чел.'],
        ['registered_users_total',          'Зарегистрированных сейчас',       'чел.'],
        ['dau_share_of_registered_percent', 'Доля DAU',                        '%'],
        ['pcu_target',                      'Пиковая одновременная аудитория', 'чел.'],
        ['peak_rps',                        'Пиковый RPS',                     'req/s'],
        ['sla_target',                      'Целевой SLA',                     '%'],
        ['rto_hours',                       'RTO',                             'часов'],
        ['rpo_minutes',                     'RPO',                             'минут'],
        ['ai_llm_used',                     'Использование LLM',               null],
        ['rag_needed',                      'RAG',                             null],
        ['ai_agent_mode',                   'Режим AI-агентов',                null],
        ['pdn_152fz',                       'Обработка ПДн (152-ФЗ)',          null],
        ['fstec_certification_required',    'Аттестация ФСТЭК',                null],
        ['georedundancy_required',          'Геоизбыточность',                 null]
    ];

    let printed = 0;
    for (const [id, label, unit] of fieldsToShow) {
        const v = ans[id];
        if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
        let formatted;
        if (typeof v === 'boolean') {
            formatted = v ? 'да' : 'нет';
        } else if (Array.isArray(v)) {
            formatted = v.map(x => sanitizeMemoText(x)).join(', ');
        } else if (typeof v === 'number' && Number.isFinite(v)) {
            formatted = formatNumber(v);
        } else {
            formatted = sanitizeMemoText(v);
        }
        // Unit добавляем ТОЛЬКО к не-boolean'ам (boolean'у unit смысла не несёт).
        if (unit && typeof v !== 'boolean') {
            formatted = `${formatted} ${unit}`;
        }
        lines.push(bulletLine(label, formatted));
        printed++;
    }

    if (printed === 0) {
        lines.push('- *Параметры не заполнены.*');
    }

    // Аудит коэффициентов (2026-05-31): прозрачность по AI-предложенным дефолтам.
    lines.push(...buildDefaultCoefficientsLines(calc));
    return lines.join('\n');
}

/* Аудит коэффициентов (2026-05-31): видимый список «допущений по умолчанию».
   Риск-коэффициенты и AI-факторы стендов — инженерные оценки, заложенные в
   модель разработчиком на основе типовых IT-практик, а НЕ отраслевой норматив.
   Выносим их в memo с явным дисклеймером и пометкой «по умолчанию» (значение
   ещё не уточнено пользователем) vs «уточнено». Помогает согласующему бюджет
   понять, какие числа стоит проверить под конкретный проект. */
function buildDefaultCoefficientsLines(calc) {
    const s = calc?.settings || {};
    const ans = calc?.answers || {};
    const out = [];

    const pct = (v) => `+${formatNumber((v || 0) * 100, { min: 0, max: 1 })} %`;
    const num = (v, def) => Number.isFinite(v) ? v : def;
    const mark = (v, def) => Math.abs(num(v, def) - def) < 1e-9 ? '*(по умолчанию)*' : '*(уточнено)*';

    const riskItems = [];
    // Риск-коэффициенты применяются к итогу только в режиме «с рисками».
    if (s.applyRiskFactors !== false) {
        const bt = num(s.bufferTask, DEFAULT_BUFFER_TASK);
        const bp = num(s.bufferProject, DEFAULT_BUFFER_PROJECT);
        const ki = num(s.kInflation, DEFAULT_K_INFLATION);
        const ks = num(s.kSeasonal, DEFAULT_K_SEASONAL);
        const ksh = num(s.kScheduleShift, DEFAULT_K_SCHEDULE_SHIFT);
        const kc = num(s.kContingency, DEFAULT_K_CONTINGENCY);
        riskItems.push(`  - Буфер задач: ${pct(bt)} ${mark(bt, DEFAULT_BUFFER_TASK)}`);
        riskItems.push(`  - Буфер проекта: ${pct(bp)} ${mark(bp, DEFAULT_BUFFER_PROJECT)}`);
        riskItems.push(`  - Инфляция: ${pct(ki)} в год ${mark(ki, DEFAULT_K_INFLATION)}`);
        riskItems.push(`  - Сезонность: ${ks > 0 ? pct(ks) : 'выкл.'} ${mark(ks, DEFAULT_K_SEASONAL)}`);
        riskItems.push(`  - Сдвиг расписания: ${pct(ksh)}, только разовые затраты ${mark(ksh, DEFAULT_K_SCHEDULE_SHIFT)}`);
        riskItems.push(`  - Непредвиденные: ${pct(kc)} ${mark(kc, DEFAULT_K_CONTINGENCY)}`);
    }

    // AI-факторы стендов — только если AI реально используется в расчёте.
    const aiUsed = ans.ai_llm_used === true || ans.ai_agent_mode === true;
    let aiLine = null;
    if (aiUsed && s.aiStandFactor && typeof s.aiStandFactor === 'object') {
        const order = [['DEV', 'DEV'], ['IFT', 'ИФТ'], ['PSI', 'ПСИ'], ['LOAD', 'НТ'], ['PROD', 'ПРОМ']];
        const parts = [];
        for (const [id, label] of order) {
            const v = s.aiStandFactor[id];
            if (Number.isFinite(v)) parts.push(`${label} ${Math.round(v * 100)}%`);
        }
        if (parts.length > 0) aiLine = `  - AI-нагрузка на стендах: ${parts.join(' · ')} (доля от ПРОМ)`;
    }

    if (riskItems.length === 0 && !aiLine) return out;

    out.push('');
    out.push('**Допущения по умолчанию (инженерная оценка, не норматив):**');
    out.push(...riskItems);
    if (aiLine) out.push(aiLine);
    out.push('');
    out.push('*Эти значения — типовые IT-оценки, заложенные в модель разработчиком, а не отраслевой норматив. Проверьте их под конкретный проект; изменить можно в Опроснике → «Параметры расчёта».*');
    return out;
}

function buildProviderSection(ctx) {
    const lines = ['## 4. Использованные прайсы', ''];
    const provider = ctx?.providerInfo;

    if (!provider || (!provider.providerId && !provider.version)) {
        lines.push('- Провайдер: не указан.');
        lines.push('- Версия: —');
        lines.push('- Статус: unknown');
        return lines.join('\n');
    }

    // Stage 18.1.6: «Провайдер» УБРАН из раздела 3 — он уже в Summary как
    // identifier. Здесь оставляем только детали applied overlay (версия/дата/
    // статус) или fallback «базовые тарифы провайдера».

    if (provider.version) {
        lines.push(bulletLine('Версия', sanitizeMemoText(provider.version)));
        if (provider.updatedAt) lines.push(bulletLine('Актуальность прайса', sanitizeMemoText(provider.updatedAt)));
        if (provider.status) lines.push(bulletLine('Статус', sanitizeMemoText(provider.status)));
    } else {
        // Без applied overlay — цены берутся из дефолтных PROVIDER_OVERLAYS,
        // они автоматически применяются. Stage 18.1.12: убрана техническая
        // приписка «overlay не импортирован» — пользователь не знает термин.
        lines.push(bulletLine('Источник цен', 'базовые тарифы провайдера'));
        if (provider.updatedAt) lines.push(bulletLine('Актуальность прайса', sanitizeMemoText(provider.updatedAt)));
    }
    return lines.join('\n');
}

function buildAssumptionsSection(ctx) {
    const lines = ['## 5. Ключевые допущения', ''];
    const ass = ctx?.assumptions;

    if (!ass) {
        lines.push('*Допущения не рассчитаны.*');
        return lines.join('\n');
    }

    if (ass.summary && typeof ass.summary === 'object') {
        const s = ass.summary;
        const pieces = [];
        if (Number.isFinite(s.manual))      pieces.push(`пользователь — ${s.manual}`);
        if (Number.isFinite(s.quick_start)) pieces.push(`Quick Start — ${s.quick_start}`);
        if (Number.isFinite(s.default))     pieces.push(`по умолчанию — ${s.default}`);
        if (pieces.length > 0) {
            lines.push(`- **Источники ответов:** ${pieces.join(', ')}.`);
        }
    }

    const risky = Array.isArray(ass.risky) ? ass.risky : [];
    if (risky.length === 0) {
        lines.push('- Рискованные допущения отсутствуют.');
    } else {
        lines.push(`- **Рискованные допущения (low confidence) — ${risky.length}:**`);
        for (const a of risky.slice(0, 10)) {
            const label = sanitizeMemoText(a.label || a.fieldId || '');
            const val = a.value == null ? '—'
                : typeof a.value === 'boolean' ? (a.value ? 'да' : 'нет')
                : sanitizeMemoText(a.value);
            lines.push(`  - ${label}: ${val}`);
        }
        if (risky.length > 10) {
            lines.push(`  - …и ещё ${risky.length - 10}.`);
        }
    }
    return lines.join('\n');
}

function buildHealthSection(ctx) {
    const lines = ['## 6. Риски и замечания', ''];
    const health = ctx?.health;

    if (!health) {
        lines.push('*Качество расчёта не рассчитано.*');
        return lines.join('\n');
    }

    const counts = health.counts || {};
    // Stage 18.1.6: «Оценка качества» УБРАНА из раздела 5 — она в Summary как
    // «Качество расчёта». Здесь оставляем только findings (ошибки/предупреждения).

    const findings = Array.isArray(health.findings) ? health.findings : [];
    const errors = findings.filter(f => f.severity === 'error');
    const warnings = findings.filter(f => f.severity === 'warning');

    if (errors.length === 0 && warnings.length === 0) {
        lines.push('- Критичных проблем не найдено.');
        return lines.join('\n');
    }

    if (errors.length > 0) {
        lines.push(`- **Ошибки (${errors.length}):**`);
        for (const f of errors.slice(0, 8)) {
            lines.push(`  - ${sanitizeMemoText(f.title || f.id || '')}`);
        }
        if (errors.length > 8) lines.push(`  - …и ещё ${errors.length - 8}.`);
    }
    if (warnings.length > 0) {
        lines.push(`- **Предупреждения (${warnings.length}):**`);
        for (const f of warnings.slice(0, 8)) {
            lines.push(`  - ${sanitizeMemoText(f.title || f.id || '')}`);
        }
        if (warnings.length > 8) lines.push(`  - …и ещё ${warnings.length - 8}.`);
    }
    // Stage 18.1.6: строку «Дополнительные рекомендации: N» УБРАЛИ — Decision
    // Memo это обоснование, не TODO-список. counts ещё может остаться полезным
    // для health-summary в UI (Health Modal), здесь же читателю обоснования
    // упоминание «есть рекомендации» только подрывает доверие.
    return lines.join('\n');
}

/* Stage 18.1.12: `buildSensitivitySection` удалена — раздел «Главные драйверы
   стоимости» больше не выводится в memo. Пользователь не видел принципиальной
   разницы между ним и разделом 2 «Состав стоимости: самые дорогие статьи» —
   оба показывают «что влияет на стоимость», только один в разрезе **состава**
   (top-10 ЭК с долями), другой в разрезе **чувствительности** (что изменится
   при ±параметре). Для **документа-обоснования** sensitivity избыточна:
   обоснование = «почему такая стоимость», sensitivity = «что менять для
   оптимизации». Sensitivity-анализ остаётся доступным как отдельный рабочий
   инструмент через Sensitivity Modal на дашборде. */

function buildBudgetSection(ctx) {
    const bg = ctx?.budgetGuardrails;
    if (!bg) return null;
    if (bg.status === 'not_configured') return null;

    const lines = ['## 7. Бюджетные ограничения', ''];

    const renderAxis = (axisLabel, section, isMonthly) => {
        if (!section || section.status === 'not_configured') {
            lines.push(`- **${axisLabel}:** целевой бюджет не задан.`);
            return;
        }
        const target = formatMemoMoney(section.target);
        const actual = formatMemoMoney(section.actual);
        const suffix = isMonthly ? '/мес' : '';
        if (section.status === 'warning') {
            const gap = formatMemoMoney(section.gap);
            const pct = formatMemoPercent(section.gapPercent);
            lines.push(`- **${axisLabel}:** превышение ${gap}${suffix} (${pct}). ` +
                `Цель ${target}${suffix}, факт ${actual}${suffix}.`);
        } else {
            lines.push(`- **${axisLabel}:** в пределах бюджета. ` +
                `Цель ${target}${suffix}, факт ${actual}${suffix}.`);
        }
    };

    renderAxis('CAPEX', bg.capex, false);
    renderAxis('OPEX',  bg.opex,  true);

    const reasons = Array.isArray(bg.reasons) ? bg.reasons : [];
    if (bg.status === 'warning' && reasons.length > 0) {
        lines.push('');
        lines.push('Главные причины превышения:');
        reasons.slice(0, 3).forEach((r, i) => {
            const label = sanitizeMemoText(r.label || r.fieldId || '');
            const impact = formatMemoMoney(Number(r.impact) || 0);
            lines.push(`${i + 1}. ${label} — влияние ≈ ${impact}.`);
        });
    }
    return lines.join('\n');
}

/* Stage 18.1.6: раздел «8. Рекомендации» УДАЛЁН из Decision Memo. Decision Memo
   — это документ обоснования расчёта для предъявления (CFO, инвестору, комитету),
   а раздел «что ещё доделать / какие пересмотреть» подрывает доверие читателя:
   «есть рекомендации к улучшению» = расчёт не закончен. Список рекомендаций
   остаётся в **рабочих инструментах** (Health Modal на дашборде, Budget Guardrails
   модалка), которые открывает архитектор во время сборки расчёта. В экспортированном
   обосновании остаются только sections: 1-Summary, 2-KeyParams, 3-Provider,
   4-Assumptions (disclosure), 5-Risks (disclosure), 6-Sensitivity, 7-Budget. */

/* ============================================================
 * Public API — build
 * ============================================================ */

/**
 * Структурированное memo (объект). Полезно для тестов и для UI, который
 * хочет рендерить отдельные секции отдельно. Markdown-вывод собирается
 * на основе этого объекта.
 *
 * @param {object|null} calc
 * @param {object} [context]
 * @returns {{ generatedAt: string, calcName: string, sections: object }}
 */
export function buildDecisionMemo(calc, context = {}) {
    const generatedAt = context.generatedAt || new Date().toISOString();
    const calcName = sanitizeMemoText(calc?.name) || '';

    const sections = {
        summary:         buildSummarySection(calc, context),
        costComposition: buildCostCompositionSection(context), // Stage 18.1.7: top-10 ЭК + Pareto
        keyParams:       buildKeyParamsSection(calc),
        provider:        buildProviderSection(context),
        assumptions:     buildAssumptionsSection(context),
        health:          buildHealthSection(context),
        budget:          buildBudgetSection(context) // null если budget not_configured
        // Stage 18.1.6: recommendations удалены — обоснование не содержит «что ещё доделать».
        // Stage 18.1.12: sensitivity удалена — раздел 4 «Главные драйверы стоимости»
        // дублировал по смыслу раздел 2 «Что повлияло» (пользователь не видел разницы).
        // Sensitivity-анализ остаётся доступным в Sensitivity Modal на дашборде
        // как рабочий инструмент оптимизации, не как часть документа-обоснования.
    };

    return { generatedAt, calcName, sections };
}

/**
 * Markdown-представление memo. Собирается из buildDecisionMemo.
 *
 * @param {object|null} calc
 * @param {object} [context]
 * @returns {string}
 */
export function buildDecisionMemoMarkdown(calc, context = {}) {
    if (!calc) {
        return '# Обоснование расчёта инфраструктуры\n\n*Нет активного расчёта для формирования memo.*\n';
    }
    const memo = buildDecisionMemo(calc, context);
    const parts = [];

    parts.push('# Обоснование расчёта инфраструктуры');
    parts.push('');
    /* RU-формат `dd.mm.yyyy hh:mi` (правило `date-format-ru`). Inline-выражение
       вместо локальной переменной — линтер `date-format-ru` ищет identifier'ы
       с подстрокой `generatedAt` в template-literal'ах. */
    parts.push(`Сформировано: ${formatDateTime(memo.generatedAt) || sanitizeMemoText(memo.generatedAt)}.`);
    parts.push('');
    /* Stage 18.1.12: упрощённый порядок без sensitivity-раздела:
         1. Краткое резюме
         2. Состав стоимости: самые дорогие статьи (top-10 + Pareto) — главный
         3. Основные параметры
         4. Использованные прайсы
         5. Ключевые допущения
         6. Риски и замечания
         7. Бюджетные ограничения (optional)
       Sensitivity убрана — раздел 4 дублировал по смыслу раздел 2.
    */
    parts.push(memo.sections.summary);
    parts.push('');
    parts.push(memo.sections.costComposition);
    parts.push('');
    parts.push(memo.sections.keyParams);
    parts.push('');
    parts.push(memo.sections.provider);
    parts.push('');
    parts.push(memo.sections.assumptions);
    parts.push('');
    parts.push(memo.sections.health);
    if (memo.sections.budget) {
        parts.push('');
        parts.push(memo.sections.budget);
    }
    parts.push('');

    return parts.join('\n');
}

/* ============================================================
 * IO — clipboard и download
 * ============================================================ */

/**
 * Копирует строку в буфер обмена.
 * Возвращает Promise<boolean> — успех/неуспех (без throw).
 */
export async function copyDecisionMemoToClipboard(markdown) {
    const text = String(markdown == null ? '' : markdown);
    // Modern API.
    if (typeof navigator !== 'undefined'
        && navigator.clipboard
        && typeof navigator.clipboard.writeText === 'function') {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (_e) {
            // Fallback ниже.
        }
    }
    // Fallback: временный textarea.
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
        return false;
    }
    let ta;
    try {
        ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.left = '-1000px';
        document.body.appendChild(ta);
        ta.select();
        const ok = typeof document.execCommand === 'function'
            ? document.execCommand('copy')
            : false;
        return !!ok;
    } catch (_e) {
        return false;
    } finally {
        if (ta && ta.parentNode) ta.parentNode.removeChild(ta);
    }
}

/**
 * Скачать строку как Markdown-файл.
 * Использует Blob + a.download. URL.revokeObjectURL — отложенная очистка.
 */
export function downloadDecisionMemoMarkdown(markdown, filename) {
    const text = String(markdown == null ? '' : markdown);
    const safeName = sanitizeFilename(filename || 'decision-memo.md');
    const finalName = safeName.endsWith('.md') ? safeName : `${safeName}.md`;

    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = finalName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), URL_REVOKE_DELAY_MS);
}
