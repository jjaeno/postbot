import { z } from "zod";

export const HealthStatusSchema = z.enum(["ok"]);

export const HealthResponseSchema = z.object({
  status: HealthStatusSchema,
  service: z.string().min(1),
  version: z.string().min(1),
  checkedAt: z.string().datetime()
});

export type HealthStatus = z.infer<typeof HealthStatusSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const createHealthResponse = (service: string, version: string): HealthResponse => ({
  status: "ok",
  service,
  version,
  checkedAt: new Date().toISOString()
});

export const AuthUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  displayName: z.string().min(1),
  timezone: z.string().min(1)
});

export const AuthWorkspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  role: z.enum(["OWNER", "MEMBER"])
});

export const AuthSessionSchema = z.object({
  user: AuthUserSchema,
  workspace: AuthWorkspaceSchema
});

export const RegisterRequestSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(12).max(128),
  displayName: z.string().min(1).max(120),
  timezone: z.string().min(1).max(64).default("Asia/Seoul")
});

export const LoginRequestSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(128)
});

export const AuthResponseSchema = z.object({
  session: AuthSessionSchema,
  csrfToken: z.string().min(32)
});

export const ErrorResponseSchema = z.object({
  message: z.string().min(1),
  code: z.string().min(1)
});

export type AuthUser = z.infer<typeof AuthUserSchema>;
export type AuthWorkspace = z.infer<typeof AuthWorkspaceSchema>;
export type AuthSession = z.infer<typeof AuthSessionSchema>;
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const PlatformSchema = z.enum(["YOUTUBE", "INSTAGRAM", "TIKTOK"]);
export const ChannelStatusSchema = z.enum(["ACTIVE", "PAUSED", "ERROR"]);
export const AutomationModeSchema = z.enum(["APPROVAL", "FULL_AUTO"]);
export const ConnectionStatusSchema = z.enum(["PLANNED", "CONNECTED", "EXPIRED", "REVOKED"]);

export const JsonObjectSchema = z.record(z.string(), z.unknown());

export const CollectionRuleSchema = z.object({
  keywords: z.array(z.string().min(1).max(80)).min(1).max(20),
  excludedKeywords: z.array(z.string().min(1).max(80)).max(20).default([]),
  allowedSources: z.array(z.string().url()).max(20).default([]),
  excludedSources: z.array(z.string().url()).max(20).default([]),
  recencyHours: z.number().int().min(1).max(24 * 30),
  collectionFrequencyMinutes: z.number().int().min(30).max(60 * 24 * 7)
});

export const ChannelTemplateInputSchema = z.object({
  name: z.string().min(1).max(120),
  tone: z.string().min(1).max(120),
  voiceProfile: z.string().min(1).max(120),
  subtitleStyle: JsonObjectSchema,
  visualStyle: JsonObjectSchema,
  aiStockRatio: z.number().min(0).max(1)
});

export const PlatformOutputProfileInputSchema = z
  .object({
    platform: PlatformSchema,
    minDurationSeconds: z.number().int().min(15).max(180),
    maxDurationSeconds: z.number().int().min(15).max(180),
    hookStyle: z.string().min(1).max(120),
    captionStyle: z.string().min(1).max(120),
    metadataRules: JsonObjectSchema,
    publicSetting: z.enum(["PUBLIC", "UNLISTED", "PRIVATE"]).default("PUBLIC")
  })
  .refine((value) => value.minDurationSeconds <= value.maxDurationSeconds, {
    message: "최소 길이는 최대 길이보다 길 수 없습니다.",
    path: ["minDurationSeconds"]
  });

export const ScheduleRuleInputSchema = z.object({
  platform: PlatformSchema.nullable().default(null),
  dayOfWeek: z.number().int().min(0).max(6),
  timeOfDayLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().min(1).max(64),
  maxPosts: z.number().int().min(1).max(10)
});

export const AutomationSettingsSchema = z.object({
  mode: AutomationModeSchema,
  minInventoryCount: z.number().int().min(1).max(100),
  dailyPublishLimit: z.number().int().min(1).max(20),
  errorAction: z.object({
    onPolicyFailure: z.enum(["hold", "regenerate"]),
    onAssetLicenseUnknown: z.enum(["hold"]),
    onConsecutiveFailures: z.enum(["pause_channel", "notify_only"])
  })
});

