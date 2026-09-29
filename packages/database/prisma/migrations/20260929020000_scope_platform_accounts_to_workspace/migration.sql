DROP INDEX `platform_accounts_platform_externalAccountId_key` ON `platform_accounts`;
CREATE UNIQUE INDEX `platform_accounts_workspaceId_platform_externalAccountId_key`
  ON `platform_accounts`(`workspaceId`, `platform`, `externalAccountId`);
