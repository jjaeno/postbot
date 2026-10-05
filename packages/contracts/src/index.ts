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
  workspace: AuthWorkspaceSchema,
  csrfToken: z.string().min(32).nullable().optional()
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
  subtitleStyle: z.object({ color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), fontSize: z.number().int().min(32).max(64).optional() }).catchall(z.unknown()),
  visualStyle: z.object({ brandColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), fontFamily: z.enum(["Arial", "sans-serif", "serif"]).optional(), watermark: z.string().max(60).optional(), logoAssetId: z.string().min(1).max(80).optional() }).catchall(z.unknown()),
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
  timezone: z.string().min(1).max(64).refine((value) => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "유효한 IANA 시간대를 입력해 주세요. 예: Asia/Seoul"),
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
    startPaused: z.boolean().optional(),
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
  provider: z.enum(["fake", "google", "meta", "tiktok"]),
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

export const AssetPreparationJobPayloadSchema = z.object({
  assetPreparation: z.object({
    channelId: z.string().min(1),
    contentItemId: z.string().min(1).nullable().default(null),
    sceneVersionId: z.string().min(1).nullable().default(null),
    platform: PlatformSchema.nullable().default(null),
    prompt: z.string().min(1).max(2_000),
    idempotencyKey: z.string().min(8).max(191)
  })
});

export const TtsPreparationJobPayloadSchema = z.object({
  ttsPreparation: z.object({
    channelId: z.string().min(1),
    contentItemId: z.string().min(1),
    sceneVersionId: z.string().min(1).nullable().default(null),
    platform: PlatformSchema.nullable().default(null),
    text: z.string().min(1).max(10_000),
    voice: z.string().min(1).max(191),
    idempotencyKey: z.string().min(8).max(191)
  })
});

export const RenderJobPayloadSchema = z.object({
  render: z.object({
    channelId: z.string().min(1),
    contentItemId: z.string().min(1),
    sceneVersionId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(191)
  })
});

export const AutomationJobContextSchema = z.object({
  automation: z.object({ runId: z.string().min(1), stage: z.enum(["COLLECT", "SCRIPT", "ASSET", "TTS", "RENDER", "POLICY", "PUBLISH"]), platform: PlatformSchema.nullable().default(null) })
});

export const CollectAutomationJobPayloadSchema = AutomationJobContextSchema.extend({
  collect: z.object({
    channelId: z.string().min(1),
    topic: z.string().min(1),
    language: z.string().min(2).max(16),
    keywords: z.array(z.string()),
    allowedSources: z.array(z.string()),
    excludedSources: z.array(z.string()),
    excludedKeywords: z.array(z.string()),
    excludedTopics: z.array(z.string()),
    recencyHours: z.number().int().positive(),
    idempotencyKey: z.string().min(8).max(191)
  })
});

export const PolicyAutomationJobPayloadSchema = AutomationJobContextSchema.extend({
  policy: z.object({ contentItemId: z.string().min(1), platform: PlatformSchema, region: z.string().min(2).max(32).default("GLOBAL") })
});

export type AssetPreparationJobPayload = z.infer<typeof AssetPreparationJobPayloadSchema>;
export type TtsPreparationJobPayload = z.infer<typeof TtsPreparationJobPayloadSchema>;
export type RenderJobPayload = z.infer<typeof RenderJobPayloadSchema>;
export type CollectAutomationJobPayload = z.infer<typeof CollectAutomationJobPayloadSchema>;
export type PolicyAutomationJobPayload = z.infer<typeof PolicyAutomationJobPayloadSchema>;

