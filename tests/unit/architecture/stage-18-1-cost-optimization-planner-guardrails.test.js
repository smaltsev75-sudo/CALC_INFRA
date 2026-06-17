/**
 * Stage 18.1 — Cost Optimization Planner architectural guardrails.
 *
 * Защищает контракт планера (v2.13.0):
 *
 *   - domain без store / services / localStorage / setAnswer.
 *   - UI без прямых controllers / state-импортов (layer-purity).
 *   - UI без setAnswer / updateActiveCalc / saveCalc / commitActiveCalc.
 *   - Mutation активного расчёта происходит ТОЛЬКО внутри _runApply
 *     controller'а (через стандартные setSetting/setAnswer + commitActiveCalc
 *     для rollback) — никогда из open/close/setLevel/toggleConstraint/
 *     updateValue/removeChange/resetDraft.
 *   - Никаких What-if / Playbook / Scenario Pack терминов в новых файлах.
 *   - Никакого «Применить план» / «Автооптимизировать».
 *   - UserManual соответствует контракту.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8');
const COP_MODAL_FILES = [
    'js/ui/modals/costOptimizationPlannerModal.js',
    'js/ui/modals/costOptimizationPlannerModalControls.js',
    'js/ui/modals/costOptimizationPlannerModalFormat.js',
    'js/ui/modals/costOptimizationPlannerModalLevers.js',
    'js/ui/modals/costOptimizationPlannerModalSummary.js'
];
const readCopModalSources = () => COP_MODAL_FILES.map(read).join('\n');

/* ============================================================
 * 1. Domain purity
 * ============================================================ */

