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
export type ChannelResponse = z.infer<typeof ChannelResponseSchema>;
export type ChannelListResponse = z.infer<typeof ChannelListResponseSchema>;
