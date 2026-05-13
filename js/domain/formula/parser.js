/**
 * Безопасный парсер выражений для формул количества элементов конфигурации.
 *
 * Грамматика (рекурсивный спуск):
 *   expr      := orExpr
 *   orExpr    := andExpr ('||' andExpr)*
 *   andExpr   := cmpExpr ('&&' cmpExpr)*
 *   cmpExpr   := addExpr (('<'|'<='|'>'|'>='|'=='|'!=') addExpr)?
 *   addExpr   := mulExpr (('+'|'-') mulExpr)*
 *   mulExpr   := unary (('*'|'/'|'%') unary)*
 *   unary     := ('-'|'+'|'!')? primary
 *   primary   := number | string | bool | ident | call | '(' expr ')'
 *   call      := name '(' (expr (',' expr)*)? ')'
 *
 * Идентификаторы:
 *   - Q.<name>           — ответ на вопрос (одноуровневый плоский map)
 *   - S.<name>           — параметр настроек
 *   - S.<name>.<sub>...  — вложенный параметр (например, S.standSizeRatio.DEV);
 *                          AST хранит путь как массив сегментов
 *   - STAND              — текущий стенд (строка: 'DEV'/'IFT'/'PSI'/'PROD'/'LOAD')
 *   - true/false
 *
 * Безопасность: парсер не использует eval/new Function. Вычисление
 * происходит над AST — никаких side-эффектов невозможно.
 */

const TOKEN_TYPES = {
    NUMBER: 'NUMBER',
    STRING: 'STRING',
    IDENT: 'IDENT',
    OP: 'OP',
    LPAREN: 'LPAREN',
    RPAREN: 'RPAREN',
    COMMA: 'COMMA',
    DOT: 'DOT',
    EOF: 'EOF'
};

const OP_CHARS = new Set(['+', '-', '*', '/', '%', '<', '>', '=', '!', '&', '|']);

/* ---------- Лексер ---------- */

