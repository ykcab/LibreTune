/**
 * Client-side INI expression parser/evaluator.
 * Mirrors libretune_core::ini::expression for visibility/enabled conditions
 * without per-field Tauri IPC round-trips.
 */

type Value = { kind: 'num'; n: number } | { kind: 'bool'; b: boolean } | { kind: 'str'; s: string };

type BinOp =
  | 'add' | 'sub' | 'mul' | 'div' | 'mod'
  | 'eq' | 'ne' | 'lt' | 'gt' | 'le' | 'ge'
  | 'and' | 'or' | 'bitAnd' | 'bitOr' | 'bitXor' | 'shl' | 'shr';

type UnaryOp = 'neg' | 'not' | 'bitNot';

type Expr =
  | { type: 'lit'; value: Value }
  | { type: 'var'; name: string }
  | { type: 'bin'; op: BinOp; left: Expr; right: Expr }
  | { type: 'tern'; cond: Expr; then: Expr; else: Expr }
  | { type: 'unary'; op: UnaryOp; inner: Expr }
  | { type: 'call'; name: string; args: Expr[] };

type Token =
  | { t: 'num'; n: number }
  | { t: 'ident'; s: string }
  | { t: 'str'; s: string }
  | { t: 'op'; s: string };

function asNum(v: Value): number {
  if (v.kind === 'num') return v.n;
  if (v.kind === 'bool') return v.b ? 1 : 0;
  return 0;
}

function asBool(v: Value): boolean {
  if (v.kind === 'bool') return v.b;
  if (v.kind === 'num') return v.n !== 0;
  return v.s.length > 0;
}

