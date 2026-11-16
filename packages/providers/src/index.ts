export { canonicalizeTopicUrl, scoreTopicCandidate } from "./topic-scoring.js";

export interface ProviderResult {
  readonly provider: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

export type AnalyticsMetric = "views" | "impressions" | "reach" | "average_view_ratio" | "average_watch_seconds" | "completion_rate" | "engagement_rate";
export type AnalyticsMetricValue = { metric: AnalyticsMetric; value: number | null; unit: "count" | "seconds" | "ratio" | null; aggregation: "sum" | "average" | "ratio" | null; unavailableReason: string | null };
export type AnalyticsObservation = { kind: "PERIOD_TOTAL" | "LIFETIME_SNAPSHOT"; periodStart?: string; periodEnd?: string };
export type AnalyticsPostResult = { observation?: AnalyticsObservation; externalPostId: string; observedAt: string; raw: Record<string, unknown>; metrics: readonly AnalyticsMetricValue[] };
export type AnalyticsPage = { posts: readonly AnalyticsPostResult[]; nextPageToken: string | null; dataDelayHours: number | null };
export interface AnalyticsProvider { fetchPage(input: { platform: "YOUTUBE" | "INSTAGRAM" | "TIKTOK"; postIds: readonly string[]; periodStart: string; periodEnd: string; pageToken: string | null }): Promise<AnalyticsPage>; }

export class FakeAnalyticsProvider implements AnalyticsProvider {
  fetchPage(input: { platform: "YOUTUBE" | "INSTAGRAM" | "TIKTOK"; postIds: readonly string[]; periodStart: string; periodEnd: string; pageToken: string | null }): Promise<AnalyticsPage> {
    const posts = input.postIds.slice(Number(input.pageToken ?? 0), Number(input.pageToken ?? 0) + 1).map((externalPostId, index) => ({ externalPostId, observedAt: new Date().toISOString(), observation: { kind: "PERIOD_TOTAL" as const, periodStart: input.periodStart, periodEnd: input.periodEnd }, raw: { platform: input.platform, periodStart: input.periodStart, page: input.pageToken ?? "first" }, metrics: [
      { metric: "views" as const, value: 100 + index, unit: "count" as const, aggregation: "sum" as const, unavailableReason: null },
      { metric: "average_watch_seconds" as const, value: 12.5, unit: "seconds" as const, aggregation: "average" as const, unavailableReason: null },
      { metric: "completion_rate" as const, value: null, unit: null, aggregation: null, unavailableReason: "NOT_PROVIDED_BY_PLATFORM" }
    ] }));
    return Promise.resolve({ posts, nextPageToken: Number(input.pageToken ?? 0) + 1 >= input.postIds.length ? null : String(Number(input.pageToken ?? 0) + 1), dataDelayHours: 24 });
  }
}

type AnalyticsHttpOptions = { readonly accessToken: string; readonly timeoutMs?: number; readonly fetchImplementation?: typeof fetch; readonly graphVersion?: string };

const analyticsFetchJson = async <Body>(url: string, options: AnalyticsHttpOptions, init: RequestInit = {}): Promise<Body> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  try {
    const response = await (options.fetchImplementation ?? fetch)(url, { ...init, headers: { authorization: `Bearer ${options.accessToken}`, ...init.headers }, signal: controller.signal });
    if (response.status === 429) throw new Error("PROVIDER_RATE_LIMITED");
    if (response.status === 401) throw new Error("OAUTH_ACCESS_TOKEN_EXPIRED");
    if (!response.ok) throw new Error(`Analytics provider request failed with status ${response.status}.`);
    return await response.json() as Body;
  } finally { clearTimeout(timeout); }
};

const unavailableMetric = (metric: AnalyticsMetric, reason: string): AnalyticsMetricValue => ({ metric, value: null, unit: null, aggregation: null, unavailableReason: reason });

// YouTube report days are Pacific calendar days, including DST transitions.
const pacificMidnight = (date: string): string => {
  const target = new Date(`${date}T00:00:00.000Z`).getTime();
  let instant = target;
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (let pass = 0; pass < 3; pass++) {
    const parts = Object.fromEntries(format.formatToParts(instant).map((part) => [part.type, part.value]));
    const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    instant += target - local;
  }
  return new Date(instant).toISOString();
};

export class YouTubeAnalyticsProvider implements AnalyticsProvider {
  constructor(private readonly options: AnalyticsHttpOptions) {}

