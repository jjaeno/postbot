ALTER TABLE `collection_rules` ADD COLUMN `profile` JSON NULL;

CREATE TABLE `source_fetches` (
  `id` VARCHAR(191) NOT NULL,
  `channelId` VARCHAR(191) NOT NULL,
  `requestKey` VARCHAR(64) NOT NULL,
  `source` VARCHAR(40) NOT NULL,
  `state` VARCHAR(16) NOT NULL,
  `response` JSON NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiresAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `source_fetches_channelId_requestKey_key` (`channelId`, `requestKey`),
  INDEX `source_fetches_channelId_startedAt_idx` (`channelId`, `startedAt`),
  INDEX `source_fetches_expiresAt_idx` (`expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `research_questions` (
  `id` VARCHAR(191) NOT NULL,
  `channelId` VARCHAR(191) NOT NULL,
  `idempotencyKey` VARCHAR(120) NOT NULL,
  `question` TEXT NOT NULL,
  `subtopic` VARCHAR(200) NOT NULL,
  `origin` VARCHAR(24) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'INVESTIGATE',
  `evidence` JSON NULL,
  `reason` VARCHAR(120) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `research_questions_channelId_idempotencyKey_key` (`channelId`, `idempotencyKey`),
  INDEX `research_questions_channelId_status_idx` (`channelId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `source_fetches` ADD CONSTRAINT `source_fetches_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `channels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `research_questions` ADD CONSTRAINT `research_questions_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `channels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
