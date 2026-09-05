'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const reviewService = require('../../services/verificationReviewService');
const { isManagerOrAbove } = require('../../utils/permissions');
const { statusLabelTr, formatDate } = require('../../utils/formatters');
const { AppError } = require('../../utils/errors');

/**
 * Manuel inceleme kuyrugu komutlari (doc-1 madde 23-24, doc-2 madde 22-23).
 * Yalnizca Manager+ kullanabilir. Onay/red/tekrar tara/askiya al islemleri
 * verificationReviewService uzerinden yapilir ve audit'e yazilir.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('inceleme')
    .setDescription('YouTube dogrulama manuel inceleme kuyrugu (yonetici)')
    .addSubcommand((sub) => sub
      .setName('liste')
      .setDescription('Bekleyen incelemeleri listele')
      .addStringOption((o) => o
        .setName('kategori')
        .setDescription('Inceleme kategorisi')
        .addChoices(
          { name: 'Bekleyen', value: 'pending' },
          { name: 'Yuksek Risk', value: 'high_risk' },
          { name: 'API Celiskisi', value: 'api_conflict' },
          { name: 'Duplicate', value: 'duplicate' }
        )))
    .addSubcommand((sub) => sub
      .setName('onayla')
      .setDescription('Dogrulamayi onayla')
      .addUserOption((o) => o.setName('kullanici').setDescription('Kullanici').setRequired(true))
      .addStringOption((o) => o.setName('gerekce').setDescription('Gerekce')))
    .addSubcommand((sub) => sub
      .setName('reddet')
      .setDescription('Dogrulamayi reddet')
      .addUserOption((o) => o.setName('kullanici').setDescription('Kullanici').setRequired(true))
      .addStringOption((o) => o.setName('gerekce').setDescription('Gerekce')))
    .addSubcommand((sub) => sub
      .setName('tekrar-tara')
      .setDescription('Dogrulamayi tekrar tarama kuyruguna al')
      .addUserOption((o) => o.setName('kullanici').setDescription('Kullanici').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('askiya-al')
      .setDescription('Kullanicinin dogrulamasini askiya al')
      .addUserOption((o) => o.setName('kullanici').setDescription('Kullanici').setRequired(true))
      .addStringOption((o) => o.setName('gerekce').setDescription('Gerekce').setRequired(true))),

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

    const sub = interaction.options.getSubcommand();
    const reviewerId = interaction.user.id;

    try {
      await interaction.deferReply({ ephemeral: true });

      if (sub === 'liste') {
        const category = interaction.options.getString('kategori') || 'pending';
        const items = await reviewService.listPendingReviews(guildId, { category });
        if (items.length === 0) {
          await interaction.editReply({ content: 'Bu kategoride bekleyen inceleme bulunmuyor.' });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('🔍 İnceleme Kuyruğu')
          .setColor(0xffa500)
          .setDescription(items.map((v) => `<@${v.discordId}> — ${statusLabelTr(v.status)} — Risk: ${v.riskScore ?? '—'} — ${formatDate(v.updatedAt)}`).join('\n').slice(0, 4000));
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const actionMap = { onayla: 'approve', reddet: 'reject', 'tekrar-tara': 'rescan', 'askiya-al': 'suspend' };
      const action = actionMap[sub];
      if (!action) return;

      const targetUser = interaction.options.getUser('kullanici');
      const reason = interaction.options.getString('gerekce') || null;

      const record = await reviewService.reviewVerification(interaction.guild, guildId, targetUser.id, { action, reason, reviewerId });
      await interaction.editReply({ content: `✅ İşlem tamamlandı: <@${targetUser.id}> → ${statusLabelTr(record.status)}` });
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