  async fetchPage(input: Parameters<AnalyticsProvider["fetchPage"]>[0]): Promise<AnalyticsPage> {
    if (input.pageToken || input.postIds.length === 0) return { posts: [], nextPageToken: null, dataDelayHours: 72 };
    const url = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
    url.searchParams.set("ids", "channel==MINE");
    url.searchParams.set("startDate", input.periodStart.slice(0, 10));
    url.searchParams.set("endDate", input.periodEnd.slice(0, 10));
    url.searchParams.set("metrics", "views,averageViewDuration,averageViewPercentage");
    url.searchParams.set("dimensions", "video");
    url.searchParams.set("filters", `video==${input.postIds.join(",")}`);
    const raw = await analyticsFetchJson<{ columnHeaders?: Array<{ name?: string }>; rows?: Array<Array<string | number>> }>(url.toString(), this.options);
    const headers = raw.columnHeaders?.map((header) => header.name ?? "") ?? [];
    const index = (name: string): number => headers.indexOf(name);
    const observedAt = new Date().toISOString();
    const rows = new Map((raw.rows ?? []).map((row) => [String(row[index("video")]), row]));
    const posts = input.postIds.map((externalPostId): AnalyticsPostResult => {
      const row = rows.get(externalPostId);
      const number = (name: string): number | null => row && index(name) >= 0 && Number.isFinite(Number(row[index(name)])) ? Number(row[index(name)]) : null;
      const views = number("views");
      const averageSeconds = number("averageViewDuration");
      const completion = number("averageViewPercentage");
      return { externalPostId, observedAt, observation: { kind: "PERIOD_TOTAL", periodStart: pacificMidnight(input.periodStart.slice(0, 10)), periodEnd: pacificMidnight(new Date(new Date(`${input.periodEnd.slice(0, 10)}T00:00:00.000Z`).getTime() + 86_400_000).toISOString().slice(0, 10)) }, raw: { headers, row: row ?? null }, metrics: [
        views === null ? unavailableMetric("views", "NOT_RETURNED_BY_YOUTUBE") : { metric: "views", value: views, unit: "count", aggregation: "sum", unavailableReason: null },
        averageSeconds === null ? unavailableMetric("average_watch_seconds", "NOT_RETURNED_BY_YOUTUBE") : { metric: "average_watch_seconds", value: averageSeconds, unit: "seconds", aggregation: "average", unavailableReason: null },
        completion === null ? unavailableMetric("average_view_ratio", "NOT_RETURNED_BY_YOUTUBE") : { metric: "average_view_ratio", value: completion / 100, unit: "ratio", aggregation: "ratio", unavailableReason: null },
        unavailableMetric("completion_rate", "NOT_PROVIDED_BY_YOUTUBE"), unavailableMetric("impressions", "REQUIRES_SEPARATE_YOUTUBE_REPORT"), unavailableMetric("engagement_rate", "PLATFORM_METRIC_NOT_EQUIVALENT")
      ] };
    });
    return { posts, nextPageToken: null, dataDelayHours: 72 };
  }
}

export class InstagramAnalyticsProvider implements AnalyticsProvider {
  constructor(private readonly options: AnalyticsHttpOptions) {}

  async fetchPage(input: Parameters<AnalyticsProvider["fetchPage"]>[0]): Promise<AnalyticsPage> {
    if (input.pageToken) return { posts: [], nextPageToken: null, dataDelayHours: 24 };
    const posts = await Promise.all(input.postIds.map(async (externalPostId): Promise<AnalyticsPostResult> => {
      const url = new URL(`https://graph.instagram.com/${this.options.graphVersion ?? "v24.0"}/${encodeURIComponent(externalPostId)}/insights`);
      url.searchParams.set("metric", "views,reach,total_interactions,ig_reels_avg_watch_time");
      const raw = await analyticsFetchJson<{ data?: Array<{ name?: string; values?: Array<{ value?: number }>; total_value?: { value?: number } }> }>(url.toString(), this.options);
      const values = new Map((raw.data ?? []).map((entry) => [entry.name ?? "", entry.values?.[0]?.value ?? entry.total_value?.value ?? null]));
      const metric = (name: string): number | null => typeof values.get(name) === "number" ? values.get(name) as number : null;
      const views = metric("views"); const reach = metric("reach"); const interactions = metric("total_interactions"); const watchMs = metric("ig_reels_avg_watch_time");
      return { externalPostId, observedAt: new Date().toISOString(), observation: { kind: "LIFETIME_SNAPSHOT" }, raw, metrics: [
        views === null ? unavailableMetric("views", "NOT_RETURNED_BY_INSTAGRAM") : { metric: "views", value: views, unit: "count", aggregation: "sum", unavailableReason: null },
        unavailableMetric("impressions", "NOT_PROVIDED_BY_INSTAGRAM"),
        reach === null ? unavailableMetric("reach", "NOT_RETURNED_BY_INSTAGRAM") : { metric: "reach", value: reach, unit: "count", aggregation: "sum", unavailableReason: null },
        watchMs === null ? unavailableMetric("average_watch_seconds", "NOT_RETURNED_BY_INSTAGRAM") : { metric: "average_watch_seconds", value: watchMs / 1_000, unit: "seconds", aggregation: "average", unavailableReason: null },
        reach && interactions !== null ? { metric: "engagement_rate", value: interactions / reach, unit: "ratio", aggregation: "ratio", unavailableReason: null } : unavailableMetric("engagement_rate", reach === 0 ? "ZERO_DENOMINATOR" : "REACH_OR_INTERACTIONS_UNAVAILABLE"),
        unavailableMetric("completion_rate", "NOT_PROVIDED_BY_INSTAGRAM")
      ] };
    }));
    return { posts, nextPageToken: null, dataDelayHours: 24 };
  }
}

export class TikTokAnalyticsProvider implements AnalyticsProvider {
  constructor(private readonly options: AnalyticsHttpOptions) {}

