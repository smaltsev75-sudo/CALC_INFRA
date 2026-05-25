/**
 * SANITY_REPORT.md — проверяемый артефакт расчётной логики.
 *
 * Если формулы, seed-прайсы, дефолты или VAT-логика меняют итоговые числа,
 * отчёт должен обновляться тем же патчем через `npm run sanity`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPORT_PATH = join('docs', 'assistant', 'SANITY_REPORT.md');

test('SANITY_REPORT.md синхронизирован с текущей расчётной логикой', (t) => {
    if (!existsSync(REPORT_PATH)) {
        t.skip(`${REPORT_PATH} — maintainer-only документ и отсутствует в clean checkout.`);
        return;
    }

    assert.doesNotThrow(() => {
        execFileSync(process.execPath, ['scripts/sanity-report.mjs', '--check'], {
            cwd: process.cwd(),
            stdio: 'pipe'
        });
    }, `${REPORT_PATH} устарел; обновите его командой \`npm run sanity\`.`);
});

test('sanity-report --check мягко пропускает отсутствующий maintainer-only отчёт', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sanity-report-'));
    const missingReportPath = join(dir, 'SANITY_REPORT.md');
    try {
        assert.doesNotThrow(() => {
            execFileSync(process.execPath, ['scripts/sanity-report.mjs', '--check'], {
                cwd: process.cwd(),
                env: { ...process.env, SANITY_REPORT_PATH: missingReportPath },
                stdio: 'pipe'
            });
        }, 'sanity:check не должен падать в clean checkout без maintainer-only SANITY_REPORT.md.');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
