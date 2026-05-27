/**
 * Дашборд — Hynex-стиль (Этап 9.6).
 *
 * Структура (асимметричная сетка):
 *   1) Hero — крупная сумма ИТОГО за выбранный период + CAPEX/OPEX composition.
 *   2) Структура расходов — donut по категориям + легенда (ИТОГО).
 *   3) 5 карточек стендов — компактные, per-stand цветовой акцент.
 *   4) Распределение по категориям — составная шкала + строки категорий
 *      (ИТОГО или по N активным стендам).
 *   5) Вклад рисков — pills с компонентами наценки.
 *
 * Все иконки — из icons.js (Lucide line-SVG). Эмодзи не используются.
 */

import { el } from './dom.js';
import {
    STAND_IDS, STAND_LABELS, STAND_DESCRIPTIONS,
    CATEGORY_IDS, CATEGORY_LABELS, CATEGORY_COLORS, CATEGORY_DESCRIPTIONS,
    PERIOD_IDS, PERIOD_LABELS, DEFAULT_PERIOD,
    COST_TYPE_LABELS, MONTHS_PER_YEAR
} from '../utils/constants.js';
/* 12.U11: на Дашборде все суммы — в тыс. ₽ без десятичных. Точность до рубля
   избыточна (оперируем сотнями тысяч и больше), сами рубли создают визуальный
   шум на крупных числах. В детализации/CSV/экспорте используется обычный
   formatRub — точность сохраняется там, где она нужна.
   12.U30-fix: пользователь явно требует «БЕЗ десятичных знаков на всех
   карточках Дашборда» (в т.ч. для дневного периода). Раньше day-период
   отображался с 1 знаком после запятой (50,4 + 112,3 = 162,7), чтобы
   суммы по компонентам сходились с total. Теперь все периоды округляются
   до целых тыс. — компромисс: на день (мелкие числа) capex+opex может
   расходиться с total на ±1 тыс. ₽ из-за независимых округлений. Ради
   единообразия отображения принято. */
import { formatNumber, formatRubThousands, percent } from '../services/format.js';
function fmtRubForPeriod(value, period) {
    return formatRubThousands(value, { fractionDigits: 0 });
}
const formatRub = formatRubThousands;
import { calculate } from '../domain/calculator.js';
import { applyStandFilter } from '../domain/standsFilter.js';
import { renderStandToggles } from './standToggles.js';
import { icon } from './icons.js';
import { extractVatAmount, renderVatBadge, renderVatBreakdownLine, vatInfo } from './vatBadge.js';
import { extractRiskAmount, renderRiskBreakdownLine } from './riskBreakdown.js';
import { renderCalculationStateSummary } from './calculationStateSummary.js';
import { renderScenarioBadge } from './scenarioBadge.js';
import { renderCalculationProviderPriceActuality } from './providerPriceActuality.js';
import {
    aggregateResources,
    aggregateAiMetrics,
    distributeRoundingPreservingSum
} from './dashboardAggregates.js';
import { computeRiskContribution, renderRiskCard } from './dashboardRiskCard.js';
import { renderAiMetricsBlock, renderResourcesBlock } from './dashboardMetricBlocks.js';
import { renderProfileBanner } from './dashboardProfileBanner.js';

export {
    aggregateAiMetrics,
    formatResourceQty,
    distributeRoundingPreservingSum
} from './dashboardAggregates.js';
export { countAnswerSources, renderProfileBanner } from './dashboardProfileBanner.js';

/* ---------- Период ---------- */

function getPeriod(state) {
    const p = state.ui?.dashboardPeriod;
    return PERIOD_IDS.includes(p) ? p : DEFAULT_PERIOD;
}

function pickTotal(bucket, period) {
    if (!bucket) return 0;
    if (period === 'daily')  return bucket.totalDaily  || 0;
    if (period === 'annual') return bucket.totalAnnual || 0;
    return bucket.totalMonthly || 0;
}

function periodSubtitle(period) {
    return period === 'daily' ? 'в день' : period === 'annual' ? 'в год' : 'в месяц';
}

function periodSlash(period) {
    return period === 'daily' ? '/ день' : period === 'annual' ? '/ год' : '/ мес';
}

function periodSlashCompact(period) {
    return period === 'daily' ? '/д' : period === 'annual' ? '/год' : '/мес';
}

function periodMul(period) {
    return period === 'daily' ? 1 / 30 : period === 'annual' ? MONTHS_PER_YEAR : 1;
}

/* v2.20.74: removed `resourcesWithTokenMetric` helper. Прежде оно
 * инжектировало строку «Токены» в блок «Объёмы ресурсов» — но карточка
 * параллельно рендерит sub-block «Объёмы AI-нагрузки», где «Токены» уже
 * есть как первая метрика. В результате в одном scope (итого и каждый стенд)
 * стенд-карточке) строка «Токены» появлялась дважды — нарушение CLAUDE.md
 * §11 «DRY ВНУТРИ scope: один индикатор на карточку». Сейчас «Объёмы
 * ресурсов» — это строго hardware (CPU/GPU/RAM/SSD/HDD/S3), а AI-метрики
 * (TOKENS / RAG-INDEX / EMBEDDINGS / AGENT_CPU) живут в отдельном
 * sub-блоке ниже. */

