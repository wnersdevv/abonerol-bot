'use strict';

const { Payment } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { getLogger } = require('../utils/logger');

/**
 * Odeme mutabakati (madde 65-66). "pending" durumda uzun sure kalmis odemeleri
 * isaretler - gercek provider API sorgusu credential varsa genisletilebilir,
 * credential yoksa (Yapilandirilmamis) yalnizca stale kayitlari raporlar.
 */
async function run(settings) {
  const logger = getLogger();
  if (!isDatabaseReady()) return { checked: 0 };

  const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const stalePending = await Payment.find({ status: 'pending', createdAt: { $lte: staleThreshold } }).limit(200);

  for (const payment of stalePending) {
    payment.reconciliationStatus = 'mismatched';
    payment.reconciliationCheckedAt = new Date();
    await payment.save();
    logger.warn(`Odeme 24 saatten uzun sure "pending" durumda kaldi, mutabakat isaretlendi: ${payment.paymentId}`);
  }

  return { checked: stalePending.length };
}

module.exports = { run };
