'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const planService = require('../../services/planService');
const { isManagerOrAbove } = require('../../utils/permissions');
const { formatCurrency, formatDuration } = require('../../utils/formatters');
const { AppError } = require('../../utils/errors');

/**
 * Yonetici plan yonetimi komutlari (madde 6, 22). Sadece Manager+ kullanabilir.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('plan')
    .setDescription('Abonelik planlarini yonetin (yonetici)')
    .addSubcommand((sub) => sub.setName('listele').setDescription('Tum planlari listele'))
    .addSubcommand((sub) => sub
      .setName('olustur')
      .setDescription('Yeni plan olustur')
      .addStringOption((o) => o.setName('ad').setDescription('Plan adi').setRequired(true))
      .addRoleOption((o) => o.setName('rol').setDescription('Verilecek rol').setRequired(true))
      .addNumberOption((o) => o.setName('fiyat').setDescription('Fiyat').setRequired(true))
      .addStringOption((o) => o.setName('para-birimi').setDescription('Para birimi (orn. TRY)').setRequired(true))
      .addIntegerOption((o) => o.setName('sure').setDescription('Sure miktari').setRequired(true))
      .addStringOption((o) => o
        .setName('sure-birimi')
        .setDescription('Sure birimi')
        .setRequired(true)
        .addChoices(
          { name: 'dakika', value: 'minute' },
          { name: 'saat', value: 'hour' },
          { name: 'gun', value: 'day' },
          { name: 'hafta', value: 'week' },
          { name: 'ay', value: 'month' },
          { name: 'yil', value: 'year' }
        )))
    .addSubcommand((sub) => sub
      .setName('sil')
      .setDescription('Plani sil')
      .addStringOption((o) => o.setName('plan-id').setDescription('Plan ID').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('aktif')
      .setDescription('Plani aktif/pasif yap')
      .addStringOption((o) => o.setName('plan-id').setDescription('Plan ID').setRequired(true))
      .addBooleanOption((o) => o.setName('durum').setDescription('Aktif mi?').setRequired(true))),

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

    try {
      if (sub === 'listele') {
        await interaction.deferReply({ ephemeral: true });
        const plans = await planService.listPlans(guildId);
        if (plans.length === 0) {
          await interaction.editReply({ content: 'Bu sunucuda henuz plan tanimlanmamis.' });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('⭐ Planlar')
          .setColor(0x5865f2)
          .setDescription(
            plans.map((p) => `**${p.name}** \`${p.planId}\`\n${p.active ? '🟢 Aktif' : '🔴 Pasif'} — ${formatCurrency(p.price, p.currency)} / ${formatDuration(p.duration, p.durationUnit)}`).join('\n\n').slice(0, 4000)
          );
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (sub === 'olustur') {
        await interaction.deferReply({ ephemeral: true });
        const plan = await planService.createPlan(guildId, {
          name: interaction.options.getString('ad'),
          roleId: interaction.options.getRole('rol').id,
          price: interaction.options.getNumber('fiyat'),
          currency: interaction.options.getString('para-birimi'),
          duration: interaction.options.getInteger('sure'),
          durationUnit: interaction.options.getString('sure-birimi'),
        }, interaction.user.id);
        await interaction.editReply({ content: `✅ Plan olusturuldu: **${plan.name}** (\`${plan.planId}\`)` });
        return;
      }

      if (sub === 'sil') {
        await interaction.deferReply({ ephemeral: true });
        const plan = await planService.deletePlan(guildId, interaction.options.getString('plan-id'), interaction.user.id);
        await interaction.editReply({ content: `🗑️ Plan silindi: **${plan.name}**` });
        return;
      }

      if (sub === 'aktif') {
        await interaction.deferReply({ ephemeral: true });
        const plan = await planService.setPlanActive(guildId, interaction.options.getString('plan-id'), interaction.options.getBoolean('durum'), interaction.user.id);
        await interaction.editReply({ content: `✅ Plan durumu guncellendi: **${plan.name}** → ${plan.active ? 'Aktif' : 'Pasif'}` });
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
