/**
 * Stage 18.2.x — Consistency / Theme Hygiene / Formula Text Fix
 *
 * Локальные регрессионные инварианты для PATCH 2.14.14:
 *   C1  store.js использует MAX_COMPARISON_CALCS, не литерал 4.
 *   C2  openSummaryFormula не называет НДС риск-коэффициентом.
 *   U1  dashboard.css не содержит var(--muted) (токен не определён в base.css).
 *   U2  .calc-state-summary-badge-warning/danger и .calc-state-summary-next-high/medium
 *       используют theme tokens (var(--warning)/var(--danger)), без хардкод-hex.
 *   U3  .calc-state-summary-next-info использует var(--text-muted);
 *       renderNextStep навешивает aria-label с priority (не полагается только на цвет).
 *   U4  applyThemeAttribute обновляет meta[name="theme-color"] под выбранную тему.
 *   C3  buildContext не пересобирает questionDefaults внутри тела;
 *       calculate() строит их один раз через buildQuestionDefaults.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { stripCssComments, stripJsComments, ruleBody } from '../../_helpers/source.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..', '..', '..');

function read(rel) {
    return readFileSync(resolve(ROOT, rel), 'utf8');
}

/* ----------------- C1: MAX_COMPARISON_CALCS в store ----------------- */

test('C1: js/state/store.js импортирует MAX_COMPARISON_CALCS', () => {
    const src = read('js/state/store.js');
    assert.match(
        src,
        /import\s*\{[^}]*MAX_COMPARISON_CALCS[^}]*\}\s*from\s*['"]\.\.\/utils\/constants\.js['"]/,
        'store.js должен импортировать MAX_COMPARISON_CALCS из constants.js'
    );
});

test('C1: store.js setComparisonIds / addComparisonId используют MAX_COMPARISON_CALCS, не литерал 4', () => {
    const src = stripJsComments(read('js/state/store.js'));
    // ищем хардкоды лимита: slice(0, 4) и >= 4
    assert.equal(
        /\.slice\(\s*0\s*,\s*4\s*\)/.test(src), false,
        'store.js не должен содержать .slice(0, 4) — заменить на MAX_COMPARISON_CALCS'
    );
    assert.equal(
        /current\.length\s*>=\s*4(?!\d)/.test(src), false,
        'store.js не должен содержать current.length >= 4 — заменить на MAX_COMPARISON_CALCS'
    );
    // Позитивно: оба call-site содержат имя константы
    const occurrences = (src.match(/MAX_COMPARISON_CALCS/g) || []).length;
    assert.ok(
        occurrences >= 3,
        `store.js должен ссылаться на MAX_COMPARISON_CALCS минимум 3 раза (import + 2 use), найдено ${occurrences}`
    );
});

/* ----------------- C2: openSummaryFormula — НДС отдельно ----------------- */

test('C2: openSummaryFormula не называет НДС риск-коэффициентом', () => {
    const src = read('js/app/printActions.js');
    // Найти message текста openSummaryFormula по фрагменту-якорю
    const anchor = src.indexOf('«Итого по расчёту» — общая стоимость');
    assert.ok(anchor > 0, 'не нашёл якорь текста openSummaryFormula');
    // Текст модалки занимает ~30 строк; берём с запасом
    const messageBody = src.slice(anchor, anchor + 3500);

    assert.equal(
        /шесть\s+риск-коэффициентов/i.test(messageBody), false,
        'openSummaryFormula не должен содержать «шесть риск-коэффициентов» (12.U20: НДС не риск)'
    );
    // НДС не должен быть в одном перечислении с risk-факторами.
    assert.equal(
        /буферы[^.]*инфляция[^.]*сезонность[^.]*НДС/i.test(messageBody), false,
        'НДС не должен перечисляться в одном списке с буферы/инфляция/сезонность'
    );
    // Позитивно: должен явно говорить «НДС — это налог, а не риск»
    assert.match(
        messageBody,
        /НДС\s*—\s*это\s+налог,?\s*а\s+не\s+риск/i,
        'openSummaryFormula должен явно объяснить, что НДС — налог, а не риск'
    );
    // Позитивно: «пять риск-коэффициентов»
    assert.match(
        messageBody,
        /пять\s+риск-коэффициентов/i,
        'openSummaryFormula должен говорить «пять риск-коэффициентов» (без НДС)'
    );
});

