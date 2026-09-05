'use strict';

const { Subscriber } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { ConfigurationError } = require('../utils/errors');
const planService = require('./planService');

/**
 * Merkezi entitlement (hak) sistemi (madde 9). Abonelik sadece rol degildir;
 * bir kullanicinin gercek haklarini MongoDB uzerinden hesaplar. Rol Discord
 * tarafinda degismis olsa bile gercek abonelik durumu buradan dogrulanir.
 */
async function getEntitlements(guildId, discordId) {
  if (!isDatabaseReady()) {
    throw new ConfigurationError('MongoDB baglantisi hazir degil. Entitlement hesaplanamiyor.');
  }

  const subscriber = await Subscriber.findOne({ guildId, discordId });
  if (!subscriber) {
    return {
      active: false,
      plan: null,
      expiresAt: null,
      feature: { access: [], limit: {}, priority: 0 },
    };
  }

  const isActiveStatus = ['active', 'trial'].includes(subscriber.status);
  const notExpired = subscriber.expiresAt ? new Date(subscriber.expiresAt).getTime() > Date.now() : false;
  const active = isActiveStatus && notExpired;

  let plan = null;
  try {
    plan = await planService.getPlan(guildId, subscriber.planId);
  } catch (err) {
    plan = null;
  }

  return {
    active,
    plan: plan
      ? {
          planId: plan.planId,
          name: plan.name,
          features: plan.features,
          limits: plan.limits,
          priority: plan.priority,
        }
      : null,
    subscription: {
      status: subscriber.status,
      expiresAt: subscriber.expiresAt,
      trial: subscriber.trial,
      autoRenew: subscriber.autoRenew,
    },
    feature: {
      access: active && plan ? plan.features : [],
      limit: active && plan ? plan.limits : {},
      priority: active && plan ? plan.priority : 0,
    },
  };
}

async function hasFeatureAccess(guildId, discordId, featureName) {
  const entitlements = await getEntitlements(guildId, discordId);
  return entitlements.active && entitlements.feature.access.includes(featureName);
}

module.exports = { getEntitlements, hasFeatureAccess };
