'use strict';

const { EmbedBuilder } = require('discord.js');
const subscriptionService = require('../../services/subscriptionService');
const renewalService = require('../../services/renewalService');
const planService = require('../../services/planService');
const { buildSubscriptionPanel } = require('./subscriptionPanel');
const { buildPlansPanel } = require('../plans/plansPanel');
const { formatDate, statusLabelTr, formatCurrency } = require('../../utils/formatters');
const { AppError } = require('../../utils/errors');
const { getLogger } = require('../../utils/logger');

/**
 * "abonelik" namespace'i altindaki tum buton etkilesimlerini yonetir
 * (subscriptionPanel.js icindeki butonlarla eslesir).
 */
async function handle(interaction, ctx, action, params) {
  const [ownerDiscordId] = params;
  const guildId = interaction.guildId;
  const requesterId = interaction.user.id;

  if (ownerDiscordId && ownerDiscordId !== requesterId) {
    await interaction.reply({ content: '❌ Bu panel sizin icin olusturulmamis.', ephemeral: true });
    return;
  }

  try {
    switch (action) {
      case 'yenile': {
        await interaction.deferReply({ ephemeral: true });
        const result = await renewalService.requestRenewal(ctx.settings, interaction.guild, guildId, requesterId);
        if (result.requiresPayment && !result.configured) {
          await interaction.editReply({ content: `🟡 ${result.message}` });
        } else if (result.requiresPayment && result.configured) {
          await interaction.editReply({ content: `💳 Odeme baslatildi. Odeme saglayicisi uzerinden islemi tamamlayabilirsiniz.` });
        } else {
          await interaction.editReply({ content: `✅ Aboneliginiz basariyla yenilendi. Yeni bitis tarihi: ${formatDate(result.subscriber.expiresAt)}` });
        }
        break;
      }
      case 'iptal': {
        await interaction.deferReply({ ephemeral: true });
        const guildSettings = await require('../../services/guildService').getOrCreateGuildSettings(guildId, interaction.guild.name).catch(() => null);
        const cancelBehavior = (guildSettings && guildSettings.subscriptionPolicy && guildSettings.subscriptionPolicy.cancelBehavior) || 'period_end';
        const subscriber = await subscriptionService.cancelSubscription(interaction.guild, guildId, requesterId, { actorId: requesterId, cancelBehavior });
        const message = cancelBehavior === 'immediate'
          ? '🛑 Aboneliginiz aninda iptal edildi.'
          : `🛑 Aboneliginiz iptal edildi, ${formatDate(subscriber.expiresAt)} tarihine kadar aktif kalacak.`;
        await interaction.editReply({ content: message });
        break;
      }
      case 'detay': {
        await interaction.deferReply({ ephemeral: true });
        const subscriber = await subscriptionService.getSubscriberStatus(guildId, requesterId);
        const history = await subscriptionService.getSubscriptionHistory(guildId, requesterId, 5);

        const embed = new EmbedBuilder()
          .setTitle('📄 Abonelik Detaylari')
          .setColor(0x5865f2);

        if (!subscriber) {
          embed.setDescription('Bu sunucuda kayitli bir aboneliginiz bulunmuyor.');
        } else {
          embed.addFields(
            { name: 'Durum', value: statusLabelTr(subscriber.status), inline: true },
            { name: 'Plan', value: subscriber.planId, inline: true },
            { name: 'Baslangic', value: formatDate(subscriber.startedAt), inline: true },
            { name: 'Bitis', value: formatDate(subscriber.expiresAt), inline: true },
            { name: 'Toplam Odeme', value: formatCurrency(subscriber.totalPaid, subscriber.currency), inline: true },
            { name: 'Otomatik Yenileme', value: subscriber.autoRenew ? 'Acik' : 'Kapali', inline: true }
          );
        }

        if (history.length > 0) {
          embed.addFields({
            name: 'Gecmis',
            value: history.map((h) => `• ${h.changeType} - ${statusLabelTr(h.status)} - ${formatDate(h.createdAt)}`).join('\n').slice(0, 1024),
          });
        }

        await interaction.editReply({ embeds: [embed] });
        break;
      }
      case 'planlar': {
        await interaction.deferReply({ ephemeral: true });
        const plans = await planService.listActivePlansCached(guildId);
        const panel = buildPlansPanel({ plans, discordId: requesterId });
        await interaction.editReply(panel);
        break;
      }
      case 'odeme': {
        await interaction.deferReply({ ephemeral: true });
        const subscriber = await subscriptionService.getSubscriberStatus(guildId, requesterId);
        if (!subscriber || !subscriber.lastPaymentId) {
          await interaction.editReply({ content: '💳 Kayitli bir odemeniz bulunmuyor.' });
        } else {
          await interaction.editReply({ content: `💳 Son odeme kimliginiz: \`${subscriber.lastPaymentId}\`\nToplam odeme: ${formatCurrency(subscriber.totalPaid, subscriber.currency)}` });
        }
        break;
      }
      case 'yardim': {
        await interaction.reply({
          ephemeral: true,
          content: [
            '## ❓ Abonelik Sistemi Yardim',
            '`/abonelik durum` - Guncel aboneligi goruntule',
            '`/abonelik planlar` - Mevcut planlari listele',
            '`/abonelik yenile` - Aboneligi yenile',
            '`/abonelik iptal` - Aboneligi iptal et',
            '`/abonelik gecmis` - Abonelik gecmisini goruntule',
          ].join('\n'),
        });
        break;
      }
      default:
        await interaction.reply({ content: '❌ Bilinmeyen islem.', ephemeral: true });
    }
  } catch (err) {
    getLogger().error('Abonelik component islemi basarisiz.', { action, message: err.message });
    const content = err instanceof AppError ? `🟡 ${err.message}` : '❌ Islem sirasinda beklenmeyen bir hata olustu.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content, ephemeral: true });
    }
  }
}

module.exports = { handle };
