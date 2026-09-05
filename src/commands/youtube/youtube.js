'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const verificationService = require('../../services/youtubeVerificationService');
const scanService = require('../../services/youtubeScanService');
const policyService = require('../../services/verificationPolicyService');
const analyticsService = require('../../services/verificationAnalyticsService');
const healthService = require('../../services/healthService');
const safeModeService = require('../../services/verificationSafeModeService');
const youtubeApiService = require('../../services/youtubeApiService');
const geminiService = require('../../services/geminiService');
const captchaService = require('../../services/captchaService');
const { isManagerOrAbove, isOwner } = require('../../utils/permissions');
const { formatDate, statusLabelTr } = require('../../utils/formatters');
const { AppError } = require('../../utils/errors');

/**
 * YouTube dogrulama komutlari (doc-1 madde 5, 23, 28; doc-2 madde 31, 43, 46-77).
 * Business logic tamamen src/services altindadir; bu dosya yalnizca
 * komut/controller katmanidir.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('youtube')
    .setDescription('YouTube kanal dogrulama sistemi')
    .addSubcommand((sub) => sub
      .setName('dogrula')
      .setDescription('YouTube kanalinizi dogrulayin')
      .addStringOption((o) => o.setName('kanal').setDescription('Kanal URL, @handle veya Channel ID').setRequired(true)))
    .addSubcommand((sub) => sub.setName('durum').setDescription('Dogrulama durumunuzu goruntuleyin'))
    .addSubcommand((sub) => sub.setName('tekrar-tara').setDescription('Kanalinizi tekrar taratin'))
    .addSubcommand((sub) => sub.setName('gecmis').setDescription('Dogrulama/tarama gecmisinizi goruntuleyin'))
    .addSubcommand((sub) => sub
      .setName('kanal-degistir')
      .setDescription('Bagli YouTube kanalinizi degistirin')
      .addStringOption((o) => o.setName('kanal').setDescription('Yeni kanal URL, @handle veya Channel ID').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('tara')
      .setDescription('(Yonetici) Manuel tarama baslat')
      .addUserOption((o) => o.setName('kullanici').setDescription('Belirli bir kullaniciyi tara (bos birakilirsa tum aktif kullanicilar)')))
    .addSubcommand((sub) => sub.setName('istatistik').setDescription('(Yonetici) Dogrulama istatistiklerini goruntule'))
    .addSubcommand((sub) => sub.setName('sistem').setDescription('(Yonetici) YouTube dogrulama sistem durumunu goruntule'))
    .addSubcommand((sub) => sub.setName('otomatik-tarama-durdur').setDescription('(Yonetici) Otomatik taramayi durdur'))
    .addSubcommand((sub) => sub.setName('otomatik-tarama-baslat').setDescription('(Yonetici) Otomatik taramayi baslat'))
    .addSubcommand((sub) => sub.setName('guvenli-mod-kapat').setDescription('(Owner/Manager) Safe Mode\'dan cikis yap')),

  async execute(interaction, ctx) {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({ content: '❌ Bu komut yalnizca sunucu icinde kullanilabilir.', ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand();
    const discordId = interaction.user.id;
    const adminSubcommands = ['tara', 'istatistik', 'sistem', 'otomatik-tarama-durdur', 'otomatik-tarama-baslat', 'guvenli-mod-kapat'];

    if (adminSubcommands.includes(sub) && !isManagerOrAbove(interaction.member, ctx.settings, interaction.guild)) {
      await interaction.reply({ content: '❌ Bu islemi gerceklestirmek icin yetkiniz bulunmuyor.', ephemeral: true });
      return;
    }

    try {
      if (!ctx.settings.youtube || !ctx.settings.youtube.apiKey) {
        if (['dogrula', 'tekrar-tara', 'kanal-degistir', 'tara'].includes(sub)) {
          await interaction.reply({ content: '🟡 YouTube API anahtari yapilandirilmamis. Dogrulama yapilamiyor.', ephemeral: true });
          return;
        }
      }

      if (sub === 'dogrula' || sub === 'tekrar-tara' || sub === 'kanal-degistir') {
        await interaction.deferReply({ ephemeral: true });
        const channelInput = sub === 'tekrar-tara' ? null : interaction.options.getString('kanal');
        const record = await verificationService.runVerification(interaction.client, ctx.settings, interaction.guild, guildId, discordId, {
          channelInputRaw: channelInput, scanType: 'manual', actorId: discordId,
        });

        const statusText = {
          passed: '🟢 Doğrulama başarılı!',
          failed: `🔴 Doğrulama başarısız.${record.failureReason ? `\nNeden: ${record.failureReason}` : ''}`,
          grace_period: `🟡 Şartlar artık sağlanmıyor, süre tanınan bir bekleme dönemindesiniz.\nBitiş: ${formatDate(record.gracePeriodExpiresAt)}`,
          manual_review: '🟠 Doğrulamanız manuel inceleme kuyruğuna alındı.',
          error: `❌ Doğrulama yapılamadı.\n${record.failureReason || ''}`,
        }[record.status] || `Durum: ${statusLabelTr(record.status)}`;

        await interaction.editReply({ content: statusText });
        return;
      }

      if (sub === 'durum') {
        await interaction.deferReply({ ephemeral: true });
        const record = await verificationService.getVerification(guildId, discordId);
        if (!record) {
          await interaction.editReply({ content: 'Henüz bir YouTube doğrulaması başlatmadınız. `/youtube dogrula` ile başlayabilirsiniz.' });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('📺 YouTube Doğrulama Durumu')
          .setColor(0x5865f2)
          .addFields(
            { name: 'Durum', value: statusLabelTr(record.status), inline: true },
            { name: 'Kanal', value: record.channelName || '—', inline: true },
            { name: 'Abone Sayısı', value: record.subscriberCount !== null ? String(record.subscriberCount) : 'Gizli/Bilinmiyor', inline: true },
            { name: 'Son Kontrol', value: formatDate(record.lastCheckedAt), inline: true },
            { name: 'AI Analizi', value: record.aiChecked ? `${record.aiRisk} (skor: ${record.aiScore})` : 'Yapılandırılmamış / çalıştırılmadı', inline: true }
          );
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (sub === 'gecmis') {
        await interaction.deferReply({ ephemeral: true });
        const history = await verificationService.getScanHistory(guildId, discordId, 10);
        if (history.length === 0) {
          await interaction.editReply({ content: 'Herhangi bir tarama geçmişiniz bulunmuyor.' });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('📜 Tarama Geçmişi')
          .setColor(0x5865f2)
          .setDescription(history.map((h) => `**${h.scanType}** — ${h.resultBefore || '—'} → ${h.resultAfter} (${formatDate(h.createdAt)})`).join('\n').slice(0, 4000));
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (sub === 'tara') {
        await interaction.deferReply({ ephemeral: true });
        const targetUser = interaction.options.getUser('kullanici');
        if (targetUser) {
          const record = await scanService.scanSingleUser(interaction.client, ctx.settings, interaction.guild, guildId, targetUser.id, null, discordId);
          await interaction.editReply({ content: `✅ <@${targetUser.id}> tarandı. Sonuç: ${statusLabelTr(record.status)}` });
        } else {
          const result = await scanService.scanGuild(interaction.client, ctx.settings, guildId, { scanType: 'admin' });
          await interaction.editReply({ content: `✅ Toplu tarama tamamlandı.\nTaranan: ${result.scanned}\nBaşarısız: ${result.failed}${result.anomaly && result.anomaly.anomaly ? `\n⚠️ ${result.anomaly.reason}` : ''}` });
        }
        return;
      }

      if (sub === 'istatistik') {
        await interaction.deferReply({ ephemeral: true });
        const analytics = await analyticsService.getVerificationAnalytics(guildId, ctx.settings);
        const embed = new EmbedBuilder()
          .setTitle('📊 YouTube Doğrulama İstatistikleri')
          .setColor(0x5865f2)
          .addFields(
            { name: 'Durum Dağılımı', value: Object.entries(analytics.byStatus).map(([k, v]) => `${statusLabelTr(k)}: ${v}`).join('\n') || 'Veri yok' },
            { name: 'Toplam Tarama', value: String(analytics.totalScans), inline: true },
            { name: 'YouTube API Kotası', value: `${analytics.youtubeQuota.used} kullanıldı / ~${analytics.youtubeQuota.remainingEstimate} kaldı`, inline: true }
          );
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (sub === 'sistem') {
        await interaction.deferReply({ ephemeral: true });
        const health = await healthService.getSystemHealth(interaction.client, ctx.settings);
        const safeState = safeModeService.getState(guildId);
        const quota = youtubeApiService.getQuotaStatus(ctx.settings.youtube && ctx.settings.youtube.quotaDailyLimit);
        const embed = new EmbedBuilder()
          .setTitle('⚙️ YouTube Doğrulama Sistem Durumu')
          .setColor(0x5865f2)
          .addFields(
            { name: 'YouTube API', value: ctx.settings.youtube && ctx.settings.youtube.apiKey ? '🟢 Yapılandırılmış' : '🟡 Yapılandırılmamış', inline: true },
            { name: 'YouTube Kotası', value: `${quota.used} / tahmini kalan ~${quota.remainingEstimate}`, inline: true },
            { name: 'Gemini AI', value: geminiService.isConfigured(ctx.settings) ? '🟢 Yapılandırılmış' : '🟡 Yapılandırılmamış', inline: true },
            { name: 'CAPTCHA', value: captchaService.getActiveProvider(ctx.settings).configured ? '🟢 Yapılandırılmış' : '🟡 Yapılandırılmamış', inline: true },
            { name: 'MongoDB', value: health.mongodb.label, inline: true },
            { name: 'Safe Mode', value: safeState.safeMode ? `🔴 Aktif (${safeState.reason})` : '🟢 Kapalı', inline: true }
          );
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (sub === 'otomatik-tarama-durdur') {
        await interaction.deferReply({ ephemeral: true });
        await policyService.updatePolicy(guildId, { autoScanEnabled: false }, discordId);
        await interaction.editReply({ content: '🛑 Otomatik tarama durduruldu.' });
        return;
      }

      if (sub === 'otomatik-tarama-baslat') {
        await interaction.deferReply({ ephemeral: true });
        await policyService.updatePolicy(guildId, { autoScanEnabled: true }, discordId);
        await interaction.editReply({ content: '✅ Otomatik tarama başlatıldı.' });
        return;
      }

      if (sub === 'guvenli-mod-kapat') {
        if (!isOwner(interaction.member, ctx.settings, interaction.guild) && !isManagerOrAbove(interaction.member, ctx.settings, interaction.guild)) {
          await interaction.reply({ content: '❌ Bu islemi gerceklestirmek icin yetkiniz bulunmuyor.', ephemeral: true });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        await safeModeService.exitSafeMode(guildId, discordId);
        await interaction.editReply({ content: '✅ Safe Mode kapatıldı, sistem normal çalışmaya döndü.' });
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
