'use strict';

const { getLogger } = require('../utils/logger');
const safeModeService = require('../services/verificationSafeModeService');
const synchronizationService = require('../services/synchronizationService');
const healthService = require('../services/healthService');
const { isDatabaseReady } = require('../database/connection');

/**
 * Safe Mode sonrasi kurtarma kontrolu (doc-2 madde 63-64). Guild safe mode'daysa
 * saglik durumunu tekrar degerlendirir; MongoDB ve Discord saglikliysa yoneticiye
 * bilgi verir (otomatik cikis yapmaz - kontrollu cikis /youtube guvenli-mod-kapat
 * komutuyla yapilir, boylece yonetici onayi olmadan toplu rol islemleri devam etmez).
 */
async function run(discordClient, settings) {
  const logger = getLogger();
  if (!isDatabaseReady()) return { checked: 0 };

  let checked = 0;
  for (const [guildId] of discordClient.guilds.cache) {
    const state = safeModeService.getState(guildId);
    if (!state.safeMode) continue;

    checked += 1;
    const health = await healthService.getSystemHealth(discordClient, settings);
    if (health.mongodb.ready && health.discord.ready) {
      logger.info(`Safe mode aktif oldugu sunucu saglikli gorunuyor, manuel cikis bekleniyor: ${guildId} (sebep: ${state.reason})`);
    }
  }

  return { checked };
}

module.exports = { run };
