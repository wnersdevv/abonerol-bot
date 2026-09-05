'use strict';

const { Schema, model } = require('mongoose');

/**
 * Aktif "durum" kaydi (madde 8). Bir kullanicinin bir sunucudaki guncel abonelik
 * durumunu tutar. Subscription modeli ise tarihsel/islemsel kayittir.
 */
const SubscriberSchema = new Schema(
  {
    discordId: { type: String, required: true, index: true },
    guildId: { type: String, required: true, index: true },
    planId: { type: String, required: true },
    roleId: { type: String, required: true },

    status: {
      type: String,
      enum: ['pending', 'active', 'trial', 'expired', 'cancelled', 'suspended', 'paused', 'failed'],
      default: 'pending',
      index: true,
    },

    startedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null, index: true },

    trial: { type: Boolean, default: false },
    trialStartedAt: { type: Date, default: null },
    trialExpiresAt: { type: Date, default: null },

    autoRenew: { type: Boolean, default: false },
    lastPaymentId: { type: String, default: null },
    totalPaid: { type: Number, default: 0 },
    currency: { type: String, default: 'TRY' },

    source: { type: String, enum: ['manual', 'payment', 'trial', 'admin_grant', 'import'], default: 'manual' },

    pausedAt: { type: Date, default: null },
    pauseRemainingMs: { type: Number, default: null },

    lastNotifiedThresholds: { type: [String], default: [] },
  },
  { timestamps: true }
);

SubscriberSchema.index({ guildId: 1, discordId: 1 }, { unique: true });
SubscriberSchema.index({ guildId: 1, status: 1 });
SubscriberSchema.index({ status: 1, expiresAt: 1 });

module.exports = model('Subscriber', SubscriberSchema);
