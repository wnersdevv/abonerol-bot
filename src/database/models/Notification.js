'use strict';

const { Schema, model } = require('mongoose');

/**
 * Bildirim deduplication kaydi (madde 13). Ayni esik (30/14/7/3/1 gun, 1 saat) icin
 * ayni abonelige birden fazla bildirim gonderilmesini engellemek amaciyla kullanilir.
 */
const NotificationSchema = new Schema(
  {
    discordId: { type: String, required: true, index: true },
    guildId: { type: String, required: true, index: true },
    subscriberId: { type: Schema.Types.ObjectId, ref: 'Subscriber', required: true },

    type: {
      type: String,
      enum: ['expiration_reminder', 'expired', 'renewal_success', 'renewal_failed', 'trial_ending', 'cancelled', 'paused', 'resumed', 'plan_changed'],
      required: true,
    },
    threshold: { type: String, default: null },

    channel: { type: String, enum: ['dm', 'guild_channel'], default: 'dm' },
    delivered: { type: Boolean, default: false },
    deliveryError: { type: String, default: null },

    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

NotificationSchema.index({ subscriberId: 1, type: 1, threshold: 1 }, { unique: true, partialFilterExpression: { threshold: { $type: 'string' } } });
NotificationSchema.index({ createdAt: 1 });

module.exports = model('Notification', NotificationSchema);
