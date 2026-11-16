ALTER TABLE `production_jobs`
  ADD COLUMN `executionToken` VARCHAR(36) NULL,
  ADD COLUMN `heartbeatAt` DATETIME(3) NULL;
