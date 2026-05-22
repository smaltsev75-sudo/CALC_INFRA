/**
 * Вкладка «Расчёты».
 *
 * UI-правило: каждое действие имеет ровно одну кнопку в видимой области.
 * Импорт ОДНОГО расчёта живёт в шапке («Импорт JSON») — глобально доступен с
 * любой вкладки. Здесь — только специфичные операции для управления списком:
 *   ➕ Новый расчёт   — создание (с хоткеем Ctrl+Alt+N).
 *   📦 Полный экспорт — bundle всего состояния (≠ единичному экспорту в шапке).
 *   📥 Полный импорт  — bundle-замена всего состояния (≠ добавочному импорту).
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { formatRubThousands, dateTime } from '../services/format.js';
import { SEED_QUESTIONS, SEED_ITEMS } from '../domain/seed.js';
import { STAND_IDS, STAND_LABELS } from '../utils/constants.js';
import { getCurrentVatRate } from '../domain/vatRateTable.js';

export function renderCalcList(state, ctx) {
    const list = state.calcList;
    return el('section', { class: 'tab-pane' },
        el('div', { class: 'tab-toolbar' },
            el('h2', { class: 'tab-title', text: 'Расчёты' }),
            el('div', { class: 'tab-toolbar-actions' },
                /* Sprint 3.0 Stage 3 финализация: Quick Start — главная точка входа.
                   До этого Quick Start был доступен только в empty-state (когда
                   список расчётов пуст). После создания первого расчёта пользователь
                   терял доступ к нему — все последующие расчёты создавались только
                   через newCalcModal со шаблон-select'ом. Теперь обе точки входа
                   видны всегда: Quick Start (primary, новичок) + Новый расчёт
                   (secondary, опытный пользователь хочет пустой шаблон). */
                /* Stage 4.9/4.14 → Stage 17.2: единственная точка входа в создание — Quick Start.
                   3 preset'а после Stage 17.2 (4-й «Пустой расчёт» удалён, дублировал
                   ctx.createCalc(name, null) из CRUD-flow). */
                el('button', {
                    class: 'btn btn-primary btn-icon-text',
                    title: 'Открыть Quick Start: заполнить 8 параметров (готовый расчёт за пару минут) — Ctrl+Alt+N.',
                    attrs: { type: 'button', 'data-testid': 'quickstart-open-toolbar' },
                    onClick: () => ctx.openQuickStart()
                },
                    icon('sparkles', { size: 16 }),
                    el('span', { text: 'Quick Start' })
                ),
                el('span', { class: 'toolbar-divider' }),
                el('button', {
                    class: 'btn btn-ghost btn-icon-text',
                    title: 'Скачать резервную копию всех расчётов и справочников одним файлом. Полезно для backup и переноса на другой компьютер.',
                    attrs: { type: 'button', 'data-testid': 'bundle-export' },
                    onClick: (e) => ctx.exportStateBundle(e)
                },
                    icon('package', { size: 16 }),
                    el('span', { text: 'Полный экспорт' })
                ),
                el('button', {
                    class: 'btn btn-ghost btn-icon-text',
                    title: 'Восстановить все расчёты из ранее сохранённой резервной копии. Внимание: текущие расчёты будут удалены!',
                    attrs: { type: 'button', 'data-testid': 'bundle-import' },
                    onClick: (e) => ctx.importStateBundle(e)
                },
                    icon('upload', { size: 16 }),
                    el('span', { text: 'Полный импорт' })
                )
            )
        ),

        list.length === 0
            ? renderEmptyState(ctx)
            : el('div', { class: 'calc-cards' },
                ...list.map(meta => renderCalcCard(meta, state, ctx))
            )
    );
}

