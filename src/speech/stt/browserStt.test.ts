// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStt, isBrowserSttSupported, SttError, type ListenSession } from '../index';
import { domError, FakeRecognition, installGetUserMedia, makeSettings, uninstallGetUserMedia, type FakeStream } from '../testing/fakes';
import { dedupeAndroidResults, isAndroidUserAgent, joinTranscript, keepDistinctSegments, STOP_TIMEOUT_MS } from './browserStt';
import { mapMediaError, mapRecognitionError } from './errors';

const settings = makeSettings({ stt: { engine: 'browser' } });

let streams: FakeStream[];

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecognition.reset();
  vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
  streams = installGetUserMedia().streams;
});

afterEach(() => {
  uninstallGetUserMedia();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function startSession(opts: Partial<Parameters<ReturnType<typeof createStt>['start']>[0]> = {}): Promise<ListenSession> {
  const engine = createStt(settings);
  const p = engine.start({ lang: 'zh', ...opts });
  await vi.advanceTimersByTimeAsync(0);
  return p;
}

describe('joinTranscript', () => {
  it('joins English with spaces', () => {
    expect(joinTranscript([' hello ', 'world', '', 'again'], 'en')).toBe('hello world again');
  });

  it('joins Chinese segments with a comma unless punctuation is present, spaces between Latin words', () => {
    expect(joinTranscript(['我叫小明', '我是一名工程师'], 'zh')).toBe('我叫小明，我是一名工程师');
    expect(joinTranscript(['你好。', '我是小明'], 'zh')).toBe('你好。我是小明');
    expect(joinTranscript(['我用 React', 'Hooks 写的'], 'zh')).toBe('我用 React Hooks 写的');
  });
});

describe('error mapping', () => {
  it('maps SpeechRecognition error codes', () => {
    expect(mapRecognitionError('no-speech')).toBeNull();
    expect(mapRecognitionError('not-allowed')?.code).toBe('permission-denied');
    expect(mapRecognitionError('service-not-allowed')?.code).toBe('permission-denied');
    expect(mapRecognitionError('audio-capture')?.code).toBe('no-microphone');
    expect(mapRecognitionError('aborted')?.code).toBe('aborted');
    const network = mapRecognitionError('network');
    expect(network?.code).toBe('network');
    expect(network?.message).toMatch(/Edge/);
    expect(network?.message).toMatch(/API/);
    expect(mapRecognitionError('language-not-supported')?.code).toBe('not-supported');
  });

  it('maps getUserMedia errors', () => {
    expect(mapMediaError(domError('NotAllowedError')).code).toBe('permission-denied');
    expect(mapMediaError(domError('SecurityError')).code).toBe('permission-denied');
    expect(mapMediaError(domError('NotFoundError')).code).toBe('no-microphone');
    expect(mapMediaError(domError('NotReadableError')).code).toBe('no-microphone');
    expect(mapMediaError(new TypeError('bad')).code).toBe('not-supported');
  });
});

describe('browser STT', () => {
  it('is supported with webkitSpeechRecognition and configures the recognizer', async () => {
    expect(isBrowserSttSupported()).toBe(true);
    const engine = createStt(settings);
    expect(engine.kind).toBe('browser');
    expect(engine.isAvailable()).toBe(true);
    await startSession({ lang: 'en' });
    const rec = FakeRecognition.last;
    expect(rec.lang).toBe('en-US');
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);
    expect(rec.startCalls).toBe(1);
  });

  it('aggregates finals + interim into onPartial and resolves stop() after the final onend', async () => {
    const partials: string[] = [];
    const session = await startSession({ onPartial: (t) => partials.push(t) });
    const rec = FakeRecognition.last;
    rec.emitResults([['我叫小明', false]]);
    rec.emitResults([
      ['我叫小明', true],
      ['我是', false],
    ]);
    rec.emitResults([
      ['我叫小明', true],
      ['我是后端工程师', true],
    ]);
    expect(partials).toEqual(['我叫小明', '我叫小明，我是', '我叫小明，我是后端工程师']);

    const stopped = session.stop();
    expect(rec.stopCalls).toBe(1);
    expect(streams[0].allStopped).toBe(true); // mic released right away
    await vi.advanceTimersByTimeAsync(1);
    await expect(stopped).resolves.toBe('我叫小明，我是后端工程师');
    expect(session.stop()).toBe(stopped);
  });

  it('auto-restarts when Chrome ends the session on silence and keeps earlier text', async () => {
    const partials: string[] = [];
    const session = await startSession({ lang: 'en', onPartial: (t) => partials.push(t) });
    const rec = FakeRecognition.last;
    await vi.advanceTimersByTimeAsync(2000);
    rec.emitResults([['first part', true]]);
    rec.emitError('no-speech'); // ignored
    rec.end();
    await vi.advanceTimersByTimeAsync(10);
    expect(rec.startCalls).toBe(2);
    rec.emitResults([['second part', false]]);
    expect(partials[partials.length - 1]).toBe('first part second part');
    rec.emitResults([['second part', true]]);
    const stopped = session.stop();
    await vi.advanceTimersByTimeAsync(1);
    await expect(stopped).resolves.toBe('first part second part');
  });

  it('keeps unfinalized interim text when the recognizer ends without a final result', async () => {
    const session = await startSession({ lang: 'en' });
    const rec = FakeRecognition.last;
    rec.emitResults([['almost done', false]]);
    FakeRecognition.stopBehavior = 'hang';
    const stopped = session.stop();
    await vi.advanceTimersByTimeAsync(STOP_TIMEOUT_MS + 10);
    await expect(stopped).resolves.toBe('almost done');
    expect(rec.abortCalls).toBe(1);
  });

  it('backs off and fails with a network error after repeated immediate ends', async () => {
    const onError = vi.fn();
    await startSession({ onError });
    const rec = FakeRecognition.last;
    const restartedAt: number[] = [];
    for (let i = 0; i < 6 && onError.mock.calls.length === 0; i++) {
      rec.end(); // ends right after starting, without any result
      const before = Date.now();
      await vi.advanceTimersToNextTimerAsync(); // the backoff timer → restart
      if (onError.mock.calls.length === 0) restartedAt.push(Date.now() - before);
    }
    expect(restartedAt).toEqual([250, 500, 1000, 2000]);
    expect(onError).toHaveBeenCalledTimes(1);
    const err = onError.mock.calls[0][0] as SttError;
    expect(err).toBeInstanceOf(SttError);
    expect(err.code).toBe('network');
    expect(rec.startCalls).toBe(5);
    expect(streams[0].allStopped).toBe(true);
  });

  it("reports a mid-session 'network' error with the Edge/API hint and still returns the text so far", async () => {
    const onError = vi.fn();
    const session = await startSession({ onError });
    const rec = FakeRecognition.last;
    rec.emitResults([['说到一半', true]]);
    rec.emitError('network');
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as SttError).code).toBe('network');
    expect((onError.mock.calls[0][0] as SttError).message).toMatch(/Edge/);
    expect(streams[0].allStopped).toBe(true);
    await expect(session.stop()).resolves.toBe('说到一半');
  });

  it('stop() rejects with the error when the session died and nothing was recognised', async () => {
    const session = await startSession({ onError: () => {} });
    FakeRecognition.last.emitError('aborted');
    await expect(session.stop()).rejects.toMatchObject({ code: 'aborted' });
  });

  it("rejects start() with permission-denied on 'not-allowed' before the session starts", async () => {
    FakeRecognition.autoStart = false;
    const engine = createStt(settings);
    const p = engine.start({ lang: 'zh' });
    const assertion = expect(p).rejects.toMatchObject({ code: 'permission-denied' });
    await vi.advanceTimersByTimeAsync(0);
    FakeRecognition.last.emitError('not-allowed');
    await assertion;
    expect(streams[0].allStopped).toBe(true);
  });

  it("maps 'audio-capture' to no-microphone (after retrying without the level-meter stream)", async () => {
    FakeRecognition.autoStart = false;
    const engine = createStt(settings);
    const p = engine.start({ lang: 'zh' });
    const assertion = expect(p).rejects.toMatchObject({ code: 'no-microphone' });
    await vi.advanceTimersByTimeAsync(0);
    const rec = FakeRecognition.last;
    rec.emitError('audio-capture');
    expect(streams[0].allStopped).toBe(true); // meter stream dropped
    rec.end();
    await vi.advanceTimersByTimeAsync(300);
    expect(rec.startCalls).toBe(2);
    rec.emitError('audio-capture');
    await assertion;
  });

  it('rejects when microphone permission is denied by getUserMedia', async () => {
    installGetUserMedia(async () => {
      throw domError('NotAllowedError', 'Permission denied');
    });
    await expect(createStt(settings).start({ lang: 'zh' })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(FakeRecognition.instances).toHaveLength(0);
  });

  it('still works without getUserMedia (no level meter)', async () => {
    uninstallGetUserMedia();
    const session = await startSession({ lang: 'en' });
    FakeRecognition.last.emitResults([['no meter', true]]);
    const stopped = session.stop();
    await vi.advanceTimersByTimeAsync(1);
    await expect(stopped).resolves.toBe('no meter');
  });

  it('cancel() aborts the recognizer and releases the mic', async () => {
    const session = await startSession();
    const rec = FakeRecognition.last;
    session.cancel();
    expect(rec.abortCalls).toBe(1);
    expect(streams[0].allStopped).toBe(true);
    rec.emitResults([['late', true]]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(rec.startCalls).toBe(1);
  });

  it('is not supported without SpeechRecognition', async () => {
    vi.unstubAllGlobals();
    expect(isBrowserSttSupported()).toBe(false);
    const engine = createStt(settings);
    expect(engine.isAvailable()).toBe(false);
    await expect(engine.start({ lang: 'zh' })).rejects.toMatchObject({ code: 'not-supported' });
  });
});

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

describe('Android repeated results', () => {
  it('detects Android user agents', () => {
    expect(isAndroidUserAgent(ANDROID_UA)).toBe(true);
    expect(isAndroidUserAgent(DESKTOP_UA)).toBe(false);
    expect(isAndroidUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(false);
    expect(isAndroidUserAgent(undefined)).toBe(false);
  });

  it('keepDistinctSegments collapses repeats and growing versions of consecutive segments', () => {
    const keep = (parts: string[], previous?: string) => keepDistinctSegments(parts, previous).map((i) => parts[i]);
    expect(keep(['我负责订单系统', '我负责订单系统', '我负责订单系统。', '把延迟降低了一半'])).toEqual(['我负责订单系统', '把延迟降低了一半']);
    expect(keep(['我负责', '我负责订单系统', '我负责'])).toEqual(['我负责订单系统']);
    expect(keep(['Hello', 'hello, world', 'next'])).toEqual(['hello, world', 'next']);
    // Distinct segments stay, also when one reappears later (not consecutive).
    expect(keep(['好的', '我们开始', '好的'])).toEqual(['好的', '我们开始', '好的']);
    // Against the previous session only an exact repeat is dropped.
    expect(keep(['你好', '我是小明'], '你好')).toEqual(['我是小明']);
    expect(keep(['你好啊'], '你好')).toEqual(['你好啊']);
  });

  it('dedupeAndroidResults drops confidence-0 repeats but keeps text nothing else covers', () => {
    expect(dedupeAndroidResults([{ text: '我负责订单系统', confidence: 0.9 }, { text: '我负责订单系统', confidence: 0 }], '')).toEqual({
      finals: ['我负责订单系统'],
      interim: '',
    });
    // A device that reports 0 for everything loses nothing.
    expect(dedupeAndroidResults([{ text: '第一句', confidence: 0 }, { text: '第二句', confidence: 0 }], '')).toEqual({
      finals: ['第一句', '第二句'],
      interim: '',
    });
    // An interim that grows the last final replaces it; a replayed interim is dropped.
    expect(dedupeAndroidResults([{ text: '我负责', confidence: 0.8 }], '我负责订单')).toEqual({ finals: [], interim: '我负责订单' });
    expect(dedupeAndroidResults([{ text: '我负责订单', confidence: 0.8 }], '我负责')).toEqual({ finals: ['我负责订单'], interim: '' });
    expect(dedupeAndroidResults([{ text: '上一段', confidence: 0 }], '', '上一段')).toEqual({ finals: [], interim: '' });
  });

  describe('in a session', () => {
    let ua: string;
    beforeEach(() => {
      ua = ANDROID_UA;
      vi.spyOn(navigator, 'userAgent', 'get').mockImplementation(() => ua);
    });

    it('does not concatenate duplicated final results on Android', async () => {
      const partials: string[] = [];
      const session = await startSession({ lang: 'zh', onPartial: (t) => partials.push(t) });
      const rec = FakeRecognition.last;
      rec.emitResults([['我负责', false]]);
      rec.emitResults([['我负责订单系统', true]]);
      rec.emitResults([
        ['我负责订单系统', true],
        ['我负责订单系统', true, 0],
      ]);
      rec.emitResults([
        ['我负责订单系统', true],
        ['我负责订单系统', true, 0],
        ['把延迟', false],
      ]);
      expect(partials[partials.length - 1]).toBe('我负责订单系统，把延迟');
      rec.emitResults([
        ['我负责订单系统', true],
        ['我负责订单系统', true, 0],
        ['把延迟降低了一半', true],
      ]);
      // Chrome ends the session; the next one starts by repeating the last segment.
      rec.end();
      await vi.advanceTimersByTimeAsync(10);
      rec.emitResults([
        ['把延迟降低了一半', true, 0],
        ['用户满意度也提升了', true],
      ]);
      const stopped = session.stop();
      await vi.advanceTimersByTimeAsync(1);
      await expect(stopped).resolves.toBe('我负责订单系统，把延迟降低了一半，用户满意度也提升了');
    });

    it('leaves desktop results exactly as delivered', async () => {
      ua = DESKTOP_UA;
      const session = await startSession({ lang: 'zh' });
      const rec = FakeRecognition.last;
      rec.emitResults([
        ['对', true],
        ['对', true],
        ['我们用的是 Kafka', true, 0],
      ]);
      const stopped = session.stop();
      await vi.advanceTimersByTimeAsync(1);
      await expect(stopped).resolves.toBe('对，对，我们用的是 Kafka');
    });
  });
});

describe('keyboard STT', () => {
  it('is never available and start() rejects', async () => {
    const engine = createStt(makeSettings({ stt: { engine: 'keyboard' } }));
    expect(engine.kind).toBe('keyboard');
    expect(engine.isAvailable()).toBe(false);
    await expect(engine.start({ lang: 'en' })).rejects.toBeInstanceOf(SttError);
  });
});
