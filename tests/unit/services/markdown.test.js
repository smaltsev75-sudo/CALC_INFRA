/**
 * Регрессионные тесты Markdown-санитайзера ([js/services/markdown.js]).
 *
 * Цель — зафиксировать поведение `renderMarkdown` на потенциально опасных
 * входах, чтобы рефакторинг парсера не открыл XSS-вектор.
 *
 * Покрываются ветки:
 *  - `inline()` — экранирование тегов в обычном тексте, тексте ссылки, bold;
 *  - `safeUrl()` — фильтрация javascript:/data:/vbscript: и whitelisting
 *    http(s)://, mailto:, #anchor;
 *  - code-block (```...```) — экранирование метасимволов;
 *  - таблицы | a | b | — экранирование содержимого ячеек.
 *
 * Все ассерты формулируются как «нет активного HTML-тега», то есть в выходе
 * не должно встречаться `<script>`, `<img ...>` и т.п. без `&lt;`-замены.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../../../js/services/markdown.js';

/** Регулярка «есть активный тег <script>» (открывающий, без `&lt;`). */
const ACTIVE_SCRIPT_RE = /<script\b/i;
/** Регулярка «есть активный тег <img>» (открывающий, без `&lt;`). */
const ACTIVE_IMG_RE = /<img\b/i;

describe('Stage 18.1.11 — table alignment из separator `:---`/`---:`/`:---:`', () => {
    /* Глобальное правило проекта: «все цифровые значения в таблицах должны быть
       выровнены по правому краю». Markdown-таблицы поддерживают alignment через
       separator-строку: `|---|--:|:--|:-:|`. До 18.1.11 парсер игнорировал её,
       все cells выводились без `align`-атрибута → CSS правила вида
       `td[align="right"]` не срабатывали → числовые колонки слева в HTML-рендере.

       Эти тесты документируют контракт «separator → align-атрибут на th/td». */

    it('separator `--:` → `align="right"` на th и td', () => {
        const md = [
            '| Параметр | Сумма |',
            '|---|--:|',
            '| LLM | 1000 |'
        ].join('\n');
        const html = renderMarkdown(md);
        // На второй колонке (Сумма) должен быть align="right" в th И в td.
        assert.match(html, /<th align="right">[^<]*Сумма[^<]*<\/th>/);
        assert.match(html, /<td align="right">[^<]*1000[^<]*<\/td>/);
        // На первой колонке (Параметр) align-атрибут НЕ должен ставиться (left = default).
        assert.match(html, /<th>[^<]*Параметр[^<]*<\/th>/);
    });

    it('separator `:---` → `align="left"` (явный)', () => {
        const md = ['| A | B |', '|:--|---|', '| 1 | 2 |'].join('\n');
        const html = renderMarkdown(md);
        assert.match(html, /<th align="left">[^<]*A[^<]*<\/th>/);
    });

    it('separator `:---:` → `align="center"`', () => {
        const md = ['| A | B |', '|:-:|---|', '| 1 | 2 |'].join('\n');
        const html = renderMarkdown(md);
        assert.match(html, /<th align="center">[^<]*A[^<]*<\/th>/);
    });

    it('separator без двоеточий → align-атрибут не добавляется', () => {
        const md = ['| A | B |', '|---|---|', '| 1 | 2 |'].join('\n');
        const html = renderMarkdown(md);
        // Никаких align'ов нет — default alignment, как и было.
        assert.doesNotMatch(html, /<th align=/);
        assert.doesNotMatch(html, /<td align=/);
    });

    it('multi-column таблица — каждая колонка парсится независимо', () => {
        const md = [
            '| # | Параметр | Сумма | Доля |',
            '|--:|---|--:|--:|',
            '| 1 | LLM | 1000 | 30 % |'
        ].join('\n');
        const html = renderMarkdown(md);
        // Колонки 1, 3, 4 — right; колонка 2 — default.
        const tdMatches = html.match(/<td[^>]*>[^<]*<\/td>/g) || [];
        assert.equal(tdMatches.length, 4);
        assert.match(tdMatches[0], /align="right"/, 'cell # должна быть right');
        assert.doesNotMatch(tdMatches[1], /align=/,   'cell Параметр без align (left = default)');
        assert.match(tdMatches[2], /align="right"/, 'cell Сумма должна быть right');
        assert.match(tdMatches[3], /align="right"/, 'cell Доля должна быть right');
    });
});

