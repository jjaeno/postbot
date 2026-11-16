ALTER TABLE `platform_posts` ADD COLUMN `productionSnapshot` JSON NULL;
UPDATE `optimization_suggestions`
SET `evidence` = JSON_SET(`evidence`, '$.legacyRuleScore', `confidenceScore`),
    `confidenceScore` = NULL
WHERE `ruleVersion` = 'optimization-rules-v1' AND `confidenceScore` IS NOT NULL;
