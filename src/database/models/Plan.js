'use strict';

const { Schema, model } = require('mongoose');

/**
 * Abonelik plani (madde 6). Hard-code degil, MongoDB uzerinden yonetilir.
 * Sinirsiz sayida plan desteklenir; guildId ile sunucuya ozel izolasyon saglanir.
 */
const PlanSchema = new Schema(
  {
    planId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },

    name: { type: String, required: true },
    description: { type: String, default: '' },
    roleId: { type: String, required: true },

    price: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: 'TRY' },

    duration: { type: Number, required: true, min: 1 },
    durationUnit: { type: String, enum: ['minute', 'hour', 'day', 'week', 'month', 'year'], required: true },

    features: { type: [String], default: [] },
    limits: { type: Schema.Types.Mixed, default: {} },

    active: { type: Boolean, default: true },
    priority: { type: Number, default: 0 },

    trialEnabled: { type: Boolean, default: false },
    trialDuration: { type: Number, default: 0 },
    trialDurationUnit: { type: String, enum: ['minute', 'hour', 'day', 'week', 'month', 'year'], default: 'day' },

    autoRenew: { type: Boolean, default: false },

    upgradeDowngradePolicy: {
      prorate: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

PlanSchema.index({ guildId: 1, active: 1 });
PlanSchema.index({ guildId: 1, priority: -1 });

module.exports = model('Plan', PlanSchema);
