/**
 * Mapping browser failures to SttError codes. Messages are English technical details for the
 * "details" area; the UI should show a localized text per `code`.
 */
import { SttError } from '../types';

export const NETWORK_HINT =
  "Chrome's built-in speech recognition relies on Google's servers, which may be unreachable " +
  '(for example in mainland China). Try Microsoft Edge, or switch the speech-recognition engine to "API" in Settings.';

/**
 * SpeechRecognitionErrorEvent.error → SttError; null for errors that are not failures
 * ('no-speech': Chrome ends a silent session, we simply restart it).
 */
export function mapRecognitionError(code: string, detail = ''): SttError | null {
  const suffix = detail ? ` (${detail})` : '';
  switch (code) {
    case 'no-speech':
      return null;
    case 'not-allowed':
      return new SttError('permission-denied', `Microphone permission was denied${suffix}. Allow microphone access for this site and try again.`);
    case 'service-not-allowed':
      return new SttError(
        'permission-denied',
        `The browser refused to start its speech-recognition service${suffix}. ` +
          'Allow microphone access, try Microsoft Edge or Chrome, or switch the recognition engine to "API".',
      );
    case 'audio-capture':
      return new SttError('no-microphone', `No microphone was found, or it could not be opened${suffix}.`);
    case 'network':
      return new SttError('network', `Speech recognition network error${suffix}. ${NETWORK_HINT}`);
    case 'aborted':
      return new SttError('aborted', `Speech recognition was aborted${suffix}.`);
    case 'language-not-supported':
      return new SttError('not-supported', `This browser cannot recognise the selected language${suffix}. Try the "API" engine.`);
    default:
      return new SttError('not-supported', `Speech recognition failed: ${code || 'unknown error'}${suffix}.`);
  }
}

/** getUserMedia / MediaRecorder DOMException → SttError. */
export function mapMediaError(err: unknown): SttError {
  if (err instanceof SttError) return err;
  const name = err instanceof Error || (typeof err === 'object' && err !== null && 'name' in err) ? String((err as { name: unknown }).name) : '';
  const message = err instanceof Error ? err.message : String(err ?? '');
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return new SttError('permission-denied', `Microphone permission was denied (${message || name}).`, { cause: err });
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return new SttError('no-microphone', 'No microphone was found. Connect one and try again.', { cause: err });
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new SttError('no-microphone', 'The microphone could not be opened — it may be in use by another application.', {
        cause: err,
      });
    case 'TypeError':
    case 'NotSupportedError':
      return new SttError('not-supported', `Microphone capture is not supported here (${message || name}).`, { cause: err });
    default:
      return new SttError('no-microphone', `Could not access the microphone${message ? `: ${message}` : ''}.`, { cause: err });
  }
}
