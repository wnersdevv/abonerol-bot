'use strict';

const { buildAdminPanel } = require('./adminPanel');
const planService = require('../../services/planService');
const subscriptionService = require('../../services/subscriptionService');
const healthService = require('../../services/healthService');
const analyticsService = require('../../services/analyticsService');
const auditService = require('../../services/auditService');
const backupService = require('../../services/backupService');
const { isManagerOrAbove } = require('../../utils/permissions');
const { formatCurrency, statusLabelTr, formatDate } = require('../../utils/formatters');
const { AppError } = require('../../utils/errors');
const { getLogger } = require('../../utils/logger');

/**
 * "admin" namespace'i altindaki panel etkilesimlerini yonetir (adminPanel.js
 * icindeki kategori Select Menu'su ile eslesir). Her kategori icin ilgili
 * servisten gercek veri cekilip panel govdesi yeniden olusturulur.
 */
async function buildCategoryBody(category, guildId, settings, discordClient) {
  switch (category) {
    case 'abonelikler': {
      const subscribers = await subscriptionService.listActiveSubscribers(guildId);
      const lines = subscribers.slice(0, 15).map((s) => `<@${s.discordId}> — ${statusLabelTr(s.status)} — ${formatDate(s.expiresAt)}`);
      return ['## 📋 Aktif Abonelikler', '', `Toplam aktif: ${subscribers.length}`, '', ...lines].join('\n');
    }
    case 'planlar': {
      const plans = await planService.listPlans(guildId);
      const lines = plans.map((p) => `**${p.name}** \`${p.planId}\` — ${p.active ? '🟢' : '🔴'} — ${formatCurrency(p.price, p.currency)}`);
      return ['## ⭐ Planlar', '', ...(lines.length ? lines : ['Henuz plan tanimlanmamis.'])].join('\n');
    }
    case 'roller': {
      const plans = await planService.listPlans(guildId, { onlyActive: true });
      const lines = plans.map((p) => `**${p.name}** → <@&${p.roleId}>`);
      return ['## 🔖 Plan Rolleri', '', ...(lines.length ? lines : ['Aktif plan bulunmuyor.'])].join('\n');
    }
    case 'odemeler': {
      const analytics = await analyticsService.getGuildAnalytics(guildId);
      const lines = analytics.recentPayments.map((p) => `${formatCurrency(p.amount, p.currency)} — ${formatDate(p.paidAt)}`);
      return ['## 💳 Son Odemeler', '', ...(lines.length ? lines : ['Kayitli odeme bulunmuyor.'])].join('\n');
    }
    case 'bildirimler':
      return ['## 🔔 Bildirimler', '', 'Hatirlatma esikleri ve bildirim kanali ayarlar.json / sunucu ayarlarindan yonetilir.'].join('\n');
    case 'istatistik': {
      const analytics = await analyticsService.getGuildAnalytics(guildId);
      const lines = Object.entries(analytics.subscribersByStatus).map(([k, v]) => `${statusLabelTr(k)}: ${v}`);
      return ['## 📊 Istatistik', '', ...lines].join('\n');
    }
    case 'loglar': {
      const logs = await auditService.listForGuild(guildId, { limit: 15 });
      const lines = logs.map((l) => `\`${formatDate(l.createdAt)}\` — ${l.action}${l.actorId ? ` — <@${l.actorId}>` : ''}`);
      return ['## 📜 Son Loglar', '', ...(lines.length ? lines : ['Kayit bulunmuyor.'])].join('\n');
    }
    case 'sistem': {
      const health = await healthService.getSystemHealth(discordClient, settings);
      return [
        '## ⚙️ Sistem Durumu', '',
        `Discord: ${health.discord.ready ? '🟢' : '🔴'} (Ping: ${health.discord.ping}ms)`,
        `MongoDB: ${health.mongodb.label}`,
        `Odeme: ${health.payment.label}`,
        `Basarisiz Isler: ${health.failedJobs}`,
      ].join('\n');
    }
    case 'guvenlik':
      return ['## 🛡️ Guvenlik', '', 'Rol hiyerarsisi, yetki katmanlari ve webhook imza dogrulamasi aktif.', 'Detaylar icin loglar sekmesine bakiniz.'].join('\n');
    case 'backup':
      return ['## 💾 Backup', '', '`/abone yedekle` ile tam yedek alabilir, `/abone disa-aktar` ile veriyi disa aktarabilirsiniz.'].join('\n');
    default:
      return '## ⚙️ WNERSDEV Yonetim Paneli\n\nBir kategori secin.';
  }
}

async function handle(interaction, ctx, action, params) {
  if (action !== 'kategori') {
    await interaction.reply({ content: '❌ Bilinmeyen islem.', ephemeral: true });
    return;
  }

  const [ownerId] = params;
  if (ownerId && ownerId !== interaction.user.id) {
    await interaction.reply({ content: '❌ Bu panel sizin icin olusturulmamis.', ephemeral: true });
    return;
  }

  if (!isManagerOrAbove(interaction.member, ctx.settings, interaction.guild)) {
    await interaction.reply({ content: '❌ Bu islemi gerceklestirmek icin yetkiniz bulunmuyor.', ephemeral: true });
    return;
  }

  try {
    await interaction.deferUpdate();
    const category = interaction.values[0];
    const bodyText = await buildCategoryBody(category, interaction.guildId, ctx.settings, interaction.client);
    const panel = buildAdminPanel({ guildId: interaction.guildId, actorId: interaction.user.id, activeCategory: category, bodyText });
    await interaction.editReply(panel);
  } catch (err) {
    getLogger().error('Admin panel kategori islemi basarisiz.', { message: err.message });
    const content = err instanceof AppError ? `🟡 ${err.message}` : '❌ İşlem sırasında beklenmeyen bir hata oluştu.';
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content, ephemeral: true });
    } else {
      await interaction.reply({ content, ephemeral: true });
    }
  }
}

module.exports = { handle };
