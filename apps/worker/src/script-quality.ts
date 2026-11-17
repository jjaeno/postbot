export function evaluateScriptQuality(input: { hook: string; body: string; callToAction: string; title: string; language: string; maxSeconds: number }) {
  const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const bodyWords = words(`${input.body} ${input.title}`);
  const hooks = [...new Set([input.hook, `${input.title.replace(/[.!?]+$/u, "")}?`, input.body.match(/^[^.!?]+[.!?]?/u)?.[0] ?? input.body])].slice(0, 3).map((hook) => {
    const exaggerated = /guarantee|100%|always|never fails|무조건|절대 실패|확실한 수익/iu.test(hook);
    const connected = [...words(hook)].some((word) => bodyWords.has(word));
    return { text: hook, accepted: !exaggerated && connected && hook.length <= 180, reasons: [...(exaggerated ? ["EXAGGERATION"] : []), ...(!connected ? ["BODY_CONNECTION_MISSING"] : []), ...(hook.length > 180 ? ["HOOK_TOO_LONG"] : [])] };
  });
  const speech = `${input.hook} ${input.body} ${input.callToAction}`;
  const cjk = speech.match(/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0;
  const otherWords = speech.replace(/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, " ").match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  const estimatedSeconds = cjk / (/^ko/i.test(input.language) ? 5 : 4.5) + otherWords / 2.6;
  if (!hooks[0]?.accepted) throw new Error(`HOOK_VALIDATION_FAILED_${hooks[0]?.reasons.join("_") ?? "EMPTY"}`);
  if (estimatedSeconds > input.maxSeconds * 1.25) throw new Error("NARRATION_BUDGET_EXCEEDED_SHORTEN_SCRIPT");
  return { method: "EDITORIAL_RULES_NOT_PERFORMANCE_PREDICTION", hookCandidates: hooks, selectedHookIndex: 0, estimatedSeconds, maximumSeconds: input.maxSeconds, durationMethod: "LANGUAGE_READING_HEURISTIC_ACTUAL_TTS_REQUIRED" };
}
