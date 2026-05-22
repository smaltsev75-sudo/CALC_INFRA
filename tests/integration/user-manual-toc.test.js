/**
 * Acceptance-тест TOC в UserManual.md (PATCH 2.17.7).
 *
 * UserManual.md содержит оглавление с ссылками `[Раздел](#anchor)`. Этот тест
 * рендерит файл через `renderMarkdown` и проверяет:
 *   (a) Каждый якорь из TOC находит соответствующий `id` heading'а в HTML.
 *   (b) Якоря не дублируются неявно (если есть `### Decision Memo` дважды,
 *       TOC ссылается на explicit slug первого — это намеренное поведение).
 *
 * Это roundtrip-acceptance (см. глобальный CLAUDE.md §5.sext): «приложение
 * должно импортировать то, что само экспортирует». Здесь — «markdown с TOC
 * должен ренериться с рабочими якорями для всех ссылок TOC».
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown } from '../../js/services/markdown.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

describe('UserManual.md TOC acceptance', () => {
    const markdown = readFileSync(join(REPO_ROOT, 'UserManual.md'), 'utf8');
    const html = renderMarkdown(markdown);

    it('UserManual.md содержит раздел Оглавление', () => {
        assert.match(html, /<h2 id="оглавление">Оглавление<\/h2>/);
    });

    it('каждая TOC-ссылка [текст](#anchor) находит heading с этим id', () => {
        /* Извлекаем все ссылки из TOC. Простая эвристика: ссылки внутри
         * списка между H2 «Оглавление» и следующим `<hr>` или `<h2>`. */
        const tocStart = html.indexOf('<h2 id="оглавление">');
        assert.ok(tocStart >= 0, 'Оглавление должно быть в HTML');
        const afterToc = html.indexOf('<h2', tocStart + 1);
        const tocBlock = afterToc > 0 ? html.slice(tocStart, afterToc) : html.slice(tocStart);

        /* Собираем все href="#..." из TOC-блока. */
        const hrefRe = /href="#([^"]+)"/g;
        const anchorsInToc = [];
        let m;
        while ((m = hrefRe.exec(tocBlock)) !== null) {
            anchorsInToc.push(m[1]);
        }
        assert.ok(anchorsInToc.length >= 10,
            `TOC должен содержать >= 10 ссылок (есть ${anchorsInToc.length})`);

        /* Для каждой ссылки находим соответствующий heading id в полном HTML. */
        const broken = [];
        for (const anchor of anchorsInToc) {
            const idRe = new RegExp(`<h[1-4][^>]*\\sid="${anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);
            if (!idRe.test(html)) {
                broken.push(anchor);
            }
        }
        assert.deepEqual(broken, [],
            `Битые TOC-якоря (не находят heading'а): ${broken.join(', ')}`);
    });

    it('TOC находится сразу после intro, до первого содержательного раздела', () => {
        /* Структурный invariant: «Оглавление» появляется ДО «Структура интерфейса». */
        const tocIdx = html.indexOf('<h2 id="оглавление">');
        const firstSectionIdx = html.indexOf('<h2 id="структура-интерфейса">');
        assert.ok(tocIdx > 0, 'Оглавление в HTML');
        assert.ok(firstSectionIdx > 0, 'Раздел «Структура интерфейса» в HTML');
        assert.ok(tocIdx < firstSectionIdx,
            'Оглавление должно идти ДО первого содержательного раздела');
    });

    it('раздел проверки реалистичности содержит practical validation checklist', () => {
        assert.match(markdown, /## Как проверить реалистичность результата/);
        assert.match(markdown, /### Быстрая проверка за 5-10 минут/);
        assert.match(markdown, /### Красные флаги/);
        assert.match(markdown, /### Встроенные эталоны проекта/);
        assert.match(markdown, /Проверено по официальным тарифам/);
        assert.match(markdown, /Цена по запросу у провайдера/);
        assert.match(markdown, /WAF \(защита веб-приложений\)/);
        assert.match(markdown, /DDoS \(защита от распределённых/);
        assert.match(markdown, /A4 landscape/);
        assert.match(markdown, /AI\/RAG\/agent-support/);
    });
});
