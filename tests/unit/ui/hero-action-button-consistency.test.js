/**
 * Regression-тест: кнопка «открыть детали» в Hero-карточке Дашборда
 * должна быть визуально согласована с такой же кнопкой в стенд-карточках.
 *
 * Стенд-карточка использует `dash-stand-card-link` — иконка-кнопка `arrow-up-right`
 * 14px без текста, в правом верхнем углу шапки. Hero раньше имел
 * `dash-hero-action` с текстом «Детали расчёта» — визуально другая кнопка.
 *
 * Унификация: Hero использует тот же класс `dash-stand-card-link` (или новый
 * общий класс), без текста, только icon — для одинакового UI-паттерна
 * «открыть подробности».
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardSource = readFileSync(
    join(__dirname, '..', '..', '..', 'js', 'ui', 'dashboard.js'),
    'utf8'
);

describe('Hero-action consistency со стенд-карточкой (12.U30 fix)', () => {
    it('Hero НЕ содержит текст-надпись «Детали расчёта» рядом с иконкой', () => {
        // Hero-кнопка должна быть только icon, без подписи (как у стенд-карточек).
        assert.doesNotMatch(dashboardSource, /text:\s*['"]Детали расчёта['"]/,
            'Hero должен использовать иконку-кнопку без текста (как на стенд-карточках)');
    });

    it('Hero использует тот же класс ссылки-кнопки `dash-stand-card-link`', () => {
        // Ищем именно в hero-actions блоке (не где-то в стенд-карточке).
        // Hero — это div class="dash-hero-actions" → внутри button с тем же классом.
        const heroActionsBlock = dashboardSource.match(/['"]dash-hero-actions['"][\s\S]{0,500}/);
        assert.ok(heroActionsBlock, 'блок dash-hero-actions должен существовать');
        assert.match(heroActionsBlock[0], /['"]dash-stand-card-link['"]/,
            'Hero-action должен использовать класс `dash-stand-card-link` для визуального единства');
    });

    it("Hero сохраняет icon('arrow-up-right') как у стенд-карточек", () => {
        const heroActionsBlock = dashboardSource.match(/['"]dash-hero-actions['"][\s\S]{0,500}/);
        assert.match(heroActionsBlock[0], /icon\(['"]arrow-up-right['"]/,
            'иконка должна оставаться arrow-up-right');
    });

    it("aria-label на Hero-кнопке (без видимого текста — обязательно для a11y)", () => {
        const heroActionsBlock = dashboardSource.match(/['"]dash-hero-actions['"][\s\S]{0,500}/);
        assert.match(heroActionsBlock[0], /aria-label['"]?\s*:\s*['"]/,
            'без видимого текста кнопка обязана иметь aria-label для скринридеров');
    });
});