export const PolicyVerdictSchema = z.enum(["pass", "warning", "review", "block"]);
export const ReviewActionSchema = z.enum(["approve", "hold", "discard", "schedule"]);
export const RunPolicyCheckRequestSchema = z.object({ platform: PlatformSchema, region: z.string().min(2).max(32).default("GLOBAL") });
export const ReviewActionRequestSchema = z.object({ action: ReviewActionSchema, platform: PlatformSchema.optional() });
export const UpdateReviewMetadataRequestSchema = z.object({
  platform: PlatformSchema.nullable().default(null),
  title: z.string().min(1).max(255),
  description: z.string().min(1).max(2_000),
  hashtags: z.array(z.string().min(1).max(80)).max(20)
});
export const PolicyFindingSchema = z.object({ code: z.string(), severity: PolicyVerdictSchema, message: z.string() });
export const ContentReviewResponseSchema = z.object({
  id: z.string(), channelId: z.string(), status: z.enum(["REVIEW_REQUIRED", "APPROVED", "SCHEDULED", "PUBLISHING", "PUBLISHED", "HELD", "FAILED"]), title: z.string(),
  description: z.string(), durationSeconds: z.number().positive().nullable(), sources: z.array(z.object({ title: z.string(), url: z.string(), sourceName: z.string() })),
  assets: z.array(z.object({ id: z.string(), licenseStatus: z.string(), purpose: z.string(), sceneVersionId: z.string().nullable().optional() })),
  policy: z.object({ status: PolicyVerdictSchema, findings: z.array(PolicyFindingSchema), snapshotId: z.string().nullable() }).nullable(),
  ideaId: z.string().nullable().default(null),
  outputs: z.array(z.object({
    platform: PlatformSchema.nullable(), scriptVersionId: z.string(), sceneVersionId: z.string().nullable(),
    scriptStatus: z.enum(["ready", "missing"]), renderStatus: z.enum(["ready", "pending"]), videoReady: z.boolean(),
    metadata: GeneratedMetadataSchema,
    title: z.string().default(""),
    script: z.object({ hook: z.string(), body: z.string(), callToAction: z.string().nullable(), language: z.string() }).nullable().default(null),
    durationSeconds: z.number().positive().nullable().default(null),
    reviewStatus: z.enum(["REVIEW_REQUIRED", "APPROVED", "HELD", "DISCARDED"]).default("REVIEW_REQUIRED"),
    policy: z.object({ status: PolicyVerdictSchema, findings: z.array(PolicyFindingSchema), snapshotId: z.string().nullable() }).nullable().default(null),
    publishStatus: z.enum(["DRAFT", "SCHEDULED", "PUBLISHING", "PUBLISHED", "FAILED", "HELD", "CANCELLED"]).nullable().default(null)
  })).default([])
});
export const ReviewPreviewResponseSchema = z.object({ url: z.string().url(), expiresInSeconds: z.number().int().positive() });
export type PolicyVerdict = z.infer<typeof PolicyVerdictSchema>;
export type RunPolicyCheckRequest = z.infer<typeof RunPolicyCheckRequestSchema>;
export type ReviewActionRequest = z.infer<typeof ReviewActionRequestSchema>;
export type UpdateReviewMetadataRequest = z.infer<typeof UpdateReviewMetadataRequestSchema>;
export type ContentReviewResponse = z.infer<typeof ContentReviewResponseSchema>;
export const ReviewAssetLicenseRequestSchema = z.object({ assetId: z.string().min(1), proofUrl: z.string().url().startsWith("https://"), licenseName: z.string().min(3).max(191), status: z.enum(["VERIFIED", "REJECTED"]), commercialUseAllowed: z.boolean(), derivativeAllowed: z.boolean() }).refine((value) => value.status !== "VERIFIED" || (value.commercialUseAllowed && value.derivativeAllowed), "검증 승인에는 상업 사용·변형 허용 증빙이 필요합니다.");
export type ReviewAssetLicenseRequest = z.infer<typeof ReviewAssetLicenseRequestSchema>;

export const ContentItemSummarySchema = z.object({
  id: z.string(), channelId: z.string(), title: z.string(), status: z.enum(["IDEA", "VALIDATING", "GENERATING", "REVIEW_REQUIRED", "APPROVED", "SCHEDULED", "PUBLISHING", "PUBLISHED", "FAILED", "HELD"]),
  updatedAt: z.string().datetime(), sceneVersionId: z.string().nullable(), renderReady: z.boolean(), platforms: z.array(PlatformSchema).default([])
});
export const ContentItemListResponseSchema = z.object({ items: z.array(ContentItemSummarySchema) });
export type ContentItemSummary = z.infer<typeof ContentItemSummarySchema>;
export type ContentItemListResponse = z.infer<typeof ContentItemListResponseSchema>;

export const CreatePublishPlanRequestSchema = z.object({ contentItemId: z.string().min(1), platformAccountId: z.string().min(1), scheduledAt: z.string().datetime(), idempotencyKey: z.string().min(8).max(191) });
export const PublishPlanResponseSchema = z.object({ id: z.string(), contentItemId: z.string(), platformAccountId: z.string(), platform: PlatformSchema, status: z.enum(["DRAFT", "SCHEDULED", "PUBLISHING", "PUBLISHED", "FAILED", "HELD", "CANCELLED"]), scheduledAt: z.string().datetime(), idempotencyKey: z.string(), title: z.string(), duplicate: z.boolean().optional() });
export type CreatePublishPlanRequest = z.infer<typeof CreatePublishPlanRequestSchema>;
export type PublishPlanResponse = z.infer<typeof PublishPlanResponseSchema>;
export const PublishCalendarItemSchema = z.object({
  id: z.string(), contentItemId: z.string(), channelId: z.string(), platform: PlatformSchema,
  status: z.enum(["DRAFT", "SCHEDULED", "PUBLISHING", "PUBLISHED", "FAILED", "HELD", "CANCELLED"]),
  scheduledAt: z.string().datetime(), title: z.string(), postUrl: z.string().url().nullable(),
  publishedAt: z.string().datetime().nullable(), failureReason: z.string().nullable()
});
export type PublishCalendarItem = z.infer<typeof PublishCalendarItemSchema>;

