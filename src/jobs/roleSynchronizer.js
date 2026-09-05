'use strict';

const synchronizationService = require('../services/synchronizationService');
const { getLogger } = require('../utils/logger');

/**
 * Tum sunucularda abone-rol senkronizasyonunu periyodik olarak calistirir (madde 10).
 */
async function run(discordClient) {
  const logger = getLogger();
  const result = await synchronizationService.synchronizeAllGuilds(discordClient);
  if (!result.ok) {
    logger.warn(`Rol senkronizasyonu atlandi: ${result.reason}`);
  }
  return result;
}

module.exports = { run };
