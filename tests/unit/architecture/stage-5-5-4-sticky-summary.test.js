/**
 * Stage 5.5.4 — Settings panel sticky-summary.
 *
 * При свёрнутой панели «Параметры расчёта» пользователь не видел, какой
 * провайдер выбран и какая ставка НДС применяется — для проверки нужно
 * было раскрывать панель и снова сворачивать. Теперь в header'е summary
 * показывает 4 ключевых параметра одной строкой:
 *
 *   [12 мес · риски ×1,42 · НДС 20% · Cloud.ru (бывший SberCloud)]
 *
 * Особенности:
 *   • Square brackets — визуальный маркер «сводка состояния»
 *   • Comma-decimal в ×1,42 — ru-locale стандарт
 *   • При выкл. master-toggle: «без рисков» / «без НДС»
 *   • Provider label берётся из PROVIDER_OVERLAYS (не raw id)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Stage 5.5.4 / renderSettingsPanel — расширенная summary', () => {
    const src = stripJsComments(read('js/ui/questionnaireSettings.js'));

    function renderSettingsPanelBody() {
        const fnStart = src.indexOf('function renderSettingsPanel(');
        if (fnStart < 0) return '';
        const after = src.indexOf('\nfunction ', fnStart + 30);
        return after < 0 ? src.slice(fnStart) : src.slice(fnStart, after);
    }

    it('summary включает provider label из PROVIDER_OVERLAYS', () => {
        const body = renderSettingsPanelBody();
        assert.match(body, /providerId\s*=\s*s\.provider/,
            'должна быть переменная providerId, читающая s.provider');
        assert.match(body, /PROVIDER_OVERLAYS\[\s*providerId\s*\]/,
            'provider label должен браться из PROVIDER_OVERLAYS[providerId]');
        assert.match(body, /providerLabel\s*=\s*providerOverlay\?\.label/,
            'providerLabel должен использовать optional chaining ?.label');
    });

    it('summary использует comma-decimal для риск-множителя (×1,42 не ×1.42)', () => {
        const body = renderSettingsPanelBody();
        assert.match(body, /riskFmt\s*=\s*totalFactor\.toFixed\(2\)\.replace\(['"]\.['"],\s*['"],['"]\)/,
            'риск-множитель должен использовать toFixed(2).replace(".", ",") — ru-locale');
    });

    it('summary обёрнут в квадратные скобки [...]', () => {
        const body = renderSettingsPanelBody();
        assert.match(body, /summary\s*=\s*`\[\$\{summaryParts\.join/,
            'summary должен начинаться с `[` и заканчиваться на `]`');
    });

    it('summary содержит 4 части: срок, риски, НДС, провайдер', () => {
        const body = renderSettingsPanelBody();
        assert.match(body, /summaryParts\s*=\s*\[[\s\S]{0,500}?providerLabel/,
            'summaryParts должен содержать providerLabel как одну из частей');
        // Проверяем наличие всех 4 ключевых сегментов
        assert.match(body, /phaseDurationMonths/, 'summary должен включать срок');
        assert.match(body, /applyRisks\s*\?\s*[`'"]риски/, 'summary должен включать риски при applyRisks');
        assert.match(body, /vatEnabled\s*\?\s*[`'"]НДС/, 'summary должен включать НДС при vatEnabled');
    });

    it('при выключенных рисках summary показывает «без рисков»', () => {
        const body = renderSettingsPanelBody();
        assert.match(body, /['"`]без\s+рисков['"`]/,
            'выключенные риски должны показывать «без рисков», не «риски: выкл»');
    });

    it('при выключенном НДС summary показывает «без НДС»', () => {
        const body = renderSettingsPanelBody();
        assert.match(body, /['"`]без\s+НДС['"`]/,
            'выключенный НДС должен показывать «без НДС», не «НДС: выкл»');
    });
});

describe('Stage 5.5.4 / forms.css — стиль .settings-summary', () => {
    /* Stage 5.5.4 не меняет CSS .settings-summary — стиль уже настроен:
       margin-left: auto, ellipsis, font-mono. Регрессия защищается. */
    it('.settings-summary использует font-mono и ellipsis', () => {
        const css = read('css/forms.css');
        const m = css.match(/\.settings-summary\s*\{([^}]+)\}/);
        assert.ok(m, '.settings-summary должен быть определён в forms.css');
        assert.match(m[1], /font-family:\s*var\(--font-mono\)/,
            'summary должен использовать font-mono для tabular-nums-style выравнивания');
        assert.match(m[1], /text-overflow:\s*ellipsis/,
            'summary должен обрезаться ellipsis на узких header\'ах');
    });
});
