import { type ChannelCollectionProfile } from "@postbot/contracts";
import { assertExecutionOwner, Prisma, type PrismaClient } from "@postbot/database";
import { createHash } from "node:crypto";
import { OfficialTopicSourceProvider, RssTopicSourceProvider, SafeExternalReader, type TopicSourceCandidate, type TopicSourceRequest } from "@postbot/providers";

export class SourceCollection {
  constructor(private readonly prisma: PrismaClient, private readonly channelId: string, private readonly profile: ChannelCollectionProfile,
    private readonly youtubeApiKey: string, private readonly reader?: (source: string, url: string) => Promise<unknown>) {}

  async read(source: string, url: string): Promise<unknown> {
    const now = new Date(); const cacheMs = this.profile.limits.cacheMinutes * 60000;
    const requestKey = createHash("sha256").update(`${source}:${url}:${Math.floor(now.getTime() / cacheMs)}`).digest("hex");
    const lease = await this.prisma.$transaction(async (tx) => {
      await assertExecutionOwner(tx);
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${this.channelId} FOR UPDATE`;
      const existing = await tx.sourceFetch.findUnique({ where: { channelId_requestKey: { channelId: this.channelId, requestKey } } });
      if (existing) return { cached: true, row: existing };
      const day = new Date(now); day.setUTCHours(0, 0, 0, 0);
      const calls = await tx.sourceFetch.count({ where: { channelId: this.channelId, startedAt: { gte: day } } });
      if (calls >= this.profile.limits.dailyCalls) throw new Error("SOURCE_DAILY_CALL_BUDGET_EXHAUSTED");
      return { cached: false, row: await tx.sourceFetch.create({ data: { channelId: this.channelId, requestKey, source, state: "PENDING", expiresAt: new Date(now.getTime() + cacheMs) } }) };
    });
    if (lease.cached) { if (lease.row.state !== "READY") throw new Error("SOURCE_REQUEST_PENDING_OR_FAILED"); return lease.row.response; }
    try {
      if (source === "YOUTUBE" && !this.youtubeApiKey && !this.reader) throw new Error("YOUTUBE_DISCOVERY_KEY_UNSET");
      const hosts = source === "YOUTUBE" ? ["www.googleapis.com"] : source === "LOC" ? ["loc.gov"] : source === "NASA" ? ["images-api.nasa.gov"] : this.profile.sources.evidenceHosts;
      const result: unknown = this.reader ? await this.reader(source, url) : await new SafeExternalReader({ hosts,
        ...(source === "YOUTUBE" ? { headers: { "x-goog-api-key": this.youtubeApiKey } } : {}) }).read(url).then((document) => source === "HTML" ? document : JSON.parse(document.text) as unknown);
      const json = JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue;
      await this.prisma.sourceFetch.update({ where: { id: lease.row.id }, data: { state: "READY", response: json } });
      return result;
    } catch (error) { await this.prisma.sourceFetch.update({ where: { id: lease.row.id }, data: { state: "FAILED" } }); throw error; }
  }

  async collect(request: TopicSourceRequest) {
    // Expire API bodies independently from daily-call receipts. Keep receipts
    // through the budget window so cache deletion cannot grant more calls.
    const now = new Date();
    await this.prisma.sourceFetch.updateMany({ where: { channelId: this.channelId, expiresAt: { lte: now }, state: "READY" }, data: { response: Prisma.DbNull, state: "EXPIRED" } });
    await this.prisma.sourceFetch.deleteMany({ where: { channelId: this.channelId, startedAt: { lt: new Date(now.getTime() - 2 * 86400000) } } });
    const official = new OfficialTopicSourceProvider(this.profile, (source, url) => this.read(source, url));
    const rss = this.profile.sources.rssUrls.length ? new RssTopicSourceProvider({ feedUrls: this.profile.sources.rssUrls,
      readDocument: async (url) => {
        const feedProfile = { ...this.profile, sources: { ...this.profile.sources, evidenceHosts: this.profile.sources.rssUrls.map((url) => new URL(url).hostname) } };
        const result = await new SourceCollection(this.prisma, this.channelId, feedProfile, "", this.reader).read("HTML", url);
        return typeof result === "object" && result && "text" in result && typeof result.text === "string" ? result.text : "";
      } }) : null;
    const settled = await Promise.allSettled([official.collect(request), ...(rss ? [rss.collect(request)] : [])]);
    const candidates = settled.flatMap((result) => result.status === "fulfilled" ? result.value.candidates : []);
    const enriched: TopicSourceCandidate[] = [];
    for (const candidate of candidates.slice(0, this.profile.limits.targetCandidates)) {
      try { enriched.push(await this.enrich(candidate)); } catch { enriched.push({ ...candidate, reliabilityMetadata: { ...candidate.reliabilityMetadata, evidenceFailure: "ORIGINAL_UNAVAILABLE", contentScope: "SUMMARY" } }); }
    }
    return { provider: "channel-profile-sources", candidates: enriched,
      failures: settled.flatMap((result) => result.status === "fulfilled" ? result.value.failures ?? [] : [{ source: "RSS", code: "SOURCE_UNAVAILABLE" }]) };
  }

  private async enrich(candidate: TopicSourceCandidate): Promise<TopicSourceCandidate> {
    const urls = candidate.reliabilityMetadata?.role === "DISCOVERY" ? candidate.summary.match(/https:\/\/[^\s<>"']+/g) ?? [] : [candidate.url];
    const allowed = urls.find((raw) => { try { const url = new URL(raw); return this.profile.sources.evidenceHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)); } catch { return false; } });
    if (!allowed) return candidate;
    const raw = await this.read("HTML", allowed);
    if (!raw || typeof raw !== "object" || !("text" in raw) || typeof raw.text !== "string") throw new Error("ORIGINAL_EXTRACTION_FAILED");
    const html = raw.text.replace(/<(script|style|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
    const match = /<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(html);
    const body = match?.[2]?.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    if (!body || body.length < 100 || body.length > 10000) throw new Error("ORIGINAL_EXTRACTION_INCOMPLETE");
    const collectedAt = "collectedAt" in raw && typeof raw.collectedAt === "string" ? raw.collectedAt : new Date().toISOString();
    const originalUrl = "url" in raw && typeof raw.url === "string" ? raw.url : allowed;
    const title = /<(?:h1|title)\b[^>]*>([\s\S]*?)<\/(?:h1|title)>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, " ").trim();
    if (candidate.reliabilityMetadata?.role === "DISCOVERY" && !title) throw new Error("ORIGINAL_TITLE_UNAVAILABLE");
    return { ...candidate, title: title?.slice(0, 255) ?? candidate.title, summary: body.slice(0, 2000), url: originalUrl, body, reliabilityScore: 0.8, reliabilityMetadata: { ...candidate.reliabilityMetadata,
      role: "EVIDENCE", contentScope: "FULL_TEXT", untrustedExternalData: true, discoveryUrl: candidate.url, collectedAt,
      fingerprint: createHash("sha256").update(body).digest("hex"),
      evidence: [{ url: originalUrl, start: 0, end: body.length, scope: "FULL_TEXT", independence: "SINGLE_SOURCE" }], mediaRights: "REVIEW_REQUIRED" } };
  }
}
