'use strict';

const { Subscriber, Subscription } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { getLogger } = require('../utils/logger');
const roleService = require('./subscriberRoleService');
const notificationService = require('./notificationService');
const auditService = require('./auditService');

/**
 * Suresi dolan abonelikleri isler (madde 12). Her biri icin:
 * 1. status -> expired, 2. rol kaldir, 3. entitlement kapanir (status uzerinden dogal olarak),
 * 4. kullaniciya bildirim, 5. gerekirse yoneticiye raporla, 6. audit log, 7. subscription history.
 *
 * Rol kaldirilamazsa aboneligi yine expired isaretler, kaldirma islemini
 * subscriberRoleService kendi retry kuyruguna gonderir (madde 12 son cumle).
 */
async function processExpiredSubscribers(discordClient, { guildFilter = null } = {}) {
  const logger = getLogger();
  if (!isDatabaseReady()) {
    logger.warn('processExpiredSubscribers atlandi: MongoDB hazir degil.');
    return { processed: 0 };
  }

  const query = {
    status: { $in: ['active', 'trial'] },
    expiresAt: { $lte: new Date() },
  };
  if (guildFilter) query.guildId = guildFilter;

  const expiredSubscribers = await Subscriber.find(query);
  let processed = 0;

  for (const subscriber of expiredSubscribers) {
    try {
      subscriber.status = 'expired';
      await subscriber.save();

      await Subscription.findOneAndUpdate(
        { discordId: subscriber.discordId, guildId: subscriber.guildId, status: { $in: ['active', 'trial'] } },
        { $set: { status: 'expired' } },
        { sort: { createdAt: -1 } }
      );

      const guild = discordClient.guilds.cache.get(subscriber.guildId);
      if (guild) {
        try {
          await roleService.removeRole(guild, subscriber.discordId, subscriber.roleId, {
            guildId: subscriber.guildId,
            actorType: 'scheduler',
            reason: 'Abonelik suresi doldu',
          });
        } catch (roleErr) {
          logger.warn('Suresi dolan abone icin rol kaldirilamadi, retry kuyruguna alindi.', {
            discordId: subscriber.discordId,
            guildId: subscriber.guildId,
            message: roleErr.message,
          });
        }
      } else {
        logger.warn('Suresi dolan abone icin guild cache bulunamadi (bot bu sunucuda olmayabilir).', {
          guildId: subscriber.guildId,
        });
      }

      await notificationService.notifyExpired(discordClient, subscriber);

      await auditService.record({
        guildId: subscriber.guildId,
        actorType: 'scheduler',
        action: 'subscription.expired',
        targetType: 'Subscriber',
        targetId: subscriber.discordId,
        details: { planId: subscriber.planId },
      });

      processed += 1;
    } catch (err) {
      logger.error('Abonelik suresi dolma islemi sirasinda hata.', {
        discordId: subscriber.discordId,
        guildId: subscriber.guildId,
        message: err.message,
      });
    }
  }

  return { processed };
}

module.exports = { processExpiredSubscribers };
