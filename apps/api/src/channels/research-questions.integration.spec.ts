import "reflect-metadata";
import { PrismaClient } from "@postbot/database";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { AuthenticatedRequest } from "../auth/request-types.js";
import { ResearchQuestionsController } from "./research-questions.controller.js";
const prisma = new PrismaClient();
const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
suite("research question intake", () => {
  afterAll(() => prisma.$disconnect());
  it("keeps audience hypotheses unverified, guards the workspace and rejects key reuse", async () => {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { email: `${key}@questions.test`, displayName: "Fixture", passwordHash: "fixture" } });
    const workspace = await prisma.workspace.create({ data: { ownerId: user.id, name: "Fixture", slug: key } });
    const channel = await prisma.channel.create({ data: { workspaceId: workspace.id, name: "Fixture", slug: key, language: "fr" } });
    const req = { auth: { workspaceId: workspace.id } } as unknown as AuthenticatedRequest;
    const controller = new ResearchQuestionsController(prisma);
    const input = { question: "Why did the artifact change?", subtopic: "artifact", origin: "AUDIENCE", idempotencyKey: key };
    const question = await controller.create(req, channel.id, input);
    expect(question.status).toBe("INVESTIGATE"); expect(question.evidence).toBeNull();
    expect((await controller.create(req, channel.id, input)).id).toBe(question.id);
    await expect(controller.create(req, channel.id, { ...input, question: "A different claim?" })).rejects.toThrow("RESEARCH_QUESTION_KEY_CONFLICT");
    await expect(controller.list({ auth: { workspaceId: "foreign" } } as unknown as AuthenticatedRequest, channel.id)).rejects.toThrow("CHANNEL_NOT_FOUND");
    expect((await controller.presets(req, channel.id)).presets.every((preset) => preset.profile.language === "fr")).toBe(true);
    await expect(controller.recheck(req, channel.id, "foreign-question")).rejects.toThrow("RESEARCH_QUESTION_NOT_FOUND");
    expect(await prisma.contentIdea.count({ where: { channelId: channel.id } })).toBe(0);
  });
});
