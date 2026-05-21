/**
 * SANITY_REPORT.md — проверяемый артефакт расчётной логики.
 *
 * Если формулы, seed-прайсы, дефолты или VAT-логика меняют итоговые числа,
 * отчёт должен обновляться тем же патчем через `npm run sanity`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

test('SANITY_REPORT.md синхронизирован с текущей расчётной логикой', (t) => {
    if (!existsSync('SANITY_REPORT.md')) {
        t.skip('SANITY_REPORT.md — maintainer-only документ и отсутствует в clean checkout.');
        return;
    }

    assert.doesNotThrow(() => {
        execFileSync(process.execPath, ['scripts/sanity-report.mjs', '--check'], {
            cwd: process.cwd(),
            stdio: 'pipe'
        });
    }, 'SANITY_REPORT.md устарел; обновите его командой `npm run sanity`.');
});
