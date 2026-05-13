/**
 * Генерация UUID v4. Использует crypto.randomUUID() при наличии,
 * с фоллбеком на crypto.getRandomValues().
 *
 * Math.random-фоллбек убран в Этапе 10.4.4: Math.random не криптостойкий
 * и не подходит для генерации идентификаторов. Все современные браузеры
 * (Chrome 90+, Safari 14+, Firefox 89+, Yandex) гарантированно
 * предоставляют crypto.randomUUID() или crypto.getRandomValues();
 * в Node ≥ 17 crypto доступен глобально. На древних рантаймах без
 * crypto API uuid() бросает понятную ошибку — это намеренно.
 */

export function uuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0'));
        return [
            hex.slice(0, 4).join(''),
            hex.slice(4, 6).join(''),
            hex.slice(6, 8).join(''),
            hex.slice(8, 10).join(''),
            hex.slice(10, 16).join('')
        ].join('-');
    }
    // Math.random-фоллбек намеренно отсутствует: см. JSDoc выше.
    throw new Error('crypto API not available — modern browser required');
}
