'use strict';

const healthService = require('../services/healthService');
const { getLogger } = require('../utils/logger');

/**
 * Periyodik sistem saglik kontrolu (madde 72, 87). Kritik bir sorun tespit
 * edilirse (MongoDB kopmus vb.) logger uzerinden uyari verir.
 */
async function run(discordClient, settings) {
  const logger = getLogger();
  const health = await healthService.getSystemHealth(discordClient, settings);

  if (!health.mongodb.ready) {
    logger.warn('Saglik kontrolu: MongoDB baglantisi hazir degil.');
  }
  if (health.failedJobs > 0) {
    logger.warn(`Saglik kontrolu: ${health.failedJobs} basarisiz/bekleyen is (failed job) var.`);
  }

  return health;
}

module.exports = { run };
