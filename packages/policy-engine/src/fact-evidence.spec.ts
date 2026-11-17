import { describe, expect, it } from "vitest";
import { verifyFactEvidence } from "./fact-evidence.js";

const url = "https://example.org/source";
const source = { url, text: "The rocket reached 100 km on 2026-11-17.", scope: "FULL_TEXT" as const, conflicting: false };
describe("claim-specific collected evidence", () => {
  it("passes literal evidence with numbers, units and dates", () => {
    const claim = source.text;
    expect(verifyFactEvidence([{ claim, sourceUrl: url }], [source], claim)).toMatchObject({ autoPass: true, claims: [{ status: "SUPPORTED", normalizedOffset: 0 }] });
  });
  it.each(["The rocket reached 1000 km on 2026-11-17.", "The rocket reached 100 miles on 2026-11-17.", "The rocket reached 100 km on 2026-11-18."])("holds a valid URL with unsupported claim %s", (claim) => {
    expect(verifyFactEvidence([{ claim, sourceUrl: url, evidenceQuote: source.text }], [source], claim).autoPass).toBe(false);
  });
  it("does not inherit validation for new script claims, summaries, conflicts or inferences", () => {
    const facts = [{ claim: source.text, sourceUrl: url }];
    expect(verifyFactEvidence(facts, [source], `${source.text} Another rocket reached 200 km.`).autoPass).toBe(false);
    expect(verifyFactEvidence(facts, [{ ...source, scope: "SUMMARY" }], source.text).autoPass).toBe(false);
    expect(verifyFactEvidence(facts, [{ ...source, conflicting: true }], source.text).autoPass).toBe(false);
    expect(verifyFactEvidence([{ ...facts[0]!, kind: "INFERENCE" }], [source], source.text).autoPass).toBe(false);
    expect(verifyFactEvidence(facts, [source, { ...source, url: "https://example.org/other", text: source.text.replace("100 km", "200 km") }], source.text)).toMatchObject({ autoPass: false, sourceConflict: true });
    expect(verifyFactEvidence([{ claim: "Power is 100 MW.", sourceUrl: url }], [{ ...source, text: "Power is 100 mW." }], "Power is 100 MW.").autoPass).toBe(false);
  });
});
