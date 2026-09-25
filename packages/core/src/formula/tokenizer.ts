import type { FormulaError, Token } from "./types";

function syntaxError(message: string, start: number, end: number): FormulaError {
  return { kind: "formulaError", code: "syntax", message, start, end };
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

/** Tokenizes a formula source string. Never throws. */
export function tokenize(src: string): Token[] | FormulaError {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const ch = src[i] as string;

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    // Ref: {columnKey}
    if (ch === "{") {
      const start = i;
      const closeIdx = src.indexOf("}", i + 1);
      if (closeIdx === -1) {
        return syntaxError("Unterminated column reference", start, n);
      }
      const raw = src.slice(i + 1, closeIdx);
      const key = raw.trim();
      if (key.length === 0) {
        return syntaxError("Empty column reference", start, closeIdx + 1);
      }
      tokens.push({ kind: "ref", value: key, start, end: closeIdx + 1 });
      i = closeIdx + 1;
      continue;
    }

    // String literal
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      let j = i + 1;
      let value = "";
      let terminated = false;
      while (j < n) {
        const c = src[j] as string;
        if (c === "\\" && j + 1 < n) {
          value += src[j + 1];
          j += 2;
          continue;
        }
        if (c === quote) {
          terminated = true;
          j++;
          break;
        }
        value += c;
        j++;
      }
      if (!terminated) {
        return syntaxError("Unterminated string literal", start, n);
      }
      tokens.push({ kind: "string", value, start, end: j });
      i = j;
      continue;
    }

    // Number: digits, optional decimal point, or leading dot
    if (isDigit(ch) || (ch === "." && isDigit(src[i + 1] ?? ""))) {
      const start = i;
      let j = i;
      let sawDot = false;
      while (j < n) {
        const c = src[j] as string;
        if (isDigit(c)) {
          j++;
          continue;
        }
        if (c === "." && !sawDot) {
          sawDot = true;
          j++;
          continue;
        }
        break;
      }
      tokens.push({ kind: "number", value: src.slice(start, j), start, end: j });
      i = j;
      continue;
    }

    // Ident / boolean / function name
    if (isIdentStart(ch)) {
      const start = i;
      let j = i + 1;
      while (j < n && isIdentPart(src[j] as string)) {
        j++;
      }
      const raw = src.slice(start, j);
      const lower = raw.toLowerCase();
      if (lower === "true" || lower === "false") {
        tokens.push({ kind: "boolean", value: lower, start, end: j });
      } else {
        tokens.push({ kind: "ident", value: raw, start, end: j });
      }
      i = j;
      continue;
    }

    // Punctuation
    if (ch === "(") {
      tokens.push({ kind: "lparen", value: "(", start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen", value: ")", start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "comma", value: ",", start: i, end: i + 1 });
      i++;
      continue;
    }

    // Operators
    if (ch === "=" ) {
      const start = i;
      if (src[i + 1] === "=") {
        tokens.push({ kind: "op", value: "=", start, end: start + 2 });
        i += 2;
      } else {
        tokens.push({ kind: "op", value: "=", start, end: start + 1 });
        i += 1;
      }
      continue;
    }
    if (ch === "!") {
      const start = i;
      if (src[i + 1] === "=") {
        tokens.push({ kind: "op", value: "!=", start, end: start + 2 });
        i += 2;
      } else {
        tokens.push({ kind: "op", value: "!", start, end: start + 1 });
        i += 1;
      }
      continue;
    }
    if (ch === "<") {
      const start = i;
      if (src[i + 1] === ">") {
        tokens.push({ kind: "op", value: "!=", start, end: start + 2 });
        i += 2;
      } else if (src[i + 1] === "=") {
        tokens.push({ kind: "op", value: "<=", start, end: start + 2 });
        i += 2;
      } else {
        tokens.push({ kind: "op", value: "<", start, end: start + 1 });
        i += 1;
      }
      continue;
    }
    if (ch === ">") {
      const start = i;
      if (src[i + 1] === "=") {
        tokens.push({ kind: "op", value: ">=", start, end: start + 2 });
        i += 2;
      } else {
        tokens.push({ kind: "op", value: ">", start, end: start + 1 });
        i += 1;
      }
      continue;
    }
    if (ch === "&") {
      const start = i;
      if (src[i + 1] === "&") {
        tokens.push({ kind: "op", value: "&&", start, end: start + 2 });
        i += 2;
        continue;
      }
      return syntaxError("Unexpected character '&'", start, start + 1);
    }
    if (ch === "|") {
      const start = i;
      if (src[i + 1] === "|") {
        tokens.push({ kind: "op", value: "||", start, end: start + 2 });
        i += 2;
        continue;
      }
      return syntaxError("Unexpected character '|'", start, start + 1);
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "%") {
      tokens.push({ kind: "op", value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }

    return syntaxError(`Unexpected character '${ch}'`, i, i + 1);
  }

  tokens.push({ kind: "eof", value: "", start: n, end: n });
  return tokens;
}
