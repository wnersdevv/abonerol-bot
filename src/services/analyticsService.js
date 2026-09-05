'use strict';

const { Subscriber, Payment, Plan } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { ConfigurationError } = require('../utils/errors');

/**
 * Sunucuya ozel istatistikler (madde 21 Admin Panel - Istatistik, madde 22 - /abone istatistik).
 */
async function getGuildAnalytics(guildId) {
  if (!isDatabaseReady()) {
    throw new ConfigurationError('MongoDB baglantisi hazir degil, istatistikler hesaplanamiyor.');
  }

  const [statusCounts, planCount, totalRevenueAgg, recentPayments] = await Promise.all([
    Subscriber.aggregate([
      { $match: { guildId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Plan.countDocuments({ guildId, active: true }),
    Payment.aggregate([
      { $match: { guildId, status: 'succeeded' } },
      { $group: { _id: '$currency', total: { $sum: '$amount' } } },
    ]),
    Payment.find({ guildId, status: 'succeeded' }).sort({ paidAt: -1 }).limit(5).lean(),
  ]);

  const statusMap = {};
  for (const item of statusCounts) statusMap[item._id] = item.count;

  return {
    subscribersByStatus: statusMap,
    activePlanCount: planCount,
    totalRevenueByCurrency: totalRevenueAgg.map((r) => ({ currency: r._id, total: r.total })),
    recentPayments,
  };
}

module.exports = { getGuildAnalytics };