function tokenize(input) {
    const tokens = [];
    let i = 0;
    const n = input.length;

    while (i < n) {
        const ch = input[i];

        // Пробелы
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }

        // Числа: 123, 12.34, .5, 1e10, 2.5e-3
        if ((ch >= '0' && ch <= '9') || (ch === '.' && input[i + 1] >= '0' && input[i + 1] <= '9')) {
            let j = i;
            let hasDot = false;
            while (j < n && ((input[j] >= '0' && input[j] <= '9') || (input[j] === '.' && !hasDot))) {
                if (input[j] === '.') hasDot = true;
                j++;
            }
            // Опциональная экспонента: e[+-]?<digits>
            if (j < n && (input[j] === 'e' || input[j] === 'E')) {
                let k = j + 1;
                if (k < n && (input[k] === '+' || input[k] === '-')) k++;
                if (k < n && input[k] >= '0' && input[k] <= '9') {
                    while (k < n && input[k] >= '0' && input[k] <= '9') k++;
                    j = k;
                }
                // Если после `e` нет цифр — это не экспонента; e становится началом
                // отдельного идентификатора (что даст ошибку парсинга на следующем шаге).
            }
            const num = parseFloat(input.slice(i, j));
            // Infinity / NaN допустимы как промежуточный результат — обработка в evaluator.
            // Здесь проверяем только синтаксис.
            if (Number.isNaN(num)) throw new FormulaError(`Некорректное число: ${input.slice(i, j)}`, i);
            tokens.push({ type: TOKEN_TYPES.NUMBER, value: num, pos: i });
            i = j;
            continue;
        }

        // Строки в одинарных или двойных кавычках
        if (ch === '"' || ch === "'") {
            const quote = ch;
            let j = i + 1;
            let str = '';
            while (j < n && input[j] !== quote) {
                if (input[j] === '\\' && j + 1 < n) {
                    str += input[j + 1];
                    j += 2;
                } else {
                    str += input[j];
                    j++;
                }
            }
            if (j >= n) throw new FormulaError('Незакрытая строка', i);
            tokens.push({ type: TOKEN_TYPES.STRING, value: str, pos: i });
            i = j + 1;
            continue;
        }

        // Идентификаторы: [A-Za-z_][A-Za-z0-9_]*
        if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_') {
            let j = i;
            while (j < n && (
                (input[j] >= 'A' && input[j] <= 'Z') ||
                (input[j] >= 'a' && input[j] <= 'z') ||
                (input[j] >= '0' && input[j] <= '9') ||
                input[j] === '_'
            )) j++;
            tokens.push({ type: TOKEN_TYPES.IDENT, value: input.slice(i, j), pos: i });
            i = j;
            continue;
        }

        if (ch === '(') { tokens.push({ type: TOKEN_TYPES.LPAREN, pos: i }); i++; continue; }
        if (ch === ')') { tokens.push({ type: TOKEN_TYPES.RPAREN, pos: i }); i++; continue; }
        if (ch === ',') { tokens.push({ type: TOKEN_TYPES.COMMA,  pos: i }); i++; continue; }
        if (ch === '.') { tokens.push({ type: TOKEN_TYPES.DOT,    pos: i }); i++; continue; }

        // Операторы (могут быть двусимвольными)
        if (OP_CHARS.has(ch)) {
            const two = input.slice(i, i + 2);
            if (['<=', '>=', '==', '!=', '&&', '||'].includes(two)) {
                tokens.push({ type: TOKEN_TYPES.OP, value: two, pos: i });
                i += 2;
            } else if (['+', '-', '*', '/', '%', '<', '>', '!'].includes(ch)) {
                tokens.push({ type: TOKEN_TYPES.OP, value: ch, pos: i });
                i++;
            } else {
                throw new FormulaError(`Неизвестный оператор: ${ch}`, i);
            }
            continue;
        }

        throw new FormulaError(`Неизвестный символ: «${ch}»`, i);
    }

    tokens.push({ type: TOKEN_TYPES.EOF, pos: n });
    return tokens;
}

/* ---------- Парсер ---------- */

export class FormulaError extends Error {
    constructor(message, pos = -1) {
        super(message);
        this.name = 'FormulaError';
        this.pos = pos;
    }
}

class Parser {
    constructor(tokens, source) {
        this.tokens = tokens;
        this.source = source;
        this.pos = 0;
    }
    peek(offset = 0) { return this.tokens[this.pos + offset]; }
    advance() { return this.tokens[this.pos++]; }
    expect(type, value) {
        const t = this.peek();
        if (t.type !== type || (value !== undefined && t.value !== value)) {
            throw new FormulaError(`Ожидалось ${value ?? type}, получено ${t.value ?? t.type}`, t.pos);
        }
        return this.advance();
    }
    matchOp(...ops) {
        const t = this.peek();
        if (t.type === TOKEN_TYPES.OP && ops.includes(t.value)) { this.advance(); return t.value; }
        return null;
    }

    parseExpr() {
        const node = this.parseOr();
        if (this.peek().type !== TOKEN_TYPES.EOF) {
            throw new FormulaError(`Лишние символы после выражения`, this.peek().pos);
        }
        return node;
    }