  async fetchPage(input: Parameters<AnalyticsProvider["fetchPage"]>[0]): Promise<AnalyticsPage> {
    if (input.pageToken || input.postIds.length === 0) return { posts: [], nextPageToken: null, dataDelayHours: 24 };
    const raw = await analyticsFetchJson<{ data?: { videos?: Array<{ id?: string; view_count?: number; like_count?: number; comment_count?: number; share_count?: number }> }; error?: { code?: string } }>("https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count", this.options, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filters: { video_ids: input.postIds } }) });
    if (raw.error?.code && raw.error.code !== "ok") throw new Error(`TikTok analytics failed: ${raw.error.code}.`);
    const rows = new Map((raw.data?.videos ?? []).flatMap((video) => video.id ? [[video.id, video] as const] : []));
    const posts = input.postIds.map((externalPostId): AnalyticsPostResult => {
      const video = rows.get(externalPostId); const views = video?.view_count;
      const engagement = views && video ? ((video.like_count ?? 0) + (video.comment_count ?? 0) + (video.share_count ?? 0)) / views : null;
      return { externalPostId, observedAt: new Date().toISOString(), observation: { kind: "LIFETIME_SNAPSHOT" }, raw: video ? { ...video } : {}, metrics: [
        typeof views === "number" ? { metric: "views", value: views, unit: "count", aggregation: "sum", unavailableReason: null } : unavailableMetric("views", "NOT_RETURNED_BY_TIKTOK"),
        engagement === null ? unavailableMetric("engagement_rate", views === 0 ? "ZERO_DENOMINATOR" : "VIEWS_UNAVAILABLE") : { metric: "engagement_rate", value: engagement, unit: "ratio", aggregation: "ratio", unavailableReason: null },
        unavailableMetric("impressions", "NOT_PROVIDED_BY_TIKTOK"), unavailableMetric("average_watch_seconds", "NOT_PROVIDED_BY_TIKTOK"), unavailableMetric("completion_rate", "NOT_PROVIDED_BY_TIKTOK")
      ] };
    });
    return { posts, nextPageToken: null, dataDelayHours: 24 };
  }
}

export type TopicSourceKind = "NEWS" | "OFFICIAL" | "PAPER" | "RSS" | "PUBLIC_DATA" | "MANUAL";

export type TopicSourceCandidate = {
  readonly title: string;
  readonly summary: string;
  readonly url: string;
  readonly sourceName: string;
  readonly sourceKind: TopicSourceKind;
  readonly publishedAt: string | null;
  readonly eventAt?: string | null;
  readonly body: string;
  readonly reliabilityScore: number;
  readonly contentHash?: string;
  readonly reliabilityMetadata?: Readonly<Record<string, unknown>>;
};

export type TopicSourceRequest = {
  readonly channelId: string;
  readonly topic: string;
  readonly keywords: readonly string[];
  readonly allowedSources: readonly string[];
  readonly excludedSources: readonly string[];
  readonly recencyHours: number;
  readonly idempotencyKey: string;
};

export type TopicSourceResult = ProviderResult & {
  readonly candidates: readonly TopicSourceCandidate[];
};

export interface TopicSourceProvider {
  collect(request: TopicSourceRequest): Promise<TopicSourceResult>;
}

const fixtureCandidates: readonly TopicSourceCandidate[] = [
  {
    title: "Reusable rocket test reaches new altitude",
    summary: "A public aerospace test reported improved reusable booster recovery performance.",
    url: "https://example.org/science/reusable-rocket-test?utm_source=fixture",
    sourceName: "Example Science",
    sourceKind: "RSS",
    publishedAt: "2026-08-30T00:00:00.000Z",
    body: "Reusable rocket test reaches new altitude with verified public telemetry and recovery footage. A public aerospace test reported improved reusable booster recovery performance.",
    reliabilityMetadata: { contentScope: "FULL_TEXT", fixture: true },
    reliabilityScore: 0.82
  },
  {
    title: "Ocean sensor network publishes open climate data",
    summary: "A research group released public ocean sensor data for short-form explainers.",
    url: "https://public.example.org/ocean/sensor-network",
    sourceName: "Public Research Data",
    sourceKind: "PUBLIC_DATA",
    publishedAt: "2026-08-29T00:00:00.000Z",
    body: "Ocean sensor network publishes open climate data with methodology notes and public license metadata. A research group released public ocean sensor data for short-form explainers.",
    reliabilityMetadata: { contentScope: "FULL_TEXT", fixture: true },
    reliabilityScore: 0.88
  },
  {
    title: "Medical investment rumor should be filtered",
    summary: "A fixture item intentionally includes excluded health and finance terms.",
    url: "https://example.org/rumor/medical-investment",
    sourceName: "Filtered Fixture",
    sourceKind: "NEWS",
    publishedAt: "2026-08-30T00:00:00.000Z",
    body: "Medical investment rumor combines health advice and finance speculation.",
    reliabilityScore: 0.2
  }
];

const sourceAllowed = (
  candidate: TopicSourceCandidate,
  allowedSources: readonly string[],
  excludedSources: readonly string[]
): boolean => {
  const hostname = new URL(candidate.url).hostname;
  if (excludedSources.some((source) => candidate.url.startsWith(source) || hostname === source)) {
    return false;
  }
  return allowedSources.length === 0 || allowedSources.some((source) => candidate.url.startsWith(source) || hostname === source);
};

export class FixtureTopicSourceProvider implements TopicSourceProvider {
  constructor(private readonly candidates: readonly TopicSourceCandidate[] = fixtureCandidates) {}

  collect(request: TopicSourceRequest): Promise<TopicSourceResult> {
    if (request.keywords.includes("fixture-source-failure")) {
      return Promise.reject(new Error("Fixture source failure."));
    }
    const lowerTerms = [request.topic, ...request.keywords].map((term) => term.toLowerCase());
    const candidates = this.candidates.filter((candidate) => {
      const haystack = `${candidate.title} ${candidate.summary} ${candidate.body}`.toLowerCase();
      return lowerTerms.some((term) => haystack.includes(term)) && sourceAllowed(candidate, request.allowedSources, request.excludedSources);
    });
    return Promise.resolve({
      provider: "fixture-topic-source",
      idempotencyKey: request.idempotencyKey,
      createdAt: new Date().toISOString(),
      candidates
    });
  }
}