export const CreateChannelRequestSchema = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(1000).optional().default(""),
    language: z.string().min(2).max(16),
    targetAudience: z.string().min(3).max(255),
    topic: z.string().min(3).max(255),
    excludedTopics: z.array(z.string().min(1).max(80)).max(20).default([]),
    platforms: z.array(PlatformSchema).min(1).max(3),
    collectionRule: CollectionRuleSchema,
    template: ChannelTemplateInputSchema,
    outputProfiles: z.array(PlatformOutputProfileInputSchema).min(1).max(3),
    scheduleRules: z.array(ScheduleRuleInputSchema).min(1).max(21),
    automation: AutomationSettingsSchema
  })
  .superRefine((value, ctx) => {
    const selectedPlatforms = new Set(value.platforms);
    for (const profile of value.outputProfiles) {
      if (!selectedPlatforms.has(profile.platform)) {
        ctx.addIssue({
          code: "custom",
          path: ["outputProfiles"],
          message: "선택한 플랫폼의 출력 프로필만 저장할 수 있습니다."
        });
      }
    }
    for (const platform of selectedPlatforms) {
      if (!value.outputProfiles.some((profile) => profile.platform === platform)) {
        ctx.addIssue({
          code: "custom",
          path: ["outputProfiles"],
          message: "선택한 플랫폼마다 출력 프로필이 필요합니다."
        });
      }
    }
  });

export const UpdateChannelRequestSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).optional(),
  language: z.string().min(2).max(16).optional(),
  targetAudience: z.string().min(3).max(255).optional(),
  topic: z.string().min(3).max(255).optional(),
  excludedTopics: z.array(z.string().min(1).max(80)).max(20).optional(),
  status: ChannelStatusSchema.optional(),
  platforms: z.array(PlatformSchema).min(1).max(3).optional(),
  collectionRule: CollectionRuleSchema.optional(),
  template: ChannelTemplateInputSchema.optional(),
  outputProfiles: z.array(PlatformOutputProfileInputSchema).min(1).max(3).optional(),
  scheduleRules: z.array(ScheduleRuleInputSchema).min(1).max(21).optional(),
  automation: AutomationSettingsSchema.optional()
});

export const PlatformConnectionSchema = z.object({
  platform: PlatformSchema,
  status: ConnectionStatusSchema,
  handle: z.string().nullable(),
  displayName: z.string().nullable()
});

export const PlatformAccountResponseSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  channelId: z.string().nullable(),
  platform: PlatformSchema,
  externalAccountId: z.string().min(1),
  handle: z.string().nullable(),
  displayName: z.string().nullable(),
  status: ConnectionStatusSchema,
  scopes: z.array(z.string()),
  expiresAt: z.string().datetime().nullable(),
  connectedAt: z.string().datetime().nullable(),
  disconnectedAt: z.string().datetime().nullable()
});

export const PlatformAccountListResponseSchema = z.object({
  accounts: z.array(PlatformAccountResponseSchema)
});

export const StartOAuthConnectionRequestSchema = z.object({
  channelId: z.string().min(1).optional()
});

export const StartOAuthConnectionResponseSchema = z.object({
  authorizationUrl: z.string().url(),
  stateExpiresAt: z.string().datetime(),
  provider: z.enum(["fake", "google"]),
  requiredScopes: z.array(z.string())
});

export const OAuthCallbackQuerySchema = z.object({
  state: z.string().min(32),
  code: z.string().min(1)
});

export const OAuthCallbackResultSchema = z.object({
  account: PlatformAccountResponseSchema
});

export const DisconnectPlatformAccountResponseSchema = z.object({
  ok: z.literal(true)
});

