'use strict';

const { Schema, model } = require('mongoose');

/**
 * Denetim kaydi. Rol atama/kaldirma, plan degisikligi, iptal, backup/restore gibi
 * onemli tum islemler icin olusturulur (madde 7, 12, 63...).
 */
const AuditLogSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    actorId: { type: String, default: null },
    actorType: { type: String, enum: ['user', 'system', 'scheduler', 'webhook'], default: 'system' },

    action: { type: String, required: true, index: true },
    targetType: { type: String, default: null },
    targetId: { type: String, default: null },

    details: { type: Schema.Types.Mixed, default: {} },
    success: { type: Boolean, default: true },
    errorMessage: { type: String, default: null },
  },
  { timestamps: true }
);

AuditLogSchema.index({ guildId: 1, createdAt: -1 });
AuditLogSchema.index({ guildId: 1, action: 1, createdAt: -1 });

module.exports = model('AuditLog', AuditLogSchema);