/* ---------- Допущения ---------- */

function countAssumptions(calc) {
    const questions = calc?.dictionaries?.questions || [];
    const answers = calc?.answers || {};
    let n = 0;
    for (const q of questions) {
        if (!q.allowUnknown) continue;
        const a = answers[q.id];
        if (a === null || a === undefined) { n++; continue; }
        const def = q.defaultIfUnknown;
        if (def === undefined) continue;
        if (Array.isArray(def) && Array.isArray(a)) {
            if (def.length === a.length && def.every((v, i) => v === a[i])) n++;
        } else if (a === def) {
            n++;
        }
    }
    return n;
}

/* ---------- Public render ---------- */

export function renderDashboard(state, ctx) {
    const calc = state.activeCalc;
    if (!calc) {
        return el('section', { class: 'tab-pane' },
            el('div', { class: 'dashboard-empty' },
                el('p', { text: 'Создайте расчёт во вкладке «Расчёты».' })
            )
        );
    }

    const result = calculate(calc, state.calcRevision);
    const disabledStands = calc.view?.disabledStands || [];
    const period = getPeriod(state);
    const assumptionCount = countAssumptions(calc);
    const activeStands = STAND_IDS.filter(s => !disabledStands.includes(s));
    // Режим определяется параметром расчёта в Опроснике, а не UI-toggle'ом.
    // По умолчанию — TRUE (с рисками); FALSE — «голая» базовая стоимость.
    const applyRisks = calc.settings?.applyRiskFactors !== false;
    const filtered = applyStandFilter(result, disabledStands);
    // 12.U5: агрегаты qty по dashboardResource (для блока «Объёмы ресурсов»).
    // 12.U7: применяется тот же mode-toggle applyRiskFactors что и для стоимостей —
    // при «С рисками» qty включает capacity-буферы (буфер задач/проекта/сезонный/
    // сдвиг/контингент); VAT и инфляция к qty не применяются (это финансовые,
    // не capacity-факторы).
    const resources = aggregateResources(result, calc.dictionaries?.items || [], disabledStands, applyRisks, calc.answers);
    // PATCH 2.14.16-fixup: распределяем округление так, чтобы
    // sum(active per-stand displayed) === total displayed для каждого ресурса.
    const _activeStandsForSum = STAND_IDS.filter(sid => !disabledStands.includes(sid));
    distributeRoundingPreservingSum(resources, _activeStandsForSum);
    // 13.U6: AI-метрики (TOKENS / RAG_VECTORS / EMBEDDINGS / AGENT_CPU) — параллельная
    // ось к hardware-агрегатам. Total-scope вынесен в отдельную строку Dashboard,
    // per-stand scope остаётся внутри стенд-карточек. Блок возвращает
    // null когда в этом scope нет ни одной AI-ЭК с qty>0 — для не-AI расчётов
    // ничего не появляется.
    const aiMetrics = aggregateAiMetrics(result, calc.dictionaries?.items || [], disabledStands, applyRisks, calc);

    return el('section', { class: 'tab-pane', attrs: { 'data-testid': 'dashboard-tab' } },

        /* === Toolbar === */
        el('div', { class: 'tab-toolbar' },
            el('div', { class: 'tab-title-group' },
                el('h2', { class: 'tab-title', text: 'Дэшборд' }),
                renderScenarioBadge(calc)
            ),
            el('div', { class: 'tab-toolbar-actions' },
                renderPeriodSwitcher(period, ctx),
                renderStandToggles(disabledStands, ctx),
                renderAssumptionsBtn(assumptionCount, ctx)
            )
        ),

        renderCalculationProviderPriceActuality(calc, {
            className: 'dashboard-price-actuality',
            title: 'Прайс расчёта',
            testId: 'dashboard-provider-price-actuality'
        }),

        /* === Profile banner (14.U3) — только для wizard-расчётов === */
        renderProfileBanner(calc, ctx),

        /* === Grid === */
        el('div', { class: 'dashboard-grid', attrs: { 'data-testid': 'dashboard-grid' } },
            renderHero(filtered, period, ctx, applyRisks, calc, resources.total, aiMetrics.total),
            // Stage 18.2 (PATCH 2.14.12): «Сводка состояния расчёта» —
            // композитный блок, объединяющий бывшие 4 карточки (Готовность /
            // Качество / Бюджет / Следующие шаги). presentation-only, читает
            // те же domain-источники, ctx-methods и getActiveNextSteps[0].
            renderCalculationStateSummary(calc, ctx),
            renderCategoriesCard(filtered, period, activeStands.length, ctx),
            renderRiskCard(filtered, calc, period, applyRisks),
            // Stage 18.2.x (PATCH 2.14.13): отдельная карточка «План оптимизации
            // стоимости» удалена — entry point встроен как secondary-action
            // внутри composite-сводки (renderCostOptimizationTeaser в
            // calculationStateSummary.js). Domain / контроллер / модалка не тронуты.
            renderStandsRow(result, period, disabledStands, ctx, resources.perStand, applyRisks, calc,
                state.ui?.standCardsCatsExpanded || [], aiMetrics.perStand)
        )
    );
}

/* ---------- Toolbar ---------- */

