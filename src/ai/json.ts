/**
 * Robust JSON extraction from LLM output: finds the first balanced JSON object in text that may
 * contain ```json fences, leading/trailing prose, comments, trailing commas, raw newlines inside
 * strings, Python literals, or a truncated tail.
 */

export type JsonObject = Record<string, unknown>;

export function isJsonObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Index of the brace/bracket that closes the one at `start`, or -1 when unbalanced. */
function findBalancedEnd(s: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** Whether a quote whose next character is at `from` ends the string (next non-space is , : } ] // /* or EOF). */
function closesString(s: string, from: number): boolean {
  let j = from;
  while (j < s.length && /\s/.test(s[j])) j++;
  if (j >= s.length) return true;
  const c = s[j];
  if (c === ',' || c === ':' || c === '}' || c === ']') return true;
  return c === '/' && (s[j + 1] === '/' || s[j + 1] === '*');
}

/**
 * Lenient cleanup in one pass: drops // and /* *\/ comments and trailing commas, maps
 * True/False/None, and escapes raw control characters and stray double quotes inside strings.
 */
function repairJson(s: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (ch === '\\') {
        out += ch + (s[i + 1] ?? '');
        i++;
      } else if (ch === '"') {
        // A quote that isn't followed by JSON structure is an unescaped quote inside the text
        // (他说"好的"然后…); a real closing quote is followed by , : } ] a comment or the end.
        if (closesString(s, i + 1)) {
          inString = false;
          out += ch;
        } else out += '\\"';
      } else if (ch === '\n') out += '\\n';
      else if (ch === '\r') continue;
      else if (ch === '\t') out += '\\t';
      else out += ch;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
    } else if (ch === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      i = end < 0 ? s.length : end + 1;
    } else if (ch === ',') {
      const rest = /^,\s*([}\]])/.exec(s.slice(i));
      if (!rest) out += ch;
    } else if (/[A-Za-z]/.test(ch)) {
      const word = /^[A-Za-z]+/.exec(s.slice(i))![0];
      out += word === 'True' ? 'true' : word === 'False' ? 'false' : word === 'None' ? 'null' : word;
      i += word.length - 1;
    } else out += ch;
  }
  return out;
}

/** Close a truncated object: finish the open string, drop a dangling key/comma, append closers. */
function closeTruncated(s: string): string {
  const stack: string[] = [];
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let body = s;
  if (inString) body += '"';
  body = body.replace(/,\s*$/, '').replace(/,\s*"[^"]*"\s*:?\s*$/, '').replace(/:\s*$/, ': null');
  return body + stack.reverse().join('');
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    try {
      return JSON.parse(repairJson(s));
    } catch {
      return undefined;
    }
  }
}

function firstObject(s: string): JsonObject | undefined {
  let from = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    const start = s.indexOf('{', from);
    if (start < 0) return undefined;
    const end = findBalancedEnd(s, start);
    if (end < 0) {
      const repaired = tryParse(closeTruncated(repairJson(s.slice(start))));
      return isJsonObject(repaired) ? repaired : undefined;
    }
    const value = tryParse(s.slice(start, end + 1));
    if (isJsonObject(value)) return value;
    from = start + 1;
  }
  return undefined;
}

/** The first JSON object found in `text`, or undefined. */
export function extractJson(text: string | null | undefined): JsonObject | undefined {
  if (!text) return undefined;
  const src = text.replace(/^\uFEFF/, '').trim();
  const direct = tryParse(src);
  if (isJsonObject(direct)) return direct;
  for (const m of src.matchAll(/```[a-zA-Z]*\s*\n?([\s\S]*?)```/g)) {
    const v = firstObject(m[1]);
    if (v) return v;
  }
  return firstObject(src);
}
