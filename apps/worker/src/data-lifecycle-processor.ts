import { loadConfig } from "@postbot/config";
import { Prisma, type PrismaClient } from "@postbot/database";
import { FakeStorageProvider, S3StorageProvider, type StorageProvider } from "@postbot/providers";

const objectKeysFromManifest = (value: Prisma.JsonValue | null): string[] => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const manifest = value as Record<string, unknown>;
  return [manifest.videoKey, manifest.thumbnailKey].filter((key): key is string => typeof key === "string" && key.length > 0);
};

const unique = (values: readonly string[]): string[] => [...new Set(values)];

export class DataLifecycleProcessor {
  private readonly storage: StorageProvider;

  constructor(private readonly prisma: PrismaClient, storage?: StorageProvider) {
    const config = loadConfig();
    this.storage = storage ?? (config.STORAGE_PROVIDER === "s3"
      ? new S3StorageProvider({ endpoint: config.S3_ENDPOINT, region: config.S3_REGION, bucket: config.S3_BUCKET, accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY })
      : new FakeStorageProvider());
  }

  async process(requestId: string): Promise<void> {
    const request = await this.prisma.dataLifecycleRequest.findUnique({ where: { id: requestId } });
    if (!request || request.status === "SUCCEEDED") return;
    await this.prisma.dataLifecycleRequest.update({ where: { id: request.id }, data: { status: "RUNNING", startedAt: request.startedAt ?? new Date(), errorCode: null, errorMessage: null } });
    try {
      const result = request.type === "RETENTION"
        ? await this.applyRetention(request.workspaceId, request.retentionBefore)
        : request.type === "WORKSPACE_DELETE"
          ? await this.deleteWorkspace(request.workspaceId)
          : await this.deleteUser(request.requestedByUserId);
      await this.prisma.dataLifecycleRequest.update({ where: { id: request.id }, data: { status: "SUCCEEDED", result, finishedAt: new Date() } });
    } catch (error) {
      await this.prisma.dataLifecycleRequest.update({ where: { id: request.id }, data: { status: "FAILED", errorCode: "DATA_LIFECYCLE_FAILED", errorMessage: error instanceof Error ? error.message.slice(0, 2_000) : "Data lifecycle work failed.", finishedAt: new Date() } });
      throw error;
    }
  }