function renderPeriodSwitcher(period, ctx) {
    return el('div', { class: 'period-switcher', attrs: { role: 'group', 'aria-label': 'Период отображения' } },
        ...PERIOD_IDS.map(p =>
            el('button', {
                class: ['period-btn', p === period && 'period-btn-active'],
                title: `Показывать суммы ${PERIOD_LABELS[p]}`,
                attrs: {
                    type: 'button',
                    'aria-pressed': p === period ? 'true' : 'false',
                    'data-testid': `dashboard-period-${p}`
                },
                onClick: () => { if (p !== period) ctx.setUi?.({ dashboardPeriod: p }); }
            }, PERIOD_LABELS[p])
        )
    );
}

function renderAssumptionsBtn(count, ctx) {
    const hasAssumptions = count > 0;
    return el('button', {
        class: ['btn', 'btn-ghost', 'btn-icon-text', hasAssumptions && 'btn-warning'],
        title: hasAssumptions
            ? `Реестр допущений: ${count} ${count === 1 ? 'вопрос' : 'вопрос(а/ов)'} с принятым значением по умолчанию. Откройте опросник, чтобы заполнить недостающие ответы.`
            : 'Все вопросы заполнены — расчёт без допущений.',
        attrs: { type: 'button' },
        onClick: () => {
            if (typeof ctx.openAssumptionsModal === 'function') {
                ctx.openAssumptionsModal();
            } else {
                ctx.confirm?.({
                    title: 'Реестр допущений',
                    message: `Сейчас расчёт использует ${count} значение(й) по умолчанию. ` +
                        `Откройте опросник, чтобы заполнить недостающие ответы.`,
                    confirmLabel: 'OK'
                });
            }
        }
    },
        icon('alert-triangle', { size: 16 }),
        el('span', { text: `Допущения${hasAssumptions ? ` (${count})` : ''}` })
    );
}

/* ---------- Hero ---------- */

