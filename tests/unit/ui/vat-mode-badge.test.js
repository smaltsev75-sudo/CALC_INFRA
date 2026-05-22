/**
 * Stage VAT-1 Phase 5: UI-тесты для VAT mode badge в Опроснике.
 *
 * Проверяет источники VAT-настроек и общего percent-field:
 *   - три варианта badge-text (Авто / Вручную / Заморожено);
 *   - кнопки 3-режимов вызывают правильные ctx-методы;
 *   - переход в manual через прямую правку поля Ставка НДС идёт через
 *     `ctx.setVatRateManual(fraction)` — UI вводит проценты, controller
 *     получает долю.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const QUEST_SRC = stripJsComments([
    readFileSync(join(REPO_ROOT, 'js', 'ui', 'questionnaireVatSettings.js'), 'utf8'),
    readFileSync(join(REPO_ROOT, 'js', 'ui', 'questionnairePercentField.js'), 'utf8')
].join('\n'));

describe('VAT mode badge: текст для трёх режимов', () => {
    it('auto-by-date: бейдж содержит «Авто»', () => {
        assert.match(QUEST_SRC, /badgeText\s*=\s*`Авто \$\{ratePct\}%/);
    });

    it('manual: бейдж содержит «Вручную»', () => {
        assert.match(QUEST_SRC, /badgeText\s*=\s*`Вручную \$\{ratePct\}%`/);
    });

    it('frozen: бейдж содержит «Заморожено»', () => {
        assert.match(QUEST_SRC, /badgeText\s*=\s*`Заморожено \$\{ratePct\}%/);
    });
});

describe('VAT mode badge: 3 кнопки переключения режимов', () => {
    it('Кнопка «Авто» вызывает ctx.setVatRateMode("auto-by-date")', () => {
        assert.match(QUEST_SRC, /ctx\.setVatRateMode\('auto-by-date'\)/);
    });

    it('Кнопка «Вручную» вызывает ctx.setVatRateMode("manual")', () => {
        assert.match(QUEST_SRC, /ctx\.setVatRateMode\('manual'\)/);
    });

    it('Кнопка «Заморозить» вызывает ctx.freezeVatRate()', () => {
        assert.match(QUEST_SRC, /ctx\.freezeVatRate\(\)/);
    });
});

describe('VAT mode badge: UI 22% → controller 0.22 (acceptance)', () => {
    it('Прямая правка поля «Ставка НДС» вызывает ctx.setVatRateManual(v) — не ctx.setSetting', () => {
        /* renderPercentField для vatRate передаёт callback `v => ctx.setVatRateManual(v)`.
           Внутри renderPercentField onInput делает `n / 100` и передаёт долю в callback —
           значит, при вводе UI 22 controller получает 0.22. */
        assert.match(QUEST_SRC, /v => ctx\.setVatRateManual\(v\)/);
    });

    it('Старый путь ctx.setSetting(\'vatRate\', v) — больше НЕ используется', () => {
        /* После Phase 5 vatRate редактируется через setVatRateManual, не setSetting.
           Защищаемся от регрессии: если кто-то добавит setSetting('vatRate') —
           тест упадёт и заставит выбрать корректный API. */
        assert.doesNotMatch(QUEST_SRC, /ctx\.setSetting\(['"]vatRate['"]/);
    });

    it('renderPercentField делит вход на 100 (доля = процент / 100)', () => {
        /* renderPercentField — общий helper, проверяем что внутри есть `n / 100`
           для всех percent-полей. Это инвариант фракционного контракта. */
        assert.match(QUEST_SRC, /onChange\(n\s*\/\s*100\)/);
    });
});

describe('VAT mode badge: a11y', () => {
    it('Кнопки имеют aria-pressed', () => {
        assert.match(QUEST_SRC, /'aria-pressed'\s*:\s*is(Auto|Manual|Frozen)\s*\?\s*'true'\s*:\s*'false'/);
    });
});
