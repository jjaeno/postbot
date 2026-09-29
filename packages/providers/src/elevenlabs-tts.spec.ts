import { describe, expect, it, vi } from "vitest";
import { ElevenLabsTtsProvider } from "./index.js";

describe("ElevenLabsTtsProvider", () => {
  it("derives word timing from official character alignment", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      audio_base64: Buffer.from("audio").toString("base64"),
      normalized_alignment: {
        characters: ["H", "i", " ", "a", "l", "l"],
        character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
        character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]
      }
    }));
    const provider = new ElevenLabsTtsProvider({ apiKey: "key", timeoutMs: 1_000, fetchImplementation });
    const result = await provider.synthesize({ text: "Hi all", voice: "voice", model: "model", idempotencyKey: "tts-alignment" });
    expect(result.timings).toEqual([{ text: "Hi", startSeconds: 0, endSeconds: 0.2 }, { text: "all", startSeconds: 0.3, endSeconds: 0.6 }]);
    expect(result.durationSeconds).toBe(0.6);
    const request = fetchImplementation.mock.calls[0]?.[0];
    const url = typeof request === "string" ? request : request instanceof URL ? request.href : request?.url;
    expect(url).toContain("/with-timestamps");
  });
});