function renderHero(result, period, ctx, applyRisks = true, calc = null, totalResources = null, totalAiMetrics = null) {
    const total = pickTotal(result, period);
    const sub = periodSubtitle(period);
    const mul = periodMul(period);
    const slash = periodSlash(period);

    // 12.U25-fix-6: cells активных стендов для подсчёта суммы рисков в Hero.
    // result.stands копируется по ссылке из filtered (см. applyStandFilter), поэтому
    // фильтруем по result.disabledStands (выставлен только при активном фильтре).
    const heroDisabled = result.disabledStands || [];
    const heroCells = STAND_IDS
        .filter(sid => !heroDisabled.includes(sid))
        .flatMap(sid => result.stands?.[sid]?.items || []);

    // Потенциальная наценка от риск-коэффициентов (всегда считается информационно
    // независимо от applyRisks). В режиме «с рисками» pill означает «уже включено
    // в итог»; в режиме «без рисков» — «было бы +X% если применить».
    // Берём через computeRiskContribution — он одинаково работает в обоих режимах.
    const riskInfo = computeRiskContribution(result, result.disabledStands || []);
    const surplusPct = riskInfo ? riskInfo.surplus * 100 : 0;

    const altPeriods = PERIOD_IDS
        .filter(p => p !== period)
        .map(p => ({
            id: p,
            label: periodSubtitle(p),
            value: p === 'daily' ? result.totalDaily : p === 'annual' ? result.totalAnnual : result.totalMonthly
        }));

    // CAPEX/OPEX из агрегата по активным стендам (filtered).
    const byCostType = result.byCostType || { capex: 0, opex: 0 };
    const ctSum = (byCostType.capex || 0) + (byCostType.opex || 0);
    const capexPct = ctSum > 0 ? byCostType.capex / ctSum : 0;
    const opexPct  = ctSum > 0 ? byCostType.opex  / ctSum : 0;
    const vat = calc ? vatInfo(calc) : null;
    const vatRate = vat?.rate || 0;
    const vatAmount = vat
        ? (vat.enabled ? extractVatAmount(total, vat.vatMul) : total * vatRate)
        : 0;
    const riskAmount = extractRiskAmount(heroCells) * mul;
    const riskPctText = Number.isFinite(surplusPct) && Math.abs(surplusPct) >= 0.05
        ? `${surplusPct >= 0 ? '+' : ''}${formatNumber(surplusPct, { min: 1, max: 1 })}%`
        : null;
    const costTypesBlock = ctSum > 0
        ? el('div', { class: 'dash-hero-cost-types' },
            el('div', { class: 'dash-hero-cost-type-label', text: 'Структура расходов' }),
            /* 12.U25-fix-19: stacked progress bar — визуально показывает пропорцию
               CAPEX/OPEX одной полосой (фиолетовый + бирюзовый сегменты). Под ней
               идут две строки с суммами и % — числа лежат в одной grid-сетке. */
            el('div', {
                class: 'dash-hero-cost-types-bar',
                attrs: { role: 'img',
                    'aria-label': `CAPEX ${formatNumber(capexPct * 100, { min: 1, max: 1 })}%, ` +
                                  `OPEX ${formatNumber(opexPct * 100, { min: 1, max: 1 })}%` }
            },
                el('span', {
                    class: 'dash-hero-cost-types-bar-capex',
                    style: { width: `${(capexPct * 100).toFixed(2)}%` }
                }),
                el('span', {
                    class: 'dash-hero-cost-types-bar-opex',
                    style: { width: `${(opexPct * 100).toFixed(2)}%` }
                })
            ),
            el('div', { class: 'dash-cost-row dash-cost-row-capex',
                title: 'CAPEX — капитальные (разовые) затраты: внедрение, аттестация, аудит, обучение, единоразовая закупка лицензий и оборудования.'
            },
                el('span', { class: 'dash-cost-row-dot' }),
                el('span', { class: 'dash-cost-row-label', text: 'CAPEX' }),
                el('span', { class: 'dash-cost-row-amount',
                    text: fmtRubForPeriod((byCostType.capex || 0) * mul, period) }),
                el('span', { class: 'dash-cost-row-pct', text: percent(capexPct) })
            ),
            el('div', { class: 'dash-cost-row dash-cost-row-opex',
                title: 'OPEX — операционные (регулярные) затраты: облако, лицензии-подписки, услуги, токены LLM, support.'
            },
                el('span', { class: 'dash-cost-row-dot' }),
                el('span', { class: 'dash-cost-row-label', text: 'OPEX' }),
                el('span', { class: 'dash-cost-row-amount',
                    text: fmtRubForPeriod((byCostType.opex || 0) * mul, period) }),
                el('span', { class: 'dash-cost-row-pct', text: percent(opexPct) })
            )
        )
        : null;

    return el('article', {
        class: ['dash-card', 'dash-card-hero', !applyRisks && 'dash-card-hero-base'],
        attrs: { 'data-testid': 'dashboard-hero' }
    },
        el('div', { class: 'dash-card-header' },
            el('div', { class: 'dash-card-eyebrow' },
                icon('trending-up', { size: 14 }),
                el('span', { text: 'Итого по расчёту' }),
                applyRisks
                    ? el('span', { class: 'dash-card-eyebrow-tag',
                        title: 'Итог считается с учётом риск-коэффициентов (буферы, инфляция, сезонность, сдвиг, резерв). Переключатель — в Опроснике, поле «Учитывать риск-коэффициенты в бюджете».',
                        text: 'С РИСКАМИ' })
                    : el('span', { class: 'dash-card-eyebrow-tag dash-card-eyebrow-tag-warn',
                        title: 'Итог считается БЕЗ риск-коэффициентов — это «голая» базовая стоимость по прайс-листам. Переключатель — в Опроснике, поле «Учитывать риск-коэффициенты в бюджете».',
                        text: 'БЕЗ РИСКОВ' }),
                /* 12.U23: НДС — независимая ось от рисков. Бейдж рядом, чтобы пользователь
                   видел оба статуса одним взглядом и не путал «без рисков» с «без НДС». */
                calc ? renderVatBadge(calc) : null
            ),
            /* 12.U30-fix: унифицировано со стенд-карточками — иконка-кнопка
               `dash-stand-card-link` (arrow-up-right 14px без текста) вместо
               прежней `dash-hero-action` с подписью «Детали расчёта». Один
               UI-паттерн «открыть подробности» во всех карточках Дашборда.
               Информационная кнопка-формула (info-icon) — справа, как раньше. */
            el('div', { class: 'dash-hero-actions' },
                el('button', {
                    class: 'dash-stand-card-link',
                    title: 'Открыть постатейную детализацию расчёта',
                    attrs: {
                        type: 'button',
                        'aria-label': 'Открыть детализацию',
                        'data-testid': 'dashboard-hero-details'
                    },
                    onClick: () => ctx.openStandDetails?.()
                }, icon('arrow-up-right', { size: 14 })),
                el('button', {
                    class: 'info-icon',
                    title: 'Как считается итог',
                    attrs: { type: 'button', 'aria-label': 'Показать формулу' },
                    onClick: () => ctx.openSummaryFormula?.()
                }, icon('info', { size: 12 }))
            )
        ),

        el('div', { class: 'dash-hero-body' },
            el('div', { class: 'dash-hero-main' },
                el('div', { class: 'dash-hero-value' },
                    el('span', { class: 'dash-hero-value-amount', text: fmtRubForPeriod(total, period) }),
                    el('span', { class: 'dash-hero-value-unit', text: slash })
                ),
                altPeriods.length === 2
                    ? el('div', { class: 'dash-hero-alt' },
                        ...altPeriods.map(altPeriod => el('div', { class: 'dash-hero-alt-item' },
                            el('span', { class: 'dash-hero-alt-value',
                                text: fmtRubForPeriod(altPeriod.value, altPeriod.id) }),
                            el('span', { class: 'dash-hero-alt-label',
                                text: periodSlashCompact(altPeriod.id) })
                        ))
                    )
                    : null
            ),
            /* Структура расходов стоит в верхнем bar-слоте hero, чтобы CAPEX/OPEX
               bar был выровнен с bars карточек «Распределение» и «Вклад рисков». */
            costTypesBlock,
            el('div', { class: 'dash-hero-breakdown' },
                vatAmount > 0 ? el('div', {
                    class: ['dash-hero-breakdown-row', 'dash-hero-breakdown-row-vat',
                        vat && !vat.enabled && 'dash-hero-breakdown-row-vat-potential'],
                    title: vat?.enabled
                        ? 'НДС рассчитан из итоговой суммы; ставка настраивается в Опроснике.'
                        : 'НДС сейчас не применён к итогу.'
                },
                    el('span', { class: 'dash-hero-breakdown-label', text: 'НДС' }),
                    el('span', { class: 'dash-hero-breakdown-amount', text: fmtRubForPeriod(vatAmount, period) }),
                    el('span', { class: 'dash-hero-breakdown-value', text: `${Math.round(vatRate * 100)}%` })
                ) : null,
                riskAmount > 0 ? el('div', {
                    class: ['dash-hero-breakdown-row', 'dash-hero-breakdown-row-risk',
                        !applyRisks && 'dash-hero-breakdown-row-risk-potential'],
                    title: applyRisks
                        ? 'Риск-коэффициенты уже включены в итог.'
                        : 'Риск-коэффициенты сейчас не применены к итогу.'
                },
                    el('span', { class: 'dash-hero-breakdown-label', text: 'Риски' }),
                    el('span', { class: 'dash-hero-breakdown-amount', text: fmtRubForPeriod(riskAmount, period) }),
                    el('span', { class: 'dash-hero-breakdown-value', text: riskPctText || '—' })
                ) : null
            )
        ),
        renderDashboardTotalMetrics(totalResources, totalAiMetrics, applyRisks, ctx, period)
    );
}

