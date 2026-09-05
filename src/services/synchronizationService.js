'use strict';

const { Subscriber } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { getLogger } = require('../utils/logger');
const roleService = require('./subscriberRoleService');
const planService = require('./planService');
const auditService = require('./auditService');

/**
 * Otomatik rol senkronizasyon sistemi (madde 10):
 * 1. aktif aboneleri getir, 2. Discord uyelerini kontrol et, 3. rollerini kontrol et,
 * 4. eksik rol varsa ver, 5. suresi gecmisse kaldir (expirationService de bunu yapar,
 * burada ek guvenlik katmani olarak tekrar kontrol edilir), 6. yanlis plan rolu varsa duzelt,
 * 7. silinmis rolu raporla.
 *
 * Ayrica otomatik rol onarimi (madde 73) ve rol catismasi (madde 74) burada uygulanir.
 */
async function synchronizeGuild(discordClient, guildId) {
  const logger = getLogger();
  if (!isDatabaseReady()) {
    return { ok: false, reason: 'MongoDB baglantisi hazir degil.' };
  }

  const guild = discordClient.guilds.cache.get(guildId);
  if (!guild) {
    return { ok: false, reason: 'Bot bu sunucuda bulunmuyor.' };
  }

  const activeSubscribers = await Subscriber.find({ guildId, status: { $in: ['active', 'trial'] } });
  const report = { checked: 0, fixed: 0, removed: 0, reported: [], errors: [] };

  for (const subscriber of activeSubscribers) {
    report.checked += 1;
    try {
      let member;
      try {
        member = await guild.members.fetch(subscriber.discordId);
      } catch (err) {
        report.reported.push({ discordId: subscriber.discordId, issue: 'Kullanici sunucuda bulunamadi.' });
        continue;
      }

      const isExpired = subscriber.expiresAt && new Date(subscriber.expiresAt).getTime() <= Date.now();
      if (isExpired) {
        if (member.roles.cache.has(subscriber.roleId)) {
          await roleService.removeRole(guild, subscriber.discordId, subscriber.roleId, {
            guildId,
            actorType: 'scheduler',
            reason: 'Senkronizasyon: sure dolmus abonelik',
          });
          report.removed += 1;
        }
        continue;
      }

      const role = guild.roles.cache.get(subscriber.roleId);
      if (!role) {
        report.reported.push({ discordId: subscriber.discordId, issue: `Plan rolu (${subscriber.roleId}) silinmis.` });
        await auditService.record({
          guildId,
          actorType: 'scheduler',
          action: 'sync.role_deleted_reported',
          targetType: 'Subscriber',
          targetId: subscriber.discordId,
          details: { roleId: subscriber.roleId },
          success: false,
        });
        continue;
      }

      if (!member.roles.cache.has(subscriber.roleId)) {
        await roleService.assignRole(guild, subscriber.discordId, subscriber.roleId, { guildId, actorType: 'scheduler' });
        report.fixed += 1;
      }

      // Rol catismasi kontrolu (madde 74): kullanicida birden fazla plan rolu var mi?
      const allPlans = await planService.listPlans(guildId);
      const planRoleIds = new Set(allPlans.map((p) => p.roleId));
      const memberPlanRoles = [...member.roles.cache.keys()].filter((rid) => planRoleIds.has(rid) && rid !== subscriber.roleId);

      if (memberPlanRoles.length > 0) {
        const guildDoc = await require('../database/models').Guild.findOne({ guildId }).lean().catch(() => null);
        const policy = (guildDoc && guildDoc.rolePolicy && guildDoc.rolePolicy.conflictPolicy) || 'highest_priority_keep';

        if (policy === 'highest_priority_keep' || policy === 'remove_all_but_one') {
          for (const conflictRoleId of memberPlanRoles) {
            await roleService.removeRole(guild, subscriber.discordId, conflictRoleId, {
              guildId,
              actorType: 'scheduler',
              reason: 'Rol catismasi cozumu: aktif plan disindaki rol kaldirildi',
            });
          }
        } else {
          report.reported.push({ discordId: subscriber.discordId, issue: 'Birden fazla plan rolune sahip (uyari politikasi).' });
        }
      }
    } catch (err) {
      report.errors.push({ discordId: subscriber.discordId, error: err.message });
      logger.error('Senkronizasyon sirasinda hata.', { discordId: subscriber.discordId, message: err.message });
    }
  }

  await auditService.record({
    guildId,
    actorType: 'scheduler',
    action: 'sync.completed',
    details: report,
  });

  return { ok: true, report };
}

async function synchronizeAllGuilds(discordClient) {
  if (!isDatabaseReady()) return { ok: false, reason: 'MongoDB baglantisi hazir degil.' };

  const results = [];
  // Buyuk olcek (madde 76): guildleri sirayla, kucuk gecikmelerle isleyerek
  // Discord API'yi ve MongoDB'yi ayni anda bogmamaya calisir.
  for (const [guildId] of discordClient.guilds.cache) {
    const result = await synchronizeGuild(discordClient, guildId);
    results.push({ guildId, ...result });
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { ok: true, results };
}

module.exports = { synchronizeGuild, synchronizeAllGuilds };
