/**
 * Вычислитель AST формул. Принимает скомпилированный AST (см. parser.js)
 * и контекст { Q, S, STAND } и возвращает числовой/булевский результат.
 *
 * Поддерживаемые встроенные функции (whitelist):
 *   min(a,b,...), max(a,b,...)
 *   round(x), ceil(x), floor(x), abs(x)
 *   if(cond, a, b) — ленивое тернарное
 *   clamp(x, lo, hi)
 *
 * Любая другая функция вызывает FormulaError.
 */

import { FormulaError } from './parser.js';
import { FORMULA_MAX_DEPTH } from '../../utils/constants.js';

const BUILTINS = Object.freeze({
    min:   (...a) => Math.min(...a.map(toNum)),
    max:   (...a) => Math.max(...a.map(toNum)),
    round: x => Math.round(toNum(x)),
    ceil:  x => Math.ceil(toNum(x)),
    floor: x => Math.floor(toNum(x)),
    abs:   x => Math.abs(toNum(x)),
    clamp: (x, lo, hi) => Math.min(Math.max(toNum(x), toNum(lo)), toNum(hi)),
    // if — обрабатывается особым образом в evaluate (для ленивости).
});

function toNum(v) {
    if (v === true) return 1;
    if (v === false) return 0;
    if (typeof v === 'number') return v;
    if (Array.isArray(v)) return v.length;            // multiselect → длина
    if (typeof v === 'string') {
        const n = parseFloat(v.replace(',', '.'));
        return Number.isFinite(n) ? n : 0;
    }
    if (v === null || v === undefined) return 0;
    return 0;
}

function toBool(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number')  return v !== 0;
    if (Array.isArray(v))       return v.length > 0;
    if (typeof v === 'string')  return v !== '' && v !== 'false' && v !== '0';
    return Boolean(v);
}

/**
 * Получить значение ответа на вопрос с приведением к числу/массиву.
 * Если ответа нет — fallback к defaultValue вопроса (если передан).
 */
function resolveQuestion(name, context) {
    const answers = context.Q || {};
    if (Object.prototype.hasOwnProperty.call(answers, name)) return answers[name];
    const def = context.questionDefaults || {};
    if (Object.prototype.hasOwnProperty.call(def, name)) return def[name];
    return 0;
}

/**
 * Резолвит S-путь, начиная от context.S, проходя по сегментам.
 * - Одноуровневый S.foo: path=['foo'].
 * - Многоуровневый S.foo.bar: path=['foo','bar'] (например, S.standSizeRatio.DEV).
 *
 * Если на любом сегменте узел отсутствует или не объект — возвращает 0.
 * Если конечное значение — не примитив (объект/массив), тоже 0: формула должна
 * брать терминальное скалярное значение, а не контейнер.
 */
function resolveSettingPath(path, context) {
    let v = context.S || {};
    for (const seg of path) {
        if (v === null || v === undefined || typeof v !== 'object') return 0;
        if (!Object.prototype.hasOwnProperty.call(v, seg)) return 0;
        v = v[seg];
    }
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
    return 0;
}

/**
 * Рекурсивно вычислить узел AST.
 * Возвращает number | boolean | string (строки только из спец. случаев — STAND).
 *
 * Параметр `depth` — текущий уровень вложенности (для guard'а от глубоких
 * формул). При превышении FORMULA_MAX_DEPTH бросается FormulaError, что
 * предотвращает RangeError браузера и потенциальное зависание UI.
 */
