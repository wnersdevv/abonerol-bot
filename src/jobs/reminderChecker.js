'use strict';

const notificationService = require('../services/notificationService');
const { getLogger } = require('../utils/logger');

/**
 * Suresi yaklasan abonelikler icin hatirlatma bildirimleri gonderir (madde 13).
 */
async function run(discordClient, settings) {
  const logger = getLogger();
  const result = await notificationService.processReminders(discordClient, settings);
  if (result.sent > 0) {
    logger.info(`Hatirlatma bildirimleri gonderildi: ${result.sent}`);
  }
  return result;
}

module.exports = { run };
