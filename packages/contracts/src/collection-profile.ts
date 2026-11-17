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
    targetCandidates: z.number().int().min(1).max(100), recentTopicDays: z.number().int().min(1).max(365),
    maxPersonRepeats: z.number().int().min(1).max(20), maxEventRepeats: z.number().int().min(1).max(20), maxSubtopicRepeats: z.number().int().min(1).max(20) }).strict(),
  production: z.object({ maxEstimatedCostUsd: z.string().regex(/^\d{1,6}(?:\.\d{1,6})?$/),
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
