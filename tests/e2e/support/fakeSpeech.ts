/**
 * Browser speech fakes, installed with `page.addInitScript(installFakeSpeech)` before any app code:
 *
 * - `speechSynthesis` + `SpeechSynthesisUtterance`: two zh and two en voices (one female, one male
 *   each), a real queue, and start → boundary → end events a few ms apart. Every utterance is
 *   recorded in `window.__fakeTts.spoken` (text, lang, voice).
 * - `webkitSpeechRecognition` / `SpeechRecognition`: when started it emits `start`, then interim
 *   results for the next scripted answer (`window.__fakeStt.say(text)`); `stop()` delivers the
 *   final result and `end`, like Chrome flushing on stop. Starts are recorded with their lang.
 *   `window.__fakeStt.failNext(code)` makes the next start fail with that SpeechRecognition error.
 *
 * The function must be self-contained: Playwright serializes it into the page.
 */
export interface FakeUtteranceRecord {
  text: string;
  lang: string;
  voice: string | null;
  rate: number;
  pitch: number;
  /** 'end' once it finished, 'cancelled' if cancel() cut it off. */
  outcome: 'pending' | 'end' | 'cancelled';
  boundaries: number;
}

export interface FakeSpeechWindow {
  __fakeTts: { spoken: FakeUtteranceRecord[]; voices: { name: string; lang: string }[] };
  __fakeStt: {
    starts: { lang: string; continuous: boolean; interimResults: boolean }[];
    say(text: string): void;
    failNext(error: string): void;
    pending: string[];
  };
}

