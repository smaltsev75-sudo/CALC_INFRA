import { THEME_IDS, DEFAULT_THEME } from '../utils/constants.js';

/* Цвета meta[name=theme-color] для mobile browser-chrome / PWA frame.
   Соответствуют --bg-panel в base.css (#0a0f1a в dark, #f5e9cb в light).
   При расхождении токенов в base.css — обновить здесь синхронно. */
export const THEME_COLOR_BY_THEME = Object.freeze({
    dark: '#0a0f1a',
    light: '#f5e9cb'
});

/**
 * Применить тему как атрибут data-theme на <html>. Невалидное значение
 * игнорируется и заменяется DEFAULT_THEME, чтобы не оставить страницу без
 * палитры. Идемпотентно.
 */
export function applyThemeAttribute(theme) {
    const safe = THEME_IDS.includes(theme) ? theme : DEFAULT_THEME;
    if (typeof document !== 'undefined' && document.documentElement) {
        if (safe === DEFAULT_THEME) {
            // Дефолт — без атрибута, чтобы CSS :root применялся напрямую.
            document.documentElement.removeAttribute('data-theme');
        } else {
            document.documentElement.setAttribute('data-theme', safe);
        }
        // Пользовательский выбор темы может расходиться с системным
        // prefers-color-scheme, поэтому media-варианты meta недостаточно.
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta && THEME_COLOR_BY_THEME[safe]) {
            meta.setAttribute('content', THEME_COLOR_BY_THEME[safe]);
        }
    }
}
