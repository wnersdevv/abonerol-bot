'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { buildAdminPanel } = require('../../components/admin/adminPanel');
const { isManagerOrAbove } = require('../../utils/permissions');

/**
 * Yonetim panelini acar (madde 21). Panel icerigi admin route handler
 * uzerinden Select Menu secimine gore doldurulur.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('WNERSDEV yonetim panelini ac (yonetici)'),

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

    const panel = buildAdminPanel({ guildId, actorId: interaction.user.id });
    await interaction.reply({ ...panel, ephemeral: true });
  },
};