/* ----------------- U1: var(--muted) удалён из dashboard.css ----------------- */

test('U1: dashboard.css не содержит var(--muted) — токен не определён', () => {
    const src = stripCssComments(read('css/dashboard.css'));
    const matches = src.match(/var\(--muted\)/g) || [];
    assert.equal(
        matches.length, 0,
        `dashboard.css не должен содержать var(--muted) (токен нигде не определён), найдено: ${matches.length}`
    );
});

test('U1: --muted не определён ни в одном CSS-файле (либо удалить, либо определить)', () => {
    const files = [
        'css/base.css', 'css/components.css', 'css/dashboard.css',
        'css/forms.css', 'css/tables.css', 'css/comparison.css',
        'css/modals.css', 'css/sidebar.css', 'css/layout.css', 'css/print.css'
    ];
    for (const f of files) {
        const src = stripCssComments(read(f));
        const defined = /^\s*--muted\s*:/m.test(src);
        assert.equal(
            defined, false,
            `${f}: --muted нигде не должен быть определён (используем --text-muted)`
        );
    }
});

/* ----------------- U2: badges на theme tokens ----------------- */

test('U2: calc-state-summary-badge-warning использует var(--warning)', () => {
    const body = ruleBody(read('css/dashboard.css'), '.calc-state-summary-badge-warning');
    assert.match(body, /color:\s*var\(--warning\)/);
    assert.match(body, /var\(--warning\)/);
});

test('U2: calc-state-summary-badge-danger использует var(--danger)', () => {
    const body = ruleBody(read('css/dashboard.css'), '.calc-state-summary-badge-danger');
    assert.match(body, /color:\s*var\(--danger\)/);
    assert.match(body, /var\(--danger\)/);
});

