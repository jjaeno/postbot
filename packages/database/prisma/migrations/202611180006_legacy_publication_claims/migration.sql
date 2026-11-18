INSERT IGNORE INTO `audit_logs` (`id`,`workspaceId`,`action`,`targetType`,`targetId`,`metadata`)
SELECT SHA2(CONCAT('legacy-publication:',p.`id`),256), a.`workspaceId`, 'publication.legacy_unconfirmed', 'platformPost', p.`id`,
  JSON_OBJECT('previousPlanStatus',r.`status`,'recordedPublishedAt',DATE_FORMAT(p.`publishedAt`,'%Y-%m-%dT%H:%i:%s.%fZ'),'reason','LEGACY_TIMESTAMP_NOT_PLATFORM_VERIFIED')
FROM `platform_posts` p JOIN `publish_plans` r ON r.`id`=p.`publishPlanId` JOIN `platform_accounts` a ON a.`id`=p.`platformAccountId`
WHERE p.`publicationState`='LEGACY_UNCONFIRMED';
UPDATE `publish_plans` r JOIN `platform_posts` p ON p.`publishPlanId`=r.`id`
SET r.`status`='HELD' WHERE p.`publicationState`='LEGACY_UNCONFIRMED' AND r.`status`='PUBLISHED';
UPDATE `content_items` c SET c.`status`='HELD'
WHERE c.`status`='PUBLISHED'
  AND EXISTS (SELECT 1 FROM `publish_plans` r JOIN `platform_posts` p ON p.`publishPlanId`=r.`id` WHERE r.`contentItemId`=c.`id` AND p.`publicationState`='LEGACY_UNCONFIRMED')
  AND NOT EXISTS (SELECT 1 FROM `publish_plans` r JOIN `platform_posts` p ON p.`publishPlanId`=r.`id` WHERE r.`contentItemId`=c.`id` AND p.`publicationState`='PUBLISHED');
