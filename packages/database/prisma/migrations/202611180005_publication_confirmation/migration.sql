ALTER TABLE `publish_plans` MODIFY `status` ENUM('DRAFT','SCHEDULED','PUBLISHING','UPLOADED','PROCESSING','PUBLISHED','FAILED','HELD','CANCELLED') NOT NULL DEFAULT 'DRAFT';
ALTER TABLE `publish_attempts` ADD COLUMN `protectedProviderEvidence` JSON NULL;
ALTER TABLE `platform_posts`
  MODIFY `publishedAt` DATETIME(3) NULL,
  ADD COLUMN `publicationState` VARCHAR(32) NOT NULL DEFAULT 'LEGACY_UNCONFIRMED',
  ADD COLUMN `publicationCheckedAt` DATETIME(3) NULL,
  ADD COLUMN `nextPublicationCheckAt` DATETIME(3) NULL,
  ADD COLUMN `publicationCheckCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `publicationFailureCode` VARCHAR(80) NULL,
  ADD COLUMN `visibility` VARCHAR(16) NULL;
ALTER TABLE `platform_posts` ALTER COLUMN `publicationState` SET DEFAULT 'UPLOADED';
CREATE INDEX `platform_posts_publicationState_nextPublicationCheckAt_idx` ON `platform_posts` (`publicationState`,`nextPublicationCheckAt`);
