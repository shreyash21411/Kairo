// ── Kairo syntax highlighter ─────────────────────────────────────────────────
// A minimal, dependency-free lexer for the languages shown in the quickstart.

export type TokKind =
  | "keyword"
  | "string"
  | "comment"
  | "number"
  | "fn"
  | "type"
  | "flag"
  | "plain"

export interface Tok {
  kind: TokKind
  text: string
}

export type Lang = "python" | "js" | "curl"

// ── Keyword sets ──────────────────────────────────────────────────────────────

const PY_KW = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break",
  "class", "continue", "def", "del", "elif", "else", "except", "finally",
  "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal",
  "not", "or", "pass", "raise", "return", "self", "try", "while", "with",
  "yield",
])

const JS_KW = new Set([
  "async", "await", "break", "case", "catch", "class", "const", "continue",
  "default", "delete", "do", "else", "export", "extends", "false", "finally",
  "for", "from", "function", "if", "import", "in", "instanceof", "interface",
  "let", "new", "null", "of", "return", "static", "super", "switch", "this",
  "throw", "true", "try", "type", "typeof", "undefined", "var", "void",
  "while", "with", "yield",
])

// ── Helpers ───────────────────────────────────────────────────────────────────

function append(toks: Tok[], kind: TokKind, text: string) {
  if (kind === "plain" && toks.length > 0 && toks[toks.length - 1].kind === "plain") {
    toks[toks.length - 1].text += text
  } else {
    toks.push({ kind, text })
  }
}

function scanString(s: string, quote: string): number {
  let i = 1
  while (i < s.length) {
    if (s[i] === "\\") { i += 2; continue }
    if (s[i] === quote) { return i + 1 }
    i++
  }
  return s.length
}

// ── Python lexer ──────────────────────────────────────────────────────────────

function lexPython(line: string): Tok[] {
  const toks: Tok[] = []
  let i = 0

  while (i < line.length) {
    const s = line.slice(i)
    const ch = s[0]

    // Comment
    if (ch === "#") { append(toks, "comment", s); break }

    // Triple-quoted string (simplified: only single-line occurrences)
    if ((s.startsWith('"""') || s.startsWith("'''"))) {
      const q3 = s.slice(0, 3)
      const end = s.indexOf(q3, 3)
      const len = end === -1 ? s.length : end + 3
      append(toks, "string", s.slice(0, len))
      i += len
      continue
    }

    // f-string prefix + normal string
    const fPrefix = ch === "f" && (s[1] === '"' || s[1] === "'") ? 1 : 0
    if (fPrefix || ch === '"' || ch === "'") {
      const quoteStart = i + fPrefix
      const quote = line[quoteStart]
      const inner = line.slice(quoteStart)
      const len = scanString(inner, quote)
      append(toks, "string", line.slice(i, quoteStart + len))
      i = quoteStart + len
      continue
    }

    // Number
    const numM = /^\d+(?:\.\d+)?/.exec(s)
    if (numM) { append(toks, "number", numM[0]); i += numM[0].length; continue }

    // Identifier → keyword / type / fn / plain
    const idM = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(s)
    if (idM) {
      const w = idM[0]
      const after = s.slice(w.length)
      const kind: TokKind = PY_KW.has(w)
        ? "keyword"
        : /^[A-Z]/.test(w)
          ? "type"
          : /^\s*\(/.test(after)
            ? "fn"
            : "plain"
      append(toks, kind, w)
      i += w.length
      continue
    }

    append(toks, "plain", ch)
    i++
  }

  return toks
}

// ── JS/TS lexer ───────────────────────────────────────────────────────────────

function lexJs(line: string): Tok[] {
  const toks: Tok[] = []
  let i = 0

  while (i < line.length) {
    const s = line.slice(i)
    const ch = s[0]

    // Line comment
    if (s.startsWith("//")) { append(toks, "comment", s); break }

    // Template literal
    if (ch === "`") {
      const end = s.indexOf("`", 1)
      const len = end === -1 ? s.length : end + 1
      append(toks, "string", s.slice(0, len))
      i += len
      continue
    }

    // Regular string
    if (ch === '"' || ch === "'") {
      const len = scanString(s, ch)
      append(toks, "string", s.slice(0, len))
      i += len
      continue
    }

    // Number
    const numM = /^\d+(?:\.\d+)?/.exec(s)
    if (numM) { append(toks, "number", numM[0]); i += numM[0].length; continue }

    // Identifier → keyword / type / fn / plain
    const idM = /^[a-zA-Z_$][a-zA-Z0-9_$]*/.exec(s)
    if (idM) {
      const w = idM[0]
      const after = s.slice(w.length)
      const kind: TokKind = JS_KW.has(w)
        ? "keyword"
        : /^[A-Z]/.test(w)
          ? "type"
          : /^\s*\(/.test(after)
            ? "fn"
            : "plain"
      append(toks, kind, w)
      i += w.length
      continue
    }

    append(toks, "plain", ch)
    i++
  }

  return toks
}

// ── cURL/bash lexer ───────────────────────────────────────────────────────────

function lexCurl(line: string): Tok[] {
  const toks: Tok[] = []
  let i = 0

  while (i < line.length) {
    const s = line.slice(i)
    const ch = s[0]

    // Comment
    if (ch === "#") { append(toks, "comment", s); break }

    // Quoted string
    if (ch === '"' || ch === "'") {
      const len = scanString(s, ch)
      append(toks, "string", s.slice(0, len))
      i += len
      continue
    }

    // URL
    const urlM = /^https?:\/\/\S+/.exec(s)
    if (urlM) { append(toks, "string", urlM[0]); i += urlM[0].length; continue }

    // Flag (--header, -H, -X, -d, etc.)
    const flagM = /^--?[a-zA-Z][-a-zA-Z]*/.exec(s)
    if (flagM) { append(toks, "flag", flagM[0]); i += flagM[0].length; continue }

    // Identifier
    const idM = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(s)
    if (idM) {
      const w = idM[0]
      append(toks, w === "curl" ? "keyword" : "plain", w)
      i += w.length
      continue
    }

    append(toks, "plain", ch)
    i++
  }

  return toks
}

// ── Public API ────────────────────────────────────────────────────────────────

export function tokenizeCode(code: string, lang: Lang): Tok[][] {
  const lex = lang === "python" ? lexPython : lang === "js" ? lexJs : lexCurl
  return code.split("\n").map(lex)
}
