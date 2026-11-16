import { createHash } from "node:crypto";

export type FactClaim = { claim: string; sourceUrl: string; kind?: "FACT" | "ASSUMPTION" | "INFERENCE"; evidenceQuote?: string };
export type EvidenceSource = { url: string; text: string; scope: "FULL_TEXT" | "SUMMARY" | "UNKNOWN"; conflicting: boolean };
const normalized = (value: string): string => value.normalize("NFKC").replace(/\s+/gu, " ").trim();
export const scriptEvidenceFingerprint = (text: string): string => createHash("sha256").update(normalized(text)).digest("hex");

// This proves fidelity to the collected text, not independent real-world truth.
// Only literal support is auto-approved; semantic entailment needs human review.
export function verifyFactEvidence(claims: readonly FactClaim[], sources: readonly EvidenceSource[], scriptText: string) {
  const results = claims.map((claim) => {
    const source = sources.find((item) => item.url === claim.sourceUrl);
    const quote = claim.evidenceQuote ?? claim.claim;
    const location = source ? normalized(source.text).indexOf(normalized(quote)) : -1;
    const numbers = (text: string): string[] => text.match(/\d+(?:[.,]\d+)*/g) ?? [];
    const numericMatch = numbers(claim.claim).every((value) => numbers(quote).includes(value));
    const reason = claim.kind && claim.kind !== "FACT" ? "ASSUMPTION_OR_INFERENCE_REQUIRES_REVIEW"
      : !source ? "SOURCE_NOT_COLLECTED" : source.conflicting ? "SOURCE_CONFLICT"
      : source.scope !== "FULL_TEXT" ? "ORIGINAL_TEXT_REQUIRED"
      : location < 0 ? "QUOTE_NOT_FOUND" : !numericMatch ? "NUMERIC_MISMATCH" : !normalized(quote).includes(normalized(claim.claim)) ? "CLAIM_NOT_SUPPORTED_BY_QUOTE" : null;
    return { ...claim, evidenceQuote: quote, scope: source?.scope ?? "UNKNOWN", normalizedOffset: location < 0 ? null : location, status: reason ? "REVIEW_REQUIRED" : "SUPPORTED", reason };
  });
  const numericStatements = sources.flatMap((source) => source.text.split(/(?<=[.!?。！？])\s+|\n+/u).filter((text) => /\d/.test(text)).map((text) => ({ source: source.url, text: normalized(text), shape: normalized(text).replace(/\d+(?:[.,]\d+)*/g, "<number>") })));
  const sourceConflict = sources.some((source) => source.conflicting) || numericStatements.some((left) => numericStatements.some((right) => left.source !== right.source && left.shape === right.shape && left.text !== right.text));
  const scriptStatements = scriptText.split(/(?<=[.!?。！？])\s+|\n+/u).map((text) => text.trim()).filter(Boolean)
    .filter((text) => !/[?？]$/.test(text) && !/^(?:check |learn |follow |subscribe |share |확인|구독|공유)/i.test(text));
  const statementEvidence = scriptStatements.map((text) => {
    const statement = normalized(text.replace(/^a verified source reports:\s*/i, ""));
    const linked = results.find((result) => result.status === "SUPPORTED" && normalized(result.claim).includes(statement));
    const direct = sources.find((source) => source.scope === "FULL_TEXT" && !source.conflicting && normalized(source.text).includes(statement));
    return { text, sourceUrl: linked?.sourceUrl ?? direct?.url ?? null, normalizedOffset: direct ? normalized(direct.text).indexOf(statement) : linked?.normalizedOffset ?? null };
  });
  const unsupported = statementEvidence.filter((statement) => statement.sourceUrl === null).map((statement) => statement.text);
  return { version: "literal-evidence-v1", fingerprint: scriptEvidenceFingerprint(scriptText), method: "COLLECTED_TEXT_FIDELITY", autoPass: results.length > 0 && results.every((result) => result.status === "SUPPORTED") && unsupported.length === 0 && !sourceConflict, claims: results, statementEvidence, unsupportedStatements: unsupported, sourceConflict };
}
