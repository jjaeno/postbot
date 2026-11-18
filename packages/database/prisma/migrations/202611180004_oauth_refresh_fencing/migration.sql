ALTER TABLE `oauth_credentials`
  ADD COLUMN `credentialVersion` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `refreshLeaseToken` VARCHAR(64) NULL,
  ADD COLUMN `refreshLeaseUntil` DATETIME(3) NULL;
