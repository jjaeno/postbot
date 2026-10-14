import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleImageProvider } from "./index.js";

const request = { model: "gemini-3.1-flash-lite-image", prompt: "Vertical landscape", width: 1080, height: 1920, idempotencyKey: "image-contract" };
describe("Google image REST contract", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("requests image output and records decoded dimensions instead of video canvas dimensions", async () => {
    const bytes = await sharp({ create: { width: 9, height: 16, channels: 3, background: "red" } }).png().toBuffer();
    const mock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ candidates: [{ content: { parts: [{ text: "image" }, { inlineData: { mimeType: "image/png", data: bytes.toString("base64") } }] } }] }));
    vi.stubGlobal("fetch", mock);
    const result = await new GoogleImageProvider({ apiKey: "contract-key", timeoutMs: 1000, usdPerOutput: 0.5 }).generate(request);
    expect(result).toMatchObject({ width: 9, height: 16, estimatedCostUsd: "0.500000" });
    const body = mock.mock.calls[0]?.[1]?.body;
    if (typeof body !== "string") throw new Error("EXPECTED_JSON_REQUEST");
    expect(JSON.parse(body)).toMatchObject({ generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "9:16" } } });
  });
  it.each([{ candidates: [] }, { candidates: [{ content: { parts: [{ text: "refused" }] } }] }, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AAAA" } }] } }] }, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "!bad" } }] } }] }])("rejects missing, text-only and corrupt images", async (body) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json(body)));
    await expect(new GoogleImageProvider({ apiKey: "contract-key", timeoutMs: 1000, usdPerOutput: 1 }).generate(request)).rejects.toThrow();
  });
});
