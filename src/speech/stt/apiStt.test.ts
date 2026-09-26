// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../../store/settings';
import type { Settings, SttSettings } from '../../types';
import { createStt, retryTranscription, SttError, testMicrophone } from '../index';
import {
  domError,
  FakeMediaRecorder,
  installFetch,
  installGetUserMedia,
  jsonResponse,
  makeSettings,
  uninstallGetUserMedia,
  type FakeStream,
} from '../testing/fakes';
import { parseTranscription, TRANSCRIBE_TIMEOUT_MS, transcriptionHttpError } from './apiStt';
import { extensionForMime, pickRecorderMimeType } from './recorder';

const sttSettings = (stt: Partial<SttSettings> = {}): Settings =>
  makeSettings({
    stt: {
      engine: 'api',
      apiPresetId: 'openai',
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-stt',
      apiModel: 'whisper-1',
      useProxy: false,
      ...stt,
    },
  });

let streams: FakeStream[];

beforeEach(() => {
  vi.useFakeTimers();
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.supported = ['audio/webm;codecs=opus', 'audio/webm'];
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  streams = installGetUserMedia().streams;
  useSettingsStore.setState({ proxyAvailable: null });
});

afterEach(() => {
  uninstallGetUserMedia();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('recorder helpers', () => {
  it('picks webm/opus → webm → mp4 → ogg', () => {
    expect(pickRecorderMimeType((t) => t === 'audio/webm;codecs=opus' || t === 'audio/mp4')).toBe('audio/webm;codecs=opus');
    expect(pickRecorderMimeType((t) => t === 'audio/mp4' || t === 'audio/ogg')).toBe('audio/mp4');
    expect(pickRecorderMimeType((t) => t === 'audio/ogg')).toBe('audio/ogg');
    expect(pickRecorderMimeType(() => false)).toBe('');
  });

  it('maps MIME types to file extensions', () => {
    expect(extensionForMime('audio/webm;codecs=opus')).toBe('webm');
    expect(extensionForMime('audio/mp4')).toBe('mp4');
    expect(extensionForMime('audio/ogg; codecs=opus')).toBe('ogg');
    expect(extensionForMime('audio/wav')).toBe('wav');
    expect(extensionForMime('')).toBe('webm');
  });

  it('parses JSON and plain-text transcription bodies', () => {
    expect(parseTranscription('{"text":" 你好 世界 "}')).toBe('你好 世界');
    expect(parseTranscription('plain text answer\n')).toBe('plain text answer');
    expect(parseTranscription('{"text":"<|zh|><|NEUTRAL|>我叫小明"}')).toBe('我叫小明');
    expect(parseTranscription('{"other":1}')).toBe('');
    expect(parseTranscription('')).toBe('');
  });
});

describe('API STT', () => {
  it('records, then POSTs multipart {file, model, language, response_format} and resolves with the text', async () => {
    const { requests } = installFetch(() => jsonResponse({ text: ' 我是一名后端工程师。 ' }));
    const engine = createStt(sttSettings());
    expect(engine.kind).toBe('api');
    expect(engine.isAvailable()).toBe(true);
    const session = await engine.start({ lang: 'zh' });
    const recorder = FakeMediaRecorder.instances[0];
    expect(recorder.mimeType).toBe('audio/webm;codecs=opus');
    expect(recorder.state).toBe('recording');
    expect(recorder.timeslice).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(1200);
    const result = session.stop();
    await vi.advanceTimersByTimeAsync(5);
    await expect(result).resolves.toBe('我是一名后端工程师。');
    expect(streams[0].allStopped).toBe(true);

    expect(requests).toHaveLength(1);
    const { url, init } = requests[0];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-stt');
    expect(headers['Content-Type']).toBeUndefined();
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    const file = form.get('file') as File;
    expect(file.name).toBe('answer.webm');
    expect(file.type).toBe('audio/webm');
    expect(file.size).toBeGreaterThan(0);
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('language')).toBe('zh');
    expect(form.get('response_format')).toBe('json');
  });

  it('uses the relay when enabled and available, and mp4 on Safari-like recorders', async () => {
    FakeMediaRecorder.supported = ['audio/mp4'];
    useSettingsStore.setState({ proxyAvailable: true });
    const { requests } = installFetch(() => jsonResponse({ text: 'hello' }));
    const session = await createStt(sttSettings({ useProxy: true, apiBaseUrl: 'https://api.groq.com/openai/v1' })).start({
      lang: 'en',
    });
    await vi.advanceTimersByTimeAsync(800);
    const result = session.stop();
    await vi.advanceTimersByTimeAsync(5);
    await expect(result).resolves.toBe('hello');
    expect(requests[0].url).toBe(`${location.origin}/api/proxy/https/api.groq.com/openai/v1/audio/transcriptions`);
    expect((requests[0].init.headers as Record<string, string>)['x-interview-proxy']).toBe('1');
    expect(((requests[0].init.body as FormData).get('file') as File).name).toBe('answer.mp4');
    expect((requests[0].init.body as FormData).get('language')).toBe('en');
  });

  it("rejects recordings shorter than 300 ms as 'no-speech' without calling the API", async () => {
    const { fetch } = installFetch(() => jsonResponse({ text: 'x' }));
    const session = await createStt(sttSettings()).start({ lang: 'zh' });
    await vi.advanceTimersByTimeAsync(100);
    const result = session.stop();
    const assertion = expect(result).rejects.toMatchObject({ code: 'no-speech' });
    await vi.advanceTimersByTimeAsync(5);
    await assertion;
    expect(fetch).not.toHaveBeenCalled();
    expect(streams[0].allStopped).toBe(true);
  });

  /** Record ~1 s with the API engine and return the rejection of stop(). */
  async function failedTake(): Promise<SttError> {
    const session = await createStt(sttSettings()).start({ lang: 'en' });
    await vi.advanceTimersByTimeAsync(1000);
    const result = session.stop().then(
      () => {
        throw new Error('expected a rejection');
      },
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(5);
    const err = await result;
    expect(err).toBeInstanceOf(SttError);
    return err as SttError;
  }

  it.each([
    [401, { error: { message: 'Invalid API key' } }, 'config', /HTTP 401.*Invalid API key.*API key/],
    [403, { error: 'Forbidden region' }, 'config', /HTTP 403.*Forbidden region/],
    [404, { error: { message: 'model not found' } }, 'config', /HTTP 404.*model not found.*base URL/],
    [429, { error: { message: 'Rate limit reached for whisper-large-v3' } }, 'api', /rate-limit.*HTTP 429.*Rate limit reached/],
    [503, { error: { message: 'upstream overloaded' } }, 'api', /server error \(HTTP 503\).*upstream overloaded/],
    [400, { error: { message: 'bad file' } }, 'api', /HTTP 400.*bad file/],
  ] as const)('maps HTTP %i to a distinct reason, keeping the recording', async (status, body, code, message) => {
    installFetch(() => jsonResponse(body, status));
    const err = await failedTake();
    expect(err.code).toBe(code);
    expect(err.status).toBe(status);
    expect(err.message).toMatch(message);
    expect(err.recording).toBeInstanceOf(Blob);
    expect(await err.recording!.text()).toBe('fake-audio-bytes');
  });

  it("maps fetch failures to SttError('network'), keeping the recording", async () => {
    installFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const err = await failedTake();
    expect(err.code).toBe('network');
    expect(err.status).toBeUndefined();
    expect(err.message).toMatch(/Could not reach the transcription service: Failed to fetch.*CORS/);
    expect(err.recording?.size).toBeGreaterThan(0);
  });

  it("maps a timeout to SttError('network') with its own message, keeping the recording", async () => {
    installFetch(
      (req) =>
        new Promise<Response>((_resolve, reject) => {
          req.init.signal?.addEventListener('abort', () => reject(domError('AbortError')));
        }),
    );
    const session = await createStt(sttSettings()).start({ lang: 'en' });
    await vi.advanceTimersByTimeAsync(1000);
    const result = session.stop().then(
      () => null,
      (err: unknown) => err as SttError,
    );
    await vi.advanceTimersByTimeAsync(TRANSCRIBE_TIMEOUT_MS + 10);
    const err = await result;
    expect(err).toMatchObject({ code: 'network' });
    expect(err?.message).toMatch(/did not answer in time/);
    expect(err?.recording?.size).toBeGreaterThan(0);
  });

  it('transcriptionHttpError keeps the status in the message even without a reason', () => {
    expect(transcriptionHttpError(502, '').message).toMatch(/HTTP 502/);
    expect(transcriptionHttpError(502, '').recording).toBeUndefined();
  });

  it('retryTranscription() sends the kept recording again with the current settings', async () => {
    let calls = 0;
    const { requests } = installFetch(() => (++calls === 1 ? jsonResponse({ error: 'slow down' }, 429) : jsonResponse({ text: '  second try ' })));
    const err = await failedTake();
    expect(err.recording).toBeDefined();
    const text = await retryTranscription(sttSettings({ apiKey: 'sk-new' }), err.recording!, 'en');
    expect(text).toBe('second try');
    expect(requests).toHaveLength(2);
    expect((requests[1].init.headers as Record<string, string>).Authorization).toBe('Bearer sk-new');
    const file = (requests[1].init.body as FormData).get('file') as File;
    expect(file.name).toBe('answer.webm');
    expect(await file.text()).toBe('fake-audio-bytes');
    expect((requests[1].init.body as FormData).get('language')).toBe('en');
  });

  it('retryTranscription() failures carry the recording again; cancel and config are handled', async () => {
    const recording = new Blob(['bytes'], { type: 'audio/mp4' });
    installFetch(() => jsonResponse({ error: 'still busy' }, 503));
    const again = await retryTranscription(sttSettings(), recording, 'zh').then(
      () => null,
      (e: unknown) => e as SttError,
    );
    expect(again).toMatchObject({ code: 'api', status: 503 });
    expect(again?.recording).toBe(recording);

    const noConfig = await retryTranscription(sttSettings({ apiBaseUrl: '' }), recording, 'zh').then(
      () => null,
      (e: unknown) => e as SttError,
    );
    expect(noConfig).toMatchObject({ code: 'config' });
    expect(noConfig?.recording).toBe(recording);

    const { requests } = installFetch(
      (req) =>
        new Promise<Response>((_resolve, reject) => {
          req.init.signal?.addEventListener('abort', () => reject(domError('AbortError')));
        }),
    );
    const ctl = new AbortController();
    const pending = retryTranscription(sttSettings(), recording, 'zh', ctl.signal).then(
      () => null,
      (e: unknown) => e as SttError,
    );
    await vi.advanceTimersByTimeAsync(10);
    ctl.abort();
    expect(await pending).toMatchObject({ code: 'aborted' });
    expect(((requests[0].init.body as FormData).get('file') as File).name).toBe('answer.mp4');

    await expect(retryTranscription(sttSettings(), new Blob([]), 'zh')).rejects.toMatchObject({ code: 'no-speech' });
  });

  it('cancel() discards the recording and releases the mic', async () => {
    const { fetch } = installFetch(() => jsonResponse({ text: 'x' }));
    const session = await createStt(sttSettings()).start({ lang: 'zh' });
    await vi.advanceTimersByTimeAsync(1000);
    session.cancel();
    expect(streams[0].allStopped).toBe(true);
    await expect(session.stop()).rejects.toMatchObject({ code: 'aborted' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a disconnected microphone through onError', async () => {
    const onError = vi.fn();
    await createStt(sttSettings()).start({ lang: 'zh', onError });
    streams[0].tracks[0].dispatchEvent(new Event('ended'));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({ code: 'no-microphone' });
  });

  it("rejects with 'config' when base URL or model is missing", async () => {
    const engine = createStt(sttSettings({ apiModel: '' }));
    expect(engine.isAvailable()).toBe(false);
    await expect(engine.start({ lang: 'zh' })).rejects.toMatchObject({ code: 'config' });
    expect(streams).toHaveLength(0);
  });

  it('maps getUserMedia failures', async () => {
    installGetUserMedia(async () => {
      throw domError('NotFoundError');
    });
    await expect(createStt(sttSettings()).start({ lang: 'zh' })).rejects.toMatchObject({ code: 'no-microphone' });
    uninstallGetUserMedia();
    await expect(createStt(sttSettings()).start({ lang: 'zh' })).rejects.toMatchObject({ code: 'not-supported' });
  });

  it('is not supported without MediaRecorder', async () => {
    vi.stubGlobal('MediaRecorder', undefined);
    const engine = createStt(sttSettings());
    expect(engine.isAvailable()).toBe(false);
    await expect(engine.start({ lang: 'zh' })).rejects.toMatchObject({ code: 'not-supported' });
  });
});

describe('testMicrophone', () => {
  it('opens and releases the mic, resolving with the peak level (0 without Web Audio)', async () => {
    const p = testMicrophone(500);
    await vi.advanceTimersByTimeAsync(600);
    await expect(p).resolves.toBe(0);
    expect(streams[0].allStopped).toBe(true);
  });

  it('rejects with permission-denied', async () => {
    installGetUserMedia(async () => {
      throw domError('NotAllowedError');
    });
    await expect(testMicrophone(100)).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
