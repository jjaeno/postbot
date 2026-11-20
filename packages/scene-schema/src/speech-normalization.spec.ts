import { describe, expect, it } from "vitest";
import { displayTimingsFromSpeech, normalizeNarration, SpeechNormalizationSchema } from "./speech-normalization.js";
const timings = (text: string) => [...text.matchAll(/\S+/gu)].map((match, index) => ({ text: match[0], startSeconds: index, endSeconds: index + 0.9 }));
describe("speech text and display position mapping", () => {
  it.each(["ko", "en"])("maps numbers, dates, units and names without losing original %s captions", (language) => {
    const original = "2026-11-18 NASA가 3.5km, 25%와 OpenAI를 설명했다.";
    const result = normalizeNarration(original, language, { OpenAI: language === "ko" ? "오픈에이아이" : "Open A I" });
    expect(result.speech).not.toContain("2026-11-18"); expect(result.speech).not.toContain("3.5km");
    const display = displayTimingsFromSpeech(result, timings(result.speech));
    expect(display.map((entry) => entry.joiner + entry.text).join("")).toBe(original);
    for (const segment of result.segments) expect(original.slice(segment.originalStart, segment.originalEnd)).not.toBe("");
    expect(display.every((entry) => entry.endSeconds > entry.startSeconds)).toBe(true);
  });
  it("keeps proper names outside acronym boundaries and rejects unaligned or invalid dates", () => {
    expect(normalizeNarration("TRAIN NASA", "ko").speech).toBe("TRAIN 나사");
    expect(() => normalizeNarration("2026-02-30", "ko")).toThrow("DATE_INVALID");
    const result = normalizeNarration("2026년", "ko");
    expect(() => displayTimingsFromSpeech(result, timings("다른 발화"))).toThrow("ALIGNMENT");
    expect(SpeechNormalizationSchema.safeParse({ ...result, segments: [] }).success).toBe(false);
  });
});
