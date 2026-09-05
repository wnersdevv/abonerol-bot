'use strict';

const { SlashCommandBuilder } = require('discord.js');
const policyService = require('../../services/verificationPolicyService');
const { isManagerOrAbove } = require('../../utils/permissions');
const { AppError } = require('../../utils/errors');

/**
 * YouTube dogrulama politikasi ayarlari (doc-1 madde 2, 36; doc-2 madde 2-3).
 * Guncelleme her zaman yeni bir policy versiyonu olusturur (versioning).
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('youtube-ayar')
    .setDescription('YouTube dogrulama politikasini yapilandirin (yonetici)')
    .addRoleOption((o) => o.setName('rol').setDescription('Dogrulama basarili olunca verilecek rol'))
    .addIntegerOption((o) => o.setName('min-abone').setDescription('Minimum abone sayisi'))
    .addIntegerOption((o) => o.setName('min-video').setDescription('Minimum video sayisi'))
    .addIntegerOption((o) => o.setName('tarama-araligi-saat').setDescription('Otomatik tarama araligi (saat)'))
    .addIntegerOption((o) => o.setName('grace-period-saat').setDescription('Grace period suresi (saat)'))
    .addStringOption((o) => o
      .setName('duplicate-politika')
      .setDescription('Ayni kanalin birden fazla hesaba baglanmasi politikasi')
      .addChoices(
        { name: 'Izin ver', value: 'ALLOW' },
        { name: 'Reddet', value: 'DENY' },
        { name: 'Manuel inceleme', value: 'MANUAL_REVIEW' }
      ))
    .addBooleanOption((o) => o.setName('otomatik-tarama').setDescription('Otomatik tarama acik/kapali')),

  async execute(interaction, ctx) {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({ content: '❌ Bu komut yalnizca sunucu icinde kullanilabilir.', ephemeral: true });
      return;
    }
    if (!isManagerOrAbove(interaction.member, ctx.settings, interaction.guild)) {
      await interaction.reply({ content: '❌ Bu islemi gerceklestirmek icin yetkiniz bulunmuyor.', ephemeral: true });
      return;
    }

    try {
      await interaction.deferReply({ ephemeral: true });

      const updates = {};
      const role = interaction.options.getRole('rol');
      if (role) updates.roleId = role.id;

      const minSub = interaction.options.getInteger('min-abone');
      const minVideo = interaction.options.getInteger('min-video');
      if (minSub !== null || minVideo !== null) {
        const current = await policyService.getActivePolicy(guildId);
        const conditions = [];
        if (minSub !== null) conditions.push({ field: 'subscriberCount', operator: 'gte', value: minSub, valueMax: null });
        if (minVideo !== null) conditions.push({ field: 'videoCount', operator: 'gte', value: minVideo, valueMax: null });
        // Mevcut kosullardan degistirilmeyenleri koru
        const preserved = (current.ruleGroup.conditions || []).filter(
          (c) => !conditions.some((nc) => nc.field === c.field)
        );
        updates.ruleGroup = { logic: current.ruleGroup.logic || 'AND', conditions: [...preserved, ...conditions] };
      }

      const scanHours = interaction.options.getInteger('tarama-araligi-saat');
      if (scanHours !== null) updates.scanIntervalMs = scanHours * 60 * 60 * 1000;

      const graceHours = interaction.options.getInteger('grace-period-saat');
      if (graceHours !== null) updates.gracePeriodMs = graceHours * 60 * 60 * 1000;

      const duplicatePolicy = interaction.options.getString('duplicate-politika');
      if (duplicatePolicy) updates.duplicateChannelPolicy = duplicatePolicy;

      const autoScan = interaction.options.getBoolean('otomatik-tarama');
      if (autoScan !== null) updates.autoScanEnabled = autoScan;

      if (Object.keys(updates).length === 0) {
        await interaction.editReply({ content: 'Herhangi bir ayar belirtmediniz.' });
        return;
      }

      const newPolicy = await policyService.updatePolicy(guildId, updates, interaction.user.id);
      await interaction.editReply({ content: `✅ Politika güncellendi (v${newPolicy.version}).` });
    } catch (err) {
      const content = err instanceof AppError ? `🟡 ${err.message}` : '❌ İşlem sırasında beklenmeyen bir hata oluştu.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content });
      } else {
        await interaction.reply({ content, ephemeral: true });
      }
    }
  },
};
