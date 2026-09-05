'use strict';

const { getLogger } = require('../utils/logger');
const safeModeService = require('./verificationSafeModeService');

/**
 * Anomali tespiti (doc-2 madde 34-35). Bir tarama turunda beklenmeyen derecede
 * yuksek basarisizlik orani tespit edilirse otomatik rol kaldirma DURDURULUR
 * ve SAFE MODE'a gecilir - toplu yanlis rol kaldirma engellenir.
 */
async function checkMassFailure(guildId, { totalScanned, failedCount }, settings) {
  const logger = getLogger();
  if (totalScanned === 0) return { anomaly: false };

  const minSampleSize = (settings.verification && settings.verification.massFailureMinSampleSize) || 20;
  const thresholdPercent = (settings.verification && settings.verification.massFailurePercentageThreshold) || 40;

  if (totalScanned < minSampleSize) return { anomaly: false };

  const failurePercent = (failedCount / totalScanned) * 100;
  if (failurePercent >= thresholdPercent) {
    const reason = `MASS_FAILURE_DETECTED: ${failedCount}/${totalScanned} (%${failurePercent.toFixed(1)}) basarisiz - esik %${thresholdPercent}`;
    logger.error(reason, { guildId });
    await safeModeService.enterSafeMode(guildId, reason, 'scheduler');
    return { anomaly: true, reason, failurePercent };
  }

  return { anomaly: false, failurePercent };
}

module.exports = { checkMassFailure };