describe('Stage 18.1 — domain pure (без UI/store/services)', () => {
    const src = [
        'js/domain/costOptimizationPlanner.js',
        'js/domain/costOptimizationPlannerConfig.js',
        'js/domain/costOptimizationPlannerPlans.js',
        'js/domain/costOptimizationPlannerShared.js'
    ].map(f => stripJsComments(read(f))).join('\n');

    it('не импортирует store', () => {
        assert.doesNotMatch(src, /from\s+['"][^'"]*state\/store/);
        assert.doesNotMatch(src, /from\s+['"][^'"]*\/store/);
    });

    it('не импортирует services/', () => {
        assert.doesNotMatch(src, /from\s+['"][^'"]*services\//);
    });

    it('не использует localStorage', () => {
        assert.doesNotMatch(src, /localStorage\./);
    });

    it('не вызывает setAnswer / updateActiveCalc / saveCalc', () => {
        for (const method of ['setAnswer', 'updateActiveCalc', 'saveCalc', 'commitActiveCalc']) {
            assert.doesNotMatch(src, new RegExp(`\\b${method}\\s*\\(`),
                `domain не должен вызывать ${method}`);
        }
    });

    it('не использует document/window/global DOM', () => {
        assert.doesNotMatch(src, /\bdocument\.\w+/);
        assert.doesNotMatch(src, /\bwindow\.\w+/);
    });
});

/* ============================================================
 * 2. UI layer-purity
 * ============================================================ */

describe('Stage 18.1 — UI layer-purity', () => {
    /* Stage 18.2.x: teaser встроен в composite-сводку (calculationStateSummary.js). */
    const cardSrc  = stripJsComments(read('js/ui/calculationStateSummary.js'));
    const modalSrc = stripJsComments(readCopModalSources());

    it('UI не импортирует controllers/ напрямую', () => {
        assert.doesNotMatch(cardSrc, /from\s+['"][^'"]*controllers\//);
        assert.doesNotMatch(modalSrc, /from\s+['"][^'"]*controllers\//);
    });

    it('UI не импортирует state/store напрямую', () => {
        assert.doesNotMatch(cardSrc, /from\s+['"][^'"]*state\/store/);
        assert.doesNotMatch(modalSrc, /from\s+['"][^'"]*state\/store/);
    });

    it('UI не вызывает setAnswer / updateActiveCalc / saveCalc', () => {
        for (const method of ['setAnswer', 'updateActiveCalc', 'saveCalc']) {
            assert.doesNotMatch(cardSrc, new RegExp(`\\b${method}\\s*\\(`));
            assert.doesNotMatch(modalSrc, new RegExp(`\\b${method}\\s*\\(`));
        }
    });

    it('UI взаимодействует со state ТОЛЬКО через ctx-методы', () => {
        // Допустимы: ctx.openCostOptimizationPlannerModal, ctx.closeModal,
        // ctx.setCostOptimizationConstraint, ctx.focusQuestion, ctx.setActiveTab.
        // Запрещены: store.update*, store.openModal без обёртки.
        assert.doesNotMatch(cardSrc, /\bstore\.\w+/);
        assert.doesNotMatch(modalSrc, /\bstore\.\w+/);
    });
});

/* ============================================================
 * 3. Next Steps integration
 * ============================================================ */

describe('Stage 18.1 — Next Steps target navigation-only', () => {
    it('TARGET_DISPATCH содержит cost_optimization_planner → ctx.openCostOptimizationPlannerModal', () => {
        // Stage 18.2: TARGET_DISPATCH перенесён из nextSteps.js в calculationStateSummary.js.
        const src = stripJsComments(read('js/ui/calculationStateSummary.js'));
        assert.match(src,
            /cost_optimization_planner\s*:\s*\(\s*ctx\s*\)\s*=>\s*ctx\.openCostOptimizationPlannerModal/);
    });

    it('ALLOWED_TARGETS содержит cost_optimization_planner', () => {
        const src = stripJsComments(read('js/domain/recommendedActions.js'));
        assert.match(src, /['"]cost_optimization_planner['"]/);
    });

    it('recommendedActions предлагает action ТОЛЬКО при budget warning (не дефолт)', () => {
        const src = stripJsComments(read('js/domain/recommendedActions.js'));
        // action должен быть обёрнут в условие BUDGET_STATUS.WARNING
        assert.match(src,
            /BUDGET_STATUS\.WARNING[\s\S]{0,2500}target:\s*['"]cost_optimization_planner['"]/);
    });

    it('action target — navigation, не mutation (нет apply/preview/rollback в actionLabel/title)', () => {
        const src = stripJsComments(read('js/domain/recommendedActions.js'));
        // Берём именно makeAction-блок с target=cost_optimization_planner, не сырое окно
        // (иначе попадаем в соседние ALLOWED_TARGETS / FORBIDDEN_TARGETS массивы).
        const m = src.match(/makeAction\(\{[\s\S]{0,500}?target:\s*['"]cost_optimization_planner['"][\s\S]{0,500}?\}\)/);
        assert.ok(m, 'makeAction({ target: cost_optimization_planner }) должен существовать');
        const block = m[0];
        assert.equal(/\bapply\b|\bpreview\b|\brollback\b/i.test(block), false,
            'cost_optimization_planner action не должен включать apply/preview/rollback в title/actionLabel/reason');
    });
});

/* ============================================================
 * 4. Удалённые / запрещённые термины
 * ============================================================ */

describe('Stage 18.1 — нет восстановленных удалённых терминов', () => {
    const FORBIDDEN_TERMS = [
        'Optimization Playbook',
        'Apply playbook',
        'What-if модалка',
        'Scenario pack',
        'apply_to_scenario',
        'mutate_scenario'
    ];

    for (const term of FORBIDDEN_TERMS) {
        it(`не появляется "${term}" в новых файлах Stage 18.1 / 18.2.x`, () => {
            const files = [
                'js/domain/costOptimizationPlanner.js',
                'js/domain/costOptimizationPlannerConfig.js',
                'js/domain/costOptimizationPlannerPlans.js',
                'js/domain/costOptimizationPlannerShared.js',
                'js/ui/calculationStateSummary.js',
                ...COP_MODAL_FILES
            ];
            for (const f of files) {
                const src = read(f);
                assert.equal(src.includes(term), false,
                    `${f} содержит запрещённый термин "${term}"`);
            }
        });
    }
});

/* ============================================================
 * 5. UserManual — синхронизация
 * ============================================================ */

describe('Stage 18.1 — UserManual синхронизирован', () => {
    const src = read('UserManual.md');

    it('содержит раздел «План оптимизации стоимости»', () => {
        assert.match(src, /План оптимизации стоимости/);
    });

    it('явно говорит про explicit apply (изменения не применяются без нажатия)', () => {
        /* Принимаем оба числа («не применяет» / «не применяют») и оба глагола;
           Phase 3 также добавил «применяются … только после нажатия». */
        assert.match(src,
            /не\s+применя(?:е|ю)т.*автоматически|не\s+меня(?:е|ю)т.*автоматически|применя(?:е|ю)тся\s+к\s+расч[её]ту\s+только\s+после/i);
    });

    it('упоминает 3 уровня: консервативный / амбициозный / экстремальный', () => {
        assert.match(src, /консервативн/i);
        assert.match(src, /амбициозн/i);
        assert.match(src, /экстремальн/i);
    });

    /* Phase 3-specific: документация описывает Apply / Rollback / inline confirm. */
    it('описывает «Применить изменения» (Apply)', () => {
        assert.match(src, /Применить изменения/);
    });

    it('описывает откат («Откатить последнее применение» или rollback session-only)', () => {
        assert.match(src, /Откатить последнее применение|rollback|откат/i);
    });

    it('описывает inline high-risk confirmation', () => {
        assert.match(src, /Подтвердить изменения|inline-confirmation|inline-подтвержден|подтверждени/i);
    });

    it('явно говорит, что черновик не сохраняется (F5 теряет)', () => {
        /* PATCH 2.17.7: после русификации UserManual.md фраза изменилась с
         * «runtime-only, без localStorage» на «живёт только в текущей сессии,
         * без сохранения в браузере». Regex теперь принимает обе формы. */
        assert.match(src,
            /F5\s+(?:теря|сбрасывает)|runtime-only|без\s+localStorage|session-only|только в текущей сессии|без сохранения в браузере/i);
    });
});

/* ============================================================
 * 9. Phase 4 — legacy CSS удалён + версия 2.13.0
 * ============================================================ */

describe('Stage 18.1 Phase 4 — legacy CSS absence', () => {
    const css = read('css/dashboard.css');

    it('нет class definitions для .cop-tile-* (старый 3-tile dashboard)', () => {
        /* Проверяем именно объявления класса (^\.cop-tile), не упоминания
           в комментариях. */
        const matches = css.match(/^\.cop-tile(?![a-z-])/gm) || [];
        const tileSub = css.match(/^\.cop-tile-\w+/gm) || [];
        assert.equal(matches.length, 0, `Legacy .cop-tile rules: ${matches.length}`);
        assert.equal(tileSub.length, 0, `Legacy .cop-tile-* rules: ${tileSub.length}`);
    });

    it('нет class definitions для .cop-plan-* (старая read-only modal)', () => {
        const matches = css.match(/^\.cop-plan-\w+/gm) || [];
        assert.equal(matches.length, 0, `Legacy .cop-plan-* rules: ${matches.length}`);
    });

    it('нет .cop-block / .cop-block-header / .cop-block-subtitle / .cop-tiles', () => {
        for (const sel of ['.cop-block ', '.cop-block-header', '.cop-block-subtitle', '.cop-tiles']) {
            assert.equal(
                css.match(new RegExp(`^\\${sel.trim()}\\b`, 'gm'))?.length || 0,
                0,
                `Legacy ${sel} rule still present`
            );
        }
    });

    it('нет orphan .cop-lever-{row,from-to,saving,no-nav,nav-cta}', () => {
        for (const sel of ['.cop-lever-row', '.cop-lever-from-to', '.cop-lever-saving',
                           '.cop-lever-no-nav', '.cop-lever-nav-cta']) {
            assert.equal(
                css.match(new RegExp(`^\\${sel}\\b`, 'gm'))?.length || 0,
                0,
                `Legacy ${sel} rule still present`
            );
        }
    });

    it('Stage 18.2.x — `.cop-teaser*` orphan-классы удалены (teaser встроен в composite-сводку)', () => {
        const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
        assert.doesNotMatch(cssNoComments, /^\.cop-teaser\b/m);
        assert.doesNotMatch(cssNoComments, /^\.cop-teaser-cta\b/m);
    });

    it('teaser встроен как .calc-state-summary-optimization* (Stage 18.2.x)', () => {
        assert.match(css, /\.calc-state-summary-optimization\b/);
        assert.match(css, /\.calc-state-summary-optimization-cta\b/);
    });

    it('Phase 3 classes присутствуют (.cop-rollback-bar, .cop-confirm-panel)', () => {
        assert.match(css, /^\.cop-rollback-bar\b/m);
        assert.match(css, /^\.cop-confirm-panel\b/m);
    });
});

describe('Stage 18.1 / 18.1.1 / 18.2 / VAT-1 / VAT-2 / Stage 19 / Stage 19.x — версия 2.13.x..2.20.x', () => {
    it('package.json содержит 2.13.x..2.21.x (Stage 18.1 → VAT-2 → MINOR 2.18.0 → Stage 19 → MINOR 2.21.0 qty-модель ПРОМ)', () => {
        const pkg = JSON.parse(read('package.json'));
        assert.match(pkg.version, /^2\.(13|14|15|16|17|18|19|20|21)\.\d+$/);
    });

    it('APP_VERSION в constants.js синхронизирован с package.json', () => {
        const constSrc = read('js/utils/constants.js');
        const pkg = JSON.parse(read('package.json'));
        const m = constSrc.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
        assert.ok(m);
        assert.equal(m[1], pkg.version);
    });
});

/* ============================================================
 * 6. Phase 3 — controller mutation surface ограничен apply/rollback
 * ============================================================ */

describe('Stage 18.1 Phase 3 — controller mutation surface', () => {
    const ctlSrc = stripJsComments(read('js/controllers/costOptimizationPlannerController.js'));

    it('controller использует store.{openModal,patchModal,closeModal} для draft state', () => {
        assert.match(ctlSrc, /store\.(openModal|patchModal|closeModal)/);
    });

    it('controller импортирует calcController и calcPersistence ТОЛЬКО для apply/rollback', () => {
        assert.match(ctlSrc, /from\s+['"]\.\/calcController(\.js)?['"]/);
        assert.match(ctlSrc, /from\s+['"][^'"]*services\/calcPersistence(\.js)?['"]/);
    });

    it('setSetting / setAnswer вызываются ТОЛЬКО внутри _dispatchPatches/_runApply', () => {
        /* Простой статический инвариант: ищем все вызовы setSetting/setAnswer,
           каждый должен находиться внутри _dispatchPatches или _runApply
           (Phase 3 apply pipeline). Никаких setSetting/setAnswer в openModal /
           setLevel / toggleConstraint / updateValue / removeChange / reset /
           rollback. */
        const setterCalls = [...ctlSrc.matchAll(/calcCtl\.(setSetting|setAnswer)\s*\(/g)];
        assert.ok(setterCalls.length >= 2,
            'Phase 3 ожидается ≥2 вызова setSetting/setAnswer');
        for (const m of setterCalls) {
            /* Ищем enclosing function: имя ближайшего function/export function/
               function _name выше m.index. */
            const upto = ctlSrc.slice(0, m.index);
            const fnMatch = [...upto.matchAll(/function\s+(_?\w+)\s*\(/g)].pop();
            assert.ok(fnMatch, 'enclosing function found');
            const enclosing = fnMatch[1];
            assert.ok(
                enclosing === '_dispatchPatches' || enclosing === '_runApply',
                `${m[1]} вне apply-pipeline (находится в ${enclosing})`
            );
        }
    });

    it('commitActiveCalc вызывается ТОЛЬКО в rollback (после updateActiveCalc snapshot)', () => {
        const commitCalls = [...ctlSrc.matchAll(/commitActiveCalc\s*\(/g)];
        assert.ok(commitCalls.length >= 1, 'rollback должен вызвать commitActiveCalc');
        for (const m of commitCalls) {
            const upto = ctlSrc.slice(0, m.index);
            const fnMatch = [...upto.matchAll(/function\s+(_?\w+)\s*\(/g)].pop();
            assert.ok(fnMatch);
            assert.equal(fnMatch[1], 'rollbackOptimizationApply',
                `commitActiveCalc в неподходящей функции: ${fnMatch[1]}`);
        }
    });

    it('open/setLevel/toggleConstraint/updateValue/removeChange/reset НЕ мутируют activeCalc', () => {
        /* Перечисляем функции, которые ДОЛЖНЫ оставаться pure relative к calc. */
        const pureFns = [
            'openCostOptimizationPlannerModal',
            'closeCostOptimizationPlannerModal',
            'setOptimizationLevel',
            'toggleOptimizationConstraint',
            'updateOptimizationDraftValue',
            'removeOptimizationDraftChange',
            'resetOptimizationDraft',
            'cancelOptimizationApplyConfirm'
        ];
        for (const fn of pureFns) {
            const re = new RegExp(`export function ${fn}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`);
            const body = ctlSrc.match(re);
            assert.ok(body, `body of ${fn} not found`);
            const blk = body[1];
            for (const forbidden of ['setSetting', 'setAnswer', 'commitActiveCalc', 'updateActiveCalc']) {
                assert.ok(!new RegExp(`\\b${forbidden}\\s*\\(`).test(blk),
                    `${fn} не должен вызывать ${forbidden}`);
            }
        }
    });
});

/* ============================================================
 * 7. Phase 3 — Modal Apply button активен, есть rollback и confirm panel
 * ============================================================ */

describe('Stage 18.1 Phase 3 — Apply / Rollback / Confirm in modal', () => {
    const modalSrc = stripJsComments(readCopModalSources());

    it('кнопка «Применить изменения» имеет ОПЦИОНАЛЬНЫЙ disabled (applyEnabled-driven)', () => {
        assert.match(modalSrc,
            /class:\s*['"][^'"]*cop-modal-apply[^'"]*['"][\s\S]{0,400}?applyEnabled\s*\?\s*undefined\s*:\s*['"]disabled['"]/);
    });

    it('Apply активен только при hasChanges && !hasError && !confirming', () => {
        assert.match(modalSrc,
            /applyEnabled\s*=\s*hasChanges\s*&&\s*!hasError\s*&&\s*!confirming/);
    });

    it('Apply onClick → ctx.applyOptimizationDraftAction', () => {
        assert.match(modalSrc, /onClick:\s*applyEnabled\s*\?\s*\(\)\s*=>\s*ctx\.applyOptimizationDraftAction\(\)/);
    });

    it('Inline confirm panel рендерится из renderInlineConfirmPanel', () => {
        assert.match(modalSrc, /function renderInlineConfirmPanel/);
        assert.match(modalSrc, /role:\s*['"]alertdialog['"]/);
    });

    it('Confirm panel НЕ открывает вложенную модалку', () => {
        assert.ok(!/store\.openModal\s*\(\s*['"]confirm['"]/.test(modalSrc),
            'inline confirmation, без вложенной confirmModal');
    });

    it('Rollback bar рендерится из renderRollbackBar', () => {
        assert.match(modalSrc, /function renderRollbackBar/);
        assert.match(modalSrc, /lastApplySnapshot/);
    });
});

/* ============================================================
 * 8. Phase 3 — нет persist для draft / lastApplySnapshot
 * ============================================================ */

describe('Stage 18.1 Phase 3 — draft / snapshot не persist\'ятся', () => {
    const ctlSrc = stripJsComments(read('js/controllers/costOptimizationPlannerController.js'));
    const modalSrc = stripJsComments(readCopModalSources());

    it('controller НЕ обращается к localStorage / persistence helpers', () => {
        assert.ok(!/localStorage/.test(ctlSrc));
        assert.ok(!/STORAGE_KEYS/.test(ctlSrc));
        assert.ok(!/from\s+['"][^'"]*persistence/.test(ctlSrc),
            'нет импортов state/persistence');
    });

    it('UI модалка тоже не пишет draft в localStorage', () => {
        assert.ok(!/localStorage/.test(modalSrc));
    });
});