function renderEmptyState(ctx) {
    // Welcome / entry-point: позитивный фрейминг, hero-icon в круге, три stat-чипа
    // с фактами наполнения справочников (вопросы / ЭК / стенды), primary CTA
    // «Quick Start» рядом с ghost-кнопкой «Импорт JSON». Импорт здесь
    // дублирует кнопку «Импорт JSON» в шапке, но в empty-state это первичная точка
    // входа, поэтому она не должна быть скрыта в мелком hint-блоке.
    return el('div', { class: 'empty-state empty-state-welcome' },
        el('div', { class: 'empty-state-hero', attrs: { 'aria-hidden': 'true' } },
            icon('bar-chart-3', { size: 44 })
        ),
        el('div', { class: 'empty-state-title', text: 'Создайте ваш первый расчёт' }),
        el('div', { class: 'empty-state-subtitle',
            text: 'Справочники уже наполнены типовыми шаблонами — заполните опросник за пару минут и получите оценку полной стоимости инфраструктуры (CAPEX + OPEX) с разбивкой по стендам, категориям и риск-коэффициентам.'
        }),

        el('div', { class: 'empty-state-stats', attrs: { role: 'list', 'aria-label': 'Что уже готово к работе' } },
            renderWelcomeStat('clipboard-list', SEED_QUESTIONS.length, 'вопросов в опроснике'),
            renderWelcomeStat('table-2', SEED_ITEMS.length, 'элементов инфраструктуры'),
            renderWelcomeStat('sliders-horizontal', STAND_IDS.length, 'стендов: DEV → ПРОМ')
        ),

        el('div', { class: 'empty-state-actions' },
            /* Stage 4.9/4.14 → Stage 17.2: единственная primary-точка — Quick Start.
               Кнопка «Новый расчёт» в toolbar убрана; 3 preset'а после Stage 17.2.
               Secondary-кнопка — импорт из JSON. */
            el('button', {
                class: 'btn btn-primary btn-large btn-icon-text',
                title: 'Заполнить 8 параметров (готовый расчёт за пару минут) — Quick Start (Ctrl+Alt+N).',
                attrs: { type: 'button', 'data-testid': 'quickstart-open-empty' },
                onClick: () => ctx.openQuickStart()
            },
                icon('sparkles', { size: 18 }),
                el('span', { text: 'Quick Start' })
            ),
            el('button', {
                class: 'btn btn-ghost btn-large btn-icon-text',
                title: 'Импорт ранее сохранённого расчёта из JSON-файла (Ctrl+Alt+O)',
                attrs: { type: 'button', 'data-testid': 'empty-import-json' },
                onClick: (e) => ctx.importCalc(e)
            },
                icon('folder-open', { size: 18 }),
                el('span', { text: 'Импорт JSON' })
            )
        ),

        el('div', { class: 'empty-state-hotkeys', attrs: { 'aria-hidden': 'true' } },
            el('span', {},
                el('kbd', { text: 'Ctrl+Alt+N' }),
                el('span', { text: ' — Quick Start' })
            ),
            el('span', { class: 'empty-state-hotkeys-sep', text: '·' }),
            el('span', {},
                el('kbd', { text: 'Ctrl+Alt+O' }),
                el('span', { text: ' — открыть из файла' })
            )
        )
    );
}

/** Русская плюрализация для счётчиков на calc-card chips: «1 сценарий», «2 сценария», «5 сценариев». */
function pluralizeRu(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
}

function renderWelcomeStat(iconName, value, label) {
    return el('div', { class: 'empty-state-stat', attrs: { role: 'listitem' } },
        el('div', { class: 'empty-state-stat-icon', attrs: { 'aria-hidden': 'true' } },
            icon(iconName, { size: 18 })
        ),
        el('div', { class: 'empty-state-stat-value', text: String(value) }),
        el('div', { class: 'empty-state-stat-label', text: label })
    );
}

