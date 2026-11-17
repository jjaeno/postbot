import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getTestDatabaseUrl } from "./scripts/database-url.js";

const prisma = new PrismaClient({
  datasourceUrl: getTestDatabaseUrl()
});

const cleanDatabase = async (): Promise<void> => {
  const operations = [
    prisma.notification.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.budgetHistory.deleteMany(),
    prisma.experimentAssignment.deleteMany(),
    prisma.automationEvent.deleteMany(),
    prisma.automationCostReservation.deleteMany(),
    prisma.automationStep.deleteMany(),
    prisma.automationRun.deleteMany(),
    prisma.automationBudget.deleteMany(),
    prisma.automationSwitch.deleteMany(),
    prisma.analyticsMetricSnapshot.deleteMany(),
    prisma.analyticsSync.deleteMany(),
    prisma.publishAttempt.deleteMany(),
    prisma.platformPost.deleteMany(),
    prisma.publishPlan.deleteMany(),
    prisma.policySnapshot.deleteMany(),
    prisma.policyCheck.deleteMany(),
    prisma.policyRule.deleteMany(),
    prisma.costLedger.deleteMany(),
    prisma.billingReconciliation.deleteMany(),
    prisma.providerUsage.deleteMany(),
    prisma.jobAttempt.deleteMany(),
    prisma.productionJob.deleteMany(),
    prisma.assetUsage.deleteMany(),
    prisma.assetLicense.deleteMany(),
    prisma.assetSource.deleteMany(),
    prisma.assetGenerationCache.deleteMany(),
    prisma.providerRightsPolicy.deleteMany(),
    prisma.asset.deleteMany(),
    prisma.experiment.deleteMany(),
    prisma.optimizationSuggestion.deleteMany(),
    prisma.strategyVersion.deleteMany(),
    prisma.sceneVersion.deleteMany(),
    prisma.scriptVersion.deleteMany(),
    prisma.sourceReference.deleteMany(),
    prisma.contentIdea.deleteMany(),
    prisma.contentItem.deleteMany(),
    prisma.scheduleRule.deleteMany(),
    prisma.platformOutputProfile.deleteMany(),
    prisma.channelTemplate.deleteMany(),
    prisma.collectionRule.deleteMany(),
    prisma.sourceFetch.deleteMany(),
    prisma.researchQuestion.deleteMany(),
    prisma.oAuthCredential.deleteMany(),
    prisma.platformAccount.deleteMany(),
    prisma.oAuthConnectionState.deleteMany(),
    prisma.channel.deleteMany(),
    prisma.authSession.deleteMany(),
    prisma.membership.deleteMany(),
    prisma.workspace.deleteMany(),
    prisma.user.deleteMany()
  ];
  for (const operation of operations) {
    await operation;
  }
};

const createWorkspace = async () => {
  const suffix = crypto.randomUUID();
  const user = await prisma.user.create({
    data: {
      email: `owner-${suffix}@postbot.dev`,
      displayName: "Owner",
      passwordHash: "hashed-password",
      timezone: "UTC"
    }
  });
  const workspace = await prisma.workspace.create({
    data: {
      name: "Workspace",
      slug: `workspace-${suffix}`,
      ownerId: user.id
    }
  });
  await prisma.membership.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      role: "OWNER"
    }
  });
  const channel = await prisma.channel.create({
    data: {
      workspaceId: workspace.id,
      name: "Channel",
      slug: `channel-${suffix}`
    }
  });
  return { user, workspace, channel };
};