export function installFakeSpeech(): void {
  type Handler = ((ev: unknown) => void) | null;
  const w = window as unknown as Record<string, unknown>;

  // ───────────── speechSynthesis ─────────────
  const voices = [
    { voiceURI: 'fake-zh-female', name: 'Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)', lang: 'zh-CN', localService: false, default: false },
    { voiceURI: 'fake-zh-male', name: 'Microsoft Yunxi Online (Natural) - Chinese (Mainland)', lang: 'zh-CN', localService: false, default: false },
    { voiceURI: 'fake-en-female', name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US', localService: false, default: true },
    { voiceURI: 'fake-en-male', name: 'Microsoft Guy Online (Natural) - English (United States)', lang: 'en-US', localService: false, default: false },
  ];
  const spoken: Record<string, unknown>[] = [];

  class FakeUtterance {
    text: string;
    lang = '';
    voice: { name: string } | null = null;
    rate = 1;
    pitch = 1;
    volume = 1;
    onstart: Handler = null;
    onend: Handler = null;
    onerror: Handler = null;
    onboundary: Handler = null;
    onpause: Handler = null;
    onresume: Handler = null;
    onmark: Handler = null;
    constructor(text = '') {
      this.text = text;
    }
    addEventListener() {}
    removeEventListener() {}
  }

  interface Job {
    u: FakeUtterance;
    rec: Record<string, unknown>;
  }
  const queue: Job[] = [];
  let current: Job | null = null;
  let timers: number[] = [];
  const voiceListeners = new Set<(ev: unknown) => void>();

  const synth = {
    speaking: false,
    pending: false,
    paused: false,
    onvoiceschanged: null as Handler,
    getVoices: () => voices.slice(),
    speak(u: FakeUtterance) {
      const rec = { text: u.text, lang: u.lang, voice: u.voice?.name ?? null, rate: u.rate, pitch: u.pitch, outcome: 'pending', boundaries: 0 };
      spoken.push(rec);
      queue.push({ u, rec });
      synth.pending = queue.length > 0 && current !== null;
      if (!current) next();
    },
    cancel() {
      timers.forEach((t) => window.clearTimeout(t));
      timers = [];
      const jobs = [...(current ? [current] : []), ...queue.splice(0)];
      current = null;
      synth.speaking = false;
      synth.pending = false;
      for (const job of jobs) {
        job.rec.outcome = 'cancelled';
        job.u.onerror?.({ type: 'error', error: 'interrupted', utterance: job.u });
      }
    },
    pause() {
      synth.paused = true;
    },
    resume() {
      synth.paused = false;
    },
    addEventListener(type: string, fn: (ev: unknown) => void) {
      if (type === 'voiceschanged') voiceListeners.add(fn);
    },
    removeEventListener(type: string, fn: (ev: unknown) => void) {
      if (type === 'voiceschanged') voiceListeners.delete(fn);
    },
    dispatchEvent: () => true,
  };

  function next(): void {
    const job = queue.shift() ?? null;
    current = job;
    synth.pending = queue.length > 0;
    if (!job) {
      synth.speaking = false;
      return;
    }
    synth.speaking = true;
    const { u, rec } = job;
    timers.push(
      window.setTimeout(() => {
        if (current !== job) return;
        u.onstart?.({ type: 'start', utterance: u });
        rec.boundaries = (rec.boundaries as number) + 1;
        u.onboundary?.({ type: 'boundary', name: 'word', charIndex: 0, utterance: u });
      }, 5),
      window.setTimeout(() => {
        if (current !== job) return;
        rec.boundaries = (rec.boundaries as number) + 1;
        u.onboundary?.({ type: 'boundary', name: 'word', charIndex: Math.floor(u.text.length / 2), utterance: u });
      }, 15),
      window.setTimeout(() => {
        if (current !== job) return;
        rec.outcome = 'end';
        synth.speaking = false;
        u.onend?.({ type: 'end', utterance: u });
        next();
      }, 30),
    );
  }

  Object.defineProperty(window, 'speechSynthesis', { configurable: true, get: () => synth });
  w.SpeechSynthesisUtterance = FakeUtterance;
  w.__fakeTts = { spoken, voices: voices.map((v) => ({ name: v.name, lang: v.lang })) };

  // ───────────── SpeechRecognition ─────────────
  const pending: string[] = [];
  const failures: string[] = [];
  const starts: Record<string, unknown>[] = [];
  const results = (parts: [string, boolean][]) => {
    const list = parts.map(([transcript, isFinal]) => {
      const alt = { transcript, confidence: 0.9 };
      return { isFinal, length: 1, 0: alt, item: () => alt };
    });
    return { resultIndex: 0, results: Object.assign(list, { item: (i: number) => list[i] }) };
  };

  class FakeRecognition {
    lang = '';
    continuous = false;
    interimResults = false;
    maxAlternatives = 1;
    onstart: Handler = null;
    onend: Handler = null;
    onerror: Handler = null;
    onresult: Handler = null;
    onaudiostart: Handler = null;
    onspeechstart: Handler = null;
    private running = false;
    private answer = '';
    private timers: number[] = [];
    start() {
      if (this.running) throw new DOMException('recognition has already started', 'InvalidStateError');
      this.running = true;
      this.answer = pending.shift() ?? '';
      starts.push({ lang: this.lang, continuous: this.continuous, interimResults: this.interimResults });
      const failure = failures.shift();
      if (failure) {
        // Like Chrome without access to Google's servers: an error, then the session ends.
        this.timers.push(
          window.setTimeout(() => {
            this.running = false;
            this.onerror?.({ type: 'error', error: failure, message: '' });
            this.onend?.({ type: 'end' });
          }, 10),
        );
        return;
      }
      const words = this.answer.split(' ');
      const half = words.length > 1 ? words.slice(0, Math.ceil(words.length / 2)).join(' ') : this.answer.slice(0, Math.ceil(this.answer.length / 2));
      this.timers.push(
        window.setTimeout(() => this.running && this.onstart?.({ type: 'start' }), 10),
        window.setTimeout(() => this.running && this.answer && this.onresult?.(results([[half, false]])), 40),
        window.setTimeout(() => this.running && this.answer && this.onresult?.(results([[this.answer, false]])), 80),
      );
    }
    stop() {
      if (!this.running) return;
      this.running = false;
      this.timers.forEach((t) => window.clearTimeout(t));
      const answer = this.answer;
      window.setTimeout(() => {
        if (answer) this.onresult?.(results([[answer, true]]));
        this.onend?.({ type: 'end' });
      }, 10);
    }
    abort() {
      if (!this.running) return;
      this.running = false;
      this.timers.forEach((t) => window.clearTimeout(t));
      window.setTimeout(() => this.onend?.({ type: 'end' }), 5);
    }
    addEventListener() {}
    removeEventListener() {}
  }

  w.webkitSpeechRecognition = FakeRecognition;
  w.SpeechRecognition = FakeRecognition;
  w.__fakeStt = { starts, pending, say: (text: string) => pending.push(text), failNext: (error: string) => failures.push(error) };
}
