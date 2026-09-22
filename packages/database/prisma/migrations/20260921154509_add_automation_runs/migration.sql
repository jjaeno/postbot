-- CreateTable
CREATE TABLE `automation_runs` (
    `id` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `status` ENUM('QUEUED', 'RUNNING', 'PAUSED', 'DRAINING', 'SUCCEEDED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'QUEUED',
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `checkpoint` JSON NULL,
    `budgetReserved` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `budgetActual` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `failureCount` INTEGER NOT NULL DEFAULT 0,
    `pausedReason` TEXT NULL,
    `nextRunAt` DATETIME(3) NULL,
    `heartbeatAt` DATETIME(3) NULL,
    `lastErrorCode` VARCHAR(80) NULL,
    `lastErrorMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `automation_runs_idempotencyKey_key`(`idempotencyKey`),
    INDEX `automation_runs_channelId_status_createdAt_idx`(`channelId`, `status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `automation_runs` ADD CONSTRAINT `automation_runs_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `channels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `automation_steps` (
    `id` VARCHAR(191) NOT NULL,
    `automationRunId` VARCHAR(191) NOT NULL,
    `stage` ENUM('COLLECT', 'SCRIPT', 'ASSET', 'TTS', 'RENDER', 'POLICY', 'PUBLISH', 'ANALYTICS') NOT NULL,
    `status` ENUM('PENDING', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'HELD', 'FAILED', 'CANCELLED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `productionJobId` VARCHAR(191) NULL,
    `attemptCount` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 3,
    `output` JSON NULL,
    `errorCode` VARCHAR(80) NULL,
    `errorMessage` TEXT NULL,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `automation_steps_automationRunId_stage_key`(`automationRunId`, `stage`),
    UNIQUE INDEX `automation_steps_productionJobId_key`(`productionJobId`),
    INDEX `automation_steps_automationRunId_status_idx`(`automationRunId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `automation_budgets` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'USD',
    `dailySoftLimit` DECIMAL(18, 6) NULL,
    `dailyHardLimit` DECIMAL(18, 6) NULL,
    `monthlySoftLimit` DECIMAL(18, 6) NULL,
    `monthlyHardLimit` DECIMAL(18, 6) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `automation_budgets_workspaceId_channelId_key`(`workspaceId`, `channelId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `automation_cost_reservations` (
    `id` VARCHAR(191) NOT NULL,
    `automationRunId` VARCHAR(191) NOT NULL,
    `stage` ENUM('COLLECT', 'SCRIPT', 'ASSET', 'TTS', 'RENDER', 'POLICY', 'PUBLISH', 'ANALYTICS') NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(18, 6) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'USD',
    `releasedAt` DATETIME(3) NULL,
    `settledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `automation_cost_reservations_idempotencyKey_key`(`idempotencyKey`),
    INDEX `auto_cost_res_run_state_idx`(`automationRunId`, `releasedAt`, `settledAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `automation_events` (
    `id` VARCHAR(191) NOT NULL,
    `automationRunId` VARCHAR(191) NOT NULL,
    `action` ENUM('START', 'PAUSE', 'RESUME', 'DRAIN', 'KILL', 'RETRY', 'HOLD', 'AUTO_PAUSE') NOT NULL,
    `reason` TEXT NULL,
    `details` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `automation_events_automationRunId_createdAt_idx`(`automationRunId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `automation_switches` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(80) NULL,
    `isEnabled` BOOLEAN NOT NULL DEFAULT true,
    `reason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `automation_switches_workspaceId_provider_key`(`workspaceId`, `provider`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `automation_steps` ADD CONSTRAINT `automation_steps_automationRunId_fkey` FOREIGN KEY (`automationRunId`) REFERENCES `automation_runs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `automation_steps` ADD CONSTRAINT `automation_steps_productionJobId_fkey` FOREIGN KEY (`productionJobId`) REFERENCES `production_jobs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `automation_budgets` ADD CONSTRAINT `automation_budgets_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `automation_budgets` ADD CONSTRAINT `automation_budgets_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `channels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `automation_cost_reservations` ADD CONSTRAINT `automation_cost_reservations_automationRunId_fkey` FOREIGN KEY (`automationRunId`) REFERENCES `automation_runs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `automation_events` ADD CONSTRAINT `automation_events_automationRunId_fkey` FOREIGN KEY (`automationRunId`) REFERENCES `automation_runs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `automation_switches` ADD CONSTRAINT `automation_switches_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
