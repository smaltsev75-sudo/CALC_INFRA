import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { stripCssComments } from '../../_helpers/source.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const modalsCss = stripCssComments(fs.readFileSync(path.resolve(here, '../../../css/modals.css'), 'utf8'));

function ruleBody(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = modalsCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    assert.ok(match, `не найдено правило ${selector}`);
    return match[1];
}

describe('Паспорт ПРОМ — светлая тема не должна просвечивать backdrop', () => {
    it('CSS Паспорта не использует несуществующий токен --bg', () => {
        const passportBlock = modalsCss.slice(modalsCss.indexOf('.pp-overlay .pp-modal'));
        assert.doesNotMatch(passportBlock, /var\(--bg\)/, 'var(--bg) не определён в темах и делает background невалидным');
    });

    it('основные панели Паспорта имеют явный непрозрачный фон', () => {
        assert.match(ruleBody('.pp-overlay .pp-modal'), /background\s*:\s*var\(--bg-main\)/);
        assert.match(ruleBody('.pp-left'), /background\s*:\s*var\(--bg-main\)/);
        assert.match(ruleBody('.pp-right'), /background\s*:\s*var\(--bg-card\)/);
    });
});
