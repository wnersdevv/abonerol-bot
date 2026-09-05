'use strict';

const planService = require('../../services/planService');
const trialService = require('../../services/trialService');
const subscriptionService = require('../../services/subscriptionService');
const renewalService = require('../../services/renewalService');
const { formatDate } = require('../../utils/formatters');
const { AppError } = require('../../utils/errors');
const { getLogger } = require('../../utils/logger');

/**
 * "plan" namespace'i altindaki secim etkilesimlerini yonetir (plansPanel.js
 * icindeki Select Menu ile eslesir).
 */
async function handle(interaction, ctx, action, params) {
  const [ownerDiscordId] = params;
  const guildId = interaction.guildId;
  const requesterId = interaction.user.id;

  if (ownerDiscordId && ownerDiscordId !== requesterId) {
    await interaction.reply({ content: '❌ Bu secim sizin icin olusturulmamis.', ephemeral: true });
    return;
  }

  try {
    if (action !== 'sec') {
      await interaction.reply({ content: '❌ Bilinmeyen islem.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const planId = interaction.values[0];
    const plan = await planService.getPlan(guildId, planId);

    if (plan.trialEnabled) {
      const eligibility = await trialService.isTrialEligible(guildId, requesterId, plan);
      if (eligibility.eligible) {
        const subscriber = await trialService.startTrial(guildId, requesterId, plan, requesterId);
        await interaction.editReply({
          content: `🎁 "${plan.name}" plani icin deneme suresi baslatildi.\nDeneme bitis tarihi: ${formatDate(subscriber.trialExpiresAt)}`,
        });
        return;
      }
    }

    if (plan.price === 0) {
      const { subscriber } = await subscriptionService.grantSubscription(interaction.guild, {
        discordId: requesterId,
        guildId,
        planId: plan.planId,
        source: 'manual',
        actorId: requesterId,
        actorType: 'user',
      });
      await interaction.editReply({ content: `✅ "${plan.name}" planina abone oldunuz. Bitis tarihi: ${formatDate(subscriber.expiresAt)}` });
      return;
    }

    const result = await renewalService.requestRenewal(ctx.settings, interaction.guild, guildId, requesterId).catch(async () => {
      // Mevcut abonelik yoksa dogrudan odeme baslat
      const paymentService = require('../../services/paymentService');
      return paymentService.initiatePayment(ctx.settings, { guildId, discordId: requesterId, plan });
    });

    if (result.configured === false) {
      await interaction.editReply({ content: `🟡 ${result.message}` });
    } else {
      await interaction.editReply({ content: `💳 "${plan.name}" plani icin odeme baslatildi. Odeme saglayicisi uzerinden islemi tamamlayin.` });
    }
  } catch (err) {
    getLogger().error('Plan secim islemi basarisiz.', { message: err.message });
    const content = err instanceof AppError ? `🟡 ${err.message}` : '❌ Islem sirasinda beklenmeyen bir hata olustu.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content, ephemeral: true });
    }
  }
}

module.exports = { handle };
