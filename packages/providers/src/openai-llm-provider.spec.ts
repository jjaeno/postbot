import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeLlmProvider, OpenAiLlmProvider } from "./index.js";
import { FakeStorageProvider } from "./index.js";

const responseBody = {
  created_at: 1_788_480_000,
  status: "completed",
  output: [{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text: JSON.stringify({ planning: {}, script: {}, facts: [], sceneDocument: {} }) }] }],
  usage: { input_tokens: 12, output_tokens: 34, total_tokens: 46 }
};

describe("OpenAiLlmProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests Responses API Structured Outputs and maps token usage", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedInit = init;
      return Promise.resolve(new Response(JSON.stringify(responseBody), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiLlmProvider({ apiKey: "test-key", baseUrl: "https://api.openai.com/v1", timeoutMs: 1_000, inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 1 });

    const result = await provider.generateScriptAndScene({
      model: "test-model", promptVersion: "v1", idempotencyKey: "job-1", title: "Title", summary: "Summary",
      topic: "Topic", platform: "YOUTUBE", partial: "full", sources: [{ title: "Title", summary: "Summary", url: "https://example.org/source" }]
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(capturedInit?.headers).toBeDefined();
    expect(new Headers(capturedInit?.headers).get("Idempotency-Key")).toBe("job-1");
    expect(typeof capturedInit?.body).toBe("string");
    const requestBody: unknown = JSON.parse(capturedInit?.body as string);
    expect(requestBody).toMatchObject({ text: { format: { type: "json_schema", strict: true } } });
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 34, totalTokens: 46 });
  });

  it("refuses OpenAI calls without an API key", async () => {
    const provider = new OpenAiLlmProvider({ apiKey: "", baseUrl: "https://api.openai.com/v1", timeoutMs: 1_000, inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 1 });
    await expect(
      provider.generateScriptAndScene({
        model: "test-model", promptVersion: "v1", idempotencyKey: "job-1", title: "Title", summary: "Summary",
        topic: "Topic", platform: null, partial: "full", sources: []
      })
    ).rejects.toThrow("OPENAI_API_KEY");
  });

  it("aborts a request when the configured timeout elapses", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiLlmProvider({ apiKey: "test-key", baseUrl: "https://api.openai.com/v1", timeoutMs: 1, inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 1 });

    await expect(
      provider.generateScriptAndScene({
        model: "test-model", promptVersion: "v1", idempotencyKey: "timeout-job", title: "Title", summary: "Summary",
        topic: "Topic", platform: null, partial: "full", sources: []
      })
    ).rejects.toThrow("Aborted");
  });
});

describe("FakeStorageProvider", () => {
  it("uploads, downloads, presigns, and deletes objects", async () => {
    const storage = new FakeStorageProvider();
    const body = new TextEncoder().encode("asset");
    const stored = await storage.upload({ key: "assets/test", body, mimeType: "text/plain" });
    await expect(storage.download(stored.key)).resolves.toEqual(body);
    await expect(storage.presignedUrl(stored.key, 60)).resolves.toContain("expiresIn=60");
    await storage.delete(stored.key);
    await expect(Promise.resolve().then(() => storage.download(stored.key))).rejects.toThrow("STORAGE_OBJECT_NOT_FOUND");
  });
});

describe("FakeLlmProvider channel context", () => {
  it("applies channel language, audience, tone, hook, CTA, and duration settings", async () => {
    const result = await new FakeLlmProvider().generateScriptAndScene({
      model: "fake-v1", promptVersion: "v1", idempotencyKey: "context-job", title: "Product update", summary: "A useful change shipped.",
      topic: "software", platform: "YOUTUBE", partial: "full", sources: [{ title: "Release", summary: "A useful change shipped.", url: "https://example.org/release" }],
      channelContext: {
        language: "ko-KR", targetAudience: "초보 창업자", tone: "차분한 설명", hookStyle: "숫자로 시작", callToActionStyle: "저장해 두세요",
        minDurationSeconds: 30, maxDurationSeconds: 50, captionStyle: "큰 자막", strategy: { emphasis: "practical" }
      }
    });
    const serialized = JSON.stringify(result.structuredOutput);
    expect(serialized).toContain("ko-KR");
    expect(serialized).toContain("초보 창업자");
    expect(serialized).toContain("차분한 설명");
    expect(serialized).toContain("숫자로 시작");
    expect(serialized).toContain("저장해 두세요");
    expect(serialized).toContain('"durationSeconds":40');
  });
});