describe('renderMarkdown: XSS via <script> в тексте', () => {
    it('экранирует <script> в обычном параграфе', () => {
        const html = renderMarkdown('<script>alert(1)</script>');
        assert.equal(ACTIVE_SCRIPT_RE.test(html), false, `got: ${html}`);
        assert.equal(html.includes('&lt;script&gt;'), true, `got: ${html}`);
    });

    it('экранирует <script> внутри code-block', () => {
        const md = '```\n<script>alert(1)</script>\n```';
        const html = renderMarkdown(md);
        assert.equal(ACTIVE_SCRIPT_RE.test(html), false, `got: ${html}`);
        // Code-блок оборачивается в <pre><code>...</code></pre>
        assert.equal(html.includes('<pre><code>'), true, `got: ${html}`);
        assert.equal(html.includes('&lt;script&gt;'), true, `got: ${html}`);
    });

    it('экранирует <script> в ячейке таблицы', () => {
        const md = [
            '| a | b |',
            '|---|---|',
            '| <script>alert(1)</script> | ok |'
        ].join('\n');
        const html = renderMarkdown(md);
        assert.equal(ACTIVE_SCRIPT_RE.test(html), false, `got: ${html}`);
        assert.equal(html.includes('<table>'), true, `got: ${html}`);
        assert.equal(html.includes('&lt;script&gt;'), true, `got: ${html}`);
    });

    it('экранирует <script> в тексте ссылки', () => {
        // [<script>](http://x) — текст ссылки должен быть экранирован.
        const html = renderMarkdown('[<script>](http://x)');
        assert.equal(ACTIVE_SCRIPT_RE.test(html), false, `got: ${html}`);
        assert.equal(html.includes('&lt;script&gt;'), true, `got: ${html}`);
        // При этом ссылка остаётся валидной (href сохранён).
        assert.equal(/href="http:\/\/x"/.test(html), true, `got: ${html}`);
    });
});

