'use strict';

const fs = require('fs');
const path = require('path');
const { Guild, Plan, Subscriber, Subscription, Payment } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { ConfigurationError, ValidationError } = require('../utils/errors');
const { getLogger } = require('../utils/logger');
const auditService = require('./auditService');

const BACKUP_DIR = path.join(process.cwd(), 'backups');

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/**
 * Sunucuya ozel tam yedek olusturur (madde 21, 82). Hassas odeme saglayici
 * anahtarlari yedeklenmez - yalnizca uygulama verisi (plan/abone/subscription/payment).
 */
async function createGuildBackup(guildId, actorId) {
  if (!isDatabaseReady()) throw new ConfigurationError('MongoDB baglantisi hazir degil, yedek alinamiyor.');

  const [guildDoc, plans, subscribers, subscriptions, payments] = await Promise.all([
    Guild.findOne({ guildId }).lean(),
    Plan.find({ guildId }).lean(),
    Subscriber.find({ guildId }).lean(),
    Subscription.find({ guildId }).lean(),
    Payment.find({ guildId }).lean(),
  ]);

  const backup = {
    version: 1,
    createdAt: new Date().toISOString(),
    guildId,
    guild: guildDoc,
    plans,
    subscribers,
    subscriptions,
    payments,
  };

  ensureBackupDir();
  const fileName = `backup_${guildId}_${Date.now()}.json`;
  const filePath = path.join(BACKUP_DIR, fileName);
  fs.writeFileSync(filePath, JSON.stringify(backup, null, 2), 'utf-8');

  await auditService.record({
    guildId,
    actorId,
    actorType: 'user',
    action: 'backup.created',
    details: { fileName, plans: plans.length, subscribers: subscribers.length },
  });

  return { filePath, fileName, stats: { plans: plans.length, subscribers: subscribers.length, subscriptions: subscriptions.length, payments: payments.length } };
}

/**
 * Bir JSON yedegini geri yukler. Sadece ayni guildId'ye ait yedekler kabul edilir
 * (guild isolation - madde 25, 63). Var olan kayitlar upsert edilir, silinmez.
 */
async function restoreGuildBackup(guildId, backupJson, actorId) {
  if (!isDatabaseReady()) throw new ConfigurationError('MongoDB baglantisi hazir degil, geri yukleme yapilamiyor.');

  let backup;
  try {
    backup = typeof backupJson === 'string' ? JSON.parse(backupJson) : backupJson;
  } catch (err) {
    throw new ValidationError('Yedek dosyasi gecerli JSON degil.');
  }

  if (!backup.guildId || backup.guildId !== guildId) {
    throw new ValidationError('Yedek dosyasi bu sunucuya ait degil (guildId uyusmuyor).');
  }

  const stats = { plans: 0, subscribers: 0, subscriptions: 0, payments: 0 };

  for (const plan of backup.plans || []) {
    await Plan.findOneAndUpdate({ planId: plan.planId }, { $set: plan }, { upsert: true });
    stats.plans += 1;
  }
  for (const subscriber of backup.subscribers || []) {
    await Subscriber.findOneAndUpdate({ guildId, discordId: subscriber.discordId }, { $set: subscriber }, { upsert: true });
    stats.subscribers += 1;
  }
  for (const subscription of backup.subscriptions || []) {
    await Subscription.findOneAndUpdate({ subscriptionId: subscription.subscriptionId }, { $set: subscription }, { upsert: true });
    stats.subscriptions += 1;
  }
  for (const payment of backup.payments || []) {
    await Payment.findOneAndUpdate({ paymentId: payment.paymentId }, { $set: payment }, { upsert: true });
    stats.payments += 1;
  }
  if (backup.guild) {
    await Guild.findOneAndUpdate({ guildId }, { $set: backup.guild }, { upsert: true });
  }

  await auditService.record({
    guildId,
    actorId,
    actorType: 'user',
    action: 'backup.restored',
    details: stats,
  });

  return stats;
}

/**
 * Sunucu verisini disa aktarir - dis sistemlere entegrasyon veya manuel inceleme
 * icin sade bir JSON dokumu (madde 22: /abone dışa-aktar).
 */
async function exportGuildData(guildId) {
  return createGuildBackup(guildId, null);
}

async function importGuildData(guildId, jsonContent, actorId) {
  return restoreGuildBackup(guildId, jsonContent, actorId);
}

function listBackups() {
  ensureBackupDir();
  return fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.json'));
}

module.exports = { createGuildBackup, restoreGuildBackup, exportGuildData, importGuildData, listBackups };