export const ChannelResponseSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string(),
  language: z.string().min(1),
  targetAudience: z.string(),
  topic: z.string(),
  excludedTopics: z.array(z.string()),
  status: ChannelStatusSchema,
  automationMode: AutomationModeSchema,
  minInventoryCount: z.number().int(),
  dailyPublishLimit: z.number().int(),
  errorAction: AutomationSettingsSchema.shape.errorAction,
  collectionRule: CollectionRuleSchema,
  template: ChannelTemplateInputSchema,
  outputProfiles: z.array(PlatformOutputProfileInputSchema),
  scheduleRules: z.array(ScheduleRuleInputSchema),
  platformConnections: z.array(PlatformConnectionSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const ChannelListResponseSchema = z.object({
  channels: z.array(ChannelResponseSchema)
});

export type Platform = z.infer<typeof PlatformSchema>;
export type ChannelStatus = z.infer<typeof ChannelStatusSchema>;
export type AutomationMode = z.infer<typeof AutomationModeSchema>;
export type CollectionRule = z.infer<typeof CollectionRuleSchema>;
export type ChannelTemplateInput = z.infer<typeof ChannelTemplateInputSchema>;
export type PlatformOutputProfileInput = z.infer<typeof PlatformOutputProfileInputSchema>;
export type ScheduleRuleInput = z.infer<typeof ScheduleRuleInputSchema>;
export type AutomationSettings = z.infer<typeof AutomationSettingsSchema>;
export type CreateChannelRequest = z.infer<typeof CreateChannelRequestSchema>;
export type UpdateChannelRequest = z.infer<typeof UpdateChannelRequestSchema>;
export type PlatformConnection = z.infer<typeof PlatformConnectionSchema>;
export type PlatformAccountResponse = z.infer<typeof PlatformAccountResponseSchema>;
export type PlatformAccountListResponse = z.infer<typeof PlatformAccountListResponseSchema>;
export type StartOAuthConnectionRequest = z.infer<typeof StartOAuthConnectionRequestSchema>;
export type StartOAuthConnectionResponse = z.infer<typeof StartOAuthConnectionResponseSchema>;
export type OAuthCallbackQuery = z.infer<typeof OAuthCallbackQuerySchema>;
export type OAuthCallbackResult = z.infer<typeof OAuthCallbackResultSchema>;
export type DisconnectPlatformAccountResponse = z.infer<typeof DisconnectPlatformAccountResponseSchema>;
export type ChannelResponse = z.infer<typeof ChannelResponseSchema>;
export type ChannelListResponse = z.infer<typeof ChannelListResponseSchema>;

export const ProductionJobTypeSchema = z.enum([
  "COLLECT",
  "SCRIPT",
  "ASSET",
  "TTS",
  "RENDER",
  "POLICY",
  "PUBLISH",
  "ANALYTICS"
]);

export const ProductionJobStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "RETRY_WAIT",
  "NEEDS_REVIEW",
  "SUCCEEDED",
  "FAILED",
  "CANCEL_REQUESTED",
  "CANCELLED"
]);

export const CreateProductionJobRequestSchema = z.object({
  type: ProductionJobTypeSchema,
  channelId: z.string().min(1),
  contentItemId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(8).max(191),
  payload: JsonObjectSchema.default({}),
  runAfter: z.string().datetime().optional()
});

export const RecoverProductionJobRequestSchema = z.object({
  runAfter: z.string().datetime().optional()
});

export const JobAttemptResponseSchema = z.object({
  id: z.string().min(1),
  attemptNumber: z.number().int().positive(),
  status: ProductionJobStatusSchema,
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable()
});

export const ProductionJobResponseSchema = z.object({
  id: z.string().min(1),
  channelId: z.string().nullable(),
  contentItemId: z.string().nullable(),
  type: ProductionJobTypeSchema,
  status: ProductionJobStatusSchema,
  queueName: z.string().min(1),
  idempotencyKey: z.string().min(1),
  payload: JsonObjectSchema,
  result: JsonObjectSchema.nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  runAfter: z.string().datetime().nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  attempts: z.array(JobAttemptResponseSchema),
  duplicate: z.boolean().optional()
});

export const JobProgressEventSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  status: ProductionJobStatusSchema,
  attemptNumber: z.number().int().positive().nullable(),
  progress: z.number().min(0).max(100),
  message: z.string(),
  createdAt: z.string().datetime()
});

export type ProductionJobType = z.infer<typeof ProductionJobTypeSchema>;
export type ProductionJobStatus = z.infer<typeof ProductionJobStatusSchema>;
export type CreateProductionJobRequest = z.infer<typeof CreateProductionJobRequestSchema>;
export type RecoverProductionJobRequest = z.infer<typeof RecoverProductionJobRequestSchema>;
export type JobAttemptResponse = z.infer<typeof JobAttemptResponseSchema>;
export type ProductionJobResponse = z.infer<typeof ProductionJobResponseSchema>;
export type JobProgressEvent = z.infer<typeof JobProgressEventSchema>;

export const IdeaStatusSchema = z.enum(["CANDIDATE", "SHORTLISTED", "REJECTED", "USED", "EXPIRED"]);

export const CollectIdeasRequestSchema = z.object({
  channelId: z.string().min(1),
  idempotencyKey: z.string().min(8).max(191),
  source: z.enum(["auto", "manual"]).default("auto"),
  manualCandidates: z
    .array(
      z.object({
        title: z.string().min(1).max(255),
        summary: z.string().max(2000).default(""),
        url: z.string().url(),
        sourceName: z.string().min(1).max(191),
        sourceKind: z.enum(["NEWS", "OFFICIAL", "PAPER", "RSS", "PUBLIC_DATA", "MANUAL"]).default("MANUAL"),
        publishedAt: z.string().datetime().nullable().default(null),
        body: z.string().max(10000).default(""),
        reliabilityScore: z.number().min(0).max(1).default(0.7)
      })
    )
    .max(20)
    .default([])
});