export const AutomationRunStatusSchema = z.enum(["QUEUED", "RUNNING", "PAUSED", "DRAINING", "SUCCEEDED", "FAILED", "CANCELLED"]);
export const AutomationStageSchema = z.enum(["COLLECT", "SCRIPT", "ASSET", "TTS", "RENDER", "POLICY", "PUBLISH"]);
export const AutomationStepStatusSchema = z.enum(["PENDING", "QUEUED", "RUNNING", "SUCCEEDED", "HELD", "FAILED", "CANCELLED", "SKIPPED"]);
export const AutomationRunRequestSchema = z.object({
  channelId: z.string().min(1),
  idempotencyKey: z.string().min(8).max(191),
  ideaId: z.string().min(1).optional(),
  sample: z.boolean().optional(),
  platforms: z.array(PlatformSchema).min(1).max(3).optional(),
  partial: z.enum(["full", "hook", "body", "metadata", "scene"]).default("full")
});
export const AutomationControlRequestSchema = z.object({ action: z.enum(["pause", "resume", "drain", "kill", "retry", "hold", "skip"]), reason: z.string().max(500).optional(), stage: AutomationStageSchema.optional(), platform: PlatformSchema.optional() });
export const AutomationRunResponseSchema = z.object({
  id: z.string(), channelId: z.string(), status: AutomationRunStatusSchema, idempotencyKey: z.string(),
  createdAt: z.string().datetime().optional(), finishedAt: z.string().datetime().nullable().optional(),
  checkpoint: z.record(z.string(), z.unknown()).nullable(), failureCount: z.number().int(),
  pausedReason: z.string().nullable(),
  nextRunAt: z.string().datetime().nullable(), heartbeatAt: z.string().datetime().nullable(),
  lastErrorCode: z.string().nullable(), lastErrorMessage: z.string().nullable(),
  steps: z.array(z.object({ stage: AutomationStageSchema, platform: PlatformSchema.nullable(), status: AutomationStepStatusSchema, attemptCount: z.number().int(), maxAttempts: z.number().int(), productionJobId: z.string().nullable(), errorCode: z.string().nullable(), errorMessage: z.string().nullable(), output: JsonObjectSchema.nullable().optional() }))
});
export const AutomationBudgetRequestSchema = z.object({
  channelId: z.string().min(1).nullable().default(null), currency: z.string().length(3).default("USD"),
  dailySoftLimit: z.number().nonnegative().nullable().default(null), dailyHardLimit: z.number().nonnegative().nullable().default(null),
  monthlySoftLimit: z.number().nonnegative().nullable().default(null), monthlyHardLimit: z.number().nonnegative().nullable().default(null)
}).superRefine((value, ctx) => {
  if (value.dailySoftLimit !== null && value.dailyHardLimit !== null && value.dailySoftLimit > value.dailyHardLimit) ctx.addIssue({ code: "custom", path: ["dailySoftLimit"], message: "Soft limit cannot exceed hard limit." });
  if (value.monthlySoftLimit !== null && value.monthlyHardLimit !== null && value.monthlySoftLimit > value.monthlyHardLimit) ctx.addIssue({ code: "custom", path: ["monthlySoftLimit"], message: "Soft limit cannot exceed hard limit." });
});
export const AutomationSwitchRequestSchema = z.object({ provider: z.string().min(1).max(80).nullable().default(null), isEnabled: z.boolean(), reason: z.string().max(500).optional() });
export type AutomationRunStatus = z.infer<typeof AutomationRunStatusSchema>;
export type AutomationStage = z.infer<typeof AutomationStageSchema>;
export type AutomationStepStatus = z.infer<typeof AutomationStepStatusSchema>;
export type AutomationRunResponse = z.infer<typeof AutomationRunResponseSchema>;
export type AutomationBudgetRequest = z.infer<typeof AutomationBudgetRequestSchema>;
export const AutomationBudgetResponseSchema = z.object({
  id: z.string(), channelId: z.string().nullable(), currency: z.string().length(3),
  dailySoftLimit: z.number().nullable(), dailyHardLimit: z.number().nullable(),
  monthlySoftLimit: z.number().nullable(), monthlyHardLimit: z.number().nullable(),
  updatedAt: z.string().datetime()
});
export type AutomationBudgetResponse = z.infer<typeof AutomationBudgetResponseSchema>;
export const AnalyticsSyncRequestSchema = z.object({ channelId: z.string().min(1), platform: PlatformSchema, periodStart: z.string().datetime(), periodEnd: z.string().datetime(), timezone: z.string().min(1).max(64), idempotencyKey: z.string().min(8).max(191) }).refine((value) => value.periodStart < value.periodEnd, { message: "periodStart must precede periodEnd" });
export const AnalyticsMetricResponseSchema = z.object({ metric: z.string(), status: z.enum(["AVAILABLE", "UNAVAILABLE", "PARTIAL"]), value: z.number().nullable(), unit: z.string().nullable(), aggregation: z.string().nullable(), unavailableReason: z.string().nullable(), observedAt: z.string().datetime(), revision: z.number().int(), mappingVersion: z.string() });
export const AnalyticsReportResponseSchema = z.object({ channelId: z.string(), platform: PlatformSchema.optional(), periodStart: z.string().datetime(), periodEnd: z.string().datetime(), metrics: z.array(AnalyticsMetricResponseSchema), partial: z.boolean(), lastSyncedAt: z.string().datetime().nullable() });
export type AnalyticsSyncRequest = z.infer<typeof AnalyticsSyncRequestSchema>;
export type AnalyticsReportResponse = z.infer<typeof AnalyticsReportResponseSchema>;

