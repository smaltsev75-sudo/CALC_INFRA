import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cssSource = readFileSync(
    join(__dirname, '..', '..', '..', 'css', 'layout.css'),
    'utf8'
);

function ruleBody(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = cssSource.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
    assert.ok(match, `${selector} должен быть определён`);
    return match[1];
}

describe('Persist indicator: success state is green', () => {
    for (const selector of ['.persist-indicator.persist-idle', '.persist-indicator.persist-saved']) {
        it(`${selector} uses success color, border and background`, () => {
            const body = ruleBody(selector);
            assert.match(body, /color\s*:\s*var\(--success\)/);
            assert.match(body, /border-color\s*:\s*var\(--success\)/);
            assert.match(body, /background\s*:\s*var\(--success-faint\)/);
        });
    }
});