export const UpdateIdeaStatusRequestSchema = z.object({
  status: IdeaStatusSchema,
  rejectionReason: z.string().max(1000).optional()
});

export const ContentIdeaSchema = z.object({
  id: z.string().min(1),
  channelId: z.string().min(1),
  status: IdeaStatusSchema,
  title: z.string(),
  summary: z.string(),
  canonicalUrl: z.string().url(),
  sourceName: z.string(),
  sourceKind: z.enum(["NEWS", "OFFICIAL", "PAPER", "RSS", "PUBLIC_DATA", "MANUAL"]),
  provider: z.string(),
  publishedAt: z.string().datetime().nullable(),
  collectedAt: z.string().datetime(),
  suitabilityScore: z.number().min(0).max(1),
  freshnessScore: z.number().min(0).max(1),
  reliabilityScore: z.number().min(0).max(1),
  expectedValueScore: z.number().min(0).max(1),
  rejectionReason: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const CollectIdeasResponseSchema = z.object({
  channelId: z.string().min(1),
  created: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  ideas: z.array(ContentIdeaSchema)
});

export const ContentIdeaListResponseSchema = z.object({
  ideas: z.array(ContentIdeaSchema)
});

export type IdeaStatus = z.infer<typeof IdeaStatusSchema>;
export type CollectIdeasRequest = z.infer<typeof CollectIdeasRequestSchema>;
export type UpdateIdeaStatusRequest = z.infer<typeof UpdateIdeaStatusRequestSchema>;
export type ContentIdea = z.infer<typeof ContentIdeaSchema>;
export type CollectIdeasResponse = z.infer<typeof CollectIdeasResponseSchema>;
export type ContentIdeaListResponse = z.infer<typeof ContentIdeaListResponseSchema>;

export const GenerateScriptSceneRequestSchema = z.object({
  ideaId: z.string().min(1),
  platform: PlatformSchema.nullable().default(null),
  idempotencyKey: z.string().min(8).max(191),
  partial: z.enum(["full", "hook", "body", "metadata", "scene"]).default("full")
});

export const GenerationIdeaSnapshotSchema = z.object({
  id: z.string().min(1),
  channelId: z.string().min(1),
  title: z.string().min(1).max(255),
  summary: z.string().max(2000),
  canonicalUrl: z.string().url(),
  sourceName: z.string().min(1),
  sourceKind: z.enum(["NEWS", "OFFICIAL", "PAPER", "RSS", "PUBLIC_DATA", "MANUAL"]),
  publishedAt: z.string().datetime().nullable(),
  topic: z.string().min(1),
  language: z.string().min(2).max(16)
});

export const ScriptGenerationJobPayloadSchema = z.object({
  generation: z.object({
    request: GenerateScriptSceneRequestSchema,
    idea: GenerationIdeaSnapshotSchema
  })
});

export const FactSourceLinkSchema = z.object({
  claim: z.string().min(1).max(1000),
  sourceUrl: z.string().url()
});

export const GeneratedMetadataSchema = z.object({
  description: z.string().min(1).max(2000),
  hashtags: z.array(z.string().min(1).max(80)).max(20)
});

export const GeneratedScriptSchema = z.object({
  hook: z.string().min(1).max(280),
  body: z.string().min(1).max(2000),
  callToAction: z.string().min(1).max(280),
  language: z.string().min(2).max(16),
  durationSeconds: z.number().positive().max(180)
});

export const ScriptSceneGenerationResponseSchema = z.object({
  contentItemId: z.string().min(1),
  scriptVersionId: z.string().min(1),
  sceneVersionId: z.string().min(1),
  version: z.number().int().positive(),
  promptVersion: z.string().min(1),
  model: z.string().min(1),
  metadata: GeneratedMetadataSchema,
  script: GeneratedScriptSchema,
  facts: z.array(FactSourceLinkSchema).min(1),
  sceneDocument: JsonObjectSchema,
  usage: z.object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    estimatedCostUsd: z.string().min(1)
  }),
  duplicate: z.boolean().optional()
});

export type GenerateScriptSceneRequest = z.infer<typeof GenerateScriptSceneRequestSchema>;
export type GenerationIdeaSnapshot = z.infer<typeof GenerationIdeaSnapshotSchema>;
export type ScriptGenerationJobPayload = z.infer<typeof ScriptGenerationJobPayloadSchema>;
export type FactSourceLink = z.infer<typeof FactSourceLinkSchema>;
export type GeneratedMetadata = z.infer<typeof GeneratedMetadataSchema>;
export type GeneratedScript = z.infer<typeof GeneratedScriptSchema>;
export type ScriptSceneGenerationResponse = z.infer<typeof ScriptSceneGenerationResponseSchema>;
