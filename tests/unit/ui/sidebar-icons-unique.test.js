/**
 * Фикс 2026-06-17: «Вопросы» (админ-экран) и «Справка» (footer) использовали
 * одинаковую иконку help-circle (?) для разных действий — пользователь читает
 * это как ошибку. «Справка» по конвенции сохраняет «?»; «Вопросы» получает
 * собственную иконку.
 *
 * Forcing function: иконки навигационных/админ/data-пунктов sidebar уникальны,
 * и help-circle зарезервирована за кнопкой «Справка» (не используется как
 * iconName ни одного пункта).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { stripJsComments } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = stripJsComments(
    readFileSync(path.resolve(__dirname, '../../../js/ui/sidebar.js'), 'utf8')
);

function iconNames() {
    const re = /iconName:\s*'([a-z0-9-]+)'/g;
    const out = [];
    let m;
    while ((m = re.exec(SRC)) !== null) out.push(m[1]);
    return out;
}

describe('sidebar — уникальность иконок действий', () => {
    it('все iconName пунктов sidebar уникальны (нет двух действий с одной иконкой)', () => {
        const names = iconNames();
        const dupes = names.filter((n, i) => names.indexOf(n) !== i);
        assert.deepEqual([...new Set(dupes)], [],
            `повторяющиеся иконки пунктов: ${[...new Set(dupes)].join(', ')}`);
    });
    it('help-circle зарезервирована за «Справкой» — не используется как iconName пункта', () => {
        assert.ok(!iconNames().includes('help-circle'),
            'help-circle должна быть только у кнопки «Справка», не у навигационных пунктов');
    });
});
