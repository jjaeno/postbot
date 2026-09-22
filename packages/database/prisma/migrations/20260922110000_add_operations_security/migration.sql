CREATE TABLE `budget_histories` (
    `id` VARCHAR(191) NOT NULL,
    `automationBudgetId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NULL,
    `changedByUserId` VARCHAR(191) NULL,
    `before` JSON NULL,
    `after` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `budget_histories_workspaceId_createdAt_idx`(`workspaceId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NULL,
    `notificationKey` VARCHAR(191) NOT NULL,
    `eventKey` VARCHAR(120) NOT NULL,
    `severity` ENUM('INFO', 'WARNING', 'CRITICAL') NOT NULL DEFAULT 'INFO',
    `payload` JSON NOT NULL,
    `acknowledgedAt` DATETIME(3) NULL,
    `acknowledgedByUserId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `notifications_notificationKey_key`(`notificationKey`),
    INDEX `notifications_workspaceId_acknowledgedAt_createdAt_idx`(`workspaceId`, `acknowledgedAt`, `createdAt`),
    INDEX `notifications_workspaceId_eventKey_createdAt_idx`(`workspaceId`, `eventKey`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `action` VARCHAR(120) NOT NULL,
    `targetType` VARCHAR(80) NOT NULL,
    `targetId` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `audit_logs_workspaceId_createdAt_idx`(`workspaceId`, `createdAt`),
    INDEX `audit_logs_workspaceId_action_createdAt_idx`(`workspaceId`, `action`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `budget_histories` ADD CONSTRAINT `budget_histories_automationBudgetId_fkey` FOREIGN KEY (`automationBudgetId`) REFERENCES `automation_budgets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `budget_histories` ADD CONSTRAINT `budget_histories_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `channels`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
