import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { money, moneyPrecise, num, integer, percent, parseNumberInput, dateTime, dateOnly } from '../../../js/services/format.js';
import { renderMarkdown } from '../../../js/services/markdown.js';

describe('format.money (RUB only — мультивалютность удалена)', () => {
    it('форматирует число со знаком ₽ в конце', () => {
        const s = money(1234567);
        assert.match(s, /1.234.567/);
        assert.match(s, /₽$/);
    });
    it('moneyPrecise — со знаком ₽', () => {
        const s = moneyPrecise(1234.56);
        assert.match(s, /₽$/);
    });
    it('handles non-finite', () => {
        assert.equal(money(NaN), '—');
        assert.equal(money(Infinity), '—');
    });
});

describe('format.percent', () => {
    it('30% from 0.3', () => {
        assert.equal(percent(0.3), '30%');
    });
    it('handles 0', () => {
        assert.equal(percent(0), '0%');
    });
});

describe('format.parseNumberInput', () => {
    it('parses comma decimal', () => {
        assert.equal(parseNumberInput('1,5'), 1.5);
    });
    it('parses dot decimal', () => {
        assert.equal(parseNumberInput('1.5'), 1.5);
    });
    it('parses with spaces', () => {
        assert.equal(parseNumberInput('1 234,5'), 1234.5);
    });
    it('returns NaN for non-numeric', () => {
        assert.ok(Number.isNaN(parseNumberInput('abc')));
        assert.ok(Number.isNaN(parseNumberInput('')));
    });
    it('passes through numbers', () => {
        assert.equal(parseNumberInput(42), 42);
    });
});

describe('format.date', () => {
    it('formats ISO datetime', () => {
        const s = dateTime('2026-05-01T12:30:00Z');
        assert.match(s, /\d{2}\.\d{2}\.\d{4}/);
    });
    it('handles invalid', () => {
        assert.equal(dateTime('invalid'), '—');
        assert.equal(dateTime(null), '—');
    });
    it('dateOnly without time', () => {
        const s = dateOnly('2026-05-01');
        assert.match(s, /^\d{2}\.\d{2}\.\d{4}$/);
    });
});

describe('markdown', () => {
    it('renders headers', () => {
        /* PATCH 2.17.7: heading-id для TOC-якорей (см. markdown.test.js
         * «Heading id-атрибуты»). Сам heading-текст не меняется. */
        const html = renderMarkdown('# Hello');
        assert.match(html, /<h1 id="hello">Hello<\/h1>/);
    });
    it('renders bold/italic', () => {
        assert.match(renderMarkdown('**bold**'), /<strong>bold<\/strong>/);
        assert.match(renderMarkdown('a *italic* b'), /<em>italic<\/em>/);
    });
    it('renders inline code', () => {
        assert.match(renderMarkdown('`code`'), /<code>code<\/code>/);
    });
    it('renders unordered list', () => {
        const html = renderMarkdown('- a\n- b');
        assert.match(html, /<ul>/);
        assert.match(html, /<li>a<\/li>/);
    });
    it('renders code block', () => {
        const html = renderMarkdown('```\nx = 1\n```');
        assert.match(html, /<pre><code>/);
    });
    it('renders table', () => {
        const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
        assert.match(html, /<table>/);
        assert.match(html, /<th>a<\/th>/);
        assert.match(html, /<td>1<\/td>/);
    });
    it('escapes HTML in text', () => {
        const html = renderMarkdown('<script>x</script>');
        assert.match(html, /&lt;script&gt;/);
        assert.doesNotMatch(html, /<script>/);
    });
    it('safe URLs only', () => {
        const html = renderMarkdown('[click](javascript:alert(1))');
        assert.doesNotMatch(html, /javascript:/);
    });
    it('http(s) URLs allowed', () => {
        const html = renderMarkdown('[click](https://example.com)');
        assert.match(html, /href="https:\/\/example.com"/);
    });
    it('handles empty input', () => {
        assert.equal(renderMarkdown(''), '');
        assert.equal(renderMarkdown(null), '');
    });
});
