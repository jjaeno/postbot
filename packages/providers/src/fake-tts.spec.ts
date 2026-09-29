import { describe, expect, it } from "vitest";
import { FakeTtsProvider } from "./index.js";

describe("Fake TTS media contract", () => {
  it.each(["A short narration", ""]) ("returns PCM WAV with consistent duration for %j", async (text) => {
    const result = await new FakeTtsProvider().synthesize({ model: "fake", voice: "neutral", text, idempotencyKey: "wav-contract" });
    const audio = Buffer.from(result.bytes);
    expect(result.mimeType).toBe("audio/wav");
    expect(audio.toString("ascii", 0, 4)).toBe("RIFF");
    expect(audio.toString("ascii", 8, 16)).toBe("WAVEfmt ");
    expect(audio.readUInt32LE(4)).toBe(audio.length - 8);
    expect(audio.readUInt16LE(20)).toBe(1);
    expect(audio.readUInt16LE(22)).toBe(1);
    expect(audio.toString("ascii", 36, 40)).toBe("data");
    expect(audio.readUInt32LE(40)).toBe(audio.length - 44);
    expect((audio.length - 44) / audio.readUInt32LE(28)).toBeCloseTo(result.durationSeconds);
    expect(result.durationSeconds).toBeGreaterThan(0);
    expect(result.timings.at(-1)?.endSeconds ?? 0).toBeLessThanOrEqual(result.durationSeconds);
  });
});
