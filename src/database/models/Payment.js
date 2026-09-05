'use strict';

const { Schema, model } = require('mongoose');

/**
 * Odeme kaydi (madde 8). Provider yapilandirilmamissa gercek odeme olusturulmaz;
 * bu model yalnizca gercek provider entegrasyonu aktifken doldurulur.
 */
const PaymentSchema = new Schema(
  {
    paymentId: { type: String, required: true, unique: true, index: true },
    discordId: { type: String, required: true, index: true },
    guildId: { type: String, required: true, index: true },
    subscriptionId: { type: String, default: null },
    planId: { type: String, required: true },

    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true },

    provider: { type: String, required: true },
    providerTransactionId: { type: String, default: null, index: true },

    status: {
      type: String,
      enum: ['pending', 'succeeded', 'failed', 'refunded', 'reconciling', 'disputed'],
      default: 'pending',
      index: true,
    },

    paidAt: { type: Date, default: null },

    idempotencyKey: { type: String, default: null, index: true, unique: true, sparse: true },
    reconciliationStatus: { type: String, enum: ['matched', 'mismatched', 'unchecked'], default: 'unchecked' },
    reconciliationCheckedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

PaymentSchema.index({ guildId: 1, discordId: 1, createdAt: -1 });
PaymentSchema.index({ provider: 1, providerTransactionId: 1 });

module.exports = model('Payment', PaymentSchema);
