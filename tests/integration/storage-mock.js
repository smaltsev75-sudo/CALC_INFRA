/**
 * Минималистичный mock localStorage для интеграционных тестов.
 * Подменяется в global перед импортом модулей storage.
 */

class MemoryStorage {
    constructor() { this.data = new Map(); }
    get length() { return this.data.size; }
    setItem(k, v) { this.data.set(String(k), String(v)); }
    getItem(k) { return this.data.has(k) ? this.data.get(k) : null; }
    removeItem(k) { this.data.delete(k); }
    key(i) { return Array.from(this.data.keys())[i] ?? null; }
    clear() { this.data.clear(); }
}

export function installLocalStorage() {
    // Принудительно заменяем — даже если Node предоставил свой localStorage
    // (в новых версиях он экспериментальный), он может не иметь нужных методов.
    Object.defineProperty(globalThis, 'localStorage', {
        value: new MemoryStorage(),
        configurable: true,
        writable: true
    });
    return globalThis.localStorage;
}
