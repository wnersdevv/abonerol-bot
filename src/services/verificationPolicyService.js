'use strict';

const { VerificationPolicy } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { ConfigurationError, NotFoundError } = require('../utils/errors');
const { getCache } = require('../core/cache');
const auditService = require('./auditService');

/**
 * Guild politika yonetimi + versiyonlama (doc-2 madde 2-3).
 * Sart degistiginde: yeni policy kaydedilir, version artar, eski dogrulamalar
 * korunur (kendi policyVersion'lariyla), degisiklik audit log'a yazilir.
 */
function requireDb() {
  if (!isDatabaseReady()) {
    throw new ConfigurationError('MongoDB baglantisi hazir degil. Dogrulama politikasi kullanilamiyor.');
  }
}

function cacheKey(guildId) {
  return `verification-policy:${guildId}`;
}

async function getActivePolicy(guildId) {
  requireDb();
  const cached = getCache().get(cacheKey(guildId));
  if (cached) return cached;

  let policy = await VerificationPolicy.findOne({ guildId, active: true }).sort({ version: -1 });
  if (!policy) {
    policy = await VerificationPolicy.create({ guildId, version: 1, active: true });
  }

  getCache().set(cacheKey(guildId), policy, 30000);
  return policy;
}

/**
 * Politikayi gunceller. Eski policy'yi pasife alir, yeni version olusturur -
 * boylece gecmis dogrulamalarin hangi kurallarla yapildigi hep bilinir.
 */
async function updatePolicy(guildId, updates, actorId) {
  requireDb();
  const current = await getActivePolicy(guildId);

  current.active = false;
  await current.save();

  const newPolicyData = current.toObject();
  delete newPolicyData._id;
  delete newPolicyData.createdAt;
  delete newPolicyData.updatedAt;

  const newPolicy = await VerificationPolicy.create({
    ...newPolicyData,
    ...updates,
    guildId,
    version: current.version + 1,
    active: true,
  });

  getCache().delete(cacheKey(guildId));

  await auditService.record({
    guildId,
    actorId,
    actorType: 'user',
    action: 'verification.policy_changed',
    targetType: 'VerificationPolicy',
    targetId: String(newPolicy._id),
    details: { fromVersion: current.version, toVersion: newPolicy.version, updates },
  });

  return newPolicy;
}

async function getPolicyByVersion(guildId, version) {
  requireDb();
  const policy = await VerificationPolicy.findOne({ guildId, version });
  if (!policy) throw new NotFoundError(`Policy versiyonu bulunamadi: ${version}`);
  return policy;
}

module.exports = { getActivePolicy, updatePolicy, getPolicyByVersion };
