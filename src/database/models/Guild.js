'use strict';

const { Schema, model } = require('mongoose');

/**
 * Sunucuya ozel ayarlar (madde 25, 26). Her guild kendi plan/rol/fiyat/kanal/bildirim/
 * odeme/trial/sure/mesaj yapilandirmasina sahip olabilir; guildId ile izole edilir.
 */
const GuildSchema = new Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: '' },
    active: { type: Boolean, default: true },
    maintenanceMode: { type: Boolean, default: false },

    channels: {
      logChannelId: { type: String, default: null },
      notificationChannelId: { type: String, default: null },
      adminPanelChannelId: { type: String, default: null },
      panelChannelId: { type: String, default: null },
    },

    messages: {
      welcomeMessage: { type: String, default: '' },
      renewalMessage: { type: String, default: '' },
      expirationMessage: { type: String, default: '' },
    },

    subscriptionPolicy: {
      cancelBehavior: { type: String, enum: ['immediate', 'period_end'], default: 'period_end' },
      pauseAllowed: { type: Boolean, default: true },
      planChangePolicy: { type: String, enum: ['immediate', 'period_end'], default: 'immediate' },
      gracePeriodMs: { type: Number, default: 259200000 },
    },

    rolePolicy: {
      autoRepair: { type: Boolean, default: true },
      conflictPolicy: { type: String, enum: ['highest_priority_keep', 'remove_all_but_one', 'warn_only'], default: 'highest_priority_keep' },
    },

    featureFlags: {
      payments: { type: Boolean, default: false },
      trial: { type: Boolean, default: true },
      notifications: { type: Boolean, default: true },
      autoRenew: { type: Boolean, default: true },
      statistics: { type: Boolean, default: true },
      roleSync: { type: Boolean, default: true },
    },

    trialAbuseDetection: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = model('Guild', GuildSchema);
