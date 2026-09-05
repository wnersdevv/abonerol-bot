'use strict';

const { Schema, model } = require('mongoose');

/**
 * Guild'e ozel dogrulama politikasi (doc-2 madde 1-3: Rule Engine + Policy Versioning).
 * Her guild kendi kural setine sahiptir; sart degistiginde version artar,
 * eski dogrulamalar eski policyVersion ile iliskilendirilmis kalir.
 */
const RuleConditionSchema = new Schema(
  {
    field: { type: String, required: true }, // orn: subscriberCount, videoCount, channelAgeDays
    operator: { type: String, enum: ['gte', 'lte', 'gt', 'lt', 'eq', 'neq', 'between'], required: true },
    value: { type: Schema.Types.Mixed, required: true },
    valueMax: { type: Schema.Types.Mixed, default: null }, // 'between' icin
  },
  { _id: false }
);

const RuleGroupSchema = new Schema(
  {
    logic: { type: String, enum: ['AND', 'OR', 'NOT'], default: 'AND' },
    conditions: { type: [RuleConditionSchema], default: [] },
  },
  { _id: false }
);

const VerificationPolicySchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    version: { type: Number, default: 1 },
    active: { type: Boolean, default: true },

    roleId: { type: String, default: null },
    ruleGroup: { type: RuleGroupSchema, default: () => ({ logic: 'AND', conditions: [] }) },

    scanIntervalMs: { type: Number, default: 21600000 }, // varsayilan 6 saat
    autoScanEnabled: { type: Boolean, default: false },

    gracePeriodMs: { type: Number, default: 21600000 }, // varsayilan 6 saat

    duplicateChannelPolicy: { type: String, enum: ['ALLOW', 'DENY', 'MANUAL_REVIEW'], default: 'MANUAL_REVIEW' },
    roleConflictPolicy: { type: String, enum: ['HIGHEST_PRIORITY', 'KEEP_ALL', 'MANUAL_REVIEW'], default: 'HIGHEST_PRIORITY' },

    riskThresholds: {
      lowMax: { type: Number, default: 30 },
      mediumMax: { type: Number, default: 60 },
      highMax: { type: Number, default: 85 },
      massFailurePercentage: { type: Number, default: 40 },
    },

    notificationChannelId: { type: String, default: null },

    channelChangeCooldownMs: { type: Number, default: 259200000 }, // 3 gun
    verificationCooldownMs: { type: Number, default: 3600000 }, // 1 saat
    manualRetryCooldownMs: { type: Number, default: 600000 }, // 10 dakika
  },
  { timestamps: true }
);

VerificationPolicySchema.index({ guildId: 1, version: -1 });
VerificationPolicySchema.index({ guildId: 1, active: 1 });

module.exports = model('VerificationPolicy', VerificationPolicySchema);
