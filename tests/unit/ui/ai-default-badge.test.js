/**
 * Sprint 3.0 / Stage 2-3: AI-default бейдж в Опроснике.
 *
 * Когда у поля answersMeta[q.id].source === 'ai_default' (выставляется в
 * wizardProfiles.js при ai_used=true), Опросник показывает фиолетовый
 * бейдж «AI-default» рядом с label вопроса. Это даёт пользователю явный
 * сигнал «значение пришло из toggle'а AI в Quick Start, не из профиля
 * и не из ручной правки».
 *
 * Тесты проверяют интегрированность бейджа из 4 точек:
 *   1. SOURCE_BADGES['ai_default'] существует и имеет ожидаемые
 *      label/cls/tip (структурный matcher по questionnaire.js).
 *   2. renderSourceBadge включает source='ai_default' в whitelist
 *      (renderSourceBadge возвращает null только для отсутствующего
 *      или неизвестного source — все известные source отрабатывают
 *      через одну функцию).
 *   3. wizardProfiles.js помечает AI-поля source='ai_default'
 *      (а не 'wizard'/'profile' как до Stage 2).
 *   4. CSS-класс .field-source-badge--ai-default определён
 *      в обеих темах (dark + light).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments, stripCssComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..', '..');

const questionnaireSrc = readFileSync(join(root, 'js', 'ui', 'questionnaire.js'), 'utf8');
const wizardProfilesSrc = readFileSync(join(root, 'js', 'domain', 'wizardProfiles.js'), 'utf8');
const formsCssSrc = readFileSync(join(root, 'css', 'forms.css'), 'utf8');

describe('AI-default бейдж — SOURCE_BADGES конфиг', () => {
    const noComments = stripJsComments(questionnaireSrc);

    it('SOURCE_BADGES содержит запись ai_default с человеко-понятным label (Stage 4: «Из мастера AI»)', () => {
        // Stage 4 cleanup 2026-05-08: label переименован с технического «AI-default»
        // на бизнес-понятный «Из мастера AI», унифицированный с другими бейджами
        // источников («Из мастера», «Из профиля», «Из масштаба» и т.д.).
        assert.ok(
            /ai_default\s*:\s*\{[^}]*label:\s*['"]Из мастера AI['"]/.test(noComments),
            'Запись ai_default с label «Из мастера AI» не найдена в SOURCE_BADGES (Stage 4 cleanup)'
        );
    });

    it('запись ai_default содержит cls «ai-default» (для CSS-класса field-source-badge--ai-default)', () => {
        assert.ok(
            /ai_default\s*:\s*\{[^}]*cls:\s*['"]ai-default['"]/.test(noComments),
            'cls: "ai-default" не найден в записи ai_default — CSS-класс не сматчится'
        );
    });

    it('запись ai_default содержит tip с упоминанием Quick Start', () => {
        // tip должен объяснять происхождение — что это из toggle'а AI в Quick Start.
        const m = noComments.match(/ai_default\s*:\s*\{[^}]*tip:\s*['"]([^'"]+)['"]/);
        assert.ok(m, 'tip не найден в записи ai_default');
        const tip = m[1];
        assert.ok(
            /Quick Start|AI\/LLM/i.test(tip),
            `tip ai_default должен упоминать «Quick Start» или «AI/LLM», получено: "${tip}"`
        );
    });
});

describe('AI-default бейдж — renderSourceBadge whitelist', () => {
    const noComments = stripJsComments(questionnaireSrc);

    it('renderSourceBadge — общая функция, без жёсткого whitelist по source', () => {
        // Семантика: renderSourceBadge берёт cfg = SOURCE_BADGES[meta.source].
        // Если бы был жёсткий whitelist (например `if (source !== 'wizard' && ...) return null`),
        // ai_default бы туда не попал. Проверяем что функция читает SOURCE_BADGES[meta.source].
        assert.ok(
            /SOURCE_BADGES\s*\[\s*meta\.source\s*\]/.test(noComments),
            'renderSourceBadge не читает SOURCE_BADGES[meta.source] — возможен жёсткий whitelist'
        );
    });
});

describe('AI-default бейдж — wizardProfiles помечает поля source=ai_default', () => {
    const noComments = stripJsComments(wizardProfilesSrc);

    it('ai_llm_used помечается source=ai_default при ai_used=true', () => {
        // Должна быть строка вроде set('ai_llm_used', true, 'ai_default');
        assert.ok(
            /set\(\s*['"]ai_llm_used['"]\s*,\s*true\s*,\s*['"]ai_default['"]/.test(noComments),
            "set('ai_llm_used', true, 'ai_default') не найден"
        );
    });

    it('ai_llm_used помечается source=ai_default ТАКЖЕ при ai_used=false (явно false)', () => {
        // При выключенном AI явное false помечается тем же source — иначе legacy-defaults
        // в seed.js могут включить AI обратно.
        assert.ok(
            /set\(\s*['"]ai_llm_used['"]\s*,\s*false\s*,\s*['"]ai_default['"]/.test(noComments),
            "set('ai_llm_used', false, 'ai_default') не найден — при ai_used=false поле не помечается"
        );
    });

    it('rag_corpus_size_gb помечается source=ai_default', () => {
        assert.ok(
            /set\(\s*['"]rag_corpus_size_gb['"][^)]*['"]ai_default['"]/.test(noComments),
            "set('rag_corpus_size_gb', ..., 'ai_default') не найден"
        );
    });

    it('ai_caching_share помечается source=ai_default', () => {
        assert.ok(
            /set\(\s*['"]ai_caching_share['"][^)]*['"]ai_default['"]/.test(noComments),
            "set('ai_caching_share', ..., 'ai_default') не найден"
        );
    });

    it('AI-prefill цикл по profile.ai использует source ai_default (не wizard/profile)', () => {
        // В цикле Object.entries(profile.ai).forEach должен быть set(..., 'ai_default').
        assert.ok(
            /Object\.entries\s*\(\s*profile\.ai\s*\)\.forEach[\s\S]*?set\(\s*[^,]+,\s*[^,]+,\s*['"]ai_default['"]/.test(noComments),
            'Цикл по profile.ai не использует source=ai_default — возможна регрессия на wizard/profile'
        );
    });
});

describe('AI-default бейдж — CSS .field-source-badge--ai-default определён', () => {
    const noCssComments = stripCssComments(formsCssSrc);

    it('класс определён в dark-теме (без data-theme)', () => {
        // Dark-тема — селектор без [data-theme="light"].
        assert.ok(
            /\.field-source-badge--ai-default\s*\{[^}]+\}/.test(noCssComments),
            'Селектор .field-source-badge--ai-default не определён для dark-темы'
        );
    });

    it('класс определён в light-теме через [data-theme="light"]', () => {
        assert.ok(
            /\[data-theme="light"\]\s*\.field-source-badge--ai-default\s*\{/.test(noCssComments),
            'Селектор [data-theme="light"] .field-source-badge--ai-default не определён — light-тема даст rgba'
        );
    });

    it('контраст: light-тема использует тёмный текст rgb(107, 33, 168) — WCAG AA на белом', () => {
        // Тестируем именно цвет в light-теме (rgb(107, 33, 168) = ~5.3:1 на белом, AA pass).
        const lightBlock = noCssComments.match(/\[data-theme="light"\]\s*\.field-source-badge--ai-default\s*\{([^}]+)\}/);
        assert.ok(lightBlock, 'Light-тема блока не найден');
        assert.ok(
            /color:\s*rgb\s*\(\s*107\s*,\s*33\s*,\s*168\s*\)/.test(lightBlock[1]),
            'В light-теме color должен быть rgb(107, 33, 168) (purple-800 для контраста ≥4.5:1 на белом)'
        );
    });
});