function renderDashboardTotalMetrics(totalResources, totalAiMetrics, applyRisks, ctx, period) {
    if (!totalResources && !totalAiMetrics) return null;

    return el('section', { class: 'dash-dashboard-metrics' },
        totalResources ? renderResourcesBlock(
            totalResources,
            'Объёмы ресурсов · ИТОГО',
            applyRisks,
            /*showModeBadge*/ false,
            period
        ) : null,
        totalAiMetrics ? renderAiMetricsBlock(
            totalAiMetrics,
            'Объёмы AI-нагрузки · ИТОГО',
            applyRisks,
            ctx,
            period
        ) : null
    );
}

/* ---------- Стенды (5 карточек, отсортированных по убыванию суммы) ---------- */

function renderStandsRow(result, period, disabledStands, ctx, perStandResources = {}, applyRisks = true, calc = null, expandedCats = [], perStandAiMetrics = {}) {
    // Сортируем по убыванию `data.totalMonthly`. Disabled-стенды всё равно показываем
    // (приглушёнными), но в конце списка — чтобы сначала шли активные.
    const sorted = STAND_IDS.slice().sort((a, b) => {
        const aOff = disabledStands.includes(a) ? 1 : 0;
        const bOff = disabledStands.includes(b) ? 1 : 0;
        if (aOff !== bOff) return aOff - bOff;
        const am = result.stands?.[a]?.totalMonthly || 0;
        const bm = result.stands?.[b]?.totalMonthly || 0;
        return bm - am;
    });

    return el('section', { class: 'dash-stands-row' },
        el('div', { class: 'dash-section-title' },
            el('span', { text: 'Стенды' })
        ),
        el('div', { class: 'dash-stands-grid' },
            ...sorted.map(sid => renderStandCard(
                sid, result, period, ctx, disabledStands.includes(sid),
                perStandResources[sid] || {}, applyRisks, calc,
                expandedCats.includes(sid),
                perStandAiMetrics[sid] || {}
            ))
        )
    );
}

