'use strict';

const fs = require('fs');
const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const subscriptionService = require('../../services/subscriptionService');
const planService = require('../../services/planService');
const synchronizationService = require('../../services/synchronizationService');
const analyticsService = require('../../services/analyticsService');
const healthService = require('../../services/healthService');
const backupService = require('../../services/backupService');
const { isManagerOrAbove, isOwner } = require('../../utils/permissions');
const { formatDate, statusLabelTr, formatCurrency } = require('../../utils/formatters');
const { AppError } = require('../../utils/errors');

/**
 * Yonetici abone/sistem yonetim komutlari (madde 22: ver, uzat, sure, iptal,
 * duraklat, devam, sil, kontrol, senkronize; madde 21: istatistik, sistem, backup).
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('abone')
    .setDescription('Abone ve sistem yonetimi (yonetici)')
    .addSubcommand((sub) => sub
      .setName('ver')
      .setDescription('Kullaniciya manuel abonelik ver')
      .addUserOption((o) => o.setName('kullanici').setDescription('Kullanici').setRequired(true))
      .addStringOption((o) => o.setName('plan-id').setDescription('Plan ID').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('uzat')
      .setDescription('Aboneligi uzat')
      .addUserOption((o) => o.setName('kullanici').setDescription('Kullanici').setRequired(true))
      .addIntegerOption((o) => o.setName('sure').setDescription('Ek sure').setRequired(true))
      .addStringOption((o) => o
        .setName('sure-birimi')
        .setDescription('Sure birimi')
        .setRequired(true)
        .addChoices(
          { name: 'gun', value: 'day' }, { name: 'hafta', value: 'week' },
          { name: 'ay', value: 'month' }, { name: 'yil', value: 'year' }
        )))
    .addSubcommand((sub) => sub
      .setName('iptal')
      .setDescription('Kullanicinin aboneligini iptal et')
      .addUserOption((o) => o.setName('kullanici').setDescription('Kullanici').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('duraklat')
      .setDescription('Aboneligi duraklat')
      .addUserOption((o) => o.setName('kullanici').setDescription('Kullanici').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('devam')
      .setDescription('Duraklatilmis aboneligi devam ettir')
      .addUserOption((o) => o.setName('kullanici').setDescription('Kullanici').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('sil')
      .setDescription('Abone kaydini kalici olarak sil')
      .addUserOption((o) => o.setName('kullanici').setDescription('Kullanici').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('kontrol')
      .setDescription('Bir kullanicinin abonelik durumunu goruntule')
      .addUserOption((o) => o.setName('kullanici').setDescription('Kullanici').setRequired(true)))
    .addSubcommand((sub) => sub.setName('senkronize').setDescription('Bu sunucudaki abone rollerini senkronize et'))
    .addSubcommand((sub) => sub.setName('istatistik').setDescription('Sunucu abonelik istatistiklerini goruntule'))
    .addSubcommand((sub) => sub.setName('sistem').setDescription('Sistem saglik durumunu goruntule'))
    .addSubcommand((sub) => sub.setName('yedekle').setDescription('Sunucu verisinin yedegini al'))
    .addSubcommand((sub) => sub.setName('disa-aktar').setDescription('Sunucu verisini disa aktar (JSON)')),

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
    const actorId = interaction.user.id;

    try {
      await interaction.deferReply({ ephemeral: true });

      if (sub === 'ver') {
        const targetUser = interaction.options.getUser('kullanici');
        const { subscriber } = await subscriptionService.grantSubscription(interaction.guild, {
          discordId: targetUser.id, guildId, planId: interaction.options.getString('plan-id'),
          source: 'admin_grant', actorId, actorType: 'user',
        });
        await interaction.editReply({ content: `✅ <@${targetUser.id}> icin abonelik verildi. Bitis: ${formatDate(subscriber.expiresAt)}` });
        return;
      }

      if (sub === 'uzat') {
        const targetUser = interaction.options.getUser('kullanici');
        const subscriber = await subscriptionService.extendSubscription(
          guildId, targetUser.id, interaction.options.getInteger('sure'), interaction.options.getString('sure-birimi'), actorId
        );
        await interaction.editReply({ content: `✅ <@${targetUser.id}> aboneligi uzatildi. Yeni bitis: ${formatDate(subscriber.expiresAt)}` });
        return;
      }

      if (sub === 'iptal') {
        const targetUser = interaction.options.getUser('kullanici');
        const subscriber = await subscriptionService.cancelSubscription(interaction.guild, guildId, targetUser.id, { actorId, cancelBehavior: 'immediate' });
        await interaction.editReply({ content: `🛑 <@${targetUser.id}> aboneligi iptal edildi.` });
        return;
      }

      if (sub === 'duraklat') {
        const targetUser = interaction.options.getUser('kullanici');
        await subscriptionService.pauseSubscription(guildId, targetUser.id, actorId);
        await interaction.editReply({ content: `⏸️ <@${targetUser.id}> aboneligi duraklatildi.` });
        return;
      }

      if (sub === 'devam') {
        const targetUser = interaction.options.getUser('kullanici');
        const subscriber = await subscriptionService.resumeSubscription(guildId, targetUser.id, actorId);
        await interaction.editReply({ content: `▶️ <@${targetUser.id}> aboneligi devam ettirildi. Yeni bitis: ${formatDate(subscriber.expiresAt)}` });
        return;
      }

      if (sub === 'sil') {
        if (!isOwner(interaction.member, ctx.settings, interaction.guild)) {
          await interaction.editReply({ content: '❌ Bu islem yalnizca sunucu sahibi/owner tarafindan yapilabilir.' });
          return;
        }
        const targetUser = interaction.options.getUser('kullanici');
        await subscriptionService.deleteSubscriberRecord(guildId, targetUser.id, actorId);
        await interaction.editReply({ content: `🗑️ <@${targetUser.id}> abone kaydi kalici olarak silindi.` });
        return;
      }

      if (sub === 'kontrol') {
        const targetUser = interaction.options.getUser('kullanici');
        const subscriber = await subscriptionService.getSubscriberStatus(guildId, targetUser.id);
        if (!subscriber) {
          await interaction.editReply({ content: `<@${targetUser.id}> icin kayitli abonelik bulunamadi.` });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle(`Abonelik Durumu — ${targetUser.username}`)
          .setColor(0x5865f2)
          .addFields(
            { name: 'Durum', value: statusLabelTr(subscriber.status), inline: true },
            { name: 'Plan', value: subscriber.planId, inline: true },
            { name: 'Bitis', value: formatDate(subscriber.expiresAt), inline: true },
            { name: 'Toplam Odeme', value: formatCurrency(subscriber.totalPaid, subscriber.currency), inline: true }
          );
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (sub === 'senkronize') {
        const result = await synchronizationService.synchronizeGuild(interaction.client, guildId);
        if (!result.ok) {
          await interaction.editReply({ content: `🟡 ${result.reason}` });
          return;
        }
        await interaction.editReply({
          content: `✅ Senkronizasyon tamamlandi.\nKontrol edilen: ${result.report.checked}\nDuzeltilen: ${result.report.fixed}\nKaldirilan: ${result.report.removed}\nRaporlanan sorun: ${result.report.reported.length}\nHata: ${result.report.errors.length}`,
        });
        return;
      }

      if (sub === 'istatistik') {
        const analytics = await analyticsService.getGuildAnalytics(guildId);
        const embed = new EmbedBuilder()
          .setTitle('📊 Abonelik İstatistikleri')
          .setColor(0x5865f2)
          .addFields(
            { name: 'Durum Dagilimi', value: Object.entries(analytics.subscribersByStatus).map(([k, v]) => `${statusLabelTr(k)}: ${v}`).join('\n') || 'Veri yok' },
            { name: 'Aktif Plan Sayisi', value: String(analytics.activePlanCount), inline: true },
            { name: 'Toplam Gelir', value: analytics.totalRevenueByCurrency.map((r) => formatCurrency(r.total, r.currency)).join(', ') || '0', inline: true }
          );
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (sub === 'sistem') {
        const health = await healthService.getSystemHealth(interaction.client, ctx.settings);
        const embed = new EmbedBuilder()
          .setTitle('⚙️ Sistem Durumu')
          .setColor(0x5865f2)
          .addFields(
            { name: 'Discord', value: `${health.discord.ready ? '🟢 Bagli' : '🔴 Bagli degil'} (Ping: ${health.discord.ping}ms)`, inline: true },
            { name: 'MongoDB', value: health.mongodb.label, inline: true },
            { name: 'Odeme Saglayicisi', value: health.payment.label, inline: true },
            { name: 'Kuyruk', value: `${health.queue.active} aktif / ${health.queue.pending} bekleyen`, inline: true },
            { name: 'Basarisiz Isler', value: String(health.failedJobs), inline: true }
          );
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (sub === 'yedekle') {
        const result = await backupService.createGuildBackup(guildId, actorId);
        const attachment = new AttachmentBuilder(fs.readFileSync(result.filePath), { name: result.fileName });
        await interaction.editReply({ content: `💾 Yedek olusturuldu. Plan: ${result.stats.plans}, Abone: ${result.stats.subscribers}`, files: [attachment] });
        return;
      }

      if (sub === 'disa-aktar') {
        const result = await backupService.exportGuildData(guildId);
        const attachment = new AttachmentBuilder(fs.readFileSync(result.filePath), { name: result.fileName });
        await interaction.editReply({ content: '📤 Sunucu verisi disa aktarildi.', files: [attachment] });
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
