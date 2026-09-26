/**
 * A strict, minimal fake of the Web Audio API for Node tests. It records the graph and validates
 * calls the way browsers do (RangeError for negative/non-finite times, exponential ramps to 0,
 * starting a source twice, stopping before start…), so synthesis code that passes here will not
 * throw in a real browser. Test-only; never imported by production code.
 */

type Listener = () => void;

function assertTime(time: number, what: string): void {
  if (!Number.isFinite(time)) throw new TypeError(`${what}: non-finite time ${time}`);
  if (time < 0) throw new RangeError(`${what}: negative time ${time}`);
}

function assertFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) throw new TypeError(`${what}: non-finite value ${value}`);
}

export interface ParamEvent {
  type: 'set' | 'linear' | 'exponential' | 'target' | 'cancel';
  value: number;
  time: number;
  timeConstant?: number;
}

export class FakeAudioParam {
  value: number;
  readonly events: ParamEvent[] = [];
  readonly inputs: FakeAudioNode[] = [];

  constructor(defaultValue: number) {
    this.value = defaultValue;
  }

  setValueAtTime(value: number, time: number): this {
    assertFinite(value, 'setValueAtTime');
    assertTime(time, 'setValueAtTime');
    this.events.push({ type: 'set', value, time });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    assertFinite(value, 'linearRampToValueAtTime');
    assertTime(time, 'linearRampToValueAtTime');
    this.events.push({ type: 'linear', value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    assertFinite(value, 'exponentialRampToValueAtTime');
    assertTime(time, 'exponentialRampToValueAtTime');
    if (value === 0) throw new RangeError('exponentialRampToValueAtTime: value must not be 0');
    this.events.push({ type: 'exponential', value, time });
    return this;
  }

  setTargetAtTime(value: number, time: number, timeConstant: number): this {
    assertFinite(value, 'setTargetAtTime');
    assertTime(time, 'setTargetAtTime');
    assertFinite(timeConstant, 'setTargetAtTime timeConstant');
    if (timeConstant < 0) throw new RangeError('setTargetAtTime: negative timeConstant');
    this.events.push({ type: 'target', value, time, timeConstant });
    return this;
  }

  cancelScheduledValues(time: number): this {
    assertTime(time, 'cancelScheduledValues');
    this.events.push({ type: 'cancel', value: Number.NaN, time });
    return this;
  }

  /** Largest value the automation ever asks for (for loudness sanity checks). */
  get maxScheduled(): number {
    return this.events.reduce((m, e) => (e.type === 'cancel' ? m : Math.max(m, e.value)), this.value);
  }
}

export class FakeAudioNode {
  readonly context: FakeAudioContext;
  readonly kind: string;
  readonly outputs: (FakeAudioNode | FakeAudioParam)[] = [];
  disconnected = false;

  constructor(context: FakeAudioContext, kind: string) {
    this.context = context;
    this.kind = kind;
    context.created.push(this);
  }

  connect<T extends FakeAudioNode | FakeAudioParam>(destination: T): T {
    if (!(destination instanceof FakeAudioNode) && !(destination instanceof FakeAudioParam)) {
      throw new TypeError('connect: destination is not an AudioNode/AudioParam');
    }
    if (destination instanceof FakeAudioNode && destination.context !== this.context) {
      throw new Error('connect: nodes from different contexts');
    }
    this.outputs.push(destination);
    if (destination instanceof FakeAudioParam) destination.inputs.push(this);
    return destination;
  }

  disconnect(): void {
    this.outputs.length = 0;
    this.disconnected = true;
  }
}

export class FakeGainNode extends FakeAudioNode {
  readonly gain = new FakeAudioParam(1);
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'gain');
  }
}

export class FakeBiquadFilterNode extends FakeAudioNode {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new FakeAudioParam(350);
  readonly Q = new FakeAudioParam(1);
  readonly gain = new FakeAudioParam(0);
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'biquad');
  }
}

export class FakeStereoPannerNode extends FakeAudioNode {
  readonly pan = new FakeAudioParam(0);
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'panner');
  }
}

export class FakeConvolverNode extends FakeAudioNode {
  buffer: FakeAudioBuffer | null = null;
  normalize = true;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'convolver');
  }
}

export class FakeDynamicsCompressorNode extends FakeAudioNode {
  readonly threshold = new FakeAudioParam(-24);
  readonly knee = new FakeAudioParam(30);
  readonly ratio = new FakeAudioParam(12);
  readonly attack = new FakeAudioParam(0.003);
  readonly release = new FakeAudioParam(0.25);
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'compressor');
  }
}

export class FakeScheduledSource extends FakeAudioNode {
  startTime: number | null = null;
  stopTime: number | null = null;
  onended: (() => void) | null = null;