describe('renderMarkdown: фильтрация опасных URL (safeUrl)', () => {
    it('javascript: → href="#"', () => {
        const html = renderMarkdown('[click](javascript:alert(1))');
        // Опасная схема НЕ должна попасть в href.
        assert.equal(/href="javascript:/i.test(html), false, `got: ${html}`);
        assert.equal(/href="#"/.test(html), true, `got: ${html}`);
    });

    it('data: → href="#"', () => {
        const html = renderMarkdown('[click](data:text/html,foo)');
        assert.equal(/href="data:/i.test(html), false, `got: ${html}`);
        assert.equal(/href="#"/.test(html), true, `got: ${html}`);
    });

    it('vbscript: → href="#"', () => {
        // SAFE_URL_RE разрешает только http(s)://, # и mailto:, поэтому
        // vbscript: точно не должен пройти.
        const html = renderMarkdown('[click](vbscript:foo)');
        assert.equal(/href="vbscript:/i.test(html), false, `got: ${html}`);
        assert.equal(/href="#"/.test(html), true, `got: ${html}`);
    });
});

describe('renderMarkdown: безопасные URL пропускаются', () => {
    it('mailto: остаётся в href', () => {
        const html = renderMarkdown('[ok](mailto:a@b.c)');
        assert.equal(/href="mailto:a@b\.c"/.test(html), true, `got: ${html}`);
    });

    it('https:// остаётся в href', () => {
        const html = renderMarkdown('[ok](https://x)');
        assert.equal(/href="https:\/\/x"/.test(html), true, `got: ${html}`);
    });

    it('http:// остаётся в href', () => {
        const html = renderMarkdown('[ok](http://y)');
        assert.equal(/href="http:\/\/y"/.test(html), true, `got: ${html}`);
    });

    it('#anchor остаётся в href', () => {
        const html = renderMarkdown('[ok](#anchor)');
        assert.equal(/href="#anchor"/.test(html), true, `got: ${html}`);
    });
});

describe('renderMarkdown: <img onerror> через инъекцию в bold', () => {
    it('**<img onerror=alert(1)>** — img экранирован, не активен', () => {
        const html = renderMarkdown('**<img onerror=alert(1)>**');
        assert.equal(ACTIVE_IMG_RE.test(html), false, `got: ${html}`);
        // Должен присутствовать в виде &lt;img...&gt;
        assert.equal(html.includes('&lt;img'), true, `got: ${html}`);
        // Bold-обёртка работает (содержимое внутри <strong>).
        assert.equal(html.includes('<strong>'), true, `got: ${html}`);
    });
});

describe('renderMarkdown: code-block с метасимволами', () => {
    it('экранирует <, >, & внутри ```...```', () => {
        const md = '```\n<a> & <b>\n```';
        const html = renderMarkdown(md);
        // В выходе не должно быть активных тегов <a> или <b>.
        assert.equal(/<a\b/i.test(html), false, `got: ${html}`);
        assert.equal(/<b\b/i.test(html), false, `got: ${html}`);
        // Зато должны быть экранированные представления.
        assert.equal(html.includes('&lt;a&gt;'), true, `got: ${html}`);
        assert.equal(html.includes('&lt;b&gt;'), true, `got: ${html}`);
        assert.equal(html.includes('&amp;'), true, `got: ${html}`);
    });
});

describe('renderMarkdown: спецсимволы в URL и тексте ссылки', () => {
    it('& в URL экранируется как &amp;', () => {
        // safeUrl пропускает https://, escapeHtml превратит & в &amp;.
        const html = renderMarkdown('[ok](https://x?a=1&b=2)');
        // Сырой `&` (не как часть `&amp;` или `&lt;`...) недопустим
        // на месте URL — проверяем по подстроке href.
        const hrefMatch = /href="([^"]+)"/.exec(html);
        assert.notEqual(hrefMatch, null, `no href in: ${html}`);
        const href = hrefMatch[1];
        // В href не должно быть голого `&`, окружённого не-сущностью.
        assert.equal(/&(?!amp;|lt;|gt;|quot;|#39;)/.test(href), false,
            `unescaped & in href: ${href}`);
        // И обязательно встречается экранированный амперсанд.
        assert.equal(href.includes('&amp;'), true, `got href: ${href}`);
    });

    it('инъекция через [*<x>*](http://y) — текст ссылки экранирован', () => {
        // Курсив + угловые скобки внутри текста ссылки.
        const html = renderMarkdown('[*<x>*](http://y)');
        // Активного тега <x> быть не должно.
        assert.equal(/<x\b/i.test(html), false, `got: ${html}`);
        // <x> должен присутствовать в виде &lt;x&gt;.
        assert.equal(html.includes('&lt;x&gt;'), true, `got: ${html}`);
        // Ссылка осталась валидной.
        assert.equal(/href="http:\/\/y"/.test(html), true, `got: ${html}`);
    });
});

describe('Heading id-атрибуты (TOC support, PATCH 2.17.7)', () => {
    /* UserManual.md содержит оглавление [Раздел](#раздел). Markdown-рендер
       должен генерировать `<h2 id="раздел">Раздел</h2>` — иначе клик по TOC
       не работает в in-app help (F1-модалка). */

    it('простой ASCII heading получает lowercase id', () => {
        const html = renderMarkdown('## Hello World');
        assert.match(html, /<h2 id="hello-world">Hello World<\/h2>/);
    });

    it('кириллический heading получает lowercase кириллический id', () => {
        const html = renderMarkdown('## Расчёты');
        assert.match(html, /<h2 id="расчёты">Расчёты<\/h2>/);
    });

    it('спецсимволы убираются, пробелы → дефис', () => {
        const html = renderMarkdown('## Качество расчёта (Health Check)');
        assert.match(html,
            /<h2 id="качество-расчёта-health-check">Качество расчёта \(Health Check\)<\/h2>/);
    });

    it('многоуровневые spaces схлопываются в один дефис', () => {
        /* «Стенды и инвариант «стенд ≤ ПРОМ»» — после strip ≤ и « » получится
           «стенд  пром» с двумя пробелами; должны схлопнуться в один дефис. */
        const html = renderMarkdown('## Стенды и инвариант «стенд ≤ ПРОМ»');
        /* Никаких двойных дефисов в id; ≤ выпало; кавычки выпали. */
        const m = html.match(/<h2 id="([^"]+)">/);
        assert.ok(m, `должен быть id-атрибут, html: ${html}`);
        assert.doesNotMatch(m[1], /--/, `id не должен содержать двойных дефисов: ${m[1]}`);
        assert.match(m[1], /^стенды-и-инвариант-стенд-пром$/);
    });

    it('дубликаты заголовков получают -1, -2 суффиксы (как GitHub)', () => {
        const md = [
            '### Decision Memo',
            '...',
            '',
            '### Decision Memo',
            '...'
        ].join('\n');
        const html = renderMarkdown(md);
        assert.match(html, /<h3 id="decision-memo">/);
        assert.match(html, /<h3 id="decision-memo-1">/);
    });

    it('TOC-link [text](#anchor) → активная ссылка к heading', () => {
        const md = [
            '- [Расчёты](#расчёты)',
            '',
            '## Расчёты'
        ].join('\n');
        const html = renderMarkdown(md);
        /* Ссылка в TOC валидна (safeUrl уже whitelisted # — line 13). */
        assert.match(html, /<a href="#расчёты"[^>]*>Расчёты<\/a>/);
        /* Якорь на heading присутствует. */
        assert.match(html, /<h2 id="расчёты">Расчёты<\/h2>/);
    });

    it('heading без id-pригодного контента (только спецсимволы) — без id-атрибута', () => {
        const html = renderMarkdown('## ###');
        /* После slugify останется пусто → id="" нежелателен, лучше совсем без атрибута. */
        assert.match(html, /<h2>.*<\/h2>/);
        assert.doesNotMatch(html, /<h2 id=""/);
    });

    it('AI-нагрузка — leading ASCII + кириллица', () => {
        const html = renderMarkdown('### AI-нагрузка на стендах');
        assert.match(html, /<h3 id="ai-нагрузка-на-стендах">/);
    });
});
