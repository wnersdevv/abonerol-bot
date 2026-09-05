'use strict';

const { YouTubeVerification } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { ConfigurationError } = require('../utils/errors');
const { getLogger } = require('../utils/logger');
const { getQueue } = require('../core/queue');
const verificationService = require('./youtubeVerificationService');
const anomalyService = require('./verificationAnomalyService');
const safeModeService = require('./verificationSafeModeService');
const policyService = require('./verificationPolicyService');

/**
 * Toplu/otomatik tarama orkestrasyonu (doc-1 madde 5-6, doc-2 madde 26, 30, 41, 69-70).
 * Buyuk kullanici kumelerini queue uzerinden, concurrency siniriyla isler.
 * Sonunda anomaly check yapar - anormal derecede yuksek basarisizlik varsa
 * Safe Mode devreye girer ve kalan toplu rol islemleri durur.
 */
function requireDb() {
  if (!isDatabaseReady()) {
    throw new ConfigurationError('MongoDB baglantisi hazir degil. Tarama sistemi kullanilamiyor.');
  }
}

/**
 * Onceliklendirme (doc-2 madde 26, 41): grace period > daha once sorunlu >
 * manuel retry > normal. Basit bir siralama fonksiyonu ile uygulanir.
 */
function priorityScore(record) {
  if (record.status === 'grace_period') return 0;
  if (record.status === 'failed' || record.status === 'error') return 1;
  if (record.scanType === 'retry') return 2;
  return 3;
}

async function scanGuild(discordClient, settings, guildId, { scanType = 'automatic', targetDiscordIds = null } = {}) {
  requireDb();
  const logger = getLogger();

  if (!safeModeService.isOperationAllowed(guildId, 'AUTO_SCAN') && scanType === 'automatic') {
    logger.warn(`AUTO_SCAN kill switch aktif, otomatik tarama atlandi: ${guildId}`);
    return { scanned: 0, skipped: true, reason: 'AUTO_SCAN kapali' };
  }

  const query = { guildId };
  if (targetDiscordIds && targetDiscordIds.length > 0) {
    query.discordId = { $in: targetDiscordIds };
  } else {
    query.status = { $in: ['passed', 'grace_period', 'failed', 'manual_review'] };
  }

  const records = await YouTubeVerification.find(query);
  records.sort((a, b) => priorityScore(a) - priorityScore(b));

  const guild = discordClient.guilds.cache.get(guildId);
  const queue = getQueue();
  let scanned = 0;
  let failed = 0;

  const tasks = records.map((record) => queue.push(
    async () => {
      const result = await verificationService.runVerification(discordClient, settings, guild, guildId, record.discordId, {
        channelInputRaw: record.channelId,
        scanType,
      });
      scanned += 1;
      if (result.status === 'failed' || result.status === 'error') failed += 1;
      return result;
    },
    { name: `yt-tara:${guildId}:${record.discordId}`, maxAttempts: 2 }
  ).catch((err) => {
    logger.warn('Tarama sirasinda kullanici islenemedi.', { discordId: record.discordId, message: err.message });
    failed += 1;
  }));

  await Promise.all(tasks);

  const anomalyResult = await anomalyService.checkMassFailure(guildId, { totalScanned: scanned, failedCount: failed }, settings);

  return { scanned, failed, anomaly: anomalyResult };
}

async function scanSingleUser(discordClient, settings, guild, guildId, discordId, channelInputRaw, actorId) {
  return verificationService.runVerification(discordClient, settings, guild, guildId, discordId, {
    channelInputRaw, scanType: actorId ? 'admin' : 'manual', actorId,
  });
}

async function scanAllGuilds(discordClient, settings) {
  requireDb();
  const results = [];
  for (const [guildId] of discordClient.guilds.cache) {
    const policy = await policyService.getActivePolicy(guildId).catch(() => null);
    if (!policy || !policy.autoScanEnabled) continue;

    const dueRecords = await YouTubeVerification.countDocuments({ guildId, nextCheckAt: { $lte: new Date() } });
    if (dueRecords === 0) continue;

    // eslint-disable-next-line no-await-in-loop
    const result = await scanGuild(discordClient, settings, guildId, { scanType: 'automatic' });
    results.push({ guildId, ...result });
  }
  return results;
}

module.exports = { scanGuild, scanSingleUser, scanAllGuilds };
