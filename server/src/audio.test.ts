import { describe, expect, it } from "vitest";
import { audioDurationMs, pcm16ToWav } from "./audio.js";

describe("PCM audio helpers", () => {
  it("creates a valid mono PCM WAV header", () => {
    const pcm = Buffer.alloc(32_000);
    const wav = pcm16ToWav(pcm, 16_000);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt32LE(40)).toBe(32_000);
    expect(wav).toHaveLength(32_044);
  });

  it("calculates duration from 16-bit PCM bytes", () => {
    expect(audioDurationMs(32_000, 16_000)).toBe(1000);
  });
});
