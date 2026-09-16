import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiLlmProvider } from "./index.js";

const responseBody = {
  created_at: 1_788_480_000,
  output_text: JSON.stringify({ planning: {}, script: {}, facts: [], sceneDocument: {} }),
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
    const provider = new OpenAiLlmProvider({ apiKey: "test-key", baseUrl: "https://api.openai.com/v1", timeoutMs: 1_000 });

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
    const provider = new OpenAiLlmProvider({ apiKey: "", baseUrl: "https://api.openai.com/v1", timeoutMs: 1_000 });
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
    const provider = new OpenAiLlmProvider({ apiKey: "test-key", baseUrl: "https://api.openai.com/v1", timeoutMs: 1 });

    await expect(
      provider.generateScriptAndScene({
        model: "test-model", promptVersion: "v1", idempotencyKey: "timeout-job", title: "Title", summary: "Summary",
        topic: "Topic", platform: null, partial: "full", sources: []
      })
    ).rejects.toThrow("Aborted");
  });
});