export const OptimizationSettingsSchema = z.object({
  protectedTopics: z.array(z.string().min(1).max(120)).max(50).default([]),
  protectedBrandPhrases: z.array(z.string().min(1).max(120)).max(50).default([]),
  prohibitedPatterns: z.array(z.string().min(1).max(120)).max(50).default([]),
  autoApplyFields: z.array(z.enum(["durationSeconds", "hookStyle", "subtitleDensity", "publishHour"])).max(4).default([]),
  maxChangeRatio: z.number().min(0).max(0.5).default(0.2)
});
export const UpdateOptimizationSettingsRequestSchema = z.object({ channelId: z.string().min(1), settings: OptimizationSettingsSchema });
export const GenerateSuggestionsRequestSchema = z.object({ channelId: z.string().min(1), platform: PlatformSchema, metric: z.enum(["views", "impressions", "average_watch_seconds", "completion_rate", "engagement_rate"]), periodStart: z.string().datetime(), periodEnd: z.string().datetime(), idempotencyKey: z.string().min(8).max(128) }).refine((value) => value.periodStart < value.periodEnd, { message: "periodStart must precede periodEnd" });
export const SuggestionActionRequestSchema = z.object({ action: z.enum(["approve", "reject", "apply", "expire"]), reason: z.string().min(1).max(500).optional() });
export const ExperimentStrategySchema = z.object({ durationSeconds: z.number().positive().max(180) }).strict();
export const CreateExperimentRequestSchema = z.object({ channelId: z.string().min(1), name: z.string().min(1).max(120), hypothesis: z.string().min(1).max(2000), platform: PlatformSchema.default("YOUTUBE"), periodDays: z.number().int().min(1).max(90).default(30), targetMetric: z.string().min(1).max(80), minSampleSize: z.number().int().min(2).max(10_000), control: ExperimentStrategySchema, variant: ExperimentStrategySchema, successCriteria: z.object({ direction: z.enum(["higher", "lower"]).default("higher"), minRelativeImprovement: z.number().positive().max(1).default(0.1) }).strict(), stopCriteria: z.object({ maxAssignments: z.number().int().min(4).max(20_000) }).strict().optional() }).refine((value) => !value.stopCriteria || value.stopCriteria.maxAssignments >= value.minSampleSize * 2, "배정 상한은 두 그룹 최소 표본의 합 이상이어야 합니다.");
export const ExperimentActionRequestSchema = z.object({ action: z.enum(["start", "pause", "stop", "complete", "inconclusive"]), reason: z.string().min(1).max(500).optional() });
export const AssignExperimentRequestSchema = z.object({ contentItemId: z.string().min(1) });
export const OptimizationSuggestionResponseSchema = z.object({ id: z.string(), channelId: z.string(), status: z.enum(["PENDING", "PROPOSED", "APPROVED", "REJECTED", "HELD", "APPLIED", "EXPIRED"]), title: z.string(), rationale: z.string(), evidence: z.unknown(), targetStrategy: z.unknown().nullable(), sampleSize: z.number().int(), confidenceScore: z.number().nullable(), expectedImpact: z.unknown().nullable(), risk: z.unknown().nullable(), expiresAt: z.string().datetime().nullable(), createdAt: z.string().datetime(), appliedAt: z.string().datetime().nullable() });
export const ExperimentResponseSchema = z.object({ id: z.string(), channelId: z.string(), status: z.enum(["DRAFT", "RUNNING", "PAUSED", "COMPLETED", "CANCELLED", "STOPPED", "INCONCLUSIVE"]), name: z.string(), hypothesis: z.string(), targetMetric: z.string().nullable(), minSampleSize: z.number().int(), allocation: z.unknown(), successCriteria: z.unknown(), stopCriteria: z.unknown().nullable(), result: z.unknown().nullable(), stopReason: z.string().nullable(), startedAt: z.string().datetime().nullable(), endedAt: z.string().datetime().nullable() });
export type OptimizationSettings = z.infer<typeof OptimizationSettingsSchema>;
export type OptimizationSuggestionResponse = z.infer<typeof OptimizationSuggestionResponseSchema>;
export const StrategyVersionResponseSchema = z.object({ version: z.number().int(), name: z.string(), appliedAt: z.string().datetime().nullable(), strategy: JsonObjectSchema });
export type StrategyVersionResponse = z.infer<typeof StrategyVersionResponseSchema>;
export type ExperimentResponse = z.infer<typeof ExperimentResponseSchema>;