function renderStandCard(sid, result, period, ctx, isDisabled, standResources = {}, applyRisks = true, calc = null, catsExpanded = false, standAiMetrics = {}) {
    const data = result.stands?.[sid];
    if (!data) return null;
    const total = pickTotal(data, period);
    const share = result.totalMonthly > 0 ? data.totalMonthly / result.totalMonthly : 0;
    const slash = periodSlash(period);
    // alt-период: если основной — мес/день/год, alt берёт другой, отличный от него.
    // Месяц без дробных тыс. — нет смысла; день — 1 знак для согласованности сумм.
    const alt = period === 'monthly'
        ? `${fmtRubForPeriod(data.totalAnnual, 'annual')} / год`
        : `${fmtRubForPeriod(data.totalMonthly, 'monthly')} / мес`;

    const byCat = data.byCategory || {};
    const totalStandMonthly = data.totalMonthly || 0;
    const topCats = CATEGORY_IDS
        .filter(c => (byCat[c] || 0) > 0)
        .sort((a, b) => (byCat[b] || 0) - (byCat[a] || 0));

    const byCostType = data.byCostType || { capex: 0, opex: 0 };
    const ctSum = (byCostType.capex || 0) + (byCostType.opex || 0);
    const capexPct = ctSum > 0 ? byCostType.capex / ctSum : 0;
    const opexPct  = ctSum > 0 ? byCostType.opex  / ctSum : 0;

    const cardArticle = el('article', {
        class: ['dash-stand-card', `stand-card-${sid}`, isDisabled && 'dash-stand-card-disabled'],
        attrs: { 'data-testid': `dashboard-stand-${sid}` }
    },
        /* 12.U24-fix-3: explicit 2-row структура шапки.
         *   row1 (.dash-stand-card-header-top): icon + title-col + arrow
         *   row2 (.dash-stand-card-badges): risk-бейдж + VAT-бейдж
         * Header — flex-direction: column, поэтому ряды всегда лежат друг под другом
         * независимо от длины subtitle. Старая версия полагалась на flex-wrap +
         * `flex-basis: 100%` на бейджах: для коротких subtitle работало, но на
         * длинном (ИФТ — «Интеграционно-функциональное тестирование») arrow
         * переносился на отдельную строку, header растягивался на 3 ряда, числа
         * в разных карточках оказывались на разных вертикальных уровнях. */
        el('div', { class: 'dash-stand-card-header' },
            el('div', { class: 'dash-stand-card-header-top' },
                el('div', { class: 'dash-stand-card-title-wrap' },
                    el('span', { class: 'dash-stand-card-icon' }, icon('server', { size: 16 })),
                    el('div', { class: 'dash-stand-card-title-col' },
                        el('div', { class: 'dash-stand-card-title', text: STAND_LABELS[sid] }),
                        el('div', { class: 'dash-stand-card-subtitle', text: STAND_DESCRIPTIONS[sid] })
                    )
                ),
                el('button', {
                    class: 'dash-stand-card-link',
                    title: 'Открыть детализацию',
                    attrs: {
                        type: 'button',
                        'aria-label': 'Открыть детализацию',
                        'data-testid': `dashboard-stand-${sid}-details`
                    },
                    onClick: () => ctx.openStandDetails?.(sid)
                }, icon('arrow-up-right', { size: 14 }))
            ),
            /* Бейджи в шапке: С РИСКАМИ + С НДС + Доля от итого. На отдельной строке
               под title-row (12.U24-fix-3 explicit 2-row).
               12.U9: бейдж режима — маркер scope ВСЕЙ карточки.
               12.U23: VAT-бейдж — независимый маркер (принцип №22 DRY ВНУТРИ scope).
               12.U25-fix-5: share-бейдж — третий пилл, показывает только %; полное
               пояснение «доля стоимости стенда в общей стоимости расчёта» — в title. */
            el('div', { class: 'dash-stand-card-badges' },
                applyRisks
                    ? el('span', { class: 'dash-stand-card-badge dash-resources-badge dash-resources-badge-risk',
                        title: 'Все суммы и объёмы карточки считаются с учётом риск-коэффициентов (буферы, инфляция, сезонность, сдвиг, резерв). НДС — отдельная ось, см. соседний бейдж. Переключатель рисков — в Опроснике.',
                        text: 'С РИСКАМИ' })
                    : el('span', { class: 'dash-stand-card-badge dash-resources-badge dash-resources-badge-base',
                        title: 'Все суммы и объёмы карточки — БЕЗ риск-коэффициентов (голая базовая стоимость по прайс-листам).',
                        text: 'БЕЗ РИСКОВ' }),
                calc ? renderVatBadge(calc) : null,
                el('span', {
                    class: 'dash-stand-card-share-badge',
                    title: `Доля стоимости этого стенда в общей стоимости расчёта по активным стендам. ` +
                           `Стенд ${STAND_LABELS[sid]} — ${percent(share)} от ИТОГО (${formatRub(result.totalMonthly || 0)} / мес).`,
                    text: percent(share)
                })
            )
        ),

        el('div', { class: 'dash-stand-card-numbers' },
            el('div', { class: 'dash-stand-card-total' },
                el('span', { class: 'dash-stand-card-total-value', text: fmtRubForPeriod(total, period) }),
                el('span', { class: 'dash-stand-card-total-unit', text: slash })
            ),
            /* 12.U25-fix-3: сумма НДС — прямая визуальная связь «total → НДС-составляющая».
               useThousands=true — на Дашборде все суммы с точностью до тысяч. */
            calc ? renderVatBreakdownLine(calc, total, slash, { useThousands: true }) : null,
            /* 12.U25-fix-6: сумма риск-наценки этого стенда — параллельно VAT, под ним.
               cells = data.items (все ячейки этого стенда). При applyRisks=false → null. */
            renderRiskBreakdownLine(data.items || [], applyRisks, periodMul(period), slash, null, { useThousands: true }),
            el('div', { class: 'dash-stand-card-alt', text: alt })
        ),

        /* 12.U26-fix: бейдж «Исключён из ИТОГО» вынесен ВЫШЕ карточки в slot-обёртку
           (см. renderStandCard) — иначе opacity: 0.4 у `.dash-stand-card-disabled`
           глушил его и пользователь не видел причину disabled-состояния. */

        /* CAPEX / OPEX — суммы с долями. Размещаем ВЫШЕ «По категориям»: тип расхода
           (капекс vs опекс) — более крупный финансовый разрез, чем разбивка по категориям
           ЭК. Пользователь сначала видит структуру бюджета, потом — детализацию категорий. */
        ctSum > 0
            ? el('div', { class: 'dash-stand-card-cost-types' },
                el('div', { class: 'dash-cost-row dash-cost-row-capex',
                    title: `${COST_TYPE_LABELS.capex}: капитальные (разовые) затраты`
                },
                    el('span', { class: 'dash-cost-row-dot' }),
                    el('span', { class: 'dash-cost-row-label', text: 'CAPEX' }),
                    /* 12.U30-fix: интервал времени (slash) обязателен — без него
                       пользователь не понимает период при переключении day/мес/год. */
                    el('span', { class: 'dash-cost-row-amount',
                        text: `${fmtRubForPeriod((byCostType.capex || 0) * periodMul(period), period)} ${slash}` }),
                    el('span', { class: 'dash-cost-row-pct', text: percent(capexPct) })
                ),
                el('div', { class: 'dash-cost-row dash-cost-row-opex',
                    title: `${COST_TYPE_LABELS.opex}: операционные (регулярные) затраты`
                },
                    el('span', { class: 'dash-cost-row-dot' }),
                    el('span', { class: 'dash-cost-row-label', text: 'OPEX' }),
                    el('span', { class: 'dash-cost-row-amount',
                        text: `${fmtRubForPeriod((byCostType.opex || 0) * periodMul(period), period)} ${slash}` }),
                    el('span', { class: 'dash-cost-row-pct', text: percent(opexPct) })
                )
            )
            : null,

        /* По категориям — collapsible (12.U25-fix-17). По умолчанию свёрнут;
         * раскрытое состояние per-stand сохраняется в state.ui.standCardsCatsExpanded
         * и переживает F5 (persist через subscriber в app.js).
         * Нажатие на header-кнопку → ctx.toggleStandCatsExpanded(sid). */
        topCats.length > 0
            ? el('div', { class: ['dash-stand-card-cats', catsExpanded && 'dash-stand-card-cats-expanded'] },
                el('button', {
                    class: 'dash-stand-card-cats-toggle',
                    attrs: {
                        type: 'button',
                        'aria-expanded': String(!!catsExpanded),
                        'aria-controls': `cats-body-${sid}`
                    },
                    title: catsExpanded
                        ? 'Свернуть распределение по категориям'
                        : 'Развернуть распределение по категориям',
                    onClick: e => { e.stopPropagation(); ctx.toggleStandCatsExpanded?.(sid); }
                },
                    el('span', { class: 'dash-stand-card-cats-title', text: 'По категориям' }),
                    /* Иконка одна, поворот ↑/↓ через CSS-transform на
                       `.dash-stand-card-cats-expanded .chevron`. Плавный rotate. */
                    el('span', { class: 'dash-stand-card-cats-chevron' },
                        icon('chevron-down', { size: 14 })
                    )
                ),
                catsExpanded
                    ? el('div', { class: 'dash-stand-card-cats-body', attrs: { id: `cats-body-${sid}` } },
                        el('div', { class: 'dash-stand-card-cats-bar', attrs: { role: 'img',
                            'aria-label': 'Распределение по категориям' } },
                            ...topCats.map(cat => {
                                const v = byCat[cat] || 0;
                                const w = totalStandMonthly > 0 ? (v / totalStandMonthly) * 100 : 0;
                                return el('span', {
                                    class: 'dash-stand-card-cats-seg',
                                    style: { width: `${w.toFixed(2)}%`, background: CATEGORY_COLORS[cat] },
                                    title: `${CATEGORY_LABELS[cat]}: ${formatRub(v)} ${slash} (${percent(v / totalStandMonthly)})`
                                });
                            })
                        ),
                        el('div', { class: 'dash-stand-card-cats-legend' },
                            ...topCats.map(cat => {
                                const v = byCat[cat] || 0;
                                const share = totalStandMonthly > 0 ? v / totalStandMonthly : 0;
                                /* Stand-карточки узкие (5 в ряд), label-колонка получает
                                   ~30-40px и обрезается до 3 символов. title= на самой
                                   строке legend-item — hover в любом месте показывает
                                   полное имя категории + точную сумму и долю. */
                                return el('div', {
                                    class: 'dash-stand-card-cats-legend-item',
                                    title: `${CATEGORY_LABELS[cat]}: ${fmtRubForPeriod(v * periodMul(period), period)} ${slash} (${percent(share)})`
                                },
                                    el('span', { class: 'dash-stand-card-cats-legend-dot',
                                        style: { background: CATEGORY_COLORS[cat] } }),
                                    el('span', { class: 'dash-stand-card-cats-legend-label', text: CATEGORY_LABELS[cat] }),
                                    /* 12.U30-fix: интервал (slash) — без него пользователь
                                       не понимает, в каком периоде сумма по категории. */
                                    el('span', { class: 'dash-stand-card-cats-legend-amount',
                                        text: `${fmtRubForPeriod(v * periodMul(period), period)} ${slash}` }),
                                    el('span', { class: 'dash-stand-card-cats-legend-pct',
                                        text: percent(share) })
                                );
                            })
                        )
                    )
                    : null
            )
            : null,

        /* 12.U5/U7/U8/U9: Объёмы ресурсов на этом стенде (qty с/без рисков по тому же
           toggle, что и стоимости карточки). Бейдж режима НЕ показываем здесь — он переехал
           в шапку карточки (рядом с названием стенда), потому что (1) это маркер scope ВСЕЙ
           карточки, (2) для вертикального выравнивания «Объёмов ресурсов» между карточками
           бейдж не должен жить ВНУТРИ выравниваемого блока. */
        renderResourcesBlock(
            standResources,
            'Объёмы ресурсов',
            applyRisks,
            /*showModeBadge*/ false,
            period
        ),

        /* 13.U6: Метрики AI / RAG / агентов на этом стенде. Возвращает null если на стенде
           нет ни одной AI-ЭК с qty>0 (например, на DEV токены не закладываются — блок
           автоматически скроется). */
        renderAiMetricsBlock(standAiMetrics, 'Объёмы AI-нагрузки', applyRisks, ctx, period)
    );

    /* 12.U26-fix: бейдж «Исключён из ИТОГО» — sibling карточки в slot-обёртке.
       Раньше бейдж жил ВНУТРИ карточки и его «съедал» opacity: 0.4 disabled-карточки. */
    if (!isDisabled) return cardArticle;
    return el('div', { class: 'dash-stand-card-slot' },
        el('div', {
            class: 'dash-stand-card-excluded-banner',
            title: 'Стенд исключён из ИТОГО. Чтобы вернуть — нажмите его кнопку в строке «Стенды:» в шапке Дашборда.',
            text: 'Исключён из ИТОГО'
        }),
        cardArticle
    );
}

