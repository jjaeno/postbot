import { describe, expect, it, vi } from "vitest";
import { ElevenLabsTtsProvider, resolveTtsVoice } from "./index.js";

describe("ElevenLabsTtsProvider", () => {
  it("maps the original alignment when the normalized transcript expands a year", async () => {
    const align = (text: string) => ({ characters: [...text], character_start_times_seconds: [...text].map((_, index) => index * 0.1), character_end_times_seconds: [...text].map((_, index) => (index + 1) * 0.1) });
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ audio_base64: Buffer.from([0xff, 0xfb, 0x90, 0x64]).toString("base64"), alignment: align("2026"), normalized_alignment: align("two thousand twenty six") }));
    const result = await new ElevenLabsTtsProvider({ apiKey: "test", timeoutMs: 1000, usdPerThousandCharacters: 1, fetchImplementation }).synthesize({ text: "2026", voice: "voice", model: "model", idempotencyKey: "year" });
    expect(result.timings.map((timing) => timing.text).join("")).toBe("2026");
  });
  it("derives word timing from official character alignment", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      audio_base64: Buffer.from([0xff, 0xfb, 0x90, 0x64]).toString("base64"),
      normalized_alignment: {
        characters: ["H", "i", " ", "a", "l", "l"],
        character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
        character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]
      }
    }));
    const provider = new ElevenLabsTtsProvider({ apiKey: "key", timeoutMs: 1_000, usdPerThousandCharacters: 1, fetchImplementation });
    const result = await provider.synthesize({ text: "Hi all", voice: resolveTtsVoice("elevenlabs", "neutral-ko", "configured-voice"), model: "model", idempotencyKey: "tts-alignment" });
    expect(result.timings).toEqual([{ text: "Hi", startSeconds: 0, endSeconds: 0.2 }, { text: "all", startSeconds: 0.3, endSeconds: 0.6 }]);
    expect(result.durationSeconds).toBe(0.6);
    const request = fetchImplementation.mock.calls[0]?.[0];
    const url = typeof request === "string" ? request : request instanceof URL ? request.href : request?.url;
    expect(url).toContain("/with-timestamps");
    expect(url).toContain("/text-to-speech/configured-voice/");
  });
  it("resolves default aliases, preserves custom profiles and fails closed without a configured voice", () => {
    for (const alias of ["", "default", "neutral", "neutral-ko"]) expect(resolveTtsVoice("elevenlabs", alias, "configured")).toBe("configured");
    expect(resolveTtsVoice("elevenlabs", "custom", "configured")).toBe("custom");
    expect(resolveTtsVoice("fake", "neutral-ko", "")).toBe("neutral-ko");
    expect(() => resolveTtsVoice("elevenlabs", "neutral-ko", "")).toThrow("TTS_VOICE_CONFIGURATION_REQUIRED");
  });
});