type RssTopicSourceProviderOptions = {
  readonly feedUrls: readonly string[];
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly fetchImplementation?: typeof fetch;
  readonly now?: () => Date;
};

const decodeXml = (value: string): string => value
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/\s+/g, " ")
  .trim();

const firstXmlValue = (xml: string, names: readonly string[]): string | null => {
  for (const name of names) {
    const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i").exec(xml);
    if (match?.[1]) return decodeXml(match[1]);
  }
  return null;
};

const rssLink = (xml: string, baseUrl: string): string | null => {
  const atom = /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i.exec(xml)?.[1];
  const raw = atom ?? firstXmlValue(xml, ["link", "guid"]);
  if (!raw) return null;
  try { return new URL(raw, baseUrl).toString(); } catch { return null; }
};

const sha256Text = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
};

export class RssTopicSourceProvider implements TopicSourceProvider {
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: RssTopicSourceProviderOptions) {
    if (options.feedUrls.length === 0) throw new Error("At least one RSS feed URL is required.");
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async collect(request: TopicSourceRequest): Promise<TopicSourceResult> {
    const feeds = this.options.feedUrls.filter((url) => {
      try {
        const parsed = new URL(url);
        return parsed.protocol === "https:" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      } catch { return false; }
    });
    const settled = await Promise.allSettled(feeds.map((url) => this.collectFeed(url, request)));
    const candidates = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    if (settled.length > 0 && settled.every((result) => result.status === "rejected")) {
      throw new Error("All configured RSS feeds failed.");
    }
    const unique = new Map<string, TopicSourceCandidate>();
    for (const candidate of candidates) {
      const key = candidate.contentHash ?? candidate.url;
      if (!unique.has(key)) unique.set(key, candidate);
    }
    return { provider: "rss-topic-source", idempotencyKey: request.idempotencyKey, createdAt: this.now().toISOString(), candidates: [...unique.values()] };
  }

  private async collectFeed(feedUrl: string, request: TopicSourceRequest): Promise<TopicSourceCandidate[]> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImplementation(feedUrl, { headers: { accept: "application/atom+xml, application/rss+xml, application/xml, text/xml" }, signal: controller.signal });
        if (!response.ok) throw new Error(`RSS request failed with status ${response.status}.`);
        return this.parse(await response.text(), feedUrl, request);
      } catch (error) {
        lastError = error;
        if (attempt < this.maxRetries) await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, 100 * 2 ** attempt)));
      } finally { clearTimeout(timeout); }
    }
    throw lastError instanceof Error ? lastError : new Error("RSS request failed.");
  }

  private async parse(xml: string, feedUrl: string, request: TopicSourceRequest): Promise<TopicSourceCandidate[]> {
    const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((match) => match[2] ?? "");
    const feedName = firstXmlValue(xml, ["title"]) ?? new URL(feedUrl).hostname;
    const terms = [request.topic, ...request.keywords].map((term) => term.trim().toLowerCase()).filter(Boolean);
    const cutoff = this.now().getTime() - request.recencyHours * 3_600_000;
    const results: TopicSourceCandidate[] = [];
    for (const block of blocks) {
      const title = firstXmlValue(block, ["title"]);
      const url = rssLink(block, feedUrl);
      if (!title || !url) continue;
      const summary = firstXmlValue(block, ["description", "summary"]) ?? "";
      const body = firstXmlValue(block, ["content:encoded", "content", "description", "summary"]) ?? summary;
      const publishedRaw = firstXmlValue(block, ["pubDate", "published", "updated", "dc:date"]);
      const published = publishedRaw ? new Date(publishedRaw) : null;
      if (published && (Number.isNaN(published.getTime()) || published.getTime() < cutoff)) continue;
      const haystack = `${title} ${summary} ${body}`.toLowerCase();
      if (terms.length > 0 && !terms.some((term) => haystack.includes(term))) continue;
      const candidate: TopicSourceCandidate = {
        title, summary, body, url, sourceName: feedName, sourceKind: "RSS",
        publishedAt: published?.toISOString() ?? null,
        eventAt: published?.toISOString() ?? null,
        reliabilityScore: request.allowedSources.length > 0 ? 0.9 : 0.75,
        contentHash: await sha256Text(`${title}\n${summary}\n${body}`.toLowerCase().trim()),
        reliabilityMetadata: { transport: "https", contentScope: "SUMMARY", feedUrl, allowlisted: request.allowedSources.length > 0 }
      };
      if (sourceAllowed(candidate, request.allowedSources, request.excludedSources)) results.push(candidate);
    }
    return results;
  }
}

export type LlmGenerationSource = {
  readonly title: string;
  readonly url: string;
  readonly summary: string;
};

export type LlmGenerationRequest = {
  readonly maxOutputTokens?: number;
  readonly model: string;
  readonly promptVersion: string;
  readonly idempotencyKey: string;
  readonly title: string;
  readonly summary: string;
  readonly topic: string;
  readonly platform: "YOUTUBE" | "INSTAGRAM" | "TIKTOK" | null;
  readonly sources: readonly LlmGenerationSource[];
  readonly partial: "full" | "hook" | "body" | "metadata" | "scene" | "voice" | "subtitle";
  readonly channelContext?: {
    readonly language: string;
    readonly targetAudience: string | null;
    readonly tone: string | null;
    readonly hookStyle: string | null;
    readonly callToActionStyle: string | null;
    readonly minDurationSeconds: number | null;
    readonly maxDurationSeconds: number | null;
    readonly captionStyle: string | null;
    readonly voiceProfile?: string | null;
    readonly visualStyle?: Readonly<Record<string, unknown>>;
    readonly strategy: Readonly<Record<string, unknown>> | null;
  };
};

