import { z } from "zod";

const host = z.string().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i);
const terms = z.array(z.string().trim().min(1).max(200)).max(40);
export const ChannelCollectionProfileSchema = z.object({
  version: z.literal("collection-profile-v1"),
  audience: z.string().max(500), language: z.string().min(2).max(16), region: z.string().regex(/^[A-Z]{2}$/).nullable(),
  subtopics: terms.min(1), exclusions: terms, storyStyles: terms,
  freshness: z.enum(["NEWS", "EVERGREEN", "MIXED"]),
  sources: z.object({ rssUrls: z.array(z.string().url()).max(20), youtubeQueries: terms,
    youtubeChannelIds: z.array(z.string().regex(/^UC[\w-]{22}$/)).max(20),
    collections: z.array(z.enum(["LOC", "NASA"])).max(2), evidenceHosts: z.array(host).max(40) }).strict(),
  cadence: z.object({ collectMinutes: z.number().int().min(30).max(10080), selectMinutes: z.number().int().min(5).max(10080),
    produceMinutes: z.number().int().min(5).max(10080) }).strict(),
  limits: z.object({ dailyCalls: z.number().int().min(1).max(10000), pagesPerSource: z.number().int().min(1).max(5),
    cacheMinutes: z.number().int().min(5).max(1440), retentionDays: z.number().int().min(1).max(30),
    targetCandidates: z.number().int().min(1).max(100), processingCandidates: z.number().int().min(20).max(400).optional(), recentTopicDays: z.number().int().min(1).max(365),
    maxPersonRepeats: z.number().int().min(1).max(20), maxEventRepeats: z.number().int().min(1).max(20), maxSubtopicRepeats: z.number().int().min(1).max(20) }).strict(),
  production: z.object({ maxEstimatedCostUsd: z.string().regex(/^\d{1,6}(?:\.\d{1,6})?$/),
    producerConcurrency: z.number().int().min(1).max(10).default(1), reviewCap: z.number().int().min(1).max(100).default(5),
    scheduledBufferHours: z.number().int().min(0).max(168).default(24),
    missedPublishPolicy: z.enum(["IMMEDIATE", "NEXT_SLOT", "REVIEW"]).default("REVIEW"), missedPublishGraceMinutes: z.number().int().min(1).max(1440).default(15),
    minSeconds: z.number().int().min(15).max(180), maxSeconds: z.number().int().min(15).max(180),
    requireVisualEvidence: z.boolean() }).strict()
}).strict().refine((p) => p.production.minSeconds <= p.production.maxSeconds, { message: "PROFILE_DURATION_INVALID" });
export type ChannelCollectionProfile = z.infer<typeof ChannelCollectionProfileSchema>;

// Editable starting points, never inferred from a channel's name.
export const collectionProfilePreset = (kind: "HISTORY" | "SCIENCE" | "IT", language: string): ChannelCollectionProfile => ChannelCollectionProfileSchema.parse({
  version: "collection-profile-v1", audience: "", language, region: null,
  subtopics: kind === "HISTORY" ? ["history", "artifacts"] : kind === "SCIENCE" ? ["space", "science"] : ["software", "technology"],
  exclusions: [], storyStyles: ["question", "explanation"], freshness: kind === "IT" ? "NEWS" : "EVERGREEN",
  sources: { rssUrls: [], youtubeQueries: [], youtubeChannelIds: [], collections: kind === "HISTORY" ? ["LOC"] : kind === "SCIENCE" ? ["NASA"] : [],
    evidenceHosts: kind === "HISTORY" ? ["loc.gov"] : kind === "SCIENCE" ? ["nasa.gov"] : [] },
  cadence: { collectMinutes: 360, selectMinutes: 60, produceMinutes: 120 },
  limits: { dailyCalls: 100, pagesPerSource: 2, cacheMinutes: 60, retentionDays: 7, targetCandidates: 20, recentTopicDays: 30, maxPersonRepeats: 2, maxEventRepeats: 1, maxSubtopicRepeats: 4 },
  production: { maxEstimatedCostUsd: "1.00", minSeconds: 30, maxSeconds: 60, requireVisualEvidence: true }
});
export const ResearchQuestionInputSchema = z.object({ question: z.string().trim().min(5).max(1000), subtopic: z.string().trim().min(1).max(200), origin: z.enum(["AUDIENCE", "EDITORIAL", "AI_HYPOTHESIS"]), idempotencyKey: z.string().min(1).max(120) }).strict();

export function hasHttpsVisualReference(value: unknown): boolean {
  const record = (input: unknown): Record<string, unknown> => input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const snapshot = record(value); const media = record(snapshot.visualReferences ?? record(snapshot.reliability).media);
  return normalizeMediaReferences(media.references).some((reference) => reference.kind === "IMAGE_PREVIEW");
}

export type MediaReference = { url: string; kind: "IMAGE_PREVIEW" | "DETAIL_PAGE" | "API_RESPONSE"; rights: "ITEM_REVIEW_REQUIRED"; downloadable: "UNKNOWN"; commercialUse: "UNKNOWN" };
// A preview is a research reference, never permission to download or publish it.
export function normalizeMediaReferences(value: unknown): MediaReference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((input): MediaReference[] => {
    const item = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const raw = typeof input === "string" ? input : item.url ?? item.href;
    if (typeof raw !== "string") return [];
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return [];
      const api = /(?:^|\.)images-api\.nasa\.gov$/i.test(url.hostname) || /\.(?:json|xml)$/i.test(url.pathname) || url.searchParams.has("fo");
      const explicitlyNonImage = item.render !== undefined && item.render !== "image" || item.kind === "DETAIL_PAGE" || item.kind === "API_RESPONSE";
      const image = !api && !explicitlyNonImage && (item.kind === "IMAGE_PREVIEW" || item.render === "image" && item.rel === "preview" || /\.(?:jpe?g|png|webp|gif|avif|tiff?)(?:$|\/)/i.test(url.pathname));
      return [{ url: url.href, kind: api ? "API_RESPONSE" : image ? "IMAGE_PREVIEW" : "DETAIL_PAGE", rights: "ITEM_REVIEW_REQUIRED", downloadable: "UNKNOWN", commercialUse: "UNKNOWN" }];
    } catch { return []; }
  });
}
