/**
 * Language-aware text helpers shared by the engine, the AI layer and the UI.
 * Pure functions, no DOM.
 */
import type { Lang } from '../types';

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff]/g;
const LATIN_WORD_RE = /[A-Za-z][A-Za-z0-9'’+#.-]*/g;

/** Number of CJK characters in `text`. */
export function countCjk(text: string): number {
  return text.match(CJK_RE)?.length ?? 0;
}

/** Number of Latin words in `text`. */
export function countLatinWords(text: string): number {
  return text.match(LATIN_WORD_RE)?.length ?? 0;
}

/**
 * Rough "amount of content" in a comparable unit across languages:
 * one CJK character ≈ one unit, one Latin word ≈ two units.
 */
export function contentUnits(text: string): number {
  return countCjk(text) + countLatinWords(text) * 2;
}

/** Best guess of the language a piece of text is written in (null when there is too little text). */
export function guessLang(text: string): Lang | null {
  const cjk = countCjk(text);
  const words = countLatinWords(text);
  if (cjk + words < 3) return null;
  // Chinese answers often contain English tech terms; require a clear majority of words for 'en'.
  if (cjk >= 4 && cjk >= words) return 'zh';
  if (words >= 3 && cjk <= words * 0.3) return 'en';
  return cjk > words ? 'zh' : 'en';
}

const TERMINAL_RE = /[.!?…:;,"'”’)\]。！？；：，、」』）~～]$/;

/** Join sentences for speech: no separator between CJK sentences, a space for English. */
export function joinSpeech(parts: readonly string[], lang: Lang): string {
  const clean = parts.map((p) => p.trim()).filter(Boolean);
  return clean.reduce((acc, part) => {
    if (!acc) return part;
    // Close an unterminated fragment so TTS pauses between them.
    const closed = TERMINAL_RE.test(acc) ? acc : `${acc}${lang === 'zh' ? '。' : '.'}`;
    if (lang === 'en') return `${closed} ${part}`;
    // Chinese: add a space only between two Latin fragments.
    const needsSpace = /[A-Za-z0-9]$/.test(closed) && /^[A-Za-z0-9]/.test(part);
    return closed + (needsSpace ? ' ' : '') + part;
  }, '');
}

/**
 * Split text into sentences, keeping the terminal punctuation.
 * Handles CJK (。！？…) and Latin (. ! ?) terminators; avoids splitting "e.g." / decimals / "Node.js".
 */
export function splitSentences(text: string): string[] {
  const src = text.replace(/\s+/g, ' ').trim();
  if (!src) return [];
  const out: string[] = [];
  let buf = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    buf += ch;
    const next = src[i + 1] ?? '';
    if (/[。！？!?…]/.test(ch)) {
      // Swallow trailing closers / repeated punctuation: ”」』）)!?…
      while (i + 1 < src.length && /[”"’'」』）)!?！？…。]/.test(src[i + 1])) buf += src[++i];
      out.push(buf.trim());
      buf = '';
    } else if (ch === '.' && (next === ' ' || next === '')) {
      const prevWord = /(\S+)$/.exec(buf.slice(0, -1))?.[1] ?? '';
      const isAbbrev = /^(e\.g|i\.e|etc|vs|mr|mrs|ms|dr|inc|ltd|approx|no)$/i.test(prevWord);
      if (!isAbbrev) {
        out.push(buf.trim());
        buf = '';
      }
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

/** Truncate to `max` characters, appending an ellipsis marker when cut. */
export function truncate(text: string, max: number, marker = '…'): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - marker.length)).trimEnd() + marker;
}

const ZH_MA_END_RE = /吗[。！!…]*\s*$/;
/** 呢 ends a question only after an interrogative word ("你是怎么做的呢。", not "挺厉害的呢。"). */
const ZH_NE_END_RE = /(什么|怎么|怎样|为什么|为何|如何|哪|多少|几|谁|是否|是不是|有没有|能不能|会不会|要不要)[^。！？!?]*呢[。！!…]*\s*$/;
/** 吧 ends a request only after a "tell me" verb ("先从自我介绍开始吧。", not "我们换个话题吧。"). */
const ZH_BA_END_RE = /(说|讲|聊|谈|介绍|开始|展开|分享|举|试试|来)[^。！？!?]{0,6}吧[。！!…]*\s*$/;
const ZH_REQUEST_RE =
  /(请你?|能不能|可不可以|能否|可以(?:说说|讲讲|聊聊|谈谈|介绍|分享|举|展开|具体)|说说|讲讲|聊聊|谈谈|介绍一下|介绍下|举个例子|分享一下|(?:从|先)[^。！？!?]{0,8}介绍)/;
const EN_REQUEST_RE =
  /\b(could you|can you|would you|will you|tell me|walk me|talk me|describe|explain|introduce|share|give me|i'?d (?:love|like) to hear|i'?m curious|(?:start|begin) (?:with|by)|let'?s (?:start|begin|hear)|about yourself)\b/i;
/** Interrogative openers only count at the start ("What was…", not "That's what we need." or "What a story!"). */
const EN_WH_START_RE =
  /^(?:(?:so|and|then|now|okay|ok|alright|well|also|next|but)[,\s]+)*(?:how(?!\s+(?:cool|nice|great|interesting|fun|lovely|impressive|amazing|wonderful)\b)|what(?!\s+an?\b)|why|which|when|where|who|whose|do|did|does|is|are|was|were|have|has|had|can|could|would|will|should)\b/i;

/** A question-like sentence: ends with ? / ？, or is phrased as a question or a request to talk. */
export function looksLikeQuestion(sentence: string): boolean {
  const s = sentence.trim();
  return (
    /[?？]\s*$/.test(s) ||
    ZH_MA_END_RE.test(s) ||
    ZH_NE_END_RE.test(s) ||
    ZH_BA_END_RE.test(s) ||
    ZH_REQUEST_RE.test(s) ||
    EN_REQUEST_RE.test(s) ||
    EN_WH_START_RE.test(s)
  );
}

/**
 * Split a monologue into (reaction, question): the question is the trailing question-like
 * sentence(s); everything before it is the reaction. Used for the opening line and for
 * repairing turns whose `question` came back empty.
 */
export function splitReactionQuestion(text: string, lang: Lang): { reaction: string; question: string } {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return { reaction: '', question: '' };
  if (sentences.length === 1) return { reaction: '', question: sentences[0] };
  let qStart = sentences.length - 1;
  // Walk back while the preceding sentence is also part of the ask (e.g. "比如…？" after "请介绍一下自己。").
  for (let i = sentences.length - 1; i >= 0; i--) {
    if (looksLikeQuestion(sentences[i])) {
      qStart = i;
      if (i > 0 && looksLikeQuestion(sentences[i - 1]) && sentences[i - 1].length + sentences[i].length < 90) qStart = i - 1;
      break;
    }
  }
  // Very short trailing sentence ("好吗？") → merge with the previous one.
  if (qStart === sentences.length - 1 && qStart > 0 && sentences[qStart].replace(/\s/g, '').length <= 4) qStart -= 1;
  return {
    reaction: joinSpeech(sentences.slice(0, qStart), lang),
    question: joinSpeech(sentences.slice(qStart), lang),
  };
}

const ACTION_WORDS_RE =
  /^(?:\s*)(?:微?笑|笑着|轻笑|点头|点点头|停顿|沉思|思考|叹气|推了推眼镜|推推眼镜|推眼镜|扶了扶眼镜|看了看简历|翻看简历|翻了翻简历|挑眉|眨眼|拍手|鼓掌|托腮|记笔记|记了一笔|低头记录|在本子上|敲了敲|双手抱胸|抱着胳膊|歪头|皱眉|耸肩|smiles?|smiling|laughs?|laughing|chuckles?|grins?|nods?|nodding|pauses?|sighs?|thinks?|thinking|adjusts (?:his |her |my )?glasses|push(?:es|ed)? up (?:his |her |my )?glasses|leans (?:back|forward|in)|looks at|glances|claps?|winks?|raises (?:an )?eyebrows?|takes? (?:a )?notes?|taking notes|jots?(?: down)?|scribbles?|taps? (?:on |the )|writes? (?:it |that |something )?down|(?:folds|crosses) (?:his |her |my )?arms|tilts (?:his |her |my )?head|frowns?|shrugs?)/i;

/**
 * Make text safe for TTS and the dialogue box: strip markdown, emoji, stage directions and
 * brackets, collapse whitespace. Meaningful parenthesised content is kept (brackets removed).
 */
export function cleanSpeech(input: string, lang: Lang): string {
  let t = input.replace(/\r\n?/g, '\n');
  // Markdown links / images → label text.
  t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Code fences / inline code.
  t = t.replace(/```[a-z]*\n?/gi, '').replace(/`([^`]*)`/g, '$1');
  // *action* / _action_ stage directions, then bold / italic markers.
  t = t.replace(/(^|\s)\*([^*\n]{1,30})\*(?=\s|$|[，。,.!?！？])/g, (_m, pre: string, inner: string) =>
    ACTION_WORDS_RE.test(inner) ? pre : `${pre}${inner}`,
  );
  t = t.replace(/\*\*|__|\*|~~/g, '');
  // Symbols TTS reads badly: ranges "3~5", "~60%", arrows "12k → 85k".
  t = t.replace(/(\d)\s*[~～]\s*(?=\d)/g, lang === 'zh' ? '$1到' : '$1 to ');
  t = t.replace(/[~～]\s*(?=\d)/g, lang === 'zh' ? '约' : 'about ');
  t = t.replace(/\s*(?:→|⇒|->|=>)\s*/g, lang === 'zh' ? '到' : ' to ');
  // Headings, quotes, bullets, numbered lists at line start.
  t = t.replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-•·●▪◦]\s+|\d{1,2}[.)、]\s+)/gm, '');
  // Bracketed segments: drop stage directions, unwrap everything else.
  const unwrap = (_m: string, inner: string): string => {
    const body = inner.trim();
    if (!body) return '';
    if (ACTION_WORDS_RE.test(body)) return '';
    return lang === 'zh' ? `，${body}，` : ` ${body} `;
  };
  t = t.replace(/[（(]([^（）()]{0,80})[）)]/g, unwrap);
  t = t.replace(/[[【〔]([^\]】〕]{0,80})[\]】〕]/g, unwrap);
  t = t.replace(/[<>{}[\]【】〔〕（）()]/g, '');
  // Emoji & pictographs, variation selectors, zero-width joiners, keycaps.
  t = t.replace(/\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|\uFE0F|\u200D|\u20E3/gu, '');
  // Kaomoji-ish leftovers like ^_^ or ~~.
  t = t.replace(/\^[_-]?\^|[~～]{2,}/g, '');
  // Newlines become sentence breaks.
  t = t.replace(/\s*\n+\s*/g, lang === 'zh' ? '' : ' ');
  // Tidy punctuation produced by unwrapping.
  t = t.replace(/，\s*([，。！？、；：])/g, '$1').replace(/^[，、\s]+/, '').replace(/，+/g, '，');
  t = t.replace(/\s+([,.!?;:])/g, '$1').replace(/\s{2,}/g, ' ');
  // Chinese: no spaces between CJK characters / CJK punctuation.
  if (lang === 'zh') t = t.replace(/([\u3400-\u9fff，。！？、；：])\s+(?=[\u3400-\u9fff，。！？、；：])/g, '$1');
  t = t.trim();
  // Unwrap text wrapped entirely in quotes.
  const q = /^["“「『'](.*)["”」』']$/s.exec(t);
  if (q && !/["“”「」『』]/.test(q[1])) t = q[1].trim();
  return t;
}

/** Chinese typesetting: put a space between CJK characters and adjacent Latin letters / digits. */
export function padCjkLatin(text: string): string {
  return text
    .replace(/([\u4e00-\u9fff])([A-Za-z0-9$#@])/g, '$1 $2')
    .replace(/([A-Za-z0-9%#+])([\u4e00-\u9fff])/g, '$1 $2');
}

/** Collapse whitespace and trim, without the aggressive speech cleanup (for report text). */
export function tidyText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/\*\*|__/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
