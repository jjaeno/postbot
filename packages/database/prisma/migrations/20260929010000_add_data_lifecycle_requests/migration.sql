CREATE TABLE `data_lifecycle_requests` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NULL,
  `requestedByUserId` VARCHAR(191) NULL,
  `type` ENUM('WORKSPACE_DELETE', 'USER_DELETE', 'RETENTION') NOT NULL,
  `status` ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'QUEUED',
  `retentionBefore` DATETIME(3) NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `result` JSON NULL,
  `errorCode` VARCHAR(80) NULL,
  `errorMessage` TEXT NULL,
  `startedAt` DATETIME(3) NULL,
  `finishedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `data_lifecycle_requests_idempotencyKey_key`(`idempotencyKey`),
  INDEX `data_lifecycle_requests_workspaceId_status_createdAt_idx`(`workspaceId`, `status`, `createdAt`),
  INDEX `data_lifecycle_requests_requestedByUserId_status_createdAt_idx`(`requestedByUserId`, `status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