function lex(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') { i++; continue; }
    if ('()?,+-*/%~^!<>='.includes(ch)) {
      const two = input.slice(i, i + 2);
      if (['==', '!=', '<=', '>=', '&&', '||', '<<', '>>'].includes(two)) {
        tokens.push({ t: 'op', s: two }); i += 2; continue;
      }
      tokens.push({ t: 'op', s: ch }); i++; continue;
    }
    if (ch === '"') {
      let s = '';
      i++;
      while (i < input.length && input[i] !== '"') { s += input[i]; i++; }
      i++;
      tokens.push({ t: 'str', s });
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      let s = ch;
      i++;
      while (i < input.length && /[0-9.]/.test(input[i])) { s += input[i]; i++; }
      tokens.push({ t: 'num', n: parseFloat(s) });
      continue;
    }
    if (/[a-zA-Z_$]/.test(ch)) {
      let s = ch;
      i++;
      while (i < input.length && /[a-zA-Z0-9_$]/.test(input[i])) { s += input[i]; i++; }
      tokens.push({ t: 'ident', s });
      continue;
    }
    i++;
  }
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  parse(): Expr {
    return this.cond();
  }

  private peek(): Token | undefined { return this.tokens[this.pos]; }
  private advance(): Token | undefined { return this.tokens[this.pos++]; }

  private matchOp(...ops: string[]): string | null {
    const t = this.peek();
    if (t?.t === 'op' && ops.includes(t.s)) { this.pos++; return t.s; }
    return null;
  }

  private cond(): Expr {
    const node = this.lor();
    if (this.matchOp('?')) {
      const then = this.parse();
      if (!this.matchOp(':')) throw new Error("Expected ':'");
      return { type: 'tern', cond: node, then, else: this.parse() };
    }
    return node;
  }

  private lor(): Expr {
    let node = this.land();
    while (this.matchOp('||')) node = { type: 'bin', op: 'or', left: node, right: this.land() };
    return node;
  }

  private land(): Expr {
    let node = this.bor();
    while (this.matchOp('&&')) node = { type: 'bin', op: 'and', left: node, right: this.bor() };
    return node;
  }

  private bor(): Expr {
    let node = this.bxor();
    while (this.matchOp('|')) node = { type: 'bin', op: 'bitOr', left: node, right: this.bxor() };
    return node;
  }

  private bxor(): Expr {
    let node = this.band();
    while (this.matchOp('^')) node = { type: 'bin', op: 'bitXor', left: node, right: this.band() };
    return node;
  }

  private band(): Expr {
    let node = this.eq();
    while (this.matchOp('&')) node = { type: 'bin', op: 'bitAnd', left: node, right: this.eq() };
    return node;
  }

  private eq(): Expr {
    let node = this.cmp();
    let op = this.matchOp('==', '!=');
    while (op) {
      node = { type: 'bin', op: op === '==' ? 'eq' : 'ne', left: node, right: this.cmp() };
      op = this.matchOp('==', '!=');
    }
    return node;
  }

  private cmp(): Expr {
    let node = this.shift();
    let op = this.matchOp('<', '>', '<=', '>=');
    while (op) {
      const map: Record<string, BinOp> = { '<': 'lt', '>': 'gt', '<=': 'le', '>=': 'ge' };
      node = { type: 'bin', op: map[op], left: node, right: this.shift() };
      op = this.matchOp('<', '>', '<=', '>=');
    }
    return node;
  }

  private shift(): Expr {
    let node = this.add();
    let op = this.matchOp('<<', '>>');
    while (op) {
      node = { type: 'bin', op: op === '<<' ? 'shl' : 'shr', left: node, right: this.add() };
      op = this.matchOp('<<', '>>');
    }
    return node;
  }

  private add(): Expr {
    let node = this.mul();
    let op = this.matchOp('+', '-');
    while (op) {
      node = { type: 'bin', op: op === '+' ? 'add' : 'sub', left: node, right: this.mul() };
      op = this.matchOp('+', '-');
    }
    return node;
  }

  private mul(): Expr {
    let node = this.unary();
    let op = this.matchOp('*', '/', '%');
    while (op) {
      const map: Record<string, BinOp> = { '*': 'mul', '/': 'div', '%': 'mod' };
      node = { type: 'bin', op: map[op], left: node, right: this.unary() };
      op = this.matchOp('*', '/', '%');
    }
    return node;
  }

  private unary(): Expr {
    if (this.matchOp('-')) return { type: 'unary', op: 'neg', inner: this.unary() };
    if (this.matchOp('!')) return { type: 'unary', op: 'not', inner: this.unary() };
    if (this.matchOp('~')) return { type: 'unary', op: 'bitNot', inner: this.unary() };
    return this.primary();
  }

  private primary(): Expr {
    const t = this.advance();
    if (!t) throw new Error('Unexpected end');
    if (t.t === 'num') return { type: 'lit', value: { kind: 'num', n: t.n } };
    if (t.t === 'str') return { type: 'lit', value: { kind: 'str', s: t.s } };
    if (t.t === 'ident') {
      if (t.s === 'true') return { type: 'lit', value: { kind: 'bool', b: true } };
      if (t.s === 'false') return { type: 'lit', value: { kind: 'bool', b: false } };
      if (this.matchOp('(')) {
        const args: Expr[] = [];
        if (!this.matchOp(')')) {
          args.push(this.parse());
          while (this.matchOp(',')) {
            args.push(this.parse());
          }
          if (!this.matchOp(')')) throw new Error("Expected ')'");
        }
        return { type: 'call', name: t.s, args };
      }
      return { type: 'var', name: t.s };
    }
    if (t.t === 'op' && t.s === '(') {
      const expr = this.parse();
      if (!this.matchOp(')')) throw new Error("Expected ')'");
      return expr;
    }
    throw new Error('Unexpected token');
  }
}

function evaluate(expr: Expr, ctx: Record<string, number>): Value {
  switch (expr.type) {
    case 'lit': return expr.value;
    case 'var': return { kind: 'num', n: ctx[expr.name] ?? 0 };
    case 'unary': {
      const v = evaluate(expr.inner, ctx);
      if (expr.op === 'neg') return { kind: 'num', n: -asNum(v) };
      if (expr.op === 'not') return { kind: 'bool', b: !asBool(v) };
      return { kind: 'num', n: (~(asNum(v) | 0)) & 0xffffffff };
    }
    case 'tern': return asBool(evaluate(expr.cond, ctx)) ? evaluate(expr.then, ctx) : evaluate(expr.else, ctx);
    case 'bin': {
      const l = evaluate(expr.left, ctx);
      const r = evaluate(expr.right, ctx);
      const ln = asNum(l);
      const rn = asNum(r);
      switch (expr.op) {
        case 'add': return { kind: 'num', n: ln + rn };
        case 'sub': return { kind: 'num', n: ln - rn };
        case 'mul': return { kind: 'num', n: ln * rn };
        case 'div': return { kind: 'num', n: rn === 0 ? 0 : ln / rn };
        case 'mod': return { kind: 'num', n: rn === 0 ? 0 : ln % rn };
        case 'eq': return { kind: 'bool', b: ln === rn };
        case 'ne': return { kind: 'bool', b: ln !== rn };
        case 'lt': return { kind: 'bool', b: ln < rn };
        case 'gt': return { kind: 'bool', b: ln > rn };
        case 'le': return { kind: 'bool', b: ln <= rn };
        case 'ge': return { kind: 'bool', b: ln >= rn };
        case 'and': return { kind: 'bool', b: asBool(l) && asBool(r) };
        case 'or': return { kind: 'bool', b: asBool(l) || asBool(r) };
        case 'bitAnd': return { kind: 'num', n: (ln | 0) & (rn | 0) };
        case 'bitOr': return { kind: 'num', n: (ln | 0) | (rn | 0) };
        case 'bitXor': return { kind: 'num', n: (ln | 0) ^ (rn | 0) };
        case 'shl': return { kind: 'num', n: (ln | 0) << (rn | 0) };
        case 'shr': return { kind: 'num', n: (ln | 0) >> (rn | 0) };
      }
    }
    case 'call': return evalFn(expr.name, expr.args, ctx);
  }
}