export type LlmTokenUsage = {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
};

export type LlmGenerationResult = ProviderResult & {
  readonly model: string;
  readonly promptVersion: string;
  readonly structuredOutput: unknown;
  readonly usage: LlmTokenUsage;
  readonly estimatedCostUsd: string;
};

export interface LlmProvider {
  generateScriptAndScene(request: LlmGenerationRequest): Promise<LlmGenerationResult>;
}

const fakeStructuredOutput = (request: LlmGenerationRequest): Record<string, unknown> => {
  const source = request.sources[0];
  if (!source) {
    return { error: "missing source" };
  }
  const context = request.channelContext;
  const minimum = context?.minDurationSeconds ?? 45;
  const maximum = context?.maxDurationSeconds ?? 45;
  const strategyDuration = context?.strategy?.durationSeconds;
  const durationSeconds = Math.max(1, Math.round(typeof strategyDuration === "number" ? Math.max(minimum, Math.min(maximum, strategyDuration)) : (minimum + maximum) / 2));
  const hook = context?.hookStyle ? `${context.hookStyle}: ${request.title}` : `What changed in ${request.title}?`;
  const callToAction = context?.callToActionStyle ?? "Check the source before sharing.";
  return {
    planning: {
      title: request.title,
      summary: request.summary,
      metadata: {
        description: `${context?.tone ? `${context.tone}. ` : ""}AI generated explainer for ${context?.targetAudience ?? "a general audience"}. ${request.summary}\n\nSource: ${source.url}`,
        hashtags: ["postbot", "shorts", request.topic.toLowerCase().replaceAll(" ", "-").slice(0, 40)]
      }
    },
    script: {
      hook,
      body: `A verified source reports: ${request.summary}`,
      callToAction,
      language: context?.language ?? "en",
      durationSeconds
    },
    facts: [
      {
        claim: request.summary,
        sourceUrl: source.url
      }
    ],
    sceneDocument: {
      schemaVersion: "1.0.0",
      title: request.title,
      width: 1080,
      height: 1920,
      fps: 30,
      durationInFrames: durationSeconds * 30,
      scenes: [
        {
          id: "scene-1",
          startFrame: 0,
          durationInFrames: durationSeconds * 30,
          visualPrompt: `Vertical short explainer about ${request.title}`,
          narration: {
            text: request.summary,
            sourceUrl: source.url
          },
          overlays: [
            {
              kind: "title",
              text: request.title.slice(0, 120)
            },
            {
              kind: "fact",
              text: "Source checked"
            }
          ]
        }
      ]
    }
  };
};

export class FakeLlmProvider implements LlmProvider {
  private attempts = 0;

  generateScriptAndScene(request: LlmGenerationRequest): Promise<LlmGenerationResult> {
    this.attempts += 1;
    const behavior = request.title.toLowerCase();
    const structuredOutput =
      behavior.includes("bad-json") && this.attempts === 1
        ? { invalid: true }
        : behavior.includes("missing-source")
          ? { ...fakeStructuredOutput(request), facts: [] }
          : behavior.includes("too-long")
            ? {
                ...fakeStructuredOutput(request),
                script: {
                  hook: "Too long",
                  body: "x".repeat(2_001),
                  callToAction: "Done",
                  language: "en",
                  durationSeconds: 181
                }
              }
            : fakeStructuredOutput(request);

    return Promise.resolve({
      provider: "fake-llm",
      idempotencyKey: request.idempotencyKey,
      createdAt: new Date("2026-08-31T00:00:00.000Z").toISOString(),
      model: request.model,
      promptVersion: request.promptVersion,
      structuredOutput,
      usage: {
        promptTokens: 120,
        completionTokens: 240,
        totalTokens: 360
      },
      estimatedCostUsd: "0.000360"
    });
  }
}

type OpenAiLlmProviderOptions = {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly inputUsdPerMillionTokens?: number;
  readonly outputUsdPerMillionTokens?: number;
};

type OpenAiResponse = {
  readonly id?: string;
  readonly created_at?: number;
  readonly output_text?: string;
  readonly status?: string;
  readonly output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly total_tokens?: number;
  };
};

const scriptSceneJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["planning", "script", "facts", "sceneDocument"],
  properties: {
    planning: {
      type: "object",
      additionalProperties: false,
      required: ["title", "summary", "metadata"],
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        metadata: {
          type: "object",
          additionalProperties: false,
          required: ["description", "hashtags"],
          properties: { description: { type: "string" }, hashtags: { type: "array", items: { type: "string" } } }
        }
      }
    },
    script: {
      type: "object",
      additionalProperties: false,
      required: ["hook", "body", "callToAction", "language", "durationSeconds"],
      properties: {
        hook: { type: "string" }, body: { type: "string" }, callToAction: { type: "string" },
        language: { type: "string" }, durationSeconds: { type: "number" }
      }
    },
    facts: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["claim", "sourceUrl", "kind", "evidenceQuote"],
        properties: { claim: { type: "string" }, sourceUrl: { type: "string" }, kind: { type: "string", enum: ["FACT", "ASSUMPTION", "INFERENCE"] }, evidenceQuote: { type: "string" } }
      }
    },
    sceneDocument: {
      type: "object",
      additionalProperties: false,
      required: ["schemaVersion", "title", "width", "height", "fps", "durationInFrames", "scenes"],
      properties: {
        schemaVersion: { type: "string" }, title: { type: "string" }, width: { type: "integer" }, height: { type: "integer" },
        fps: { type: "integer" }, durationInFrames: { type: "integer" },
        scenes: {
          type: "array",
          items: {
            type: "object", additionalProperties: false,
            required: ["id", "startFrame", "durationInFrames", "visualPrompt", "narration", "overlays"],
            properties: {
              id: { type: "string" }, startFrame: { type: "integer" }, durationInFrames: { type: "integer" }, visualPrompt: { type: "string" },
              narration: {
                type: "object", additionalProperties: false, required: ["text", "sourceUrl"],
                properties: { text: { type: "string" }, sourceUrl: { type: "string" } }
              },
              overlays: {
                type: "array",
                items: {
                  type: "object", additionalProperties: false, required: ["text", "kind"],
                  properties: { text: { type: "string" }, kind: { type: "string", enum: ["title", "fact", "cta"] } }
                }
              }
            }
          }
        }
      }
    }
  }
} as const;

