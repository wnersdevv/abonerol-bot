'use strict';

const { Schema, model } = require('mongoose');

/**
 * Islemsel/tarihsel abonelik kaydi (madde 8). Her yenileme, iptal, plan degisikligi
 * icin yeni veya guncellenen bir Subscription kaydi olusur; Subscriber ise "guncel durum"u tutar.
 */
const SubscriptionSchema = new Schema(
  {
    subscriptionId: { type: String, required: true, unique: true, index: true },
    discordId: { type: String, required: true, index: true },
    guildId: { type: String, required: true, index: true },
    planId: { type: String, required: true },

    status: {
      type: String,
      enum: ['pending', 'active', 'trial', 'expired', 'cancelled', 'suspended', 'paused', 'failed'],
      default: 'pending',
      index: true,
    },

    startedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    renewedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: null },

    paymentId: { type: String, default: null },

    previousPlanId: { type: String, default: null },
    changeType: { type: String, enum: ['new', 'renewal', 'upgrade', 'downgrade', 'admin_extend', 'admin_grant', 'trial'], default: 'new' },

    idempotencyKey: { type: String, default: null, index: true, unique: true, sparse: true },
  },
  { timestamps: true }
);

SubscriptionSchema.index({ guildId: 1, discordId: 1, createdAt: -1 });
SubscriptionSchema.index({ guildId: 1, status: 1 });

module.exports = model('Subscription', SubscriptionSchema);