function evalFn(name: string, args: Expr[], ctx: Record<string, number>): Value {
  const n = name.toLowerCase();
  const ev = (e: Expr) => evaluate(e, ctx);
  const nums = () => args.map((a) => asNum(ev(a)));

  if (n === 'bits') {
    if (args.length !== 2) return { kind: 'num', n: 0 };
    const val = asNum(ev(args[0]));
    const mask = asNum(ev(args[1]));
    return { kind: 'num', n: (val & mask) !== 0 ? 1 : 0 };
  }
  if (n === 'abs') return { kind: 'num', n: Math.abs(asNum(ev(args[0]))) };
  if (n === 'min') return { kind: 'num', n: Math.min(...nums()) };
  if (n === 'max') return { kind: 'num', n: Math.max(...nums()) };
  if (n === 'round') return { kind: 'num', n: Math.round(asNum(ev(args[0]))) };
  if (n === 'floor') return { kind: 'num', n: Math.floor(asNum(ev(args[0]))) };
  if (n === 'ceil') return { kind: 'num', n: Math.ceil(asNum(ev(args[0]))) };
  if (n === 'sqrt') return { kind: 'num', n: Math.sqrt(asNum(ev(args[0]))) };
  if (n === 'pow') return { kind: 'num', n: Math.pow(asNum(ev(args[0])), asNum(ev(args[1]))) };
  if (n === 'if') return asBool(ev(args[0])) ? ev(args[1]) : ev(args[2]);
  if (n === 'not' || n === 'boolean' || n === 'bool') return { kind: 'bool', b: asBool(ev(args[0])) };
  if (n === 'isnan') return { kind: 'bool', b: Number.isNaN(asNum(ev(args[0]))) };
  if (n === 'isadvancedmathavailable') return { kind: 'bool', b: true };
  if (n === 'pastvalue') return ev(args[0]);
  if (n === 'getauxdigital') return { kind: 'num', n: 0 };
  return { kind: 'num', n: 0 };
}

const parseCache = new Map<string, Expr>();

/** Strip INI braces and normalize bare identifiers. */
export function normalizeIniExpression(raw: string): string {
  let expr = raw.trim();
  if (expr.startsWith('{') && expr.endsWith('}')) expr = expr.slice(1, -1).trim();
  if (expr && !/[(){}\s]/.test(expr) && /^[a-zA-Z_]\w*$/.test(expr)) {
    return expr;
  }
  return expr;
}

export function parseIniExpression(input: string): Expr {
  const normalized = normalizeIniExpression(input);
  let cached = parseCache.get(normalized);
  if (!cached) {
    cached = new Parser(lex(normalized)).parse();
    parseCache.set(normalized, cached);
  }
  return cached;
}

export function evaluateIniBoolean(expression: string | undefined, context: Record<string, number>): boolean {
  if (!expression?.trim()) return true;
  try {
    return asBool(evaluate(parseIniExpression(expression), context));
  } catch {
    return true;
  }
}

/** Build a cache key from only variables referenced in an expression. */
export function expressionContextKey(expression: string | undefined, context: Record<string, number>): string {
  if (!expression?.trim()) return '';
  const normalized = normalizeIniExpression(expression);
  const vars = normalized.match(/\b[a-zA-Z_]\w*\b/g);
  if (!vars) return '';
  const seen = new Set<string>();
  return vars
    .filter((v) => {
      if (v === 'true' || v === 'false') return false;
      if (seen.has(v)) return false;
      seen.add(v);
      return true;
    })
    .map((v) => `${v}:${context[v] ?? 0}`)
    .join('|');
}
