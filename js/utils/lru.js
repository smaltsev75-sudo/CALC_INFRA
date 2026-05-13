/**
 * Простой LRU-кэш по строковому ключу. При переполнении вытесняется
 * наименее недавно использованный элемент. Используется для мемоизации
 * результатов расчёта.
 */
export class LruCache {
    constructor(capacity = 16) {
        this.capacity = capacity;
        this.map = new Map();
    }
    get(key) {
        if (!this.map.has(key)) return undefined;
        const value = this.map.get(key);
        this.map.delete(key);
        this.map.set(key, value);
        return value;
    }
    set(key, value) {
        if (this.map.has(key)) this.map.delete(key);
        else if (this.map.size >= this.capacity) {
            const firstKey = this.map.keys().next().value;
            this.map.delete(firstKey);
        }
        this.map.set(key, value);
    }
    clear() {
        this.map.clear();
    }
}
