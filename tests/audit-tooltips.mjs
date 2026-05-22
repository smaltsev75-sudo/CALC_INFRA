/**
 * Аудит UI: ищет интерактивные элементы (button, input, select, textarea)
 * без атрибута title. Запускать вручную: `node tests/audit-tooltips.mjs`.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function walk(d, out = []) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
        const f = join(d, e.name);
        if (e.isDirectory()) walk(f, out);
        else if (f.endsWith('.js')) out.push(f);
    }
    return out;
}

/**
 * Найти все вызовы el('tag', { ... }, ...) с балансом скобок.
 * Возвращает массив { tag, propsBlock, lineNumber }.
 */
function findElCalls(src) {
    const calls = [];
    const tags = ['button', 'input', 'select', 'textarea'];
    for (const tag of tags) {
        const opener = `el('${tag}',`;
        let idx = 0;
        while ((idx = src.indexOf(opener, idx)) !== -1) {
            // Найти открывающую { после opener
            let i = idx + opener.length;
            while (i < src.length && src[i] !== '{' && src[i] !== ')') i++;
            if (src[i] !== '{') { idx = i; continue; }
            // Сбалансировать {}
            let depth = 1, j = i + 1;
            while (j < src.length && depth > 0) {
                if (src[j] === '{') depth++;
                else if (src[j] === '}') depth--;
                j++;
            }
            const propsBlock = src.slice(i, j); // включая внешние { и }
            const lineNumber = src.slice(0, idx).split('\n').length;
            calls.push({ tag, propsBlock, lineNumber, file: '' });
            idx = j;
        }
    }
    return calls;
}

const files = walk('js/ui');
const missing = [];

for (const file of files) {
    const src = readFileSync(file, 'utf-8');
    const calls = findElCalls(src);
    for (const c of calls) {
        c.file = file;
        if (/title\s*:/.test(c.propsBlock)) continue;
        if (/type\s*:\s*'checkbox'/.test(c.propsBlock)) continue;
        if (/type\s*:\s*'hidden'/.test(c.propsBlock)) continue;
        if (/type\s*:\s*'file'/.test(c.propsBlock)) continue;
        // input в составе .switch label — у label есть текст, контекст ясен; пропускаем
        // Skip option (внутри select)
        missing.push(c);
    }
}

console.log(`Найдено без title: ${missing.length}`);
for (const m of missing.slice(0, 50)) {
    const snippet = m.propsBlock.replace(/\s+/g, ' ').slice(0, 100);
    console.log(`  ${m.file}:${m.lineNumber} <${m.tag}> — ${snippet}`);
}