describe("core Prisma data model", () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await cleanDatabase();
    await prisma.$disconnect();
  });

  it("enforces foreign keys and unique ownership edges", async () => {
    const { user, workspace } = await createWorkspace();

    await expect(
      prisma.membership.create({
        data: {
          workspaceId: workspace.id,
          userId: "missing-user",
          role: "MEMBER"
        }
      })
    ).rejects.toMatchObject({ code: "P2003" });

    await expect(
      prisma.membership.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          role: "MEMBER"
        }
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("stores decimal usage and timestamps without float coercion", async () => {
    const { channel } = await createWorkspace();
    const eventAt = new Date("2026-08-28T12:34:56.789Z");
    const contentItem = await prisma.contentItem.create({
      data: {
        channelId: channel.id,
        title: "Decimal and UTC validation",
        topicKey: "decimal-utc",
        eventAt,
        suitabilityScore: new Prisma.Decimal("0.123456")
      }
    });

    const template = await prisma.channelTemplate.create({
      data: {
        channelId: channel.id,
        version: 1,
        name: "Template",
        aiStockRatio: new Prisma.Decimal("0.333333")
      }
    });

    expect(contentItem.suitabilityScore?.toFixed(6)).toBe("0.123456");
    expect(contentItem.eventAt?.toISOString()).toBe("2026-08-28T12:34:56.789Z");
    expect(template.aiStockRatio.toFixed(6)).toBe("0.333333");
  });

  it("enforces content and job idempotency keys", async () => {
    const { channel } = await createWorkspace();
    const contentItem = await prisma.contentItem.create({
      data: {
        channelId: channel.id,
        title: "Idempotency validation",
        topicKey: "idempotency"
      }
    });

    await expect(
      prisma.contentItem.create({
        data: {
          channelId: channel.id,
          title: "Duplicate topic",
          topicKey: "idempotency"
        }
      })
    ).rejects.toMatchObject({ code: "P2002" });

    await prisma.productionJob.create({
      data: {
        channelId: channel.id,
        contentItemId: contentItem.id,
        type: "SCRIPT",
        queueName: "script",
        idempotencyKey: "job-idempotency-key",
        payload: { contentItemId: contentItem.id }
      }
    });

    await expect(
      prisma.productionJob.create({
        data: {
          channelId: channel.id,
          contentItemId: contentItem.id,
          type: "SCRIPT",
          queueName: "script",
          idempotencyKey: "job-idempotency-key",
          payload: { contentItemId: contentItem.id }
        }
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("preserves immutable experiment assignments", async () => {
    const { channel } = await createWorkspace();
    const contentItem = await prisma.contentItem.create({ data: { channelId: channel.id, title: "Experiment content", topicKey: "experiment-content" } });
    const experiment = await prisma.experiment.create({ data: { channelId: channel.id, name: "Duration", hypothesis: "A bounded duration adjustment may improve views.", allocation: { control: {}, variant: {} }, successCriteria: { metric: "views" }, targetMetric: "views", minSampleSize: 20 } });
    await prisma.experimentAssignment.create({ data: { experimentId: experiment.id, contentItemId: contentItem.id, arm: "control", assignmentKey: "experiment-assignment-key" } });
    await expect(prisma.experimentAssignment.create({ data: { experimentId: experiment.id, contentItemId: contentItem.id, arm: "variant", assignmentKey: "experiment-assignment-key-2" } })).rejects.toMatchObject({ code: "P2002" });
  });

  it("enforces publish idempotency and platform account assignment uniqueness", async () => {
    const { workspace, channel } = await createWorkspace();
    const contentItem = await prisma.contentItem.create({
      data: {
        channelId: channel.id,
        title: "Publish validation",
        topicKey: "publish"
      }
    });
    const account = await prisma.platformAccount.create({
      data: {
        workspaceId: workspace.id,
        channelId: channel.id,
        platform: "YOUTUBE",
        externalAccountId: "youtube-account-1"
      }
    });

    await expect(
      prisma.platformAccount.create({
        data: {
          workspaceId: workspace.id,
          channelId: channel.id,
          platform: "YOUTUBE",
          externalAccountId: "youtube-account-2"
        }
      })
    ).rejects.toMatchObject({ code: "P2002" });

    const publishPlan = await prisma.publishPlan.create({
      data: {
        contentItemId: contentItem.id,
        platform: "YOUTUBE",
        platformAccountId: account.id,
        scheduledAt: new Date("2026-08-29T00:00:00.000Z"),
        idempotencyKey: "publish-plan-key",
        title: "Publish validation"
      }
    });

    await expect(
      prisma.publishPlan.create({
        data: {
          contentItemId: contentItem.id,
          platform: "YOUTUBE",
          platformAccountId: account.id,
          scheduledAt: new Date("2026-08-29T01:00:00.000Z"),
          idempotencyKey: "publish-plan-key",
          title: "Duplicate publish validation"
        }
      })
    ).rejects.toMatchObject({ code: "P2002" });

    await prisma.publishAttempt.create({
      data: {
        publishPlanId: publishPlan.id,
        attemptNumber: 1,
        idempotencyKey: "publish-attempt-key"
      }
    });

    await expect(
      prisma.publishAttempt.create({
        data: {
          publishPlanId: publishPlan.id,
          attemptNumber: 2,
          idempotencyKey: "publish-attempt-key"
        }
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
