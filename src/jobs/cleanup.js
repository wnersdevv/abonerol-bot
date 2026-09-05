'use strict';

const { VerificationScan, CaptchaAttempt, Notification } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { getLogger } = require('../utils/logger');

/**
 * Eski/gecici verileri temizler (doc-2 madde 72, 74). Aktif abonelik ve
 * AuditLog gibi kalici kayitlara dokunulmaz - yalnizca retention politikasina
 * tabi gecici veriler (tarama gecmisi, eski captcha denemeleri, eski bildirim
 * dedup kayitlari) temizlenir.
 */
async function run(settings) {
  const logger = getLogger();
  if (!isDatabaseReady()) return { cleaned: 0 };

  const scanRetentionDays = (settings.verification && settings.verification.scanRetentionDays) || 30;
  const scanCutoff = new Date(Date.now() - scanRetentionDays * 24 * 60 * 60 * 1000);

  const [scanResult, captchaResult, notifResult] = await Promise.all([
    VerificationScan.deleteMany({ createdAt: { $lte: scanCutoff } }),
    CaptchaAttempt.deleteMany({ expiresAt: { $lte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
    Notification.deleteMany({ createdAt: { $lte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } }),
  ]);

  const total = scanResult.deletedCount + captchaResult.deletedCount + notifResult.deletedCount;
  if (total > 0) {
    logger.info(`Temizlik tamamlandi: ${scanResult.deletedCount} tarama, ${captchaResult.deletedCount} captcha, ${notifResult.deletedCount} bildirim kaydi silindi.`);
  }

  return { cleaned: total };
}

module.exports = { run };
