const TARGET_SAMPLE_RATE = 16_000;
// Two seconds gives Whisper enough speech context while keeping the first live
// segment responsive on ordinary CPU hardware.
const CHUNK_SECONDS = 2;

function downsample(input: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === TARGET_SAMPLE_RATE) return input;
  const ratio = sourceRate / TARGET_SAMPLE_RATE;
  const length = Math.round(input.length / ratio);
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(Math.floor((index + 1) * ratio), input.length);
    let sum = 0;
    for (let sample = start; sample < end; sample += 1) sum += input[sample];
    output[index] = sum / Math.max(1, end - start);
  }
  return output;
}

function floatToPcm16(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  });
  return buffer;
}

export class AudioStreamer {
  private context?: AudioContext;
  private stream?: MediaStream;
  private processor?: ScriptProcessorNode;
  private source?: MediaStreamAudioSourceNode;
  private samples: number[] = [];

  constructor(
    private readonly onChunk: (audio: ArrayBuffer) => void,
    private readonly onLevel: (level: number) => void
  ) {}

  async start(): Promise<number> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    this.context = new AudioContext();
    await this.context.resume();
    this.source = this.context.createMediaStreamSource(this.stream);
    this.processor = this.context.createScriptProcessor(4096, 1, 1);
    const silent = this.context.createGain();
    silent.gain.value = 0;
    this.processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const converted = downsample(input, this.context!.sampleRate);
      let squareSum = 0;
      converted.forEach((sample) => {
        this.samples.push(sample);
        squareSum += sample * sample;
      });
      this.onLevel(Math.min(1, Math.sqrt(squareSum / converted.length) * 5));
      const chunkSize = TARGET_SAMPLE_RATE * CHUNK_SECONDS;
      while (this.samples.length >= chunkSize) {
        const chunk = new Float32Array(this.samples.splice(0, chunkSize));
        this.onChunk(floatToPcm16(chunk));
      }
    };
    this.source.connect(this.processor);
    this.processor.connect(silent);
    silent.connect(this.context.destination);
    return TARGET_SAMPLE_RATE;
  }

  async stop(): Promise<void> {
    if (this.samples.length > TARGET_SAMPLE_RATE / 2) {
      this.onChunk(floatToPcm16(new Float32Array(this.samples)));
    }
    this.samples = [];
    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    await this.context?.close();
    this.onLevel(0);
  }
}