  private async applyRetention(workspaceId: string | null, before: Date | null): Promise<Record<string, number>> {
    if (!workspaceId || !before) throw new Error("RETENTION_SCOPE_REQUIRED");
    const channels = await this.prisma.channel.findMany({ where: { workspaceId }, select: { id: true } });
    const channelIds = channels.map(({ id }) => id);
    const [scenes, assets, oldJobs] = await Promise.all([
      this.prisma.sceneVersion.findMany({ where: { contentItem: { channelId: { in: channelIds } }, createdAt: { lt: before }, renderManifest: { not: Prisma.DbNull } }, select: { id: true, renderManifest: true } }),
      this.prisma.asset.findMany({ where: { channelId: { in: channelIds }, createdAt: { lt: before }, usages: { none: {} } }, select: { id: true, storageKey: true } }),
      this.prisma.productionJob.findMany({ where: { channelId: { in: channelIds }, status: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] }, finishedAt: { lt: before } }, select: { id: true } })
    ]);
    const storageKeys = unique([...assets.map(({ storageKey }) => storageKey), ...scenes.flatMap(({ renderManifest }) => objectKeysFromManifest(renderManifest))]);
    for (const key of storageKeys) await this.storage.delete(key);
    const jobIds = oldJobs.map(({ id }) => id);
    const result = await this.prisma.$transaction(async (tx) => {
      const attempts = await tx.jobAttempt.deleteMany({ where: { productionJobId: { in: jobIds } } });
      const jobs = await tx.productionJob.deleteMany({ where: { id: { in: jobIds } } });
      const assetIds = assets.map(({ id }) => id);
      await tx.assetSource.deleteMany({ where: { assetId: { in: assetIds } } });
      await tx.assetLicense.deleteMany({ where: { assetId: { in: assetIds } } });
      const removedAssets = await tx.asset.deleteMany({ where: { id: { in: assetIds } } });
      const renderManifests = await tx.sceneVersion.updateMany({ where: { id: { in: scenes.map(({ id }) => id) } }, data: { renderManifest: Prisma.DbNull } });
      const oauthStates = await tx.oAuthConnectionState.deleteMany({ where: { workspaceId, expiresAt: { lt: before } } });
      const authSessions = await tx.authSession.deleteMany({ where: { workspaceId, expiresAt: { lt: before } } });
      const notifications = await tx.notification.deleteMany({ where: { workspaceId, acknowledgedAt: { not: null, lt: before } } });
      const ideaSnapshots = await tx.contentIdea.updateMany({ where: { channelId: { in: channelIds }, collectedAt: { lt: before } }, data: { rawSnapshot: Prisma.DbNull } });
      return { attempts: attempts.count, jobs: jobs.count, assets: removedAssets.count, renderManifests: renderManifests.count, oauthStates: oauthStates.count, authSessions: authSessions.count, notifications: notifications.count, ideaSnapshots: ideaSnapshots.count, storageObjects: storageKeys.length };
    });
    return result;
  }

  private async deleteUser(userId: string | null): Promise<Record<string, number>> {
    if (!userId) throw new Error("USER_SCOPE_REQUIRED");
    const owned = await this.prisma.workspace.findMany({ where: { ownerId: userId }, select: { id: true } });
    let storageObjects = 0;
    for (const workspace of owned) storageObjects += (await this.deleteWorkspace(workspace.id)).storageObjects;
    const result = await this.prisma.$transaction(async (tx) => {
      const sessions = await tx.authSession.deleteMany({ where: { userId } });
      const memberships = await tx.membership.deleteMany({ where: { userId } });
      const user = await tx.user.deleteMany({ where: { id: userId, workspaces: { none: {} } } });
      return { sessions: sessions.count, memberships: memberships.count, users: user.count };
    });
    return { ...result, workspaces: owned.length, storageObjects };
  }

  private async deleteWorkspace(workspaceId: string | null): Promise<{ workspaces: number; storageObjects: number }> {
    if (!workspaceId) throw new Error("WORKSPACE_SCOPE_REQUIRED");
    const channels = await this.prisma.channel.findMany({ where: { workspaceId }, select: { id: true } });
    const channelIds = channels.map(({ id }) => id);
    const content = await this.prisma.contentItem.findMany({ where: { channelId: { in: channelIds } }, select: { id: true } });
    const contentIds = content.map(({ id }) => id);
    const [assets, scenes] = await Promise.all([
      this.prisma.asset.findMany({ where: { OR: [{ channelId: { in: channelIds } }, { usages: { some: { contentItemId: { in: contentIds } } } }] }, select: { id: true, storageKey: true } }),
      this.prisma.sceneVersion.findMany({ where: { contentItemId: { in: contentIds } }, select: { id: true, renderManifest: true } })
    ]);
    const storageKeys = unique([...assets.map(({ storageKey }) => storageKey), ...scenes.flatMap(({ renderManifest }) => objectKeysFromManifest(renderManifest))]);
    for (const key of storageKeys) await this.storage.delete(key);
    await this.prisma.$transaction(async (tx) => {
      const jobs = await tx.productionJob.findMany({ where: { OR: [{ channelId: { in: channelIds } }, { contentItemId: { in: contentIds } }] }, select: { id: true } });
      const jobIds = jobs.map(({ id }) => id);
      const runs = await tx.automationRun.findMany({ where: { channelId: { in: channelIds } }, select: { id: true } });
      const runIds = runs.map(({ id }) => id);
      const plans = await tx.publishPlan.findMany({ where: { contentItemId: { in: contentIds } }, select: { id: true } });
      const planIds = plans.map(({ id }) => id);
      const posts = await tx.platformPost.findMany({ where: { publishPlanId: { in: planIds } }, select: { id: true } });
      const postIds = posts.map(({ id }) => id);
      const syncs = await tx.analyticsSync.findMany({ where: { channelId: { in: channelIds } }, select: { id: true } });
      const syncIds = syncs.map(({ id }) => id);
      const checks = await tx.policyCheck.findMany({ where: { contentItemId: { in: contentIds } }, select: { id: true } });
      const checkIds = checks.map(({ id }) => id);
      const providerUsages = await tx.providerUsage.findMany({ where: { OR: [{ contentItemId: { in: contentIds } }, { productionJobId: { in: jobIds } }] }, select: { id: true } });
      const providerUsageIds = providerUsages.map(({ id }) => id);
      const experiments = await tx.experiment.findMany({ where: { channelId: { in: channelIds } }, select: { id: true } });
      const experimentIds = experiments.map(({ id }) => id);
      await tx.analyticsMetricSnapshot.deleteMany({ where: { OR: [{ analyticsSyncId: { in: syncIds } }, { platformPostId: { in: postIds } }] } });
      await tx.analyticsSync.deleteMany({ where: { id: { in: syncIds } } });
      await tx.platformPost.deleteMany({ where: { id: { in: postIds } } });
      await tx.publishAttempt.deleteMany({ where: { publishPlanId: { in: planIds } } });
      await tx.publishPlan.deleteMany({ where: { id: { in: planIds } } });
      await tx.policySnapshot.deleteMany({ where: { OR: [{ channelId: { in: channelIds } }, { policyCheckId: { in: checkIds } }] } });
      await tx.policyCheck.deleteMany({ where: { id: { in: checkIds } } });
      await tx.experimentAssignment.deleteMany({ where: { OR: [{ experimentId: { in: experimentIds } }, { contentItemId: { in: contentIds } }] } });
      await tx.experiment.deleteMany({ where: { id: { in: experimentIds } } });
      await tx.optimizationSuggestion.deleteMany({ where: { channelId: { in: channelIds } } });
      await tx.strategyVersion.deleteMany({ where: { channelId: { in: channelIds } } });
      await tx.costLedger.deleteMany({ where: { OR: [{ contentItemId: { in: contentIds } }, { providerUsageId: { in: providerUsageIds } }] } });
      await tx.providerUsage.deleteMany({ where: { id: { in: providerUsageIds } } });
      await tx.automationCostReservation.deleteMany({ where: { automationRunId: { in: runIds } } });
      await tx.automationEvent.deleteMany({ where: { automationRunId: { in: runIds } } });
      await tx.automationStep.deleteMany({ where: { automationRunId: { in: runIds } } });
      await tx.automationRun.deleteMany({ where: { id: { in: runIds } } });
      await tx.jobAttempt.deleteMany({ where: { productionJobId: { in: jobIds } } });
      await tx.productionJob.deleteMany({ where: { id: { in: jobIds } } });
      const assetIds = assets.map(({ id }) => id);
      await tx.assetUsage.deleteMany({ where: { OR: [{ contentItemId: { in: contentIds } }, { assetId: { in: assetIds } }] } });
      await tx.assetSource.deleteMany({ where: { assetId: { in: assetIds } } });
      await tx.assetLicense.deleteMany({ where: { assetId: { in: assetIds } } });
      await tx.asset.deleteMany({ where: { id: { in: assetIds } } });
      await tx.sceneVersion.deleteMany({ where: { contentItemId: { in: contentIds } } });
      await tx.scriptVersion.deleteMany({ where: { contentItemId: { in: contentIds } } });
      await tx.sourceReference.deleteMany({ where: { contentItemId: { in: contentIds } } });
      await tx.contentIdea.deleteMany({ where: { channelId: { in: channelIds } } });
      await tx.contentItem.deleteMany({ where: { id: { in: contentIds } } });
      const accounts = await tx.platformAccount.findMany({ where: { workspaceId }, select: { id: true } });
      await tx.oAuthCredential.deleteMany({ where: { platformAccountId: { in: accounts.map(({ id }) => id) } } });
      await tx.platformAccount.deleteMany({ where: { workspaceId } });
      await tx.oAuthConnectionState.deleteMany({ where: { workspaceId } });
      await tx.collectionRule.deleteMany({ where: { channelId: { in: channelIds } } });
      await tx.sourceFetch.deleteMany({ where: { channelId: { in: channelIds } } });
      await tx.researchQuestion.deleteMany({ where: { channelId: { in: channelIds } } });
      await tx.channelTemplate.deleteMany({ where: { channelId: { in: channelIds } } });
      await tx.platformOutputProfile.deleteMany({ where: { channelId: { in: channelIds } } });
      await tx.scheduleRule.deleteMany({ where: { channelId: { in: channelIds } } });
      const budgets = await tx.automationBudget.findMany({ where: { workspaceId }, select: { id: true } });
      await tx.budgetHistory.deleteMany({ where: { automationBudgetId: { in: budgets.map(({ id }) => id) } } });
      await tx.automationBudget.deleteMany({ where: { workspaceId } });
      await tx.notification.deleteMany({ where: { workspaceId } });
      await tx.auditLog.deleteMany({ where: { workspaceId } });
      await tx.automationSwitch.deleteMany({ where: { workspaceId } });
      await tx.channel.deleteMany({ where: { id: { in: channelIds } } });
      await tx.authSession.deleteMany({ where: { workspaceId } });
      await tx.membership.deleteMany({ where: { workspaceId } });
      await tx.workspace.deleteMany({ where: { id: workspaceId } });
    }, { timeout: 60_000 });
    return { workspaces: 1, storageObjects: storageKeys.length };
  }
}

export { objectKeysFromManifest };