/* ---------- Распределение по категориям · ИТОГО ---------- */

/* AI-strip с подметриками (TOKENS / RAG_VECTORS / EMBEDDINGS / AGENT_CPU)
   ранее рендерился под прогресс-баром AI-категории. Удалён, потому что
   та же информация уже есть в total-scope блоке «Объёмы AI-нагрузки · ИТОГО»
   через renderAiMetricsBlock — дубль на одном экране визуально шумит. */

function renderCategoriesCard(result, period, activeStandsCount, ctx = {}) {
    const total = result.totalMonthly || 0;
    const byCat = result.byCategory || {};
    const slash = periodSlash(period);
    const sorted = CATEGORY_IDS
        .filter(c => (byCat[c] || 0) > 0)
        .sort((a, b) => (byCat[b] || 0) - (byCat[a] || 0));

    if (sorted.length === 0) {
        return el('article', { class: 'dash-card dash-card-categories' },
            el('div', { class: 'dash-card-header' },
                el('div', { class: 'dash-card-eyebrow' },
                    el('span', { text: 'Распределение по категориям' }),
                    el('span', { class: 'dash-card-eyebrow-tag', text: 'ИТОГО' })
                )
            ),
            el('div', { class: 'dash-card-body dash-categories-empty', text: 'Нет данных для отображения.' })
        );
    }

    return el('article', { class: 'dash-card dash-card-categories' },
        el('div', { class: 'dash-card-header' },
            el('div', { class: 'dash-card-eyebrow' },
                el('span', { text: 'Распределение по категориям' }),
                el('span', { class: 'dash-card-eyebrow-tag', text: 'ИТОГО' })
            ),
            el('div', { class: 'dash-card-eyebrow-sub',
                text: `${activeStandsCount} ${activeStandsCount === 1 ? 'активный стенд' : 'активных стендов'}`
            })
        ),
        el('div', { class: 'dash-card-body dash-categories-body' },
            el('div', { class: 'dash-category-summary' },
                el('div', { class: 'dash-category-summary-main' },
                    el('span', { class: 'dash-category-summary-amount',
                        text: fmtRubForPeriod(total * periodMul(period), period)
                    }),
                    el('span', { class: 'dash-category-summary-period', text: slash })
                )
            ),
            el('div', { class: 'dash-category-segments',
                attrs: {
                    role: 'img',
                    'aria-label': 'Доли категорий в общем бюджете'
                }
            },
                ...sorted.map(cat => {
                    const v = byCat[cat] || 0;
                    const share = total > 0 ? v / total : 0;
                    return el('span', {
                        class: 'dash-category-segment',
                        style: {
                            width: `${(share * 100).toFixed(2)}%`,
                            background: CATEGORY_COLORS[cat]
                        },
                        title: `${CATEGORY_LABELS[cat]}: ${percent(share)} бюджета`
                    });
                })
            ),
            el('div', { class: 'dash-category-table' },
            ...sorted.map(cat => {
                const v = byCat[cat] || 0;
                const share = total > 0 ? v / total : 0;
                return el('div', { class: 'dash-category-row' },
                    el('span', {
                        class: 'dash-category-row-label',
                        /* title= с расшифровкой содержания категории — что именно
                           попадает в эту группу расходов. Дополняет короткий ярлык
                           («Услуги», «Резервы»), не дублирует его. */
                        title: CATEGORY_DESCRIPTIONS[cat]
                    },
                        el('span', { class: 'dash-category-row-dot', style: { background: CATEGORY_COLORS[cat] } }),
                        el('span', { text: CATEGORY_LABELS[cat] })
                    ),
                    /* 12.U25-fix-14: сначала сумма (главное число), затем % (вторичная метрика).
                       Раньше «34,3% 2 444 тыс. ₽» — цифры читались справа налево; теперь
                       «2 444 тыс. ₽ 34,3%» — типичный финансовый порядок (number → share). */
                    el('span', { class: 'dash-category-row-value',
                        text: fmtRubForPeriod(v * periodMul(period), period) }),
                    el('span', { class: 'dash-category-row-pct', text: percent(share) })
                );
            })
            )
        )
    );
}
