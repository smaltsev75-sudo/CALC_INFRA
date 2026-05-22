/**
 * Stage 17.2 Phase 3c — Sidebar IA: «Администрирование» доступна только
 * при advancedMode = true.
 *
 * Покрывает:
 *   1. NAV_SECTIONS содержит группу «Администрирование» с advancedOnly: true.
 *   2. Группа «Справочники» удалена (rename → «Администрирование»).
 *   3. items / questions — внутри admin-группы, не основной.
 *   4. renderSidebar фильтрует advancedOnly секции по state.ui.advancedModeEnabled.
 *   5. footer содержит toggle «Расширенные настройки» (sidebar-advanced-toggle).
 *   6. Toggle вызывает ctx.toggleAdvancedMode.
 *   7. CSS .sidebar-advanced-toggle-on присутствует (визуальный маркер «вкл.»).
 *   8. KeyboardController блокирует Ctrl+Alt+6/7 без advanced-mode.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripJsComments, stripCssComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8');

describe('Phase 3c — Sidebar IA: NAV_SECTIONS', () => {
    const src = stripJsComments(read('js/ui/sidebar.js'));

    it('содержит группу "Администрирование"', () => {
        assert.match(src, /title:\s*['"]Администрирование['"]/,
            'Группа должна называться «Администрирование» (rename из «Справочники»).');
    });

    it('старая группа "Справочники" удалена', () => {
        assert.equal(src.includes("title: 'Справочники'"), false);
        assert.equal(src.includes('title: "Справочники"'), false);
    });

    it('admin-группа помечена advancedOnly: true', () => {
        // Найти блок группы «Администрирование» и убедиться что в нём advancedOnly: true.
        const m = src.match(/title:\s*['"]Администрирование['"][\s\S]*?items:\s*\[/);
        assert.ok(m, 'Структура группы «Администрирование» должна быть валидной');
        assert.match(m[0], /advancedOnly:\s*true/,
            'Группа должна быть помечена advancedOnly: true.');
    });

    it('items / questions перенесены внутрь admin-группы', () => {
        // Грубый чек: id 'items' и 'questions' встречаются после title «Администрирование».
        const adminIdx = src.indexOf("title: 'Администрирование'");
        const legacyIdx = src.indexOf("title: 'Справочники'");
        assert.ok(adminIdx >= 0, 'Заголовок «Администрирование» должен присутствовать');
        assert.equal(legacyIdx, -1, 'Старый заголовок «Справочники» удалён');
        const after = src.slice(adminIdx);
        assert.match(after, /id:\s*['"]items['"]/);
        assert.match(after, /id:\s*['"]questions['"]/);
    });
});

describe('Phase 3c — renderSidebar фильтрует advancedOnly секции', () => {
    const src = stripJsComments(read('js/ui/sidebar.js'));

    it('renderSidebar читает state.ui.advancedModeEnabled', () => {
        assert.match(src, /state\.ui\??\.?\s*\.?advancedModeEnabled/);
    });

    it('фильтр через advancedOnly + advancedMode', () => {
        // Проверяем наличие явного фильтра, без привязки к именам переменных.
        assert.match(src, /\.filter\s*\(\s*[a-z]\s*=>\s*!\s*[a-z]\.advancedOnly/i,
            'Должен быть .filter(s => !s.advancedOnly || advancedMode) — иначе admin-группа всегда видна.');
    });
});

describe('Phase 3c — Sidebar footer toggle', () => {
    const src = stripJsComments(read('js/ui/sidebar.js'));

    it('footer содержит кнопку sidebar-advanced-toggle', () => {
        assert.match(src, /sidebar-advanced-toggle/,
            'CSS-класс toggle должен быть на кнопке.');
    });

    it('label кнопки = «Расширенные настройки»', () => {
        assert.match(src, /text:\s*['"]Расширенные настройки['"]/);
    });

    it('кнопка вызывает ctx.toggleAdvancedMode()', () => {
        assert.match(src, /ctx\.toggleAdvancedMode\??\.?\(\)/);
    });

    it('кнопка имеет aria-pressed для toggle-state', () => {
        assert.match(src, /aria-pressed/);
    });

    it('aria-label явно указан (a11y, screen-reader)', () => {
        assert.match(src, /aria-label/);
    });
});

describe('Phase 3c — CSS: sidebar-advanced-toggle-on (visual indicator)', () => {
    it('css/sidebar.css содержит правило .sidebar-advanced-toggle-on', () => {
        const css = stripCssComments(read('css/sidebar.css'));
        assert.match(css, /\.sidebar-advanced-toggle-on\s*\{/,
            'Включённое состояние должно иметь визуальный маркер.');
    });
});

describe('Phase 3c — KeyboardController: Ctrl+Alt+6/7 блокируется без advanced', () => {
    const src = stripJsComments(read('js/controllers/keyboardController.js'));

    it('switchToTab проверяет state.ui.advancedModeEnabled для items/questions', () => {
        assert.match(src, /['"]items['"]\s*\|\|\s*id\s*===\s*['"]questions['"]|isAdminTab/,
            'Должен быть guard для admin-tab.');
        assert.match(src, /advancedModeEnabled/,
            'Guard должен опираться на state.ui.advancedModeEnabled.');
    });

    it('snackbar-сообщение упоминает «Расширенные настройки»', () => {
        assert.match(src, /Расширенные настройки/);
    });
});

describe('Phase 3c — app.js ctx-методы', () => {
    const src = stripJsComments(read('js/app.js'));

    it('ctx содержит setAdvancedMode и toggleAdvancedMode', () => {
        assert.match(src, /setAdvancedMode\s*\(\s*enabled\s*\)/);
        assert.match(src, /toggleAdvancedMode\s*\(\s*\)/);
    });

    it('ctx-методы делегируют в calcController', () => {
        // Допускаем как `calc.setAdvancedMode`, так и `calcController.setAdvancedMode`.
        assert.match(src, /\b(?:calc|calcController)\.setAdvancedMode\b/);
        assert.match(src, /\b(?:calc|calcController)\.toggleAdvancedMode\b/);
    });
});
