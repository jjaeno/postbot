import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, Post, Req, UseGuards } from "@nestjs/common";
import { collectionProfilePreset, ResearchQuestionInputSchema } from "@postbot/contracts";
import type { PrismaClient } from "@postbot/database";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import type { AuthenticatedRequest } from "../auth/request-types.js";

@Controller("channels/:channelId/research")
@UseGuards(AccessTokenGuard)
export class ResearchQuestionsController {
  constructor(@Inject("PRISMA_CLIENT") private readonly prisma: PrismaClient) {}
  private async owned(workspaceId: string, channelId: string) {
    const channel = await this.prisma.channel.findFirst({ where: { id: channelId, workspaceId } });
    if (!channel) throw new NotFoundException("CHANNEL_NOT_FOUND"); return channel;
  }
  @Get("presets") async presets(@Req() req: AuthenticatedRequest, @Param("channelId") channelId: string) {
    const channel = await this.owned(req.auth.workspaceId, channelId);
    return { presets: (["HISTORY", "SCIENCE", "IT"] as const).map((kind) => ({ kind, profile: collectionProfilePreset(kind, channel.language) })) };
  }
  @Get("questions") async list(@Req() req: AuthenticatedRequest, @Param("channelId") channelId: string) {
    await this.owned(req.auth.workspaceId, channelId);
    return { questions: await this.prisma.researchQuestion.findMany({ where: { channelId }, orderBy: { createdAt: "desc" }, take: 100 }) };
  }
  @Post("questions") async create(@Req() req: AuthenticatedRequest, @Param("channelId") channelId: string, @Body() raw: unknown) {
    await this.owned(req.auth.workspaceId, channelId);
    const parsed = ResearchQuestionInputSchema.safeParse(raw); if (!parsed.success) throw new BadRequestException("RESEARCH_QUESTION_INVALID");
    const input = parsed.data;
    const result = await this.prisma.researchQuestion.upsert({ where: { channelId_idempotencyKey: { channelId, idempotencyKey: input.idempotencyKey } },
      create: { channelId, ...input }, update: {} });
    if (result.question !== input.question || result.subtopic !== input.subtopic || result.origin !== input.origin) throw new ConflictException("RESEARCH_QUESTION_KEY_CONFLICT");
    return result;
  }
  @Post("questions/:questionId/recheck") async recheck(@Req() req: AuthenticatedRequest, @Param("channelId") channelId: string, @Param("questionId") questionId: string) {
    await this.owned(req.auth.workspaceId, channelId);
    const result = await this.prisma.researchQuestion.updateMany({ where: { id: questionId, channelId }, data: { status: "INVESTIGATE", reason: "MANUAL_RECHECK_REQUESTED" } });
    if (!result.count) throw new NotFoundException("RESEARCH_QUESTION_NOT_FOUND");
    return { queuedForNextCollection: true };
  }
}
