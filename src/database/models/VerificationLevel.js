'use strict';

const { Schema, model } = require('mongoose');

/**
 * Rol kademelendirme (doc-2 madde 4-5). Bronz/Silver/Gold/VIP gibi seviyeler
 * tamamen sunucuya ozel tanimlanir; her seviyenin kendi sart grubu vardir.
 */
const VerificationLevelSchema = new Schema(
  {
    levelId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },

    name: { type: String, required: true },
    roleId: { type: String, required: true },
    requirements: { type: Schema.Types.Mixed, default: {} }, // VerificationPolicy.ruleGroup ile ayni format
    priority: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

VerificationLevelSchema.index({ guildId: 1, priority: -1 });

module.exports = model('VerificationLevel', VerificationLevelSchema);
