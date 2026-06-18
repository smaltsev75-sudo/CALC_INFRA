/**
 * Stage 5B-Sec (вариант A, 2026-06-18): честный текст pdn_category.
 *
 * Фактическая модель: категория ПДн влияет на стоимость ровно в ОДНОЙ статье —
 * `security-pdn-category-hardening` (50 000 ₽/мес × {3,2,1} для УЗ {1,2,3}).
 * Она НЕ умножает всю категорию SECURITY и НЕ масштабирует СЗИ/шифрование.
 *
 * Прежний текст обещал «+50-150% к категории SECURITY» и «стоимость СЗИ занижена
 * в 1,5-3 раза» — это выдуманный множитель, которого в коде нет. Доменных
 * коэффициентов для варианта B/C у нас нет → оставляем модель «отдельная статья»
 * (вариант A) и приводим user-facing текст в соответствие.
 *
 * Этот arch-тест — forcing function: запрещает повторно ввести обещание
 * множителя всей категории в user-facing полях вопроса pdn_category.
 *
 * Regex кириллице-безопасны: в JS `\w` НЕ ловит кириллицу (это [A-Za-z0-9_]),
 * поэтому используем явные классы [а-яё] (см. feedback_regex_cyrillic_w).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_QUESTIONS } from '../../../js/domain/seed.js';

const q = SEED_QUESTIONS.find(x => x.id === 'pdn_category');

describe('pdn_category: текст не обещает множитель всей категории SECURITY (вариант A)', () => {
    it('вопрос pdn_category присутствует в seed', () => {
        assert.ok(q, 'pdn_category должен быть в SEED_QUESTIONS');
    });

    it('impact НЕ обещает «% к категории SECURITY»', () => {
        assert.doesNotMatch(String(q.impact || ''), /%\s*к\s*категории\s*SECURITY/i,
            'модель добавляет отдельную статью усиления, а не процент ко всей категории');
    });

    it('user-facing текст НЕ обещает кратное удорожание СЗИ от категории', () => {
        const text = [q.impact, q.description, q.recommendation].join('\n');
        assert.doesNotMatch(text, /заниж[а-яё]*\s+в\s+[\d.,]+\s*[-–]\s*\d+\s*раз/i,
            'нет обещания «СЗИ занижены в N раз» от категории — калькулятор так не считает');
    });

    it('impact честно описывает фактическую модель (отдельная статья усиления контура)', () => {
        assert.match(String(q.impact || ''), /отдельн[а-яё]+\s+стат|усилени[а-яё]+\s+контур/i,
            'impact должен называть реальную статью «Усиление контура по категории ПДн»');
    });
});
