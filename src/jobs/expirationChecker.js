'use strict';

const expirationService = require('../services/expirationService');
const { getLogger } = require('../utils/logger');

/**
 * Suresi dolan abonelikleri periyodik olarak isler (madde 12).
 */
async function run(discordClient) {
  const logger = getLogger();
  const result = await expirationService.processExpiredSubscribers(discordClient);
  if (result.processed > 0) {
    logger.info(`Suresi dolan abonelik kontrolu tamamlandi: ${result.processed} abonelik isledi.`);
  }
  return result;
}

module.exports = { run };
