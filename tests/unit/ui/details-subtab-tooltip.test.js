import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const detailsSrc = stripJsComments(fs.readFileSync(path.resolve(here, '../../../js/ui/details.js'), 'utf8'));

describe('Детализация: sub-tab tooltip не дублирует видимую подпись', () => {
    it('title берётся из отдельного словаря действия, а не из SUB_TAB_LABELS', () => {
        assert.match(detailsSrc, /const\s+SUB_TAB_TITLES\s*=\s*Object\.freeze/);
        assert.match(detailsSrc, /title:\s*SUB_TAB_TITLES\[t\]/);
        assert.doesNotMatch(detailsSrc, /title:\s*SUB_TAB_LABELS\[t\]/);
    });
});
