/**
 * 12.U1: persist accordion-состояний опросника.
 *
 * Контракт:
 *   - loadQuestionnaireOpenSections — null если не сохранено, иначе string[].
 *   - saveQuestionnaireOpenSections — принимает массив, не-массив → пустой массив.
 *   - loadQuestionnaireSettingsOpen — null если не сохранено, иначе boolean.
 *   - saveQuestionnaireSettingsOpen — принимает любое, кастит к boolean.
 *   - STORAGE_KEYS содержит соответствующие ключи.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../../integration/storage-mock.js';

describe('12.U1: persist опросника (accordion-состояния)', () => {
    let persist;
    let STORAGE_KEYS;

    before(async () => {
        installLocalStorage();
        persist = await import('../../../js/state/persistence.js');
        ({ STORAGE_KEYS } = await import('../../../js/utils/constants.js'));
    });

    beforeEach(() => {
        globalThis.localStorage.clear();
    });

    describe('STORAGE_KEYS', () => {
        it('содержит QUESTIONNAIRE_OPEN_SECTIONS', () => {
            assert.equal(STORAGE_KEYS.QUESTIONNAIRE_OPEN_SECTIONS, 'calc.questionnaireOpenSections');
        });

        it('содержит QUESTIONNAIRE_SETTINGS_OPEN', () => {
            assert.equal(STORAGE_KEYS.QUESTIONNAIRE_SETTINGS_OPEN, 'calc.questionnaireSettingsOpen');
        });
    });

    describe('loadQuestionnaireOpenSections', () => {
        it('возвращает null если ключ отсутствует', () => {
            assert.equal(persist.loadQuestionnaireOpenSections(), null);
        });

        it('возвращает массив, если сохранён массив', () => {
            persist.saveQuestionnaireOpenSections(['business', 'sla']);
            assert.deepEqual(persist.loadQuestionnaireOpenSections(), ['business', 'sla']);
        });

        it('возвращает null, если в storage не-массив (защита от мусора)', () => {
            globalThis.localStorage.setItem(STORAGE_KEYS.QUESTIONNAIRE_OPEN_SECTIONS, JSON.stringify('not-array'));
            assert.equal(persist.loadQuestionnaireOpenSections(), null);
        });
    });

    describe('saveQuestionnaireOpenSections', () => {
        it('сохраняет массив', () => {
            persist.saveQuestionnaireOpenSections(['a', 'b']);
            assert.deepEqual(JSON.parse(globalThis.localStorage.getItem(STORAGE_KEYS.QUESTIONNAIRE_OPEN_SECTIONS)), ['a', 'b']);
        });

        it('кастит не-массив в пустой массив (нормализация)', () => {
            persist.saveQuestionnaireOpenSections('not-array');
            assert.deepEqual(JSON.parse(globalThis.localStorage.getItem(STORAGE_KEYS.QUESTIONNAIRE_OPEN_SECTIONS)), []);
        });

        it('сохраняет пустой массив (значимое состояние «все секции свёрнуты»)', () => {
            persist.saveQuestionnaireOpenSections([]);
            assert.deepEqual(persist.loadQuestionnaireOpenSections(), []);
        });
    });

    describe('loadQuestionnaireSettingsOpen', () => {
        it('возвращает null если ключ отсутствует', () => {
            assert.equal(persist.loadQuestionnaireSettingsOpen(), null);
        });

        it('возвращает true/false из storage', () => {
            persist.saveQuestionnaireSettingsOpen(true);
            assert.equal(persist.loadQuestionnaireSettingsOpen(), true);
            persist.saveQuestionnaireSettingsOpen(false);
            assert.equal(persist.loadQuestionnaireSettingsOpen(), false);
        });

        it('возвращает null, если в storage не-boolean (защита от мусора)', () => {
            globalThis.localStorage.setItem(STORAGE_KEYS.QUESTIONNAIRE_SETTINGS_OPEN, JSON.stringify(123));
            assert.equal(persist.loadQuestionnaireSettingsOpen(), null);
        });
    });

    describe('saveQuestionnaireSettingsOpen', () => {
        it('кастит truthy/falsy к boolean', () => {
            persist.saveQuestionnaireSettingsOpen(1);
            assert.equal(persist.loadQuestionnaireSettingsOpen(), true);
            persist.saveQuestionnaireSettingsOpen(0);
            assert.equal(persist.loadQuestionnaireSettingsOpen(), false);
            persist.saveQuestionnaireSettingsOpen(null);
            // null → false (Boolean(null) === false), но loader проверяет typeof boolean —
            // false корректно сохранён.
            assert.equal(persist.loadQuestionnaireSettingsOpen(), false);
        });
    });
});
