import type { PublishedVideo } from "@postbot/publishers";

export const publicationState = (result: PublishedVideo, createdAt: Date, checks: number, options: { now?: Date; privateRequested?: boolean } = {}) => {
  const now = options.now ?? new Date();
  const privateComplete = options.privateRequested && result.status === "uploaded" && result.visibility === "private" && result.processingComplete === true;
  const date = (value: string | null | undefined): Date | null => value && Number.isFinite(Date.parse(value)) ? new Date(value) : null;
  const publishedAt = result.status === "published" ? date(result.publishedAt) : null;
  const scheduledAt = date(result.scheduledAt);
  const state = result.status.toUpperCase();
  const future = result.status === "scheduled" && scheduledAt !== null && scheduledAt > now;
  const overdue = now.getTime() > Math.max(createdAt.getTime(), scheduledAt?.getTime() ?? 0) + 86400000;
  const reviewRequired = !privateComplete && (result.status === "ambiguous" || result.status === "failed" || overdue && result.status !== "published");
  const nextCheck = privateComplete || ["published", "failed", "ambiguous"].includes(result.status) || reviewRequired ? null
    : new Date(future ? Math.min(scheduledAt.getTime() + 30000, now.getTime() + 6 * 3600000) : now.getTime() + Math.min(1800000, 30000 * 2 ** Math.min(checks, 6)));
  const failureCode = privateComplete ? null : result.failureReason && /^[a-z0-9_:-]{1,80}$/i.test(result.failureReason) ? result.failureReason : result.status === "failed" ? "PLATFORM_REPORTED_FAILURE" : overdue && result.status !== "published" ? "PUBLICATION_CONFIRMATION_STALLED" : null;
  return { state, publishedAt, scheduledAt, nextCheck, reviewRequired, failureCode,
    planStatus: result.status === "published" ? "PUBLISHED" as const : result.status === "failed" ? "FAILED" as const : reviewRequired ? "HELD" as const : result.status === "scheduled" ? "SCHEDULED" as const : result.status === "processing" ? "PROCESSING" as const : "UPLOADED" as const,
    contentStatus: privateComplete ? "APPROVED" as const : result.status === "published" ? "PUBLISHED" as const : reviewRequired ? "HELD" as const : result.status === "scheduled" ? "SCHEDULED" as const : "PUBLISHING" as const };
};
