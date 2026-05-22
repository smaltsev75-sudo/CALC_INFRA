/**
 * Stage 7 (PATCH 2.4.26) — Provider block visual refresh.
 *
 * Что проверяется:
 *   • PROVIDER_PRICE_CATEGORIES — каждая из 6 категорий имеет icon:
 *     '<lucide-name>'. dense:true — только на license + service.
 *   • icons.js — 6 новых SVG-icons зарегистрированы в ICONS:
 *     cpu, memory-stick, database, network, file-text, mail.
 *   • renderProviderPriceSummary — рендерит icon(cat.icon, { size: 14 })
 *     в category-title рядом с label-text.
 *   • CSS .provider-price-category-title — flex (icon + label inline),
 *     иконка в --accent.
 *   • CSS .provider-price-category-list-dense — column-count: 2 +
 *     break-inside: avoid + display: block (override flex родителя).
 *   • Responsive: <720px → column-count: 1 (collapse в 1 col).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments, stripCssComments, ruleBody } from '../../_helpers/source.js';

/**
 * Локальный helper: находит body @media-блока, который содержит указанный
 * anchor-селектор. extractAtMediaBody из shared helpers возвращает только
 * ПЕРВЫЙ совпавший @media (в forms.css несколько `@media (max-width: 720px)`
 * блоков для разных компонентов). Brace-balancing для корректной обработки
 * вложенных правил.
 */
function findMediaBodyWithAnchor(src, queryFragment, anchorSelector) {
    const stripped = stripCssComments(src);
    const headerRe = new RegExp(
        '@media\\s*\\([^)]*' + queryFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^)]*\\)\\s*\\{',
        'g'
    );
    let m;
    while ((m = headerRe.exec(stripped)) !== null) {
        let i = m.index + m[0].length;
        let depth = 1;
        const start = i;
        while (i < stripped.length && depth > 0) {
            const ch = stripped[i];
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
            if (depth === 0) {
                const body = stripped.slice(start, i);
                if (body.includes(anchorSelector)) return body;
                break;
            }
            i++;
        }
    }
    return null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function extractCategoriesBlock(src) {
    const start = src.indexOf('const PROVIDER_PRICE_CATEGORIES');
    assert.ok(start > 0, 'PROVIDER_PRICE_CATEGORIES должен существовать');
    const end = src.indexOf('];', start);
    return src.slice(start, end + 2);
}

function extractRenderProviderBody(src) {
    const fnStart = src.indexOf('function renderProviderPriceSummary');
    assert.ok(fnStart > 0, 'renderProviderPriceSummary должна существовать');
    const fnEnd = src.indexOf('\nfunction ', fnStart + 30);
    return src.slice(fnStart, fnEnd > 0 ? fnEnd : src.length);
}

describe('Stage 7 / 2.4.26 / Provider visual refresh — metadata', () => {
    const js = stripJsComments(read('js/ui/providerPriceSummary.js'));

    it('каждая из 6 категорий имеет поле icon: \'<lucide-name>\'', () => {
        const block = extractCategoriesBlock(js);
        const expected = [
            { key: 'cpu',     icon: 'cpu' },
            { key: 'ram',     icon: 'memory-stick' },
            { key: 'storage', icon: 'database' },
            { key: 'network', icon: 'network' },
            { key: 'license', icon: 'file-text' },
            { key: 'service', icon: 'mail' }
        ];
        for (const { key, icon: ic } of expected) {
            const re = new RegExp(`key:\\s*['"]${key}['"][\\s\\S]{0,200}?icon:\\s*['"]${ic}['"]`);
            assert.match(block, re,
                `категория key='${key}' должна иметь icon='${ic}'`);
        }
    });

    it('PATCH 2.4.28: dense:true снят со всех категорий (regression rollback)', () => {
        // Изначально (PATCH 2.4.26) license + service имели dense:true →
        // .provider-price-category-list-dense → column-count: 2. На узкой
        // ширине провайдер-карточки (6 категорий в auto-fit grid'е) суб-колонки
        // становились ~80-100px шириной, и overflow-wrap: anywhere на длинных
        // русских labels («Лицензия СУБД», «Мониторинг безопасности (SIEM/EDR)»)
        // ломал их по символам в вертикальный столбец «Л-и-ц-е-н-з-и-я-С-У-Б-Д».
        // PATCH 2.4.28: rollback. dense убран отовсюду; category list — обычный
        // vertical flex как до 2.4.26.
        const block = extractCategoriesBlock(js);
        assert.doesNotMatch(block, /dense:\s*true/,
            'после 2.4.28 ни одна категория не должна иметь dense:true ' +
            '— регрессия char-by-char overflow на узких суб-колонках');
    });
});

