'use strict';

const scanService = require('../services/youtubeScanService');
const { getLogger } = require('../utils/logger');
const { isDatabaseReady } = require('../database/connection');

/**
 * Otomatik YouTube tarama zamanlayicisi (doc-1 madde 6, doc-2 madde 26).
 * Yalnizca policy.autoScanEnabled=true olan ve nextCheckAt'i gelmis guildleri isler.
 */
async function run(discordClient, settings) {
  const logger = getLogger();
  if (!isDatabaseReady()) return { ok: false, reason: 'MongoDB baglantisi hazir degil.' };

  if (!settings.youtube || !settings.youtube.apiKey) {
    return { ok: false, reason: 'YouTube API anahtari yapilandirilmamis, otomatik tarama atlandi.' };
  }

  const results = await scanService.scanAllGuilds(discordClient, settings);
  if (results.length > 0) {
    logger.info(`Otomatik YouTube taramasi tamamlandi: ${results.length} sunucu islendi.`);
  }
  return { ok: true, results };
}

module.exports = { run };
