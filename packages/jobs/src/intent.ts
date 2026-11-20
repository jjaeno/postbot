import { createHash } from "node:crypto";

export const jobDomainPayload = (payload: Readonly<Record<string, unknown>>): Record<string, unknown> => Object.fromEntries(Object.entries(payload).filter(([key]) => !["_trace", "_requestIntent", "_llmAttempts", "_mediaCalls", "_providerReconciliations"].includes(key)));
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, canonical(nested)])) : value;
export function productionJobRequestIntent(input: { channelId: string | null; contentItemId?: string | null; type: string; queueName: string; runAfterDate?: Date | null; payload: Readonly<Record<string, unknown>> }): string {
  return createHash("sha256").update(JSON.stringify(canonical({ channelId: input.channelId, contentItemId: input.contentItemId ?? null, type: input.type, queueName: input.queueName, runAfter: input.runAfterDate?.toISOString() ?? null, payload: jobDomainPayload(input.payload) }))).digest("hex");
}
