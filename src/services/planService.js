'use strict';

const { Plan } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { generateSecureId } = require('../utils/security');
const { assertPlanShape, assertNonEmptyString } = require('../utils/validators');
const { ConfigurationError, NotFoundError, ValidationError } = require('../utils/errors');
const { getCache } = require('../core/cache');
const auditService = require('./auditService');

function requireDb() {
  if (!isDatabaseReady()) {
    throw new ConfigurationError('MongoDB baglantisi hazir degil. Plan islemleri su an kullanilamiyor.');
  }
}

function cacheKey(guildId) {
  return `plans:${guildId}:active`;
}

/**
 * Yeni plan olusturur (madde 6). Plan sistemi hard-code degildir, tamamen
 * MongoDB uzerinden yonetilir. guildId ile sunucuya ozeldir (madde 25).
 */
async function createPlan(guildId, input, actorId) {
  requireDb();
  assertNonEmptyString(guildId, 'guildId', 40);
  assertPlanShape(input);

  const planId = input.planId || generateSecureId('plan');
  const existing = await Plan.findOne({ planId });
  if (existing) {
    throw new ValidationError(`planId zaten kullaniliyor: ${planId}`);
  }

  const plan = await Plan.create({
    planId,
    guildId,
    name: input.name,
    description: input.description || '',
    roleId: input.roleId,
    price: input.price,
    currency: input.currency,
    duration: input.duration,
    durationUnit: input.durationUnit,
    features: input.features || [],
    limits: input.limits || {},
    active: input.active !== undefined ? input.active : true,
    priority: input.priority || 0,
    trialEnabled: !!input.trialEnabled,
    trialDuration: input.trialDuration || 0,
    trialDurationUnit: input.trialDurationUnit || 'day',
    autoRenew: !!input.autoRenew,
  });

  getCache().delete(cacheKey(guildId));

  await auditService.record({
    guildId,
    actorId,
    actorType: 'user',
    action: 'plan.created',
    targetType: 'Plan',
    targetId: plan.planId,
    details: { name: plan.name, price: plan.price, currency: plan.currency },
  });

  return plan;
}

async function updatePlan(guildId, planId, updates, actorId) {
  requireDb();
  const plan = await Plan.findOne({ guildId, planId });
  if (!plan) throw new NotFoundError(`Plan bulunamadi: ${planId}`);

  const allowedFields = [
    'name', 'description', 'roleId', 'price', 'currency', 'duration', 'durationUnit',
    'features', 'limits', 'active', 'priority', 'trialEnabled', 'trialDuration',
    'trialDurationUnit', 'autoRenew',
  ];

  for (const field of allowedFields) {
    if (updates[field] !== undefined) plan[field] = updates[field];
  }

  assertPlanShape(plan);
  await plan.save();

  getCache().delete(cacheKey(guildId));

  await auditService.record({
    guildId,
    actorId,
    actorType: 'user',
    action: 'plan.updated',
    targetType: 'Plan',
    targetId: plan.planId,
    details: { updates },
  });

  return plan;
}

async function deletePlan(guildId, planId, actorId) {
  requireDb();
  const plan = await Plan.findOneAndDelete({ guildId, planId });
  if (!plan) throw new NotFoundError(`Plan bulunamadi: ${planId}`);

  getCache().delete(cacheKey(guildId));

  await auditService.record({
    guildId,
    actorId,
    actorType: 'user',
    action: 'plan.deleted',
    targetType: 'Plan',
    targetId: planId,
  });

  return plan;
}

async function setPlanActive(guildId, planId, active, actorId) {
  return updatePlan(guildId, planId, { active }, actorId);
}

async function getPlan(guildId, planId) {
  requireDb();
  const plan = await Plan.findOne({ guildId, planId });
  if (!plan) throw new NotFoundError(`Plan bulunamadi: ${planId}`);
  return plan;
}

async function listPlans(guildId, { onlyActive = false } = {}) {
  requireDb();
  const query = { guildId };
  if (onlyActive) query.active = true;
  return Plan.find(query).sort({ priority: -1, createdAt: 1 });
}

async function listActivePlansCached(guildId) {
  requireDb();
  return getCache().wrap(cacheKey(guildId), 60000, () => listPlans(guildId, { onlyActive: true }));
}

module.exports = {
  createPlan,
  updatePlan,
  deletePlan,
  setPlanActive,
  getPlan,
  listPlans,
  listActivePlansCached,
};