test('U2: calc-state-summary-* не содержит #f59e0b / #ef4444', () => {
    const raw = read('css/dashboard.css');
    // Stage 18.2 блок: от первого .calc-state-summary-badge-ready до начала
    // следующей секции «Stage 18.1 (v2.13.0) — Cost Optimization Planner»
    // (она в файле дальше — порядок не chronological, а тематический;
    //  Stage 18.1 живёт в комментарии-разделителе, поэтому работаем с raw).
    const start = raw.indexOf('.calc-state-summary-badge-ready');
    assert.ok(start > 0, 'не нашёл селектор .calc-state-summary-badge-ready');
    const sectionEnd = raw.indexOf('Stage 18.1 (v2.13.0)', start);
    assert.ok(sectionEnd > 0, 'не нашёл якорь конца Stage 18.2-блока');
    // Внутри среза удаляем CSS-комментарии (чтобы не словить упоминание hex в палитро-доке).
    const block = stripCssComments(raw.slice(start, sectionEnd));
    const ambar = block.match(/#f59e0b/gi) || [];
    const red = block.match(/#ef4444/gi) || [];
    assert.equal(ambar.length, 0, `Stage 18.2 .calc-state-summary-* не должно содержать #f59e0b: найдено ${ambar.length}`);
    assert.equal(red.length, 0, `Stage 18.2 .calc-state-summary-* не должно содержать #ef4444: найдено ${red.length}`);
});

test('U2: calc-state-summary-next-high/medium используют theme tokens', () => {
    const high = ruleBody(read('css/dashboard.css'), '.calc-state-summary-next-high');
    const medium = ruleBody(read('css/dashboard.css'), '.calc-state-summary-next-medium');
    assert.match(high, /var\(--danger\)/);
    assert.match(medium, /var\(--warning\)/);
});

/* ----------------- U5: все sub-cards composite-сводки имеют одинаковый bg ----------------- */

test('U5: .calc-state-summary-{row,next,optimization} имеют идентичный background', () => {
    const src = read('css/dashboard.css');
    const row = ruleBody(src, '.calc-state-summary-row');
    const next = ruleBody(src, '.calc-state-summary-next');
    const opt = ruleBody(src, '.calc-state-summary-optimization');

    // Все три sub-card должны использовать --bg-elevated (с фолбэком на --bg-card)
    const expected = /background:\s*var\(--bg-elevated[^)]*\)/;
    assert.match(row, expected, '.calc-state-summary-row должен использовать --bg-elevated');
    assert.match(next, expected, '.calc-state-summary-next должен использовать --bg-elevated');
    assert.match(opt, expected, '.calc-state-summary-optimization должен использовать --bg-elevated (не transparent)');

    // Защита от регрессии: optimization не должен быть transparent
    assert.equal(
        /background:\s*transparent/.test(opt), false,
        '.calc-state-summary-optimization не должен быть transparent — иначе просвечивает --bg-card родителя и подложка отличается от siblings'
    );
});

/* ----------------- U3: next-info + aria-label ----------------- */

test('U3: calc-state-summary-next-info использует var(--text-muted)', () => {
    const body = ruleBody(read('css/dashboard.css'), '.calc-state-summary-next-info');
    assert.match(body, /border-left-color:\s*var\(--text-muted\)/);
});

test('U3: renderNextStep навешивает aria-label с priority (priority не только цветом)', () => {
    const src = read('js/ui/calculationStateSummary.js');
    // карта priority labels
    assert.match(src, /NEXT_STEP_PRIORITY_LABELS\s*=\s*\{[\s\S]*high[\s\S]*medium[\s\S]*low[\s\S]*info[\s\S]*\}/);
    // aria-label в renderNextStep
    const renderStart = src.indexOf('function renderNextStep');
    assert.ok(renderStart > 0);
    const renderEnd = src.indexOf('\n}\n', renderStart);
    const renderBody = src.slice(renderStart, renderEnd > 0 ? renderEnd : renderStart + 4000);
    assert.match(renderBody, /'aria-label'/, 'renderNextStep должен ставить aria-label на контейнер');
    assert.match(renderBody, /priorityLabel|priority/i);
});

/* ----------------- U4: theme-color sync ----------------- */

test('U4: index.html содержит meta[name="theme-color"]', () => {
    const src = read('index.html');
    assert.match(src, /<meta\s+name=["']theme-color["']\s+content=["']#[0-9a-fA-F]{3,6}["']/);
});

test('U4: applyThemeAttribute обновляет meta[name="theme-color"] под выбранную тему', () => {
    const src = stripJsComments(read('js/app/theme.js'));
    // карта цветов
    assert.match(
        src,
        /THEME_COLOR_BY_THEME\s*=\s*Object\.freeze\(\s*\{[\s\S]*dark\s*:\s*['"]#[0-9a-fA-F]+['"][\s\S]*light\s*:\s*['"]#[0-9a-fA-F]+['"]/,
        'theme.js должен содержать карту THEME_COLOR_BY_THEME для dark/light'
    );
    // setAttribute('content', ...) внутри applyThemeAttribute
    const start = src.indexOf('function applyThemeAttribute');
    assert.ok(start > 0);
    const fnEnd = src.indexOf('\n}', start);
    const fnBody = src.slice(start, fnEnd > 0 ? fnEnd : start + 2000);
    assert.match(fnBody, /meta\[name=["']theme-color["']\]/);
    assert.match(fnBody, /setAttribute\(\s*['"]content['"]/);
});

/* ----------------- C3: questionDefaults вычисляется один раз ----------------- */

test('C3: buildContext не пересобирает questionDefaults (no `for (const q of questions)` внутри тела)', () => {
    const src = stripJsComments(read('js/domain/calculator.js'));
    const start = src.indexOf('function buildContext(');
    assert.ok(start > 0);
    // Тело buildContext до следующего function-объявления
    const next = src.indexOf('\nfunction ', start + 1);
    const body = src.slice(start, next > 0 ? next : start + 5000);
    assert.equal(
        /for\s*\(\s*const\s+q\s+of\s+questions\s*\)/.test(body), false,
        'buildContext не должен пересобирать questionDefaults внутри тела'
    );
});

test('C3: calculate() строит questionDefaults через buildQuestionDefaults один раз', () => {
    const src = stripJsComments(read('js/domain/calculator.js'));
    assert.match(src, /function\s+buildQuestionDefaults\s*\(/);
    assert.match(src, /const\s+questionDefaults\s*=\s*buildQuestionDefaults\s*\(\s*questions\s*\)/);
    // buildContext получает questionDefaults, не questions
    assert.match(src, /buildContext\(\s*answers\s*,\s*settings\s*,\s*questionDefaults\s*,\s*stand/);
});
