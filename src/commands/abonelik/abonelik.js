'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const subscriptionService = require('../../services/subscriptionService');
const renewalService = require('../../services/renewalService');
const planService = require('../../services/planService');
const guildService = require('../../services/guildService');
const { buildSubscriptionPanel } = require('../../components/subscription/subscriptionPanel');
const { buildPlansPanel } = require('../../components/plans/plansPanel');
const { formatDate, statusLabelTr, formatCurrency } = require('../../utils/formatters');
const { AppError } = require('../../utils/errors');

/**
 * Kullaniciya yonelik abonelik komutlari (madde 14, 19). Business logic burada
 * yok - tum islemler src/services altindaki servislere delege edilir.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('abonelik')
    .setDescription('Abonelik islemlerinizi yonetin')
    .addSubcommand((sub) => sub.setName('durum').setDescription('Guncel abonelik durumunuzu goruntuleyin (panel)'))
    .addSubcommand((sub) => sub.setName('planlar').setDescription('Bu sunucudaki abonelik planlarini listeleyin'))
    .addSubcommand((sub) => sub.setName('yenile').setDescription('Aboneliginizi yenileyin'))
    .addSubcommand((sub) => sub.setName('iptal').setDescription('Aboneliginizi iptal edin'))
    .addSubcommand((sub) => sub.setName('gecmis').setDescription('Abonelik gecmisinizi goruntuleyin')),

  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const discordId = interaction.user.id;

    if (!guildId) {
      await interaction.reply({ content: '❌ Bu komut yalnizca sunucu icinde kullanilabilir.', ephemeral: true });
      return;
    }

    try {
      if (sub === 'durum') {
        await interaction.deferReply({ ephemeral: true });
        const subscriber = await subscriptionService.getSubscriberStatus(guildId, discordId);
        let plan = null;
        if (subscriber) plan = await planService.getPlan(guildId, subscriber.planId).catch(() => null);
        const panel = buildSubscriptionPanel({ subscriber, plan, discordId });
        await interaction.editReply(panel);
        return;
      }

      if (sub === 'planlar') {
        await interaction.deferReply({ ephemeral: true });
        const plans = await planService.listActivePlansCached(guildId);
        const panel = buildPlansPanel({ plans, discordId });
        await interaction.editReply(panel);
        return;
      }

      if (sub === 'yenile') {
        await interaction.deferReply({ ephemeral: true });
        const result = await renewalService.requestRenewal(ctx.settings, interaction.guild, guildId, discordId);
        if (result.requiresPayment && !result.configured) {
          await interaction.editReply({ content: `🟡 ${result.message}` });
        } else if (result.requiresPayment && result.configured) {
          await interaction.editReply({ content: '💳 Odeme baslatildi. Odeme saglayicisi uzerinden islemi tamamlayin.' });
        } else {
          await interaction.editReply({ content: `✅ Aboneliginiz yenilendi. Yeni bitis tarihi: ${formatDate(result.subscriber.expiresAt)}` });
        }
        return;
      }

      if (sub === 'iptal') {
        await interaction.deferReply({ ephemeral: true });
        const guildSettings = await guildService.getOrCreateGuildSettings(guildId, interaction.guild.name).catch(() => null);
        const cancelBehavior = (guildSettings && guildSettings.subscriptionPolicy && guildSettings.subscriptionPolicy.cancelBehavior) || 'period_end';
        const subscriber = await subscriptionService.cancelSubscription(interaction.guild, guildId, discordId, { actorId: discordId, cancelBehavior });
        const message = cancelBehavior === 'immediate'
          ? '🛑 Aboneliginiz aninda iptal edildi.'
          : `🛑 Aboneliginiz iptal edildi, ${formatDate(subscriber.expiresAt)} tarihine kadar aktif kalacak.`;
        await interaction.editReply({ content: message });
        return;
      }

      if (sub === 'gecmis') {
        await interaction.deferReply({ ephemeral: true });
        const history = await subscriptionService.getSubscriptionHistory(guildId, discordId, 10);
        if (history.length === 0) {
          await interaction.editReply({ content: 'Herhangi bir abonelik geçmişiniz bulunmuyor.' });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('📜 Abonelik Geçmişi')
          .setColor(0x5865f2)
          .setDescription(
            history.map((h) => `**${h.changeType}** — ${statusLabelTr(h.status)}\n${formatDate(h.startedAt)} → ${formatDate(h.expiresAt)}`).join('\n\n').slice(0, 4000)
          );
        await interaction.editReply({ embeds: [embed] });
        return;
      }
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
