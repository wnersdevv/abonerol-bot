'use strict';

const { getLogger } = require('../utils/logger');

/**
 * Baslangicta (madde 72) tum kritik yapilandirma alanlarini kontrol eder.
 * Eksik alanlari "Yapilandirilmamis" olarak raporlar ama process'i crash ETTIRMEZ
 * (madde 4) - sadece ilgili ozellikler devre disi kalir.
 */
function validateConfig(settings) {
  const logger = getLogger();
  const report = {
    discord: { ok: false, issues: [] },
    mongodb: { ok: false, issues: [] },
    subscription: { ok: true, issues: [] },
    roles: { ok: true, issues: [] },
    payment: { ok: false, issues: [] },
    scheduler: { ok: true, issues: [] },
    queue: { ok: true, issues: [] },
  };

  if (!settings || typeof settings !== 'object') {
    logger.error('ayarlar.json okunamadi veya gecersiz.');
    return { overallOk: false, report };
  }

  // Discord
  if (!settings.discord || !settings.discord.token) {
    report.discord.issues.push('discord.token tanimli degil.');
  } else {
    report.discord.ok = true;
  }
  if (!settings.discord || !settings.discord.clientId) {
    report.discord.issues.push('discord.clientId tanimli degil.');
    report.discord.ok = false;
  }
  if (!settings.discord || !Array.isArray(settings.discord.ownerIds) || settings.discord.ownerIds.length === 0) {
    report.discord.issues.push('discord.ownerIds bos - en az bir owner tanimlanmasi onerilir.');
  }

  // MongoDB
  if (!settings.mongodb || !settings.mongodb.uri) {
    report.mongodb.issues.push('mongodb.uri tanimli degil. Veritabani ozellikleri "Yapilandirilmamis" olarak calisacak.');
  } else {
    report.mongodb.ok = true;
  }

  // Payment
  const paymentProvider = settings.payment && settings.payment.provider;
  if (!paymentProvider || paymentProvider === 'none') {
    report.payment.issues.push('Odeme saglayicisi yapilandirilmamis. Odeme mimarisi hazir ancak gercek odeme alinamayacak.');
  } else {
    const providerCfg = settings.payment.providers && settings.payment.providers[paymentProvider];
    if (!providerCfg || !providerCfg.enabled) {
      report.payment.issues.push(`Secilen odeme saglayicisi (${paymentProvider}) "enabled: true" olarak isaretlenmemis.`);
    } else {
      report.payment.ok = true;
    }
  }

  // Scheduler / Queue sanity
  if (!settings.scheduler) report.scheduler.issues.push('scheduler ayarlari eksik, varsayilanlar kullanilacak.');
  if (!settings.queue) report.queue.issues.push('queue ayarlari eksik, varsayilanlar kullanilacak.');

  const overallOk = report.discord.ok; // Bot en azindan Discord'a baglanabilmeli

  for (const [section, result] of Object.entries(report)) {
    if (result.issues.length > 0) {
      logger.warn(`Yapilandirma kontrolu - ${section}: ${result.issues.join(' | ')}`);
    }
  }

  return { overallOk, report };
}

module.exports = { validateConfig };
