'use strict';

const { getLogger } = require('../utils/logger');

/**
 * Bot bir sunucudan cikarildiginda veri SILINMEZ (kullanici geri eklerse
 * abonelik/dogrulama gecmisi korunur). Yalnizca loglanir.
 */
function register(client) {
  client.on('guildDelete', (guild) => {
    getLogger().warn(`Sunucudan cikarildi: ${guild.name} (${guild.id}). Veriler korunuyor, silinmiyor.`);
  });
}

module.exports = { register };
