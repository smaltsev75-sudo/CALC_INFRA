/**
 * Sprint 3.0 / Stage 3 финализация: manual override AI-default полей.
 *
 * Инвариант: при `setAnswer(id, value)` для AI-поля с meta.source='ai_default'
 * source меняется на 'manual' ТОЛЬКО для этого поля. Остальные AI-поля,
 * преложенные wizard'ом при ai_used=true, продолжают носить 'ai_default'.
 * Это даёт пользователю явное визуальное разделение «что я изменил» vs
 * «что осталось из мастера».
 *
 * Также проверяется поведение Re-apply (preserve mode):
 *   - manual-помеченные AI-поля сохраняют значение + manual-tag
 *   - остальные AI-поля перезаписываются с source='ai_default' (не 'manual')
 *
 * Все тесты бьют по реальному calcController через store, без DOM-mock'ов.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

let store, calcList, calcCtl;

before(async () => {
    installLocalStorage();
    store = (await import('../../js/state/store.js')).store;
    calcList = await import('../../js/controllers/calcListController.js');
    calcCtl = await import('../../js/controllers/calcController.js');
});

beforeEach(() => {
    installLocalStorage();
    store.setActiveCalc(null);
    store.setCalcList([]);
});

function setupAiCalc(industry = 'corporate', scale = 'm') {
    return calcList.createCalcFromWizard('AI Calc', {
        product_type: 'b2b',
        industry, scale,
        geography: 'ru',
        pdn: false,
        activity: 'medium',
        ai_used: true
    });
}

describe('Stage 3: AI-default manual override — single field затрагивает только этот id', () => {
    it('после setAnswer на ai_caching_share — meta.source = manual ТОЛЬКО для него', () => {
        setupAiCalc();
        const before = store.getState().activeCalc;
        // ai_caching_share точно prefilled при ai_used=true (corporate.ai.ai_caching_share = 30).
        assert.equal(before.answersMeta.ai_caching_share?.source, 'ai_default',
            'до override ai_caching_share имеет meta=ai_default');
        assert.equal(before.answersMeta.ai_llm_used?.source, 'ai_default',
            'до override ai_llm_used имеет meta=ai_default');
        // Manual override одного поля.
        calcCtl.setAnswer('ai_caching_share', 75);
        const after = store.getState().activeCalc;
        assert.equal(after.answers.ai_caching_share, 75);
        assert.equal(after.answersMeta.ai_caching_share.source, 'manual',
            'после override ai_caching_share стал manual');
        // Остальные AI-поля не тронуты.
        assert.equal(after.answersMeta.ai_llm_used?.source, 'ai_default',
            'ai_llm_used сохранил ai_default — manual override НЕ распространяется на другие AI-поля');
        assert.equal(after.answersMeta.rag_corpus_size_gb?.source, 'ai_default',
            'rag_corpus_size_gb сохранил ai_default');
    });

    it('manual override ai_llm_used (master-toggle) НЕ перезатирает остальные AI-поля meta', () => {
        setupAiCalc();
        // Выключаем master-toggle вручную — каскадное обнуление зависимых
        // полей в null (см. CLAUDE.md), но meta'ы зависимых должны остаться
        // ai_default (это не manual-edit, а каскад).
        calcCtl.setAnswer('ai_llm_used', false);
        const after = store.getState().activeCalc;
        assert.equal(after.answers.ai_llm_used, false);
        assert.equal(after.answersMeta.ai_llm_used.source, 'manual',
            'явно изменённое поле = manual');
        // Зависимые поля (например rag_corpus_size_gb) могут быть сброшены
        // в null каскадом, но если meta была ai_default — она такой и остаётся
        // (или удаляется вместе с обнулением; обе семантики допустимы).
        const ragMeta = after.answersMeta.rag_corpus_size_gb;
        if (ragMeta) {
            assert.notEqual(ragMeta.source, 'manual',
                'rag_corpus_size_gb НЕ должен стать manual из-за каскада от ai_llm_used');
        }
    });
});

describe('Stage 3: Re-apply preserve mode сохраняет manual-overrides AI-полей', () => {
    it('manual override на ai_caching_share переживает reapplyProfile(preserve)', () => {
        setupAiCalc();
        calcCtl.setAnswer('ai_caching_share', 75);
        // Re-apply preserve — должен оставить manual-помеченные поля.
        calcCtl.reapplyProfile('preserve');
        const after = store.getState().activeCalc;
        assert.equal(after.answers.ai_caching_share, 75,
            'manual-значение 75 сохранено после Re-apply preserve');
        assert.equal(after.answersMeta.ai_caching_share.source, 'manual',
            'meta остался manual после Re-apply preserve');
    });

    it('Re-apply preserve восстанавливает source=ai_default для НЕ-manual AI-полей', () => {
        setupAiCalc();
        // Имитируем неполное состояние: дёргаем какое-нибудь не-AI поле в manual,
        // чтобы reapplyProfile(preserve) точно сработал.
        calcCtl.setAnswer('peak_rps', 9999);
        // Re-apply.
        calcCtl.reapplyProfile('preserve');
        const after = store.getState().activeCalc;
        // ai_llm_used — НЕ manual → должен быть переписан с ai_default.
        assert.equal(after.answersMeta.ai_llm_used.source, 'ai_default',
            'ai_llm_used после Re-apply preserve = ai_default (не wizard, не profile)');
        assert.equal(after.answersMeta.ai_caching_share?.source, 'ai_default',
            'ai_caching_share после Re-apply preserve = ai_default');
    });
});

describe('Stage 3: Re-apply overwrite mode перезаписывает manual AI-overrides', () => {
    it('manual ai_caching_share=75 → reapplyProfile(overwrite) → значение из профиля + meta=ai_default', () => {
        setupAiCalc();
        calcCtl.setAnswer('ai_caching_share', 75);
        const beforeOverride = store.getState().activeCalc.answers.ai_caching_share;
        assert.equal(beforeOverride, 75);
        calcCtl.reapplyProfile('overwrite');
        const after = store.getState().activeCalc;
        // 30 — дефолт corporate.ai.ai_caching_share из wizardProfiles.js.
        assert.equal(after.answers.ai_caching_share, 30,
            'значение из профиля corporate (30%) переписало manual 75%');
        assert.equal(after.answersMeta.ai_caching_share.source, 'ai_default',
            'meta после overwrite = ai_default (а не manual)');
    });
});