  start(when = 0): void {
    assertTime(when, `${this.kind}.start`);
    if (this.startTime !== null) throw new Error(`InvalidStateError: ${this.kind} started twice`);
    this.startTime = when;
  }

  stop(when = 0): void {
    assertTime(when, `${this.kind}.stop`);
    if (this.startTime === null) throw new Error(`InvalidStateError: ${this.kind} stopped before start`);
    this.stopTime = when;
  }
}

export class FakeOscillatorNode extends FakeScheduledSource {
  type: OscillatorType = 'sine';
  readonly frequency = new FakeAudioParam(440);
  readonly detune = new FakeAudioParam(0);
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'oscillator');
  }
}

export class FakeBufferSourceNode extends FakeScheduledSource {
  buffer: FakeAudioBuffer | null = null;
  loop = false;
  readonly playbackRate = new FakeAudioParam(1);
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'bufferSource');
  }

  override start(when = 0, offset = 0): void {
    assertTime(offset, 'bufferSource.start offset');
    super.start(when);
  }
}

export class FakeAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly channels: Float32Array[];

  constructor(channels: number, length: number, sampleRate: number) {
    if (channels < 1 || length < 1 || sampleRate < 3000) throw new Error('NotSupportedError: bad buffer shape');
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from({ length: channels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    const data = this.channels[channel];
    if (!data) throw new Error('IndexSizeError');
    return data;
  }
}

export class FakeAudioContext {
  currentTime = 0;
  readonly sampleRate = 48000;
  state: AudioContextState = 'suspended';
  readonly created: FakeAudioNode[] = [];
  readonly destination: FakeAudioNode;
  resumeCalls = 0;
  suspendCalls = 0;
  /** When false, resume() leaves the context suspended (no user activation). */
  allowResume = true;
  private readonly listeners = new Map<string, Listener[]>();

  constructor() {
    this.destination = new FakeAudioNode(this, 'destination');
  }

  createGain(): FakeGainNode {
    return new FakeGainNode(this);
  }
  createOscillator(): FakeOscillatorNode {
    return new FakeOscillatorNode(this);
  }
  createBufferSource(): FakeBufferSourceNode {
    return new FakeBufferSourceNode(this);
  }
  createBiquadFilter(): FakeBiquadFilterNode {
    return new FakeBiquadFilterNode(this);
  }
  createStereoPanner(): FakeStereoPannerNode {
    return new FakeStereoPannerNode(this);
  }
  createConvolver(): FakeConvolverNode {
    return new FakeConvolverNode(this);
  }
  createDynamicsCompressor(): FakeDynamicsCompressorNode {
    return new FakeDynamicsCompressorNode(this);
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeAudioBuffer {
    return new FakeAudioBuffer(channels, length, sampleRate);
  }

  resume(): Promise<void> {
    this.resumeCalls++;
    if (this.allowResume && this.state !== 'closed') this.setState('running');
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.suspendCalls++;
    if (this.state !== 'closed') this.setState('suspended');
    return Promise.resolve();
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  private setState(state: AudioContextState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of this.listeners.get('statechange') ?? []) listener();
  }

  /** Nodes of a kind (e.g. 'oscillator'). */
  nodes<T extends FakeAudioNode>(kind: string): T[] {
    return this.created.filter((n) => n.kind === kind) as T[];
  }

  /** Sources that were started (oscillators + buffer sources, excluding the silent primer). */
  get startedSources(): FakeScheduledSource[] {
    return this.created.filter((n): n is FakeScheduledSource => n instanceof FakeScheduledSource && n.startTime !== null);
  }

  asAudioContext(): AudioContext {
    return this as unknown as AudioContext;
  }
}

/** Manual timers driven together with the fake clock. */
export class FakeTimers {
  private queue: { id: number; at: number; fn: () => void }[] = [];
  private nextId = 1;
  now = 0;

  setTimeout = (fn: () => void, ms: number): number => {
    const id = this.nextId++;
    this.queue.push({ id, at: this.now + ms, fn });
    return id;
  };

  clearTimeout = (handle: unknown): void => {
    this.queue = this.queue.filter((t) => t.id !== handle);
  };

  get pending(): number {
    return this.queue.length;
  }

  /** Advance wall + audio time by `ms`, firing due timers in order. */
  advance(ms: number, ctx?: FakeAudioContext): void {
    const end = this.now + ms;
    for (;;) {
      this.queue.sort((a, b) => a.at - b.at);
      const next = this.queue[0];
      if (!next || next.at > end) break;
      this.queue.shift();
      if (ctx && ctx.state === 'running') ctx.currentTime += (next.at - this.now) / 1000;
      this.now = next.at;
      next.fn();
    }
    if (ctx && ctx.state === 'running') ctx.currentTime += (end - this.now) / 1000;
    this.now = end;
  }
}
