import { createHash } from "node:crypto";
import { canonicalizeTopicUrl } from "./topic-scoring.js";
export const sourceRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
export const sourceDigest = (value: unknown): string => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
export function sourceEvidenceSnapshot(value: unknown): Record<string, unknown> {
  const record = sourceRecord(value);
  return Object.fromEntries(["body", "contentScope", "collectedAt", "eventAt", "reliability", "evidence", "visualReferences", "eventClusterKey", "clusterMethod", "question", "angle"].filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));
}
export function sourceObservation(input: { url: string; title: string; summary: string; sourceName: string; sourceKind: string; snapshot: unknown }) {
  const snapshot = sourceEvidenceSnapshot(input.snapshot); const reliability = sourceRecord(snapshot.reliability);
  const body = typeof snapshot.body === "string" ? snapshot.body : "";
  const fingerprint = createHash("sha256").update(body.normalize("NFKC")).digest("hex");
  const rawFingerprint = createHash("sha256").update(body).digest("hex");
  const contentScope = reliability.evidenceFailure || reliability.fingerprint && reliability.fingerprint !== fingerprint && reliability.fingerprint !== rawFingerprint || !body.trim() ? "SUMMARY" : snapshot.contentScope ?? "UNKNOWN";
  const url = canonicalizeTopicUrl(input.url);
  const id = sourceDigest({ url, title: input.title, summary: input.summary, fingerprint, contentScope, evidence: snapshot.evidence ?? [], visualReferences: snapshot.visualReferences ?? null, mediaRights: reliability.mediaRights ?? null, evidenceFailure: reliability.evidenceFailure ?? null, conflict: reliability.researchState === "CONFLICTING_EVIDENCE" || reliability.claimVerification === "CONFLICTING_EVIDENCE" });
  return { id, fingerprint, url, title: input.title, summary: input.summary, sourceName: input.sourceName, sourceKind: input.sourceKind, snapshot: { ...snapshot, contentScope }, observedAt: new Date().toISOString() };
}
