/**
 * Инвариант: `APP_VERSION` в [constants.js](js/utils/constants.js) ОБЯЗАН
 * совпадать с `version` в [package.json](package.json).
 *
 * Иначе шапка sidebar и `appVersion` в JSON-bundle расходятся с формальной
 * NPM-версией пакета. Без сборщика синхронизировать одной точкой нельзя
 * (браузер не подгружает `package.json` без CORS/server-side), поэтому
 * держим два источника + этот линтер.
 *
 * Политика SemVer-bump'а описана в комментарии к `APP_VERSION` в
 * [constants.js](js/utils/constants.js).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../../../js/utils/constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgJson = JSON.parse(readFileSync(
    join(__dirname, '..', '..', '..', 'package.json'),
    'utf8'
));

describe('APP_VERSION ↔ package.json.version sync', () => {
    it('APP_VERSION совпадает с package.json "version"', () => {
        assert.equal(APP_VERSION, pkgJson.version,
            `APP_VERSION = "${APP_VERSION}", package.json.version = "${pkgJson.version}". ` +
            `Два источника правды разошлись — поднять оба синхронно при следующем bump'е. ` +
            `Политика см. в комментарии к APP_VERSION в js/utils/constants.js.`);
    });

    it('APP_VERSION имеет формат SemVer X.Y.Z (числовые сегменты)', () => {
        assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/,
            `APP_VERSION = "${APP_VERSION}" не соответствует SemVer X.Y.Z. ` +
            `Pre-release/build-metadata суффиксы (-rc1, +sha) в этом проекте не используются.`);
    });
});
