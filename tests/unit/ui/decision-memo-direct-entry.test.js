/**
 * UX-ревью (2026-05-31, #6): «Обоснование расчёта» (Decision Memo) — экспортируемый
 * документ для согласования бюджета — не имел прямого входа: открывался только как
 * top-1 «Следующий шаг» или изнутри модалок «Бюджет»/«Проверка расчёта». Добавлена
 * постоянная кнопка «Обоснование» в toolbar Дашборда (рядом с «Допущения»),
 * переиспользующая существующий ctx.openDecisionMemoModal.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const dashboardSrc = stripJsComments(fs.readFileSync(
    path.resolve(here, '../../../js/ui/dashboard.js'), 'utf8'));

describe('Decision Memo: прямой постоянный вход в toolbar Дашборда (#6)', () => {
    it('есть кнопка с data-testid="open-decision-memo"', () => {
        assert.match(dashboardSrc, /data-testid['"]?\s*:\s*['"]open-decision-memo['"]/,
            'нужна прямая кнопка с data-testid="open-decision-memo" в Дашборде');
    });

    it('кнопка вызывает существующий ctx.openDecisionMemoModal', () => {
        assert.match(dashboardSrc, /ctx\.openDecisionMemoModal\?\.\(\)/,
            'кнопка «Обоснование» должна вызывать ctx.openDecisionMemoModal');
    });

    it('кнопка подключена в toolbar (renderDecisionMemoBtn вызывается в .tab-toolbar-actions)', () => {
        assert.match(dashboardSrc, /renderDecisionMemoBtn\s*\(\s*ctx\s*\)/,
            'renderDecisionMemoBtn(ctx) должна вызываться в toolbar Дашборда');
    });
});
