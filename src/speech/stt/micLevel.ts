/** Microphone access and the live input-level meter. */
import { ensureContextRunning, getSpeechAudioContext, MIC_LEVEL_OPTIONS, startAnalyserLevel } from '../audioLevel';
import { getMediaDevices, safeCall } from '../env';
import { SttError } from '../types';
import { mapMediaError } from './errors';

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

function insecureContext(): boolean {
  return typeof globalThis.isSecureContext === 'boolean' && !globalThis.isSecureContext;
}

/** Ask for the microphone. Rejects with SttError (permission-denied / no-microphone / not-supported). */
export async function openMicrophone(): Promise<MediaStream> {
  const devices = getMediaDevices();
  if (!devices) {
    throw new SttError(
      'not-supported',
      insecureContext()
        ? 'Microphone access needs a secure page (https:// or http://localhost).'
        : 'This browser cannot access the microphone.',
    );
  }
  try {
    return await devices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
  } catch (err) {
    throw mapMediaError(err);
  }
}

/** Stop every track so the browser's "recording" indicator goes away. */
export function releaseStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* ignore */
    }
  }
}

export interface MicMeter {
  /** Stop metering (reports a final 0). Does not stop the stream. Idempotent. */
  stop(): void;
}

const NOOP_METER: MicMeter = { stop: () => {} };

/**
 * Report the stream's input level (0–1, smoothed) every animation frame.
 * A no-op when there is no callback or Web Audio is unavailable.
 */
export function startMicMeter(stream: MediaStream, onLevel?: (level: number) => void): MicMeter {
  if (!onLevel) return NOOP_METER;
  const ctx = getSpeechAudioContext();
  if (!ctx) return NOOP_METER;
  let source: MediaStreamAudioSourceNode;
  let analyser: AnalyserNode;
  let sink: GainNode;
  try {
    source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.3;
    // Keep the graph pulled without making the mic audible.
    sink = ctx.createGain();
    sink.gain.value = 0;
    source.connect(analyser);
    analyser.connect(sink);
    sink.connect(ctx.destination);
  } catch (err) {
    console.warn('[speech] microphone level meter unavailable', err);
    return NOOP_METER;
  }
  void ensureContextRunning(ctx, 1000);
  const stopLevel = startAnalyserLevel(analyser, (level) => safeCall(onLevel, level), MIC_LEVEL_OPTIONS);
  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      stopLevel();
      for (const node of [source, analyser, sink]) {
        try {
          node.disconnect();
        } catch {
          /* ignore */
        }
      }
    },
  };
}
