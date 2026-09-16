import { Prisma, PrismaClient } from "@prisma/client";
import { scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const prisma = new PrismaClient();
const scrypt = promisify(scryptCallback);
const hashPassword = async (password: string): Promise<string> => {
  const salt = "local-seed-salt";
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${key.toString("base64url")}`;
};

const user = await prisma.user.upsert({
  where: { email: "local@postbot.dev" },
  update: {},
  create: {
    email: "local@postbot.dev",
    displayName: "Local User",
    passwordHash: await hashPassword("local-postbot-password"),
    timezone: "Asia/Seoul"
  }
});

const workspace = await prisma.workspace.upsert({
  where: { slug: "local" },
  update: {},
  create: {
    name: "Local Workspace",
    slug: "local",
    ownerId: user.id,
    memberships: {
      create: {
        userId: user.id,
        role: "OWNER"
      }
    }
  }
});

const channel = await prisma.channel.upsert({
  where: {
    workspaceId_slug: {
      workspaceId: workspace.id,
      slug: "science-shorts"
    }
  },
  update: {},
  create: {
    workspaceId: workspace.id,
    name: "Science Shorts",
    slug: "science-shorts",
    description: "Local seed channel for infrastructure validation.",
    language: "ko",
    targetAudience: "curious adults",
    topic: "science",
    excludedTopics: ["medical advice", "financial advice"],
    automationMode: "APPROVAL",
    minInventoryCount: 3,
    dailyPublishLimit: 1
  }
});

await prisma.channelTemplate.upsert({
  where: {
    channelId_version: {
      channelId: channel.id,
      version: 1
    }
  },
  update: {},
  create: {
    channelId: channel.id,
    version: 1,
    name: "Default vertical short",
    tone: "clear",
    voiceProfile: "neutral",
    subtitleStyle: { safeArea: "vertical-short" },
    visualStyle: { aspectRatio: "9:16" },
    aiStockRatio: new Prisma.Decimal("0.500000"),
    isActive: true
  }
});

for (const platform of ["YOUTUBE", "INSTAGRAM", "TIKTOK"] as const) {
  await prisma.platformOutputProfile.upsert({
    where: {
      channelId_platform_version: {
        channelId: channel.id,
        platform,
        version: 1
      }
    },
    update: {},
    create: {
      channelId: channel.id,
      platform,
      version: 1,
      minDurationSeconds: 30,
      maxDurationSeconds: 90,
      hookStyle: "question",
      captionStyle: "readable",
      metadataRules: { tags: [] },
      publicSetting: "PUBLIC",
      isActive: true
    }
  });

  await prisma.policyRule.upsert({
    where: {
      platform_region_version: {
        platform,
        region: "GLOBAL",
        version: 1
      }
    },
    update: {},
    create: {
      platform,
      region: "GLOBAL",
      version: 1,
      effectiveAt: new Date("2026-08-28T00:00:00.000Z"),
      checkedAt: new Date("2026-08-28T00:00:00.000Z"),
      durationRule: { minSeconds: 30, maxSeconds: 90 },
      originalityRule: { requiresTransformativeScript: true },
      aiDisclosureRule: { discloseRealisticSyntheticMedia: true },
      rightsRule: { commercialUseRequired: true },
      restrictedTopics: ["politics", "health", "finance", "legal"]
    }
  });
}

await prisma.$disconnect();