    parseOr() {
        let left = this.parseAnd();
        while (true) {
            const op = this.matchOp('||');
            if (!op) break;
            const right = this.parseAnd();
            left = { type: 'BinOp', op, left, right };
        }
        return left;
    }
    parseAnd() {
        let left = this.parseCmp();
        while (true) {
            const op = this.matchOp('&&');
            if (!op) break;
            const right = this.parseCmp();
            left = { type: 'BinOp', op, left, right };
        }
        return left;
    }
    parseCmp() {
        const left = this.parseAdd();
        const op = this.matchOp('<', '<=', '>', '>=', '==', '!=');
        if (!op) return left;
        const right = this.parseAdd();
        return { type: 'BinOp', op, left, right };
    }
    parseAdd() {
        let left = this.parseMul();
        while (true) {
            const op = this.matchOp('+', '-');
            if (!op) break;
            const right = this.parseMul();
            left = { type: 'BinOp', op, left, right };
        }
        return left;
    }
    parseMul() {
        let left = this.parseUnary();
        while (true) {
            const op = this.matchOp('*', '/', '%');
            if (!op) break;
            const right = this.parseUnary();
            left = { type: 'BinOp', op, left, right };
        }
        return left;
    }
    parseUnary() {
        const op = this.matchOp('+', '-', '!');
        if (op) {
            const arg = this.parseUnary();
            return { type: 'UnaryOp', op, arg };
        }
        return this.parsePrimary();
    }
    parsePrimary() {
        const t = this.peek();
        if (t.type === TOKEN_TYPES.NUMBER) { this.advance(); return { type: 'Number', value: t.value }; }
        if (t.type === TOKEN_TYPES.STRING) { this.advance(); return { type: 'String', value: t.value }; }
        if (t.type === TOKEN_TYPES.LPAREN) {
            this.advance();
            const expr = this.parseOr();
            this.expect(TOKEN_TYPES.RPAREN);
            return expr;
        }
        if (t.type === TOKEN_TYPES.IDENT) {
            this.advance();
            // bool-литералы
            if (t.value === 'true')  return { type: 'Bool', value: true };
            if (t.value === 'false') return { type: 'Bool', value: false };
            // STAND — спец. идентификатор без префикса
            if (t.value === 'STAND') return { type: 'Stand' };
            // Q.<name> или S.<name>[.<sub>...]
            //   Q — одноуровневый: Q.<id>. Дальнейший DOT — синтаксическая ошибка
            //   S — многоуровневый: S.foo, S.foo.bar и т.д. (например, S.standSizeRatio.DEV)
            if ((t.value === 'Q' || t.value === 'S') && this.peek().type === TOKEN_TYPES.DOT) {
                const path = [];
                this.advance(); // съели первую DOT
                path.push(this.expect(TOKEN_TYPES.IDENT).value);
                if (t.value === 'S') {
                    while (this.peek().type === TOKEN_TYPES.DOT) {
                        this.advance();
                        path.push(this.expect(TOKEN_TYPES.IDENT).value);
                    }
                } else if (this.peek().type === TOKEN_TYPES.DOT) {
                    throw new FormulaError(
                        `Q.${path[0]} — одноуровневый идентификатор; вложенные ` +
                        `сегменты допустимы только для S.*`,
                        this.peek().pos
                    );
                }
                return { type: 'Var', scope: t.value, path };
            }
            // call: name(args)
            if (this.peek().type === TOKEN_TYPES.LPAREN) {
                this.advance();
                const args = [];
                if (this.peek().type !== TOKEN_TYPES.RPAREN) {
                    args.push(this.parseOr());
                    while (this.peek().type === TOKEN_TYPES.COMMA) { this.advance(); args.push(this.parseOr()); }
                }
                this.expect(TOKEN_TYPES.RPAREN);
                return { type: 'Call', name: t.value, args };
            }
            throw new FormulaError(`Неизвестный идентификатор «${t.value}»`, t.pos);
        }
        throw new FormulaError(`Неожиданный токен «${t.value ?? t.type}»`, t.pos);
    }
}

/**
 * Скомпилировать строковую формулу в AST.
 * Возвращает AST-узел или бросает FormulaError.
 */
export function parseFormula(source) {
    if (typeof source !== 'string') throw new FormulaError('Формула должна быть строкой');
    const trimmed = source.trim();
    if (trimmed === '') return null; // пустая формула — отсутствие ЭК для стенда (qty=0)
    const tokens = tokenize(trimmed);
    const parser = new Parser(tokens, trimmed);
    return parser.parseExpr();
}
