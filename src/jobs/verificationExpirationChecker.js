'use strict';

const { YouTubeVerification } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { getLogger } = require('../utils/logger');
const roleService = require('../services/subscriberRoleService');
const safeModeService = require('../services/verificationSafeModeService');
const auditService = require('../services/auditService');
const notificationService = require('../services/notificationService');

/**
 * Grace period suresi dolan dogrulamalari isler (doc-1 madde 8, doc-2 madde 33).
 * Grace period icinde sartlar yeniden saglanmamissa -> FAILED, rol kaldirilir.
 * Safe Mode/ROLE_REMOVAL kill switch aktifse rol kaldirma atlanir ve raporlanir.
 */
async function run(discordClient) {
  const logger = getLogger();
  if (!isDatabaseReady()) return { processed: 0 };

  const expiredGraceRecords = await YouTubeVerification.find({
    status: 'grace_period',
    gracePeriodExpiresAt: { $lte: new Date() },
  });

  let processed = 0;
  for (const record of expiredGraceRecords) {
    record.status = 'failed';
    record.state = 'FAILED';
    record.failureReason = 'Grace period sonunda sartlar yeniden saglanamadi.';
    record.gracePeriodStartedAt = null;
    record.gracePeriodExpiresAt = null;
    await record.save();

    const guild = discordClient.guilds.cache.get(record.guildId);
    if (guild && record.roleId) {
      if (safeModeService.isOperationAllowed(record.guildId, 'ROLE_REMOVAL')) {
        try {
          await roleService.removeRole(guild, record.discordId, record.roleId, {
            guildId: record.guildId, actorType: 'scheduler', reason: 'Grace period sona erdi',
          });
        } catch (err) {
          logger.warn('Grace period sonrasi rol kaldirilamadi.', { discordId: record.discordId, message: err.message });
        }
      } else {
        logger.warn(`ROLE_REMOVAL kill switch/safe mode aktif, grace period rolu kaldirilmadi: ${record.guildId}/${record.discordId}`);
      }
    }

    await auditService.record({
      guildId: record.guildId, actorType: 'scheduler',
      action: 'verification.grace_period_expired', targetType: 'YouTubeVerification', targetId: record.discordId,
    });

    await notificationService.sendDm(discordClient, record.discordId,
      '🔴 YouTube doğrulama süreniz (grace period) sona erdi ve şartları yeniden sağlayamadınız. Doğrulama rolünüz kaldırıldı.'
    ).catch(() => {});

    processed += 1;
  }

  if (processed > 0) logger.info(`Grace period kontrolu tamamlandi: ${processed} kayit isledi.`);
  return { processed };
}

module.exports = { run };
