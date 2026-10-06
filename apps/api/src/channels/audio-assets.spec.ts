import { describe, expect, it } from "vitest";
import { validateWav } from "./audio-assets.controller.js";
describe("licensed PCM WAV upload validation", () => {
  const wav = () => { const bytes = Buffer.alloc(48); bytes.write("RIFF"); bytes.writeUInt32LE(40, 4); bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(4, 40); return bytes; };
  it("accepts bounded PCM and rejects fake headers, invalid chunks and compressed formats", () => {
    expect(() => validateWav(wav())).not.toThrow();
    expect(() => validateWav(Buffer.alloc(48))).toThrow();
    const invalid = wav(); invalid.writeUInt32LE(10000, 40); expect(() => validateWav(invalid)).toThrow();
    const compressed = wav(); compressed.writeUInt16LE(3, 20); expect(() => validateWav(compressed)).toThrow();
    expect(() => validateWav(Buffer.alloc(1048577))).toThrow();
  });
});
