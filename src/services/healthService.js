'use strict';

const { getConnectionState, isDatabaseReady } = require('../database/connection');
const { getQueue } = require('../core/queue');
const { getCache } = require('../core/cache');
const { getScheduler } = require('../core/scheduler');
const { FailedJob } = require('../database/models');
const { unconfiguredLabel } = require('../utils/formatters');

/**
 * Sistem saglik durumunu toplar (madde 21 Sistem paneli, 72 Configuration Validator,
 * 87 Son Audit). /abone sistem ve /abone istatistik gibi komutlarda kullanilir.
 */
async function getSystemHealth(discordClient, settings) {
  const dbState = getConnectionState();
  const queueStatus = getQueue().size();
  const cacheSize = getCache().size();
  const schedulerStatus = getScheduler().getStatus();

  let failedJobsCount = 0;
  if (isDatabaseReady()) {
    failedJobsCount = await FailedJob.countDocuments({ status: { $in: ['pending_retry', 'exhausted'] } }).catch(() => 0);
  }

  const paymentProvider = settings.payment && settings.payment.provider;
  const paymentConfigured = paymentProvider && paymentProvider !== 'none'
    && settings.payment.providers
    && settings.payment.providers[paymentProvider]
    && settings.payment.providers[paymentProvider].enabled;

  return {
    discord: {
      ready: discordClient.isReady(),
      guildCount: discordClient.guilds.cache.size,
      ping: discordClient.ws.ping,
    },
    mongodb: {
      state: dbState.state,
      ready: isDatabaseReady(),
      lastError: dbState.lastError,
      label: isDatabaseReady() ? '🟢 Bagli' : unconfiguredLabel(),
    },
    payment: {
      configured: !!paymentConfigured,
      provider: paymentConfigured ? paymentProvider : null,
      label: paymentConfigured ? `🟢 ${paymentProvider}` : unconfiguredLabel(),
    },
    queue: queueStatus,
    cache: { entries: cacheSize },
    scheduler: schedulerStatus,
    failedJobs: failedJobsCount,
  };
}

module.exports = { getSystemHealth };
