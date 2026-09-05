'use strict';

const { YouTubeVerification, VerificationScan, VerificationReview } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { ConfigurationError } = require('../utils/errors');
const youtubeApiService = require('./youtubeApiService');

/**
 * Dogrulama istatistikleri (doc-2 madde 43, 45). Yalnizca gercek verilerden
 * hesaplanir - sahte gecmis veya tahmini rakam uretilmez.
 */
async function getVerificationAnalytics(guildId, settings) {
  if (!isDatabaseReady()) {
    throw new ConfigurationError('MongoDB baglantisi hazir degil, istatistikler hesaplanamiyor.');
  }

  const [statusCounts, totalScans, reviewCounts, quota] = await Promise.all([
    YouTubeVerification.aggregate([{ $match: { guildId } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    VerificationScan.countDocuments({ guildId }),
    VerificationReview.aggregate([{ $match: { guildId } }, { $group: { _id: '$action', count: { $sum: 1 } } }]),
    Promise.resolve(youtubeApiService.getQuotaStatus(settings.youtube && settings.youtube.quotaDailyLimit)),
  ]);

  const statusMap = {};
  for (const item of statusCounts) statusMap[item._id] = item.count;

  const reviewMap = {};
  for (const item of reviewCounts) reviewMap[item._id] = item.count;

  return {
    byStatus: statusMap,
    totalScans,
    reviewActions: reviewMap,
    youtubeQuota: quota,
  };
}

module.exports = { getVerificationAnalytics };
