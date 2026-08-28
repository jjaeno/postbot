-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(320) NOT NULL,
    `displayName` VARCHAR(120) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Seoul',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(128) NOT NULL,
    `familyId` VARCHAR(191) NOT NULL,
    `replacedById` VARCHAR(191) NULL,
    `userAgentHash` VARCHAR(128) NULL,
    `ipHash` VARCHAR(128) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `reuseDetectedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `auth_sessions_tokenHash_key`(`tokenHash`),
    UNIQUE INDEX `auth_sessions_replacedById_key`(`replacedById`),
    INDEX `auth_sessions_userId_expiresAt_idx`(`userId`, `expiresAt`),
    INDEX `auth_sessions_workspaceId_idx`(`workspaceId`),
    INDEX `auth_sessions_familyId_idx`(`familyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workspaces` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `slug` VARCHAR(80) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `workspaces_slug_key`(`slug`),
    INDEX `workspaces_ownerId_idx`(`ownerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `memberships` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `role` ENUM('OWNER', 'MEMBER') NOT NULL DEFAULT 'OWNER',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `memberships_userId_idx`(`userId`),
    UNIQUE INDEX `memberships_workspaceId_userId_key`(`workspaceId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `channels` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `slug` VARCHAR(80) NOT NULL,
    `description` TEXT NULL,
    `language` VARCHAR(16) NOT NULL DEFAULT 'ko',
    `targetAudience` VARCHAR(255) NULL,
    `topic` VARCHAR(255) NULL,
    `excludedTopics` JSON NULL,
    `status` ENUM('ACTIVE', 'PAUSED', 'ERROR') NOT NULL DEFAULT 'ACTIVE',
    `automationMode` ENUM('APPROVAL', 'FULL_AUTO') NOT NULL DEFAULT 'APPROVAL',
    `minInventoryCount` INTEGER NOT NULL DEFAULT 3,
    `dailyPublishLimit` INTEGER NOT NULL DEFAULT 1,
    `errorAction` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `channels_workspaceId_status_idx`(`workspaceId`, `status`),
    UNIQUE INDEX `channels_workspaceId_slug_key`(`workspaceId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NULL,
    `platform` ENUM('YOUTUBE', 'INSTAGRAM', 'TIKTOK') NOT NULL,
    `externalAccountId` VARCHAR(191) NOT NULL,
    `handle` VARCHAR(191) NULL,
    `displayName` VARCHAR(191) NULL,
    `status` ENUM('CONNECTED', 'EXPIRED', 'REVOKED', 'DISCONNECTED') NOT NULL DEFAULT 'CONNECTED',
    `connectedAt` DATETIME(3) NULL,
    `disconnectedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `platform_accounts_workspaceId_platform_status_idx`(`workspaceId`, `platform`, `status`),
    UNIQUE INDEX `platform_accounts_platform_externalAccountId_key`(`platform`, `externalAccountId`),
    UNIQUE INDEX `platform_accounts_channelId_platform_key`(`channelId`, `platform`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oauth_credentials` (
    `id` VARCHAR(191) NOT NULL,
    `platformAccountId` VARCHAR(191) NOT NULL,
    `encryptedAccessToken` TEXT NOT NULL,
    `encryptedRefreshToken` TEXT NULL,
    `tokenCipher` VARCHAR(64) NOT NULL,
    `tokenKeyVersion` INTEGER NOT NULL,
    `scopeHash` VARCHAR(128) NOT NULL,
    `scopes` JSON NOT NULL,
    `expiresAt` DATETIME(3) NULL,
    `lastRefreshedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `oauth_credentials_platformAccountId_key`(`platformAccountId`),
    INDEX `oauth_credentials_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `channel_templates` (
    `id` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `tone` VARCHAR(120) NULL,
    `voiceProfile` VARCHAR(120) NULL,
    `subtitleStyle` JSON NULL,
    `visualStyle` JSON NULL,
    `aiStockRatio` DECIMAL(7, 6) NOT NULL DEFAULT 0.500000,
    `isActive` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `channel_templates_channelId_isActive_idx`(`channelId`, `isActive`),
    UNIQUE INDEX `channel_templates_channelId_version_key`(`channelId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_output_profiles` (
    `id` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `platform` ENUM('YOUTUBE', 'INSTAGRAM', 'TIKTOK') NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `minDurationSeconds` INTEGER NOT NULL DEFAULT 30,
    `maxDurationSeconds` INTEGER NOT NULL DEFAULT 90,
    `hookStyle` VARCHAR(120) NULL,
    `captionStyle` VARCHAR(120) NULL,
    `metadataRules` JSON NULL,
    `publicSetting` VARCHAR(40) NOT NULL DEFAULT 'PUBLIC',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `platform_output_profiles_channelId_platform_isActive_idx`(`channelId`, `platform`, `isActive`),
    UNIQUE INDEX `platform_output_profiles_channelId_platform_version_key`(`channelId`, `platform`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `schedule_rules` (
    `id` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `platform` ENUM('YOUTUBE', 'INSTAGRAM', 'TIKTOK') NULL,
    `dayOfWeek` INTEGER NOT NULL,
    `timeOfDayUtc` VARCHAR(8) NOT NULL,
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Seoul',
    `maxPosts` INTEGER NOT NULL DEFAULT 1,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `schedule_rules_channelId_platform_isActive_idx`(`channelId`, `platform`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_items` (
    `id` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `status` ENUM('IDEA', 'VALIDATING', 'GENERATING', 'REVIEW_REQUIRED', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'HELD') NOT NULL DEFAULT 'IDEA',
    `title` VARCHAR(255) NOT NULL,
    `summary` TEXT NULL,
    `topicKey` VARCHAR(191) NOT NULL,
    `eventAt` DATETIME(3) NULL,
    `collectedAt` DATETIME(3) NULL,
    `riskLevel` INTEGER NOT NULL DEFAULT 0,
    `suitabilityScore` DECIMAL(7, 6) NULL,
    `duplicateGroupKey` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `heldReason` TEXT NULL,
    `failureReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `content_items_channelId_status_createdAt_idx`(`channelId`, `status`, `createdAt`),
    INDEX `content_items_channelId_duplicateGroupKey_idx`(`channelId`, `duplicateGroupKey`),
    UNIQUE INDEX `content_items_channelId_topicKey_key`(`channelId`, `topicKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `source_references` (
    `id` VARCHAR(191) NOT NULL,
    `contentItemId` VARCHAR(191) NOT NULL,
    `kind` ENUM('NEWS', 'OFFICIAL', 'PAPER', 'RSS', 'PUBLIC_DATA', 'MANUAL') NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `url` TEXT NOT NULL,
    `urlHash` VARCHAR(128) NOT NULL,
    `sourceName` VARCHAR(191) NOT NULL,
    `author` VARCHAR(191) NULL,
    `publishedAt` DATETIME(3) NULL,
    `eventAt` DATETIME(3) NULL,
    `reliabilityScore` DECIMAL(7, 6) NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `normalizedSnapshot` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `source_references_kind_publishedAt_idx`(`kind`, `publishedAt`),
    UNIQUE INDEX `source_references_contentItemId_urlHash_key`(`contentItemId`, `urlHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `script_versions` (
    `id` VARCHAR(191) NOT NULL,
    `contentItemId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `platform` ENUM('YOUTUBE', 'INSTAGRAM', 'TIKTOK') NULL,
    `hook` TEXT NOT NULL,
    `body` TEXT NOT NULL,
    `callToAction` TEXT NULL,
    `language` VARCHAR(16) NOT NULL DEFAULT 'ko',
    `durationSeconds` DECIMAL(8, 3) NULL,
    `promptVersion` VARCHAR(80) NULL,
    `qualitySnapshot` JSON NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `script_versions_contentItemId_createdAt_idx`(`contentItemId`, `createdAt`),
    UNIQUE INDEX `script_versions_contentItemId_platform_version_key`(`contentItemId`, `platform`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scene_versions` (
    `id` VARCHAR(191) NOT NULL,
    `contentItemId` VARCHAR(191) NOT NULL,
    `scriptVersionId` VARCHAR(191) NULL,
    `version` INTEGER NOT NULL,
    `schemaVersion` VARCHAR(40) NOT NULL,
    `platform` ENUM('YOUTUBE', 'INSTAGRAM', 'TIKTOK') NULL,
    `sceneDocument` JSON NOT NULL,
    `renderManifest` JSON NULL,
    `durationSeconds` DECIMAL(8, 3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `scene_versions_scriptVersionId_idx`(`scriptVersionId`),
    UNIQUE INDEX `scene_versions_contentItemId_platform_version_key`(`contentItemId`, `platform`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assets` (
    `id` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NULL,
    `kind` ENUM('IMAGE', 'VIDEO', 'AUDIO', 'FONT', 'GRAPHIC') NOT NULL,
    `origin` ENUM('INTERNAL', 'STOCK_FREE', 'STOCK_PAID', 'PUBLIC_DOMAIN', 'AI_GENERATED') NOT NULL,
    `storageKey` VARCHAR(512) NOT NULL,
    `checksumSha256` VARCHAR(64) NOT NULL,
    `mimeType` VARCHAR(120) NOT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `durationSeconds` DECIMAL(8, 3) NULL,
    `hasWatermark` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `assets_checksumSha256_key`(`checksumSha256`),
    INDEX `assets_channelId_kind_origin_idx`(`channelId`, `kind`, `origin`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asset_sources` (
    `id` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(80) NOT NULL,
    `model` VARCHAR(120) NULL,
    `prompt` TEXT NULL,
    `sourceUrl` TEXT NULL,
    `creator` VARCHAR(191) NULL,
    `downloadedAt` DATETIME(3) NULL,
    `providerResponse` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `asset_sources_assetId_provider_idx`(`assetId`, `provider`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asset_licenses` (
    `id` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
    `licenseName` VARCHAR(191) NOT NULL,
    `commercialUseAllowed` BOOLEAN NOT NULL DEFAULT false,
    `derivativeAllowed` BOOLEAN NOT NULL DEFAULT false,
    `attributionRequired` BOOLEAN NOT NULL DEFAULT false,
    `attributionText` TEXT NULL,
    `proofUrl` TEXT NULL,
    `validFrom` DATETIME(3) NULL,
    `validUntil` DATETIME(3) NULL,
    `checkedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `asset_licenses_assetId_status_checkedAt_idx`(`assetId`, `status`, `checkedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asset_usages` (
    `id` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `contentItemId` VARCHAR(191) NOT NULL,
    `sceneVersionId` VARCHAR(191) NULL,
    `purpose` VARCHAR(120) NOT NULL,
    `usageSnapshot` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `asset_usages_contentItemId_idx`(`contentItemId`),
    UNIQUE INDEX `asset_usages_assetId_contentItemId_purpose_key`(`assetId`, `contentItemId`, `purpose`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `production_jobs` (
    `id` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NULL,
    `contentItemId` VARCHAR(191) NULL,
    `type` ENUM('COLLECT', 'SCRIPT', 'ASSET', 'TTS', 'RENDER', 'POLICY', 'PUBLISH', 'ANALYTICS') NOT NULL,
    `status` ENUM('QUEUED', 'RUNNING', 'RETRY_WAIT', 'NEEDS_REVIEW', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED') NOT NULL DEFAULT 'QUEUED',
    `queueName` VARCHAR(80) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `result` JSON NULL,
    `errorCode` VARCHAR(80) NULL,
    `errorMessage` TEXT NULL,
    `runAfter` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `production_jobs_idempotencyKey_key`(`idempotencyKey`),
    INDEX `production_jobs_queueName_status_runAfter_idx`(`queueName`, `status`, `runAfter`),
    INDEX `production_jobs_contentItemId_type_status_idx`(`contentItemId`, `type`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `job_attempts` (
    `id` VARCHAR(191) NOT NULL,
    `productionJobId` VARCHAR(191) NOT NULL,
    `attemptNumber` INTEGER NOT NULL,
    `status` ENUM('QUEUED', 'RUNNING', 'RETRY_WAIT', 'NEEDS_REVIEW', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED') NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `errorCode` VARCHAR(80) NULL,
    `errorMessage` TEXT NULL,
    `logsRef` VARCHAR(512) NULL,

    UNIQUE INDEX `job_attempts_productionJobId_attemptNumber_key`(`productionJobId`, `attemptNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `policy_rules` (
    `id` VARCHAR(191) NOT NULL,
    `platform` ENUM('YOUTUBE', 'INSTAGRAM', 'TIKTOK') NOT NULL,
    `region` VARCHAR(32) NOT NULL DEFAULT 'GLOBAL',
    `version` INTEGER NOT NULL,
    `effectiveAt` DATETIME(3) NOT NULL,
    `checkedAt` DATETIME(3) NOT NULL,
    `durationRule` JSON NOT NULL,
    `originalityRule` JSON NOT NULL,
    `aiDisclosureRule` JSON NOT NULL,
    `rightsRule` JSON NOT NULL,
    `restrictedTopics` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `policy_rules_platform_region_effectiveAt_idx`(`platform`, `region`, `effectiveAt`),
    UNIQUE INDEX `policy_rules_platform_region_version_key`(`platform`, `region`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `policy_checks` (
    `id` VARCHAR(191) NOT NULL,
    `contentItemId` VARCHAR(191) NOT NULL,
    `policyRuleId` VARCHAR(191) NOT NULL,
    `platform` ENUM('YOUTUBE', 'INSTAGRAM', 'TIKTOK') NOT NULL,
    `status` ENUM('PASS', 'WARNING', 'FAIL', 'UNKNOWN') NOT NULL,
    `reasons` JSON NOT NULL,
    `checkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `policy_checks_contentItemId_platform_status_idx`(`contentItemId`, `platform`, `status`),
    INDEX `policy_checks_policyRuleId_idx`(`policyRuleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `policy_snapshots` (
    `id` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NULL,
    `policyRuleId` VARCHAR(191) NOT NULL,
    `policyCheckId` VARCHAR(191) NULL,
    `snapshot` JSON NOT NULL,
    `checkedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `policy_snapshots_channelId_createdAt_idx`(`channelId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `publish_plans` (
    `id` VARCHAR(191) NOT NULL,
    `contentItemId` VARCHAR(191) NOT NULL,
    `platform` ENUM('YOUTUBE', 'INSTAGRAM', 'TIKTOK') NOT NULL,
    `platformAccountId` VARCHAR(191) NOT NULL,
    `sceneVersionId` VARCHAR(191) NULL,
    `policySnapshotId` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'HELD', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `scheduledAt` DATETIME(3) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `hashtags` JSON NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `publish_plans_idempotencyKey_key`(`idempotencyKey`),
    INDEX `publish_plans_platform_status_scheduledAt_idx`(`platform`, `status`, `scheduledAt`),
    INDEX `publish_plans_platformAccountId_scheduledAt_idx`(`platformAccountId`, `scheduledAt`),
    UNIQUE INDEX `publish_plans_contentItemId_platform_key`(`contentItemId`, `platform`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `publish_attempts` (
    `id` VARCHAR(191) NOT NULL,
    `publishPlanId` VARCHAR(191) NOT NULL,
    `attemptNumber` INTEGER NOT NULL,
    `status` ENUM('QUEUED', 'RUNNING', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `requestSnapshot` JSON NULL,
    `responseSnapshot` JSON NULL,
    `errorCode` VARCHAR(80) NULL,
    `errorMessage` TEXT NULL,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `publish_attempts_idempotencyKey_key`(`idempotencyKey`),
    INDEX `publish_attempts_publishPlanId_status_idx`(`publishPlanId`, `status`),
    UNIQUE INDEX `publish_attempts_publishPlanId_attemptNumber_key`(`publishPlanId`, `attemptNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_posts` (
    `id` VARCHAR(191) NOT NULL,
    `publishPlanId` VARCHAR(191) NOT NULL,
    `platformAccountId` VARCHAR(191) NOT NULL,
    `platform` ENUM('YOUTUBE', 'INSTAGRAM', 'TIKTOK') NOT NULL,
    `externalPostId` VARCHAR(191) NOT NULL,
    `postUrl` TEXT NOT NULL,
    `publishedAt` DATETIME(3) NOT NULL,
    `policyVersion` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `platform_posts_publishPlanId_key`(`publishPlanId`),
    INDEX `platform_posts_platformAccountId_publishedAt_idx`(`platformAccountId`, `publishedAt`),
    UNIQUE INDEX `platform_posts_platform_externalPostId_key`(`platform`, `externalPostId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `provider_usages` (
    `id` VARCHAR(191) NOT NULL,
    `contentItemId` VARCHAR(191) NULL,
    `productionJobId` VARCHAR(191) NULL,
    `provider` VARCHAR(80) NOT NULL,
    `model` VARCHAR(120) NULL,
    `operation` VARCHAR(80) NOT NULL,
    `quantity` DECIMAL(18, 6) NOT NULL,
    `unit` VARCHAR(40) NOT NULL,
    `unitPrice` DECIMAL(18, 6) NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'USD',
    `estimatedCost` DECIMAL(18, 6) NULL,
    `actualCost` DECIMAL(18, 6) NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `providerResponse` JSON NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `provider_usages_idempotencyKey_key`(`idempotencyKey`),
    INDEX `provider_usages_provider_operation_occurredAt_idx`(`provider`, `operation`, `occurredAt`),
    INDEX `provider_usages_contentItemId_idx`(`contentItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cost_ledger` (
    `id` VARCHAR(191) NOT NULL,
    `contentItemId` VARCHAR(191) NULL,
    `providerUsageId` VARCHAR(191) NULL,
    `direction` ENUM('ESTIMATED', 'ACTUAL', 'CREDIT') NOT NULL,
    `category` VARCHAR(80) NOT NULL,
    `amount` DECIMAL(18, 6) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'USD',
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `note` VARCHAR(255) NULL,

    INDEX `cost_ledger_contentItemId_occurredAt_idx`(`contentItemId`, `occurredAt`),
    INDEX `cost_ledger_category_occurredAt_idx`(`category`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `strategy_versions` (
    `id` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `contentItemId` VARCHAR(191) NULL,
    `version` INTEGER NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `strategy` JSON NOT NULL,
    `promptVersion` VARCHAR(80) NULL,
    `appliedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `strategy_versions_channelId_appliedAt_idx`(`channelId`, `appliedAt`),
    UNIQUE INDEX `strategy_versions_channelId_version_key`(`channelId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `optimization_suggestions` (
    `id` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `contentItemId` VARCHAR(191) NULL,
    `strategyVersionId` VARCHAR(191) NULL,
    `status` ENUM('PROPOSED', 'APPROVED', 'REJECTED', 'HELD', 'APPLIED') NOT NULL DEFAULT 'PROPOSED',
    `title` VARCHAR(191) NOT NULL,
    `rationale` TEXT NOT NULL,
    `evidence` JSON NOT NULL,
    `sampleSize` INTEGER NOT NULL,
    `confidenceScore` DECIMAL(7, 6) NULL,
    `expectedImpact` JSON NULL,
    `decidedAt` DATETIME(3) NULL,
    `appliedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `optimization_suggestions_channelId_status_createdAt_idx`(`channelId`, `status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `experiments` (
    `id` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `contentItemId` VARCHAR(191) NULL,
    `strategyVersionId` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `name` VARCHAR(120) NOT NULL,
    `hypothesis` TEXT NOT NULL,
    `allocation` JSON NOT NULL,
    `successCriteria` JSON NOT NULL,
    `startedAt` DATETIME(3) NULL,
    `endedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `experiments_channelId_status_createdAt_idx`(`channelId`, `status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_replacedById_fkey` FOREIGN KEY (`replacedById`) REFERENCES `auth_sessions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspaces` ADD CONSTRAINT `workspaces_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `channels` ADD CONSTRAINT `channels_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `platform_accounts` ADD CONSTRAINT `platform_accounts_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `channels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `platform_accounts` ADD CONSTRAINT `platform_accounts_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `oauth_credentials` ADD CONSTRAINT `oauth_credentials_platformAccountId_fkey` FOREIGN KEY (`platformAccountId`) REFERENCES `platform_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `channel_templates` ADD CONSTRAINT `channel_templates_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `channels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `platform_output_profiles` ADD CONSTRAINT `platform_output_profiles_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `channels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_rules` ADD CONSTRAINT `schedule_rules_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `channels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `content_items` ADD CONSTRAINT `content_items_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `channels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `source_references` ADD CONSTRAINT `source_references_contentItemId_fkey` FOREIGN KEY (`contentItemId`) REFERENCES `content_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `script_versions` ADD CONSTRAINT `script_versions_contentItemId_fkey` FOREIGN KEY (`contentItemId`) REFERENCES `content_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `scene_versions` ADD CONSTRAINT `scene_versions_contentItemId_fkey` FOREIGN KEY (`contentItemId`) REFERENCES `content_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `scene_versions` ADD CONSTRAINT `scene_versions_scriptVersionId_fkey` FOREIGN KEY (`scriptVersionId`) REFERENCES `script_versions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assets` ADD CONSTRAINT `assets_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `channels`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_sources` ADD CONSTRAINT `asset_sources_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_licenses` ADD CONSTRAINT `asset_licenses_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_usages` ADD CONSTRAINT `asset_usages_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_usages` ADD CONSTRAINT `asset_usages_contentItemId_fkey` FOREIGN KEY (`contentItemId`) REFERENCES `content_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_usages` ADD CONSTRAINT `asset_usages_sceneVersionId_fkey` FOREIGN KEY (`sceneVersionId`) REFERENCES `scene_versions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `production_jobs` ADD CONSTRAINT `production_jobs_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `channels`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `production_jobs` ADD CONSTRAINT `production_jobs_contentItemId_fkey` FOREIGN KEY (`contentItemId`) REFERENCES `content_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `job_attempts` ADD CONSTRAINT `job_attempts_productionJobId_fkey` FOREIGN KEY (`productionJobId`) REFERENCES `production_jobs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `policy_checks` ADD CONSTRAINT `policy_checks_contentItemId_fkey` FOREIGN KEY (`contentItemId`) REFERENCES `content_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `policy_checks` ADD CONSTRAINT `policy_checks_policyRuleId_fkey` FOREIGN KEY (`policyRuleId`) REFERENCES `policy_rules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `policy_snapshots` ADD CONSTRAINT `policy_snapshots_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `channels`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `policy_snapshots` ADD CONSTRAINT `policy_snapshots_policyRuleId_fkey` FOREIGN KEY (`policyRuleId`) REFERENCES `policy_rules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `policy_snapshots` ADD CONSTRAINT `policy_snapshots_policyCheckId_fkey` FOREIGN KEY (`policyCheckId`) REFERENCES `policy_checks`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `publish_plans` ADD CONSTRAINT `publish_plans_contentItemId_fkey` FOREIGN KEY (`contentItemId`) REFERENCES `content_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `publish_plans` ADD CONSTRAINT `publish_plans_platformAccountId_fkey` FOREIGN KEY (`platformAccountId`) REFERENCES `platform_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `publish_plans` ADD CONSTRAINT `publish_plans_sceneVersionId_fkey` FOREIGN KEY (`sceneVersionId`) REFERENCES `scene_versions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `publish_plans` ADD CONSTRAINT `publish_plans_policySnapshotId_fkey` FOREIGN KEY (`policySnapshotId`) REFERENCES `policy_snapshots`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `publish_attempts` ADD CONSTRAINT `publish_attempts_publishPlanId_fkey` FOREIGN KEY (`publishPlanId`) REFERENCES `publish_plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `platform_posts` ADD CONSTRAINT `platform_posts_publishPlanId_fkey` FOREIGN KEY (`publishPlanId`) REFERENCES `publish_plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `platform_posts` ADD CONSTRAINT `platform_posts_platformAccountId_fkey` FOREIGN KEY (`platformAccountId`) REFERENCES `platform_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `provider_usages` ADD CONSTRAINT `provider_usages_contentItemId_fkey` FOREIGN KEY (`contentItemId`) REFERENCES `content_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `provider_usages` ADD CONSTRAINT `provider_usages_productionJobId_fkey` FOREIGN KEY (`productionJobId`) REFERENCES `production_jobs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cost_ledger` ADD CONSTRAINT `cost_ledger_contentItemId_fkey` FOREIGN KEY (`contentItemId`) REFERENCES `content_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cost_ledger` ADD CONSTRAINT `cost_ledger_providerUsageId_fkey` FOREIGN KEY (`providerUsageId`) REFERENCES `provider_usages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `strategy_versions` ADD CONSTRAINT `strategy_versions_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `channels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `strategy_versions` ADD CONSTRAINT `strategy_versions_contentItemId_fkey` FOREIGN KEY (`contentItemId`) REFERENCES `content_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `optimization_suggestions` ADD CONSTRAINT `optimization_suggestions_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `channels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `optimization_suggestions` ADD CONSTRAINT `optimization_suggestions_contentItemId_fkey` FOREIGN KEY (`contentItemId`) REFERENCES `content_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `optimization_suggestions` ADD CONSTRAINT `optimization_suggestions_strategyVersionId_fkey` FOREIGN KEY (`strategyVersionId`) REFERENCES `strategy_versions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `experiments` ADD CONSTRAINT `experiments_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `channels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `experiments` ADD CONSTRAINT `experiments_contentItemId_fkey` FOREIGN KEY (`contentItemId`) REFERENCES `content_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `experiments` ADD CONSTRAINT `experiments_strategyVersionId_fkey` FOREIGN KEY (`strategyVersionId`) REFERENCES `strategy_versions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