// A byte-based upper estimate deliberately includes schema/instruction overhead.
// It is a reservation policy, not a prediction of provider tokenization or billing.
export const estimateLlmInputTokens = (input: unknown): number => Buffer.byteLength(JSON.stringify(input), "utf8") + Buffer.byteLength(JSON.stringify(scriptSceneJsonSchema), "utf8") + 1024;

const readResponseText = (response: OpenAiResponse): string => {
  if (response.status && response.status !== "completed") throw new Error("OPENAI_RESPONSE_INCOMPLETE");
  const parts = response.output?.filter((item) => item.type === "message").flatMap((item) => item.content ?? []) ?? [];
  if (parts.some((part) => part.type === "refusal")) throw new Error("OPENAI_RESPONSE_REFUSED");
  const text = parts.filter((part) => part.type === "output_text").map((part) => part.text ?? "").join("") || response.output_text;
  if (!text) {
    throw new Error("OpenAI response did not include structured output text.");
  }
  return text;
};

export class OpenAiLlmProvider implements LlmProvider {
  constructor(private readonly options: OpenAiLlmProviderOptions) {}

  async generateScriptAndScene(request: LlmGenerationRequest): Promise<LlmGenerationResult> {
    if (!this.options.apiKey) {
      throw new Error("OPENAI_API_KEY is required when LLM_PROVIDER=openai.");
    }
    if (!(this.options.inputUsdPerMillionTokens && this.options.inputUsdPerMillionTokens > 0 && this.options.outputUsdPerMillionTokens && this.options.outputUsdPerMillionTokens > 0)) throw new Error("LLM_PRICING_REQUIRED");
    const outputLimit = request.maxOutputTokens ?? 4096;
    if (!Number.isSafeInteger(outputLimit) || outputLimit < 256 || outputLimit > 32768) throw new Error("LLM_OUTPUT_LIMIT_INVALID");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": request.idempotencyKey
        },
        body: JSON.stringify({
          model: request.model,
          store: false,
          max_output_tokens: outputLimit,
          instructions:
            "Generate a factual short-form script and scene document. Return only data that conforms to the supplied JSON Schema and cite only the supplied source URLs. For each claim provide its FACT, ASSUMPTION or INFERENCE kind and an exact evidenceQuote from the supplied text. Never treat a URL alone as evidence.",
          input: JSON.stringify({
            title: request.title,
            summary: request.summary,
            topic: request.topic,
            platform: request.platform,
            partial: request.partial,
            sources: request.sources,
            channelContext: request.channelContext
          }),
          text: {
            format: {
              type: "json_schema",
              name: "script_scene_generation",
              strict: true,
              schema: scriptSceneJsonSchema
            }
          }
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`OpenAI Responses API failed with status ${response.status}.`);
      }
      const payload = (await response.json()) as OpenAiResponse;
      const usage = payload.usage;
      const promptTokens = usage?.input_tokens;
      const completionTokens = usage?.output_tokens;
      if (promptTokens === undefined || completionTokens === undefined || !Number.isSafeInteger(promptTokens) || !Number.isSafeInteger(completionTokens) || promptTokens < 0 || completionTokens < 0) throw new Error("OPENAI_USAGE_MISSING_OR_INVALID");
      if (completionTokens > outputLimit) throw new Error("OPENAI_OUTPUT_LIMIT_EXCEEDED");
      return {
        provider: "openai",
        idempotencyKey: request.idempotencyKey,
        createdAt: payload.created_at ? new Date(payload.created_at * 1_000).toISOString() : new Date().toISOString(),
        model: request.model,
        promptVersion: request.promptVersion,
        structuredOutput: JSON.parse(readResponseText(payload)) as unknown,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: usage?.total_tokens ?? promptTokens + completionTokens
        },
        estimatedCostUsd: (((promptTokens * (this.options.inputUsdPerMillionTokens ?? 0)) + (completionTokens * (this.options.outputUsdPerMillionTokens ?? 0))) / 1_000_000).toFixed(6)
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export type StorageObject = { key: string; checksumSha256: string; mimeType: string; sizeBytes: number };
export interface StorageProvider {
  upload(input: { key: string; body: Uint8Array; mimeType: string }): Promise<StorageObject>;
  download(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  presignedUrl(key: string, expiresInSeconds: number): Promise<string>;
}

export class FakeStorageProvider implements StorageProvider {
  private readonly objects = new Map<string, { body: Uint8Array; mimeType: string }>();

