'use strict';

const { Subscriber, Notification, Guild } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { getLogger } = require('../utils/logger');
const { formatRemainingTime, formatDate } = require('../utils/formatters');

/**
 * Bildirim sistemi (madde 13). Configurable reminder esikleri (30/14/7/3/1 gun, 1 saat).
 * Ayni bildirim tekrar gonderilmez - Notification koleksiyonundaki unique index
 * (subscriberId + type + threshold) deduplication'i garanti eder.
 */

const THRESHOLD_TO_MS = {
  '30d': 30 * 24 * 60 * 60 * 1000,
  '14d': 14 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '1d': 1 * 24 * 60 * 60 * 1000,
  '1h': 60 * 60 * 1000,
};

function settingsToThresholdKeys(reminders) {
  const unitShort = { day: 'd', hour: 'h', minute: 'm' };
  return (reminders || []).map((r) => `${r.value}${unitShort[r.unit] || r.unit[0]}`);
}

async function sendDm(discordClient, discordId, content) {
  try {
    const user = await discordClient.users.fetch(discordId);
    await user.send({ content });
    return { delivered: true, error: null };
  } catch (err) {
    return { delivered: false, error: err.message };
  }
}

async function recordNotification({ discordId, guildId, subscriberId, type, threshold, delivered, deliveryError }) {
  if (!isDatabaseReady()) return null;
  try {
    return await Notification.create({
      discordId,
      guildId,
      subscriberId,
      type,
      threshold,
      channel: 'dm',
      delivered,
      deliveryError,
    });
  } catch (err) {
    // Unique index catismasi = zaten gonderilmis, sessizce gec (deduplication).
    if (err.code === 11000) return null;
    getLogger().error('Bildirim kaydi olusturulamadi.', { message: err.message });
    return null;
  }
}

async function alreadyNotified(subscriberId, type, threshold) {
  if (!isDatabaseReady()) return false;
  const existing = await Notification.findOne({ subscriberId, type, threshold });
  return !!existing;
}

/**
 * Suresi yaklasan tum abonelikleri tarar ve yapilandirilmis esiklere gore
 * bildirim gonderir (reminderChecker job'i tarafindan cagrilir).
 */
async function processReminders(discordClient, settings) {
  const logger = getLogger();
  if (!isDatabaseReady()) {
    logger.warn('processReminders atlandi: MongoDB hazir degil.');
    return { sent: 0 };
  }

  const reminders = settings.notification && settings.notification.reminders;
  if (!reminders || reminders.length === 0) return { sent: 0 };

  const activeSubscribers = await Subscriber.find({ status: { $in: ['active', 'trial'] }, expiresAt: { $ne: null } });
  let sent = 0;

  for (const subscriber of activeSubscribers) {
    const guildSettings = await Guild.findOne({ guildId: subscriber.guildId }).lean().catch(() => null);
    if (guildSettings && guildSettings.featureFlags && guildSettings.featureFlags.notifications === false) continue;

    const remainingMs = new Date(subscriber.expiresAt).getTime() - Date.now();
    if (remainingMs <= 0) continue;

    for (const reminder of reminders) {
      const unitShort = { day: 'd', hour: 'h', minute: 'm' }[reminder.unit] || reminder.unit[0];
      const thresholdKey = `${reminder.value}${unitShort}`;
      const thresholdMs = THRESHOLD_TO_MS[thresholdKey];
      if (thresholdMs === undefined) continue;

      // Esik penceresi: bu kontrol araligi (varsayilan 5 dk) icinde esigin altina yeni dusmus mu?
      const windowMs = (settings.scheduler && settings.scheduler.reminderCheckIntervalMs) || 300000;
      const isWithinWindow = remainingMs <= thresholdMs && remainingMs > thresholdMs - windowMs;
      if (!isWithinWindow) continue;

      const already = await alreadyNotified(subscriber._id, 'expiration_reminder', thresholdKey);
      if (already) continue;

      const message = `⏳ Aboneliginizin suresi yaklasiyor.\n\nKalan sure: ${formatRemainingTime(subscriber.expiresAt)}\nBitis tarihi: ${formatDate(subscriber.expiresAt)}\n\nKesintisiz devam etmesi icin \`/abonelik yenile\` komutunu kullanabilirsiniz.`;
      const result = await sendDm(discordClient, subscriber.discordId, message);
      await recordNotification({
        discordId: subscriber.discordId,
        guildId: subscriber.guildId,
        subscriberId: subscriber._id,
        type: 'expiration_reminder',
        threshold: thresholdKey,
        delivered: result.delivered,
        deliveryError: result.error,
      });
      if (result.delivered) sent += 1;
    }
  }

  return { sent };
}

async function notifyExpired(discordClient, subscriber) {
  const message = `🔴 Aboneliginizin suresi doldu.\n\nPlan: ${subscriber.planId}\nTekrar abone olmak icin \`/abonelik planlar\` komutunu kullanabilirsiniz.`;
  const result = await sendDm(discordClient, subscriber.discordId, message);
  await recordNotification({
    discordId: subscriber.discordId,
    guildId: subscriber.guildId,
    subscriberId: subscriber._id,
    type: 'expired',
    threshold: null,
    delivered: result.delivered,
    deliveryError: result.error,
  });
  return result;
}

async function notifyRenewalSuccess(discordClient, subscriber) {
  const message = `🟢 Aboneliginiz basariyla yenilendi.\n\nYeni bitis tarihi: ${formatDate(subscriber.expiresAt)}`;
  return sendDm(discordClient, subscriber.discordId, message);
}

module.exports = { processReminders, notifyExpired, notifyRenewalSuccess, sendDm };