describe('Stage 7 / 2.4.26 / Provider visual refresh — icons.js', () => {
    const iconsRaw = read('js/ui/icons.js');

    it('ICONS содержит 6 новых ключей (cpu, memory-stick, database, network, file-text, mail)', () => {
        for (const name of ['cpu', 'memory-stick', 'database', 'network', 'file-text', 'mail']) {
            // Регистрируется как `cpu:` или `'memory-stick':` — оба варианта валидны
            const re = new RegExp(`(${name.includes('-') ? `['"]${name}['"]` : name})\\s*:`);
            assert.match(iconsRaw, re,
                `Lucide-icon '${name}' должна быть зарегистрирована в ICONS`);
        }
    });

    it('каждая новая иконка содержит хотя бы один SVG-примитив (path/rect/circle/...)', () => {
        // Защита от пустых регистраций. Берём из stripped, чтобы ловить
        // именно SVG-строки, а не комментарий.
        const stripped = stripJsComments(iconsRaw);
        for (const name of ['cpu', 'memory-stick', 'database', 'network', 'file-text', 'mail']) {
            const keyForRe = name.includes('-') ? `['"]${name}['"]` : name;
            const re = new RegExp(`${keyForRe}\\s*:[\\s\\S]{0,800}?<(path|rect|circle|ellipse|polyline|line)`);
            assert.match(stripped, re,
                `'${name}' должна иметь SVG-содержимое (path/rect/circle/polyline/line)`);
        }
    });
});

describe('Stage 7 / 2.4.26 / Provider visual refresh — renderProviderPriceSummary', () => {
    const js = stripJsComments(read('js/ui/providerPriceSummary.js'));
    const body = extractRenderProviderBody(js);

    it('category-title рендерит icon(cat.icon, { size: 14 }) когда icon задан', () => {
        assert.match(body,
            /cat\.icon\s*\?\s*icon\s*\(\s*cat\.icon\s*,\s*\{\s*size:\s*14\s*\}\s*\)\s*:\s*null/,
            'icon() должен вызываться conditionally с size:14, fallback на null'
        );
    });

    it('category-title использует flex-children (icon + span), без text:-shortcut', () => {
        // text:-shortcut нельзя совмещать с children, поэтому переход на span с text:
        assert.match(body,
            /class:\s*['"]provider-price-category-title['"][\s\S]{0,300}?cat\.icon\s*\?\s*icon\(/,
            'category-title должен принимать children (icon + span), не text:'
        );
        assert.match(body,
            /class:\s*['"]provider-price-category-title-text['"]\s*,\s*text:\s*cat\.label/,
            'label теперь во вложенном span с классом title-text'
        );
    });

    it('class массив на <ul> подключает provider-price-category-list-dense conditionally', () => {
        assert.match(body,
            /class:\s*\[\s*['"]provider-price-category-list['"]\s*,\s*\n?\s*cat\.dense\s*&&\s*['"]provider-price-category-list-dense['"]\s*\]/,
            'класс dense должен подключаться через массив-форму на основе cat.dense'
        );
    });

    it('PATCH 2.4.25 invariant: is-top-expensive продолжает применяться (regression check)', () => {
        // 2.4.26 не должно сломать highlight-логику 2.4.25.
        assert.match(body,
            /isTopExpensive\s*=\s*maxValue\s*!==\s*null\s*&&\s*r\.value\s*===\s*maxValue/,
            'формула isTopExpensive из 2.4.25 должна остаться'
        );
        assert.match(body,
            /class:\s*\[\s*['"]provider-price-row['"]\s*,\s*isTopExpensive\s*&&\s*['"]is-top-expensive['"]\s*\]/,
            'класс is-top-expensive из 2.4.25 должен остаться'
        );
    });
});

describe('Stage 7 / 2.4.26 / Provider visual refresh — CSS', () => {
    const cssRaw = read('css/forms.css');
    const css = stripCssComments(cssRaw);

    it('.provider-price-category-title использует display: flex + gap для inline-иконки', () => {
        const titleRule = ruleBody(cssRaw, '.provider-price-category-title');
        assert.match(titleRule, /display:\s*flex/,
            'flex обязателен для inline-выравнивания иконки и label');
        assert.match(titleRule, /align-items:\s*center/,
            'align-items: center — вертикальное выравнивание иконки и текста');
        assert.match(titleRule, /gap:\s*\d+px/,
            'gap между иконкой и label-text');
    });

    it('иконка в category-title красится в var(--accent)', () => {
        const iconRule = ruleBody(cssRaw, '.provider-price-category-title .icon');
        assert.match(iconRule, /color:\s*var\(--accent\)/,
            'иконка должна получать accent-цвет (визуальный variety)');
    });

    it('.provider-price-category-list-dense использует column-count: 2', () => {
        const denseRule = ruleBody(cssRaw, '.provider-price-category-list-dense');
        assert.match(denseRule, /column-count:\s*2/,
            'dense-список — multi-column из 2 колонок');
        assert.match(denseRule, /display:\s*block/,
            'override display: flex родителя (.provider-price-category-list)');
    });

    it('.provider-price-category-list-dense .provider-price-row защищается break-inside: avoid', () => {
        const rowRule = ruleBody(cssRaw, '.provider-price-category-list-dense .provider-price-row');
        assert.match(rowRule, /break-inside:\s*avoid/,
            'строка не должна разрываться между колонками');
    });

    it('responsive: <720px → column-count: 1 (collapse в 1 col)', () => {
        // findMediaBodyWithAnchor сканирует ВСЕ @media (max-width: 720px) блоки
        // (их несколько в forms.css для разных компонентов) и возвращает тот,
        // что содержит .provider-price-category-list-dense.
        const mediaBody = findMediaBodyWithAnchor(cssRaw, 'max-width: 720px',
            '.provider-price-category-list-dense');
        assert.ok(mediaBody,
            '@media (max-width: 720px) с .provider-price-category-list-dense должен существовать');
        assert.match(mediaBody, /\.provider-price-category-list-dense\s*\{[^}]*column-count:\s*1/,
            'на узких экранах dense-категория должна collapse в 1 колонку');
    });

    it('regression PATCH 2.4.25: .provider-price-row.is-top-expensive остаётся в forms.css', () => {
        // 2.4.26 не должно затронуть highlight-правило 2.4.25.
        assert.match(css,
            /\.provider-price-row\.is-top-expensive[\s\S]{0,300}?color:\s*var\(--accent\)/,
            '2.4.25 highlight-rule должен остаться');
        assert.match(css,
            /\.provider-price-row\.is-top-expensive[\s\S]{0,300}?font-weight:\s*600/,
            '2.4.25 font-weight: 600 должен остаться');
    });
});
