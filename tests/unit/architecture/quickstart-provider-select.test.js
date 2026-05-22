/**
 * Quick Start provider-select invariant.
 *
 * Regression: provider field was rendered as disabled Cloud.ru-only select even
 * though provider overlays already support sbercloud/yandex/vk. The selected
 * provider also has to reach createCalcFromWizard → calc.settings.provider.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const read = rel => readFileSync(resolve(ROOT, rel), 'utf8');

function functionBody(source, name) {
    const clean = stripJsComments(source);
    const re = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
    const m = clean.match(re);
    assert.ok(m, `function ${name} должна существовать`);
    let i = m.index + m[0].length;
    const start = i;
    let depth = 1;
    while (i < clean.length && depth > 0) {
        const ch = clean[i];
        if (ch === '{') depth++;
        if (ch === '}') depth--;
        if (depth === 0) return clean.slice(start, i);
        i++;
    }
    assert.fail(`function ${name} body parse failed`);
}

test('Quick Start provider field uses ctx providers and is not disabled', () => {
    const modalSrc = read('js/ui/modals/quickStartModal.js');
    const modelSrc = read('js/ui/modals/quickStartModel.js');
    const clean = stripJsComments(`${modalSrc}\n${modelSrc}`);
    const body = functionBody(modalSrc, 'renderProviderField');

    assert.match(clean, /listActiveProvidersForQuickStart/,
        'Quick Start должен брать список активных провайдеров через ctx.');
    assert.match(clean, /getDefaultProviderId/,
        'Quick Start должен брать default provider через ctx.');
    assert.match(clean, /renderProviderField\(\s*\{[\s\S]*value:\s*draft\.provider/,
        'renderProviderField должен получать текущее значение draft.provider.');
    assert.match(clean, /onChange:\s*v\s*=>\s*patch\(\s*\{\s*provider:\s*v\s*\}\s*\)/,
        'смена provider в select должна обновлять draft.provider.');
    assert.match(clean, /provider:\s*draft\.provider\s*\|\|\s*defaultProvider/,
        'submit Quick Start должен передавать provider в createCalcFromWizard.');
    assert.doesNotMatch(body, /disabled\s*:\s*['"]disabled['"]/,
        'provider-select в Quick Start не должен быть disabled.');
    assert.match(body, /options\.map/,
        'provider-select должен рендерить options из списка, а не одну зашитую опцию.');
});

test('Quick Start provider field opens picker from field label area on first click', () => {
    const src = read('js/ui/modals/quickStartModal.js');
    const clean = stripJsComments(src);
    const body = functionBody(src, 'renderProviderField');

    assert.match(clean, /openProviderSelectFromFieldClick/,
        'у provider-select должен быть click-helper для клика по области поля.');
    assert.match(body, /onClick:\s*openProviderSelectFromFieldClick/,
        'wrapper provider-поля должен вызывать helper на click.');
    assert.match(clean, /tagName\s*===\s*'SELECT'/,
        'прямой клик по самому select должен оставаться нативным.');
    assert.match(clean, /select\.showPicker\(\)/,
        'клик по label/description должен открывать native select через showPicker(), а не только фокусировать.');
    assert.match(clean, /e\.preventDefault\(\)/,
        'helper должен подавлять label-forwarding, который даёт UX «первый клик только фокусирует».');
});

test('app ctx exposes Quick Start provider methods without UI importing controllers', () => {
    const app = stripJsComments(read('js/app.js'));
    const quickStart = stripJsComments(
        `${read('js/ui/modals/quickStartModal.js')}\n${read('js/ui/modals/quickStartModel.js')}`
    );

    assert.match(app, /listActiveProvidersForQuickStart\(\)\s*\{\s*return\s+providerCtl\.listActiveProvidersForQuickStart\(\)/,
        'app.js должен прокидывать список провайдеров через ctx.');
    assert.match(app, /getDefaultProviderId\(\)\s*\{\s*return\s+providerCtl\.getDefaultProviderId\(\)/,
        'app.js должен прокидывать default provider через ctx.');
    assert.doesNotMatch(quickStart, /from\s+['"][^'"]*controllers\//,
        'UI не должен импортировать controllers напрямую.');
    assert.doesNotMatch(quickStart, /from\s+['"][^'"]*state\//,
        'UI не должен импортировать state напрямую.');
});

test('createCalcFromWizard persists selected provider into calc.settings', () => {
    const src = stripJsComments(read('js/controllers/calcListController.js'));

    assert.match(src, /getActiveProviders\(\)/,
        'createCalcFromWizard должен проверять provider по списку активных провайдеров.');
    assert.match(src, /wizardInput\?\.provider/,
        'createCalcFromWizard должен читать provider из wizardInput.');
    assert.match(src, /:\s*DEFAULT_PROVIDER/,
        'unknown или пустой provider должен fallback-иться к DEFAULT_PROVIDER.');
    assert.match(src, /calc\.settings\s*=\s*\{[^}]*provider,\s*providerSetByWizard:\s*true/s,
        'calc.settings.provider должен сохраняться вместе с providerSetByWizard=true.');
});