/* 12.U25-fix-15: редизайн карточки расчёта (UX-аудит).
 *
 * Старая раскладка боролась за визуальный вес: «Стоимость/мес» и «Стоимость/год»
 * рендерились идентично — пользователь не понимал, где главное число; «Режим
 * расчёта» был label+pills (label выглядел как простой текст), даты и иконки
 * сливались в одну строку без разделителя.
 *
 * Новая структура (8px-grid):
 *   header  — название + индикатор активного расчёта (точка с glow)
 *   metric  — eyebrow «Стоимость в год» (11px upper, muted) → HERO 28px bold
 *             accent → secondary «↓ X тыс. ₽/мес» (13px muted, mono)
 *   chips   — статусные pills С рисками / С НДС (без избыточной подписи)
 *   footer  — divider + дата (мелкая) + tray действий (со своим bg-фоном)
 *
 * Принципы UX:
 *   - Близость: год+месяц в одном блоке (одна метрика, два формата); даты
 *     отдельно (вторичная мета).
 *   - Контраст: год — accent + 28px / 700; месяц — muted + 13px; дата —
 *     dim + 11px. Тройная иерархия читается одним взглядом.
 *   - Доступность: <h3> для имени; индикатор активного — color+ring+aria-label
 *     (не только цвет); chips остаются `cursor: help` (статусные, не кнопки —
 *     не вводим в заблуждение «можно нажать», но визуально различимы как
 *     отдельные единицы).
 */