export function evaluate(node, context, depth = 0) {
    if (depth > FORMULA_MAX_DEPTH) {
        throw new FormulaError(`Глубина выражения превышает лимит (${FORMULA_MAX_DEPTH})`);
    }
    if (node === null) return 0;
    const next = depth + 1;
    switch (node.type) {
        case 'Number': return node.value;
        case 'String': return node.value;
        case 'Bool':   return node.value;
        case 'Stand':  return context.STAND ?? '';
        case 'Var': {
            // path всегда массив сегментов; для Q — длина 1, для S — 1+.
            const path = node.path || (node.name !== undefined ? [node.name] : []);
            if (node.scope === 'Q') return resolveQuestion(path[0], context);
            if (node.scope === 'S') return resolveSettingPath(path, context);
            throw new FormulaError(`Неизвестный scope «${node.scope}»`);
        }
        case 'UnaryOp': {
            const v = evaluate(node.arg, context, next);
            switch (node.op) {
                case '+': return  toNum(v);
                case '-': return -toNum(v);
                case '!': return !toBool(v);
                default:  throw new FormulaError(`Неизвестный унарный оператор «${node.op}»`);
            }
        }
        case 'BinOp': {
            const op = node.op;
            // Логические операторы — ленивые (короткое замыкание).
            if (op === '&&') return toBool(evaluate(node.left, context, next)) && toBool(evaluate(node.right, context, next));
            if (op === '||') return toBool(evaluate(node.left, context, next)) || toBool(evaluate(node.right, context, next));

            const left  = evaluate(node.left, context, next);
            const right = evaluate(node.right, context, next);

            switch (op) {
                case '+': {
                    // Только числовое сложение (строковая конкатенация запрещена для строгости).
                    return toNum(left) + toNum(right);
                }
                case '-': return toNum(left) - toNum(right);
                case '*': return toNum(left) * toNum(right);
                case '/': {
                    const r = toNum(right);
                    return r === 0 ? 0 : toNum(left) / r;
                }
                case '%': {
                    const r = toNum(right);
                    return r === 0 ? 0 : toNum(left) % r;
                }
                case '<':  return toNum(left) <  toNum(right);
                case '<=': return toNum(left) <= toNum(right);
                case '>':  return toNum(left) >  toNum(right);
                case '>=': return toNum(left) >= toNum(right);
                case '==': return looseEquals(left, right);
                case '!=': return !looseEquals(left, right);
                default:   throw new FormulaError(`Неизвестный оператор «${op}»`);
            }
        }
        case 'Call': {
            // if(cond, a, b) — ленивое тернарное.
            if (node.name === 'if') {
                if (node.args.length !== 3) throw new FormulaError(`if() ожидает 3 аргумента`);
                return toBool(evaluate(node.args[0], context, next))
                    ? evaluate(node.args[1], context, next)
                    : evaluate(node.args[2], context, next);
            }
            const fn = BUILTINS[node.name];
            if (!fn) throw new FormulaError(`Неизвестная функция «${node.name}»`);
            const args = node.args.map(a => evaluate(a, context, next));
            return fn(...args);
        }
        default: throw new FormulaError(`Неизвестный тип узла «${node.type}»`);
    }
}

/**
 * Сравнение значений. Строки сравниваются как строки, остальное — численно.
 */
function looseEquals(a, b) {
    if (typeof a === 'string' && typeof b === 'string') return a === b;
    if (typeof a === 'string' || typeof b === 'string') return String(a) === String(b);
    return toNum(a) === toNum(b);
}

/**
 * Список идентификаторов (переменных и функций), упомянутых в AST.
 * Используется для подсветки/расшифровки в модалке формулы.
 */
export function collectReferences(node) {
    const refs = { questions: new Set(), settings: new Set(), functions: new Set(), usesStand: false };
    function visit(n) {
        if (!n || typeof n !== 'object') return;
        if (n.type === 'Var') {
            const path = n.path || (n.name !== undefined ? [n.name] : []);
            if (n.scope === 'Q') refs.questions.add(path[0]);
            if (n.scope === 'S') refs.settings.add(path.join('.'));
        } else if (n.type === 'Stand') {
            refs.usesStand = true;
        } else if (n.type === 'Call') {
            refs.functions.add(n.name);
            n.args.forEach(visit);
        } else if (n.type === 'BinOp') {
            visit(n.left); visit(n.right);
        } else if (n.type === 'UnaryOp') {
            visit(n.arg);
        }
    }
    visit(node);
    return {
        questions: Array.from(refs.questions),
        settings:  Array.from(refs.settings),
        functions: Array.from(refs.functions),
        usesStand: refs.usesStand
    };
}