export const CostReportQuerySchema = z.object({ periodStart: z.string().datetime(), periodEnd: z.string().datetime(), channelId: z.string().min(1).optional(), provider: z.string().min(1).max(80).optional() }).refine((value) => value.periodStart < value.periodEnd, { message: "periodStart must precede periodEnd" });
export const CostReportResponseSchema = z.object({ currency: z.string(), periodStart: z.string().datetime(), periodEnd: z.string().datetime(), estimated: z.number(), actual: z.number(), credit: z.number(), reconciled: z.boolean(), discrepancy: z.number(), byProvider: z.array(z.object({ provider: z.string(), estimated: z.number(), actual: z.number(), credit: z.number() })) });
export const NotificationResponseSchema = z.object({ id: z.string(), eventKey: z.string(), severity: z.enum(["INFO", "WARNING", "CRITICAL"]), payload: z.unknown(), acknowledgedAt: z.string().datetime().nullable(), createdAt: z.string().datetime() });
export const AuditLogResponseSchema = z.object({ id: z.string(), action: z.string(), targetType: z.string(), targetId: z.string().nullable(), metadata: z.unknown().nullable(), createdAt: z.string().datetime() });
export const DataLifecycleRequestTypeSchema = z.enum(["WORKSPACE_DELETE", "USER_DELETE", "RETENTION"]);
export const DataLifecycleRequestStatusSchema = z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"]);
export const CreateDataLifecycleRequestSchema = z.object({
  type: DataLifecycleRequestTypeSchema,
  idempotencyKey: z.string().min(8).max(191),
  retentionBefore: z.string().datetime().optional()
}).superRefine((value, ctx) => {
  if (value.type === "RETENTION" && !value.retentionBefore) {
    ctx.addIssue({ code: "custom", path: ["retentionBefore"], message: "retentionBefore is required for retention work." });
  }
});
export const DataLifecycleRequestResponseSchema = z.object({
  id: z.string(), workspaceId: z.string().nullable(), requestedByUserId: z.string().nullable(),
  type: DataLifecycleRequestTypeSchema, status: DataLifecycleRequestStatusSchema,
  retentionBefore: z.string().datetime().nullable(), result: z.unknown().nullable(),
  errorCode: z.string().nullable(), errorMessage: z.string().nullable(),
  startedAt: z.string().datetime().nullable(), finishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), duplicate: z.boolean().optional()
});
export type CostReportResponse = z.infer<typeof CostReportResponseSchema>;
export type NotificationResponse = z.infer<typeof NotificationResponseSchema>;
export type AuditLogResponse = z.infer<typeof AuditLogResponseSchema>;
export type CreateDataLifecycleRequest = z.infer<typeof CreateDataLifecycleRequestSchema>;
export type DataLifecycleRequestResponse = z.infer<typeof DataLifecycleRequestResponseSchema>;
export type FactSourceLink = z.infer<typeof FactSourceLinkSchema>;
export type GeneratedMetadata = z.infer<typeof GeneratedMetadataSchema>;
export type GeneratedScript = z.infer<typeof GeneratedScriptSchema>;
export type ScriptSceneGenerationResponse = z.infer<typeof ScriptSceneGenerationResponseSchema>;