  upload(input: { key: string; body: Uint8Array; mimeType: string }): Promise<StorageObject> {
    const body = new Uint8Array(input.body);
    this.objects.set(input.key, { body, mimeType: input.mimeType });
    return Promise.resolve({ key: input.key, checksumSha256: createHash("sha256").update(body).digest("hex"), mimeType: input.mimeType, sizeBytes: body.byteLength });
  }
  download(key: string): Promise<Uint8Array> {
    const object = this.objects.get(key);
    if (!object) throw new Error("STORAGE_OBJECT_NOT_FOUND");
    return Promise.resolve(new Uint8Array(object.body));
  }
  delete(key: string): Promise<void> { this.objects.delete(key); return Promise.resolve(); }
  presignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    if (!this.objects.has(key)) throw new Error("STORAGE_OBJECT_NOT_FOUND");
    return Promise.resolve(`fake-storage://${encodeURIComponent(key)}?expiresIn=${expiresInSeconds}`);
  }
}

export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  constructor(private readonly options: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string }) { this.client = new S3Client({ endpoint: options.endpoint, region: options.region, forcePathStyle: true, credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey } }); }
  async upload(input: { key: string; body: Uint8Array; mimeType: string }): Promise<StorageObject> { await this.client.send(new PutObjectCommand({ Bucket: this.options.bucket, Key: input.key, Body: input.body, ContentType: input.mimeType })); return { key: input.key, checksumSha256: createHash("sha256").update(input.body).digest("hex"), mimeType: input.mimeType, sizeBytes: input.body.byteLength }; }
  async download(key: string): Promise<Uint8Array> { const result = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key })); if (!result.Body) throw new Error("STORAGE_OBJECT_NOT_FOUND"); return new Uint8Array(await result.Body.transformToByteArray()); }
  async delete(key: string): Promise<void> { await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key })); }
  presignedUrl(key: string, expiresInSeconds: number): Promise<string> { return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.options.bucket, Key: key }), { expiresIn: expiresInSeconds }); }
}

export type ImageGenerationRequest = { model: string; prompt: string; idempotencyKey: string; width: number; height: number };
export type ImageGenerationResult = ProviderResult & { model: string; mimeType: string; bytes: Uint8Array; width: number; height: number; estimatedCostUsd: string };
export interface ImageProvider { generate(request: ImageGenerationRequest): Promise<ImageGenerationResult>; }
export class FakeImageProvider implements ImageProvider {
  generate(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    if (request.prompt.includes("provider-failure")) throw new Error("IMAGE_PROVIDER_FAILED");
    return Promise.resolve({ provider: "fake-image", idempotencyKey: request.idempotencyKey, createdAt: new Date().toISOString(), model: request.model, mimeType: "image/svg+xml", bytes: new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="${request.width}" height="${request.height}"><rect width="100%" height="100%" fill="#0f766e"/><text x="54" y="120" fill="white" font-size="42">${request.prompt.slice(0, 80)}</text></svg>`), width: request.width, height: request.height, estimatedCostUsd: "0.001000" });
  }
}

export class GoogleImageProvider implements ImageProvider {
  constructor(private readonly options: { apiKey: string; timeoutMs: number; usdPerOutput?: number }) {}
  async generate(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    if (!this.options.apiKey) throw new Error("GOOGLE_API_KEY is required when IMAGE_PROVIDER=google.");
    if (!(this.options.usdPerOutput && this.options.usdPerOutput > 0)) throw new Error("IMAGE_PRICING_REQUIRED");
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const ratios = ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
      const aspectRatio = ratios.find((ratio) => { const [w, h] = ratio.split(":").map(Number); return w && h && Math.abs(request.width / request.height - w / h) < 0.001; });
      if (!aspectRatio) throw new Error("GOOGLE_IMAGE_ASPECT_RATIO_UNSUPPORTED");
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": this.options.apiKey }, body: JSON.stringify({ contents: [{ parts: [{ text: request.prompt }] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio } } }), signal: controller.signal });
      if (!response.ok) throw new Error(`Google image API failed with status ${response.status}.`);
      const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }> };
      const image = payload.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).find((part) => part.inlineData?.data)?.inlineData;
      if (!image?.data || !image.mimeType) throw new Error("Google image API did not return inline image data.");
      if (!["image/png", "image/jpeg", "image/webp"].includes(image.mimeType)) throw new Error("GOOGLE_IMAGE_MIME_UNSUPPORTED");
      const bytes = decodeProviderBase64(image.data);
      const decoded = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "warning" }).raw().toBuffer({ resolveWithObject: true });
      const metadata = await sharp(bytes).metadata();
      const formatMime = metadata.format === "jpeg" ? "image/jpeg" : `image/${metadata.format}`;
      if (formatMime !== image.mimeType) throw new Error("GOOGLE_IMAGE_MIME_MISMATCH");
      return { provider: "google", idempotencyKey: request.idempotencyKey, createdAt: new Date().toISOString(), model: request.model, mimeType: image.mimeType, bytes, width: decoded.info.width, height: decoded.info.height, estimatedCostUsd: (this.options.usdPerOutput ?? 0).toFixed(6) };
    } finally { clearTimeout(timer); }
  }
}

export type TtsRequest = { model: string; voice: string; text: string; idempotencyKey: string };
export const resolveTtsVoice = (provider: "fake" | "elevenlabs", profile: string, configuredVoiceId: string): string => {
  const voice = profile.trim();
  if (provider === "fake") return voice || "default";
  const resolved = !voice || ["default", "neutral", "neutral-ko"].includes(voice) ? configuredVoiceId.trim() : voice;
  if (!resolved) throw new Error("TTS_VOICE_CONFIGURATION_REQUIRED");
  return resolved;
};
export type TtsTiming = { text: string; startSeconds: number; endSeconds: number };
export type TtsResult = ProviderResult & { model: string; mimeType: string; bytes: Uint8Array; durationSeconds: number; timings: TtsTiming[]; estimatedCostUsd: string };
export interface TtsProvider { synthesize(request: TtsRequest): Promise<TtsResult>; }
export class FakeTtsProvider implements TtsProvider {
  synthesize(request: TtsRequest): Promise<TtsResult> {
    if (request.text.includes("provider-failure")) throw new Error("TTS_PROVIDER_FAILED");
    const words = request.text.trim().split(/\s+/).filter(Boolean);
    const timings = words.map((text, index) => ({ text, startSeconds: index * 0.3, endSeconds: (index + 1) * 0.3 }));
    // A fake provider still has to honor its media contract: FFmpeg must be
    // able to decode the audio in an otherwise real rendering pipeline.
    const sampleRate = 16_000;
    const durationSeconds = Math.max(0.3, timings.length * 0.3);
    const dataSize = Math.round(durationSeconds * sampleRate) * 2;
    const bytes = Buffer.alloc(44 + dataSize);
    bytes.write("RIFF", 0);
    bytes.writeUInt32LE(36 + dataSize, 4);
    bytes.write("WAVEfmt ", 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(sampleRate, 24);
    bytes.writeUInt32LE(sampleRate * 2, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write("data", 36);
    bytes.writeUInt32LE(dataSize, 40);
    for (let sample = 0; sample < dataSize / 2; sample += 1) {
      const value = Math.round(Math.sin(2 * Math.PI * 440 * sample / sampleRate) * 4_000);
      bytes.writeInt16LE(value, 44 + sample * 2);
    }
    return Promise.resolve({ provider: "fake-tts", idempotencyKey: request.idempotencyKey, createdAt: new Date().toISOString(), model: request.model, mimeType: "audio/wav", bytes, durationSeconds, timings, estimatedCostUsd: (request.text.length / 1_000 * 0.01).toFixed(6) });
  }
}

export class ElevenLabsTtsProvider implements TtsProvider {
  constructor(private readonly options: { apiKey: string; timeoutMs: number; usdPerThousandCharacters?: number; fetchImplementation?: typeof fetch }) {}
  async synthesize(request: TtsRequest): Promise<TtsResult> {
    if (!this.options.apiKey) throw new Error("ELEVENLABS_API_KEY is required when TTS_PROVIDER=elevenlabs.");
    if (!(this.options.usdPerThousandCharacters && this.options.usdPerThousandCharacters > 0)) throw new Error("TTS_PRICING_REQUIRED");
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await (this.options.fetchImplementation ?? fetch)(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(request.voice)}/with-timestamps`, { method: "POST", headers: { "xi-api-key": this.options.apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ text: request.text, model_id: request.model }), signal: controller.signal });
      if (!response.ok) throw new Error(`ElevenLabs TTS API failed with status ${response.status}.`);
      const body = await response.json() as { audio_base64?: string; alignment?: CharacterAlignment | null; normalized_alignment?: CharacterAlignment | null };
      if (!body.audio_base64) throw new Error("ElevenLabs TTS response did not include audio.");
      const alignment = body.normalized_alignment ?? body.alignment;
      if (!alignment) throw new Error("ElevenLabs TTS response did not include timing alignment.");
      const timings = wordTimingsFromAlignment(alignment);
      if (timings.length === 0) throw new Error("ElevenLabs TTS alignment did not contain words.");
      const bytes = decodeProviderBase64(body.audio_base64);
      if (!(bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) && !(bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)) throw new Error("ELEVENLABS_AUDIO_INVALID");
      const durationSeconds = Math.max(...alignment.character_end_times_seconds);
      return { provider: "elevenlabs", idempotencyKey: request.idempotencyKey, createdAt: new Date().toISOString(), model: request.model, mimeType: "audio/mpeg", bytes, durationSeconds, timings, estimatedCostUsd: (request.text.length / 1_000 * (this.options.usdPerThousandCharacters ?? 0)).toFixed(6) };
    } finally { clearTimeout(timer); }
  }
}

