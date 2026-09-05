'use strict';

const { Schema, model } = require('mongoose');

/**
 * Trial abuse detection icin kalici kayit (madde 16). Bir discordId + guildId (+ plan)
 * kombinasyonunun daha once trial kullanip kullanmadigini kalici olarak izler,
 * boylece Subscriber silinse dahi tekrar trial alinamaz.
 */
const TrialUsageSchema = new Schema(
  {
    discordId: { type: String, required: true, index: true },
    guildId: { type: String, required: true, index: true },
    planId: { type: String, required: true },

    usedAt: { type: Date, default: Date.now },
    trialExpiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

TrialUsageSchema.index({ guildId: 1, discordId: 1, planId: 1 }, { unique: true });

module.exports = model('TrialUsage', TrialUsageSchema);