function renderCalcCard(meta, state, ctx) {
    const isActive = state.activeCalc?.id === meta.id;

    const applyRisks = meta.applyRiskFactors !== false;
    const vatEnabled = meta.vatEnabled !== false;
    const vatRatePct = Math.round((Number.isFinite(meta.vatRate) ? meta.vatRate : getCurrentVatRate()) * 100);

    /* Stage 4.2: чип «Исключено: …» когда у расчёта есть отключённые стенды
       (calc.view.disabledStands). Формат: 1-2 имени списком, 3+ — первые два
       + «+N». Пользователь сразу видит что отключено, не открывая calc. */
    const disabledStandsRaw = Array.isArray(meta.disabledStands) ? meta.disabledStands : [];
    const disabledStands = disabledStandsRaw
        .filter(s => STAND_IDS.includes(s))
        .map(s => STAND_LABELS[s] || s);
    let disabledChipText = '';
    let disabledChipTitle = '';
    if (disabledStands.length === 1) {
        disabledChipText = `Исключено: ${disabledStands[0]}`;
        disabledChipTitle = `Стенд ${disabledStands[0]} исключён из ИТОГО. Изменить — кнопками над стенд-карточками на дашборде.`;
    } else if (disabledStands.length === 2) {
        disabledChipText = `Исключено: ${disabledStands[0]}, ${disabledStands[1]}`;
        disabledChipTitle = `Стенды ${disabledStands.join(', ')} исключены из ИТОГО. Изменить — кнопками над стенд-карточками на дашборде.`;
    } else if (disabledStands.length >= 3) {
        const head = disabledStands.slice(0, 2).join(', ');
        const rest = disabledStands.length - 2;
        disabledChipText = `Исключено: ${head} +${rest}`;
        disabledChipTitle = `Исключены из ИТОГО: ${disabledStands.join(', ')}. Изменить — кнопками над стенд-карточками на дашборде.`;
    }

    /* Stage 4.5: чип «N сценариев» — показывает multi-profile расчёты в списке.
       Скрыт при count=1 (избегаем chip-overload для типичного single-scenario calc). */
    const scenarioCount = Number.isFinite(meta.scenarioCount) && meta.scenarioCount > 0
        ? meta.scenarioCount : 1;
    const scenariosChipText = scenarioCount > 1
        ? `${scenarioCount} ${pluralizeRu(scenarioCount, 'сценарий', 'сценария', 'сценариев')}`
        : '';
    const scenariosChipTitle = scenarioCount > 1
        ? `В расчёте ${scenarioCount} сценариев — отдельных профилей. Открыть расчёт, чтобы переключаться между ними.`
        : '';

    return el('article', {
        class: ['calc-card', isActive && 'calc-card-active'],
        onClick: () => ctx.openCalc(meta.id)
    },
        el('header', { class: 'calc-card-header' },
            el('h3', { class: 'calc-card-name', text: meta.name || '—', title: meta.name }),
            isActive
                ? el('span', {
                    class: 'calc-card-active-dot',
                    title: 'Этот расчёт открыт сейчас',
                    attrs: { 'aria-label': 'Активный расчёт' }
                })
                : null
        ),

        el('div', { class: 'calc-card-metric' },
            el('div', { class: 'calc-card-metric-eyebrow', text: 'Стоимость в год' }),
            el('div', { class: 'calc-card-metric-hero',
                text: formatRubThousands(meta.totalAnnual) }),
            /* 12.U30-fix: убраны иконка-стрелка и пояснительный tooltip про
               соотношение год/месяц — текст «X тыс. ₽ / мес» сам по себе понятен. */
            el('div', { class: 'calc-card-metric-sub' },
                el('span', { text: `${formatRubThousands(meta.totalMonthly)} / мес` })
            )
        ),

        el('div', { class: 'calc-card-chips' },
            applyRisks
                ? el('span', { class: 'calc-card-chip calc-card-chip-ok',
                    title: 'Бюджет считается с учётом всех риск-коэффициентов (буферы, инфляция, сезонность, сдвиг расписания, резерв). Это итоговая стоимость для заказчика. Изменить можно в Опроснике.',
                    text: 'С рисками' })
                : el('span', { class: 'calc-card-chip calc-card-chip-warn',
                    title: 'Бюджет считается БЕЗ риск-коэффициентов — это базовая стоимость по прайс-листам поставщиков. Изменить можно в Опроснике.',
                    text: 'Без рисков' }),
            vatEnabled
                ? el('span', { class: 'calc-card-chip calc-card-chip-vat',
                    title: `Все суммы включают НДС ${vatRatePct}%. Выключить — в Опроснике, подгруппа «НДС».`,
                    text: `С НДС ${vatRatePct}%` })
                : el('span', { class: 'calc-card-chip calc-card-chip-novat',
                    title: 'Все суммы — БЕЗ НДС. Включить — в Опроснике, подгруппа «НДС».',
                    text: 'БЕЗ НДС' }),
            disabledChipText
                ? el('span', { class: 'calc-card-chip calc-card-chip-stands',
                    title: disabledChipTitle,
                    text: disabledChipText })
                : null,
            scenariosChipText
                ? el('span', { class: 'calc-card-chip calc-card-chip-scenarios',
                    title: scenariosChipTitle,
                    text: scenariosChipText })
                : null
        ),

        el('footer', { class: 'calc-card-footer' },
            el('span', { class: 'calc-card-date',
                title: 'Дата последнего сохранения расчёта',
                text: dateTime(meta.updatedAt) }),
            el('div', { class: 'calc-card-actions' },
                el('button', {
                    class: 'calc-card-action',
                    title: 'Открыть расчёт',
                    attrs: { type: 'button', 'aria-label': 'Открыть' },
                    onClick: e => { e.stopPropagation(); ctx.openCalc(meta.id); }
                }, icon('play', { size: 14 })),
                el('button', {
                    class: 'calc-card-action',
                    title: 'Дублировать расчёт',
                    attrs: { type: 'button', 'aria-label': 'Дублировать' },
                    onClick: e => { e.stopPropagation(); ctx.duplicateCalc(meta.id); }
                }, icon('copy', { size: 14 })),
                el('button', {
                    class: 'calc-card-action',
                    title: 'Переименовать расчёт',
                    attrs: { type: 'button', 'aria-label': 'Переименовать' },
                    onClick: e => { e.stopPropagation(); ctx.renameCalc(meta.id, meta.name); }
                }, icon('edit', { size: 14 })),
                el('button', {
                    class: 'calc-card-action calc-card-action-danger',
                    title: 'Удалить расчёт (можно отменить)',
                    attrs: { type: 'button', 'aria-label': 'Удалить' },
                    onClick: e => { e.stopPropagation(); ctx.deleteCalc(meta.id, meta.name); }
                }, icon('trash', { size: 14 }))
            )
        )
    );
}
