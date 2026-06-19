/**
 * Package 8C-light — doc-guard: WIZARD §6 provider-overlay must describe
 * the current runtime, not the old MVP/stub design.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROVIDER_OVERLAYS } from '../../../js/domain/providerOverlay.js';
import { BUNDLED_PROVIDER_PRICES } from '../../../js/data/providers-bundled.generated.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const wizard = fs.readFileSync(path.join(ROOT, 'docs/assistant/WIZARD_PROFILES.md'), 'utf8');

function section(title, nextTitle) {
    const start = wizard.indexOf(title);
    assert.notEqual(start, -1, `section ${title} not found`);
    const end = wizard.indexOf(nextTitle, start + title.length);
    assert.notEqual(end, -1, `next section ${nextTitle} not found`);
    return wizard.slice(start, end);
}

const providerSection = section('## 6. Provider-overlay', '## 7. Locked / unlocked');

test('WIZARD §6 no longer contains the old MVP stub/TBD provider-overlay design', () => {
    assert.doesNotMatch(providerSection, /Stub\s*\(«скоро»|disabled с `title="Поддержка добавится/i);
    assert.doesNotMatch(providerSection, /TBD(?:\s+по тарифу|\s*$)/im);
    assert.doesNotMatch(providerSection, /export\s+const\s+PROVIDER_OVERLAYS\s*=\s*Object\.freeze/);
    assert.doesNotMatch(providerSection, /active:\s*false,\s*prices:\s*\{\}/);
});

test('WIZARD §6 points to bundled provider runtime and buildOverlayPricesFromBundled', () => {
    assert.match(providerSection, /providers-bundled\.generated\.js/);
    assert.match(providerSection, /buildOverlayPricesFromBundled/);
    assert.match(providerSection, /applyProviderOverlay/);
});

test('WIZARD §6 active providers match runtime active providers', () => {
    const activeProviders = Object.values(PROVIDER_OVERLAYS)
        .filter(provider => provider.active)
        .map(provider => provider.id)
        .sort();

    assert.deepEqual(activeProviders, ['sbercloud', 'vk', 'yandex']);
    for (const providerId of activeProviders) {
        assert.match(providerSection, new RegExp('`' + providerId + '`'));
        assert.doesNotMatch(providerSection, new RegExp('`' + providerId + '`[^\\n]+Stub', 'i'));
    }

    assert.equal(PROVIDER_OVERLAYS.onprem.active, false);
    assert.match(providerSection, /`onprem`[^.\n]+CAPEX|On-prem[^.\n]+CAPEX/i);
});

test('WIZARD §6 documents current bundled SKU counts for active providers', () => {
    for (const providerId of ['sbercloud', 'yandex', 'vk']) {
        const count = Object.keys(BUNDLED_PROVIDER_PRICES[providerId]?.prices || {}).length;
        assert.ok(count > 0, `${providerId} bundled prices must not be empty`);
        assert.match(
            providerSection,
            new RegExp('`' + providerId + '`[^\\n]+' + count + '\\s+SKU'),
            `WIZARD §6 must document ${providerId} = ${count} SKU`
        );
    }
});
