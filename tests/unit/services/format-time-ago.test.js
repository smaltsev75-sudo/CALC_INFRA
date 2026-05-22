/**
 * Stage 10.2: formatTimeAgo — humanize ISO-timestamp в относительный текст
 * для UI («только что», «5 мин назад», «вчера», «3 дн назад»).
 *
 * Используется в provider-update-row для индикатора свежести applied прайса.
 *
 * Контракты:
 *   - null / undefined / '' / невалидный → ''.
 *   - <60 сек → 'только что'.
 *   - <60 мин → 'N мин назад' (с правильным склонением).
 *   - <24 ч → 'N ч назад'.
 *   - <7 дн → 'N дн назад'.
 *   - >=7 дн → fallback на formatDate (dd.mm.yyyy).
 *
 * Pluralization для русского:
 *   1 → 'мин', 2..4 → 'мин', 5..20 → 'мин' (одинаково для всех — упрощение).
 *   Для часов и дней аналогично.
 *   Полная RU-pluralization избыточна для коротких единиц.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatTimeAgo } from '../../../js/services/format.js';

const NOW = new Date('2026-05-09T15:00:00.000Z').getTime();

describe('formatTimeAgo — невалидные входы', () => {
    it('null → ""', () => assert.equal(formatTimeAgo(null, NOW), ''));
    it('undefined → ""', () => assert.equal(formatTimeAgo(undefined, NOW), ''));
    it('"" → ""', () => assert.equal(formatTimeAgo('', NOW), ''));
    it('невалидная строка → ""', () => assert.equal(formatTimeAgo('not-a-date', NOW), ''));
    it('NaN-Date → ""', () => {
        const d = new Date('invalid');
        assert.equal(formatTimeAgo(d, NOW), '');
    });
});

describe('formatTimeAgo — относительные интервалы', () => {
    it('<10 сек → "только что"', () => {
        const t = new Date(NOW - 5_000).toISOString();
        assert.equal(formatTimeAgo(t, NOW), 'только что');
    });

    it('<60 сек → "только что"', () => {
        const t = new Date(NOW - 45_000).toISOString();
        assert.equal(formatTimeAgo(t, NOW), 'только что');
    });

    it('1 минута → "1 мин назад"', () => {
        const t = new Date(NOW - 60_000).toISOString();
        assert.equal(formatTimeAgo(t, NOW), '1 мин назад');
    });

    it('5 минут → "5 мин назад"', () => {
        const t = new Date(NOW - 5 * 60_000).toISOString();
        assert.equal(formatTimeAgo(t, NOW), '5 мин назад');
    });

    it('59 минут → "59 мин назад"', () => {
        const t = new Date(NOW - 59 * 60_000).toISOString();
        assert.equal(formatTimeAgo(t, NOW), '59 мин назад');
    });

    it('1 час → "1 ч назад"', () => {
        const t = new Date(NOW - 60 * 60_000).toISOString();
        assert.equal(formatTimeAgo(t, NOW), '1 ч назад');
    });

    it('5 часов → "5 ч назад"', () => {
        const t = new Date(NOW - 5 * 60 * 60_000).toISOString();
        assert.equal(formatTimeAgo(t, NOW), '5 ч назад');
    });

    it('23 часа → "23 ч назад"', () => {
        const t = new Date(NOW - 23 * 60 * 60_000).toISOString();
        assert.equal(formatTimeAgo(t, NOW), '23 ч назад');
    });

    it('1 день → "1 дн назад"', () => {
        const t = new Date(NOW - 24 * 60 * 60_000).toISOString();
        assert.equal(formatTimeAgo(t, NOW), '1 дн назад');
    });

    it('3 дня → "3 дн назад"', () => {
        const t = new Date(NOW - 3 * 24 * 60 * 60_000).toISOString();
        assert.equal(formatTimeAgo(t, NOW), '3 дн назад');
    });

    it('6 дней → "6 дн назад"', () => {
        const t = new Date(NOW - 6 * 24 * 60 * 60_000).toISOString();
        assert.equal(formatTimeAgo(t, NOW), '6 дн назад');
    });

    it('7 дней → fallback на полную дату dd.mm.yyyy', () => {
        const t = new Date(NOW - 7 * 24 * 60 * 60_000).toISOString();
        const r = formatTimeAgo(t, NOW);
        assert.match(r, /^\d{2}\.\d{2}\.\d{4}$/, '>= 7 дней → формат дд.мм.гггг');
    });

    it('30 дней → формат дд.мм.гггг', () => {
        const t = new Date(NOW - 30 * 24 * 60 * 60_000).toISOString();
        const r = formatTimeAgo(t, NOW);
        assert.match(r, /^\d{2}\.\d{2}\.\d{4}$/);
    });
});

describe('formatTimeAgo — будущее (timestamp в будущем относительно now)', () => {
    it('будущая дата → "только что" (clamp на 0)', () => {
        const t = new Date(NOW + 60_000).toISOString();
        assert.equal(formatTimeAgo(t, NOW), 'только что',
            'отрицательный delta clamp\'ится на 0 → "только что"');
    });
});

describe('formatTimeAgo — Date object вход', () => {
    it('принимает Date объект', () => {
        const t = new Date(NOW - 5 * 60_000);
        assert.equal(formatTimeAgo(t, NOW), '5 мин назад');
    });
});

describe('formatTimeAgo — без явного now (использует Date.now())', () => {
    it('очень близкое прошлое → "только что"', () => {
        const t = new Date(Date.now() - 1000).toISOString();
        assert.equal(formatTimeAgo(t), 'только что');
    });
});