type CharacterAlignment = { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
const wordTimingsFromAlignment = (alignment: CharacterAlignment): Array<{ text: string; startSeconds: number; endSeconds: number }> => {
  if (alignment.characters.length !== alignment.character_start_times_seconds.length || alignment.characters.length !== alignment.character_end_times_seconds.length) throw new Error("ElevenLabs TTS alignment arrays have inconsistent lengths.");
  alignment.character_start_times_seconds.forEach((start, index) => {
    const end = alignment.character_end_times_seconds[index];
    if (!Number.isFinite(start) || end === undefined || !Number.isFinite(end) || start < 0 || end < start || (index > 0 && start < (alignment.character_start_times_seconds[index - 1] ?? 0))) throw new Error("ELEVENLABS_ALIGNMENT_INVALID");
  });
  const timings: Array<{ text: string; startSeconds: number; endSeconds: number }> = [];
  let text = ""; let start = 0; let end = 0;
  const flush = (): void => { if (text) timings.push({ text, startSeconds: start, endSeconds: end }); text = ""; };
  alignment.characters.forEach((character, index) => {
    if (/\s/u.test(character)) { flush(); return; }
    if (!text) start = alignment.character_start_times_seconds[index] ?? 0;
    text += character; end = alignment.character_end_times_seconds[index] ?? start;
  });
  flush();
  return timings;
};
import { createHash } from "node:crypto";
import sharp from "sharp";
const decodeProviderBase64 = (value: string): Uint8Array => {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("PROVIDER_MEDIA_BASE64_INVALID");
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length) throw new Error("PROVIDER_MEDIA_EMPTY");
  return new Uint8Array(bytes);
};
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
