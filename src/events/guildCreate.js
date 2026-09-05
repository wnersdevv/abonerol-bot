'use strict';

const guildService = require('../services/guildService');
const { isDatabaseReady } = require('../database/connection');
const { getLogger } = require('../utils/logger');

/**
 * Bot yeni bir sunucuya eklendiginde varsayilan Guild ayarlarini olusturur
 * (madde 25 - her sunucu kendi izole ayarlarina sahip olmalidir).
 */
function register(client) {
  client.on('guildCreate', async (guild) => {
    const logger = getLogger();
    logger.info(`Yeni sunucuya eklendi: ${guild.name} (${guild.id})`);

    if (!isDatabaseReady()) {
      logger.warn('MongoDB hazir olmadigi icin yeni sunucu ayarlari olusturulamadi.');
      return;
    }

    try {
      await guildService.getOrCreateGuildSettings(guild.id, guild.name);
    } catch (err) {
      logger.error('Yeni sunucu ayarlari olusturulurken hata olustu.', { message: err.message });
    }
  });
}

module.exports = { register };
