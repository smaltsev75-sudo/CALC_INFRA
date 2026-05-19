/**
 * Sprint 4 Stage 4.15 — единообразие UX/UI после Stage 4.5–4.14.
 *
 * Anti-regression source-grep тесты:
 *   1. Opacity 0.4 для disabled-селекторов (forms.css / components.css /
 *      dashboard.css) — никаких 0.45 / 0.5 для disabled-классов.
 *   2. .qs-preset-card-chips gap = var(--space-2) (8px), не литерал 4px.
 *   3. Аббревиатуры PCU / RPS / compliance / RAG в visible UI (description,
 *      recommendation, label, text:) обёрнуты в русский эквивалент при первом
 *      упоминании. Технические аббревиатуры в списках/примерах допустимы.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCssComments } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Stage 4.15 / Opacity 0.4 для disabled-селекторов', () => {
    /* Все disabled-классы должны иметь opacity: 0.4 — единое значение по проекту.
       Раньше: forms.css .field-disabled .input = 0.5, .switch-disabled = 0.5;
       components.css .stand-toggle[aria-pressed="false"] = 0.45;
       dashboard.css .dash-stand-card-disabled = 0.5. */

    it('forms.css: .field-disabled .input opacity = 0.4', () => {
        const css = stripCssComments(read('css/forms.css'));
        const m = css.match(/\.field-disabled\s+\.input,?[\s\S]*?\{([^}]+)\}/);
        assert.ok(m, '.field-disabled .input должен существовать');
        assert.match(m[1], /opacity:\s*0\.4\b/,
            '.field-disabled .input opacity должна быть 0.4 (Stage 4.15 единообразие)');
    });

    it('forms.css: .field-disabled .percent-input-suffix opacity = 0.4', () => {
        const css = stripCssComments(read('css/forms.css'));
        const m = css.match(/\.field-disabled\s+\.percent-input-suffix\s*\{([^}]+)\}/);
        assert.ok(m);
        assert.match(m[1], /opacity:\s*0\.4\b/);
    });

    it('forms.css: .switch-disabled opacity = 0.4', () => {
        const css = stripCssComments(read('css/forms.css'));
        const m = css.match(/\.switch-disabled\s*\{([^}]+)\}/);
        assert.ok(m);
        assert.match(m[1], /opacity:\s*0\.4\b/);
    });

    it('components.css: .stand-toggle[aria-pressed="false"] opacity = 0.4', () => {
        const css = stripCssComments(read('css/components.css'));
        const m = css.match(/\.stand-toggle\[aria-pressed="false"\]\s*\{([^}]+)\}/);
        assert.ok(m);
        assert.match(m[1], /opacity:\s*0\.4\b/);
    });

    it('dashboard.css: .dash-stand-card-disabled opacity = 0.4', () => {
        const css = stripCssComments(read('css/dashboard.css'));
        const m = css.match(/\.dash-stand-card-disabled\s*\{([^}]+)\}/);
        assert.ok(m);
        assert.match(m[1], /opacity:\s*0\.4\b/);
    });

    it('NO disabled-селекторов с opacity 0.45 или 0.5', () => {
        // Sweep: ищем в проектных CSS любой disabled-селектор с устаревшими
        // opacity-значениями. Аномалия = регрессия Stage 4.15.
        const files = [
            'css/forms.css', 'css/components.css', 'css/dashboard.css',
            'css/comparison.css', 'css/modals.css'
        ];
        for (const f of files) {
            const css = stripCssComments(read(f));
            // Регекс ищет селекторы с -disabled / [disabled] / aria-pressed="false"
            // и opacity в этом же блоке.
            const re = /([^{}]*(?:-disabled|\[disabled\]|aria-pressed="false")[^{}]*)\{([^}]+)\}/g;
            let match;
            while ((match = re.exec(css)) !== null) {
                const opacityMatch = match[2].match(/opacity:\s*(0\.\d+)/);
                if (!opacityMatch) continue;
                const value = parseFloat(opacityMatch[1]);
                assert.ok(value === 0.4 || value === 1,
                    `${f}: селектор '${match[1].trim()}' имеет opacity ${value}, ожидаем 0.4 (Stage 4.15)`);
            }
        }
    });
});

describe('Stage 4.15 / Chip-row gap consistency', () => {
    it('.qs-preset-card-chips использует var(--space-2), не литерал 4px', () => {
        const css = stripCssComments(read('css/modals.css'));
        const m = css.match(/\.qs-preset-card-chips\s*\{([^}]+)\}/);
        assert.ok(m);
        assert.match(m[1], /gap:\s*var\(--space-2\)/,
            '.qs-preset-card-chips должен использовать var(--space-2) — единое значение для chip-row');
        assert.doesNotMatch(m[1], /gap:\s*4px/,
            'литерал 4px устарел (Stage 4.15: 4 → 8 для консистентности с .qs-geo-chips и .calc-card-chips)');
    });
});

describe('Stage 4.15 / Бизнес-русский в visible UI seed.js', () => {
    const seedSrc = read('js/domain/seed.js');

    it('PCU question description начинается с русского «Пиковая одновременная аудитория»', () => {
        // peak_concurrent_users.description: первое упоминание PCU должно быть
        // развёрнутым на русском, аббревиатура — в скобках.
        assert.match(seedSrc, /Пиковая\s+одновременная\s+аудитория\s*\(PCU/,
            'description PCU-вопроса должен начинаться с «Пиковая одновременная аудитория (PCU…»');
    });

    it('peak_rps recommendation начинается с русского «Пиковое число запросов в секунду»', () => {
        // Visible recommendation, не в списке примеров.
        assert.match(seedSrc, /Пиковое\s+число\s+запросов\s+в\s+секунду\s*\(RPS/,
            'recommendation peak_rps должна развёртывать RPS как «запросов в секунду (RPS…»');
    });

    it('Нет «расширенным compliance» в visible label (заменено на «требованиями регуляторов»)', () => {
        // 180-дневный retention label — единственное место, где compliance был
        // как visible английское слово.
        assert.doesNotMatch(seedSrc, /расширенным\s+compliance/,
            'visible label должен использовать «требованиями регуляторов», не «compliance»');
        assert.match(seedSrc, /расширенными\s+требованиями\s+регуляторов/);
    });

    it('Нет «RAG будет устаревать» в visible label (заменено на «индекс знаний»)', () => {
        // refresh_frequency option «never».
        assert.doesNotMatch(seedSrc, /RAG\s+будет\s+устаревать/,
            'visible label должен использовать «индекс знаний», не аббревиатуру RAG');
        assert.match(seedSrc, /индекс\s+знаний\s+будет\s+устаревать/);
    });
});
