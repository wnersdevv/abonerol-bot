'use strict';

const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const { initLogger, getLogger } = require('./src/utils/logger');
const { validateConfig } = require('./src/core/configValidator');
const { connectDatabase, disconnectDatabase } = require('./src/database/connection');
const { ensureIndexes } = require('./src/database/indexes');
const { initCache } = require('./src/core/cache');
const { initQueue } = require('./src/core/queue');
const { initScheduler, getScheduler } = require('./src/core/scheduler');
const { initComponentRouter, getComponentRouter } = require('./src/core/componentRouter');
const { loadCommandFiles, registerSlashCommands } = require('./src/core/commandLoader');
const { startWebhookServer } = require('./src/core/webhookServer');

const interactionCreateEvent = require('./src/events/interactionCreate');
const readyEvent = require('./src/events/ready');
const guildCreateEvent = require('./src/events/guildCreate');
const guildDeleteEvent = require('./src/events/guildDelete');
const messageCreateEvent = require('./src/events/messageCreate');

const subscriptionRouteHandler = require('./src/components/subscription/subscriptionRouteHandler');
const plansRouteHandler = require('./src/components/plans/plansRouteHandler');
const adminRouteHandler = require('./src/components/admin/adminRouteHandler');
const photoRouteHandler = require('./src/components/photo/photoRouteHandler');

const expirationCheckerJob = require('./src/jobs/expirationChecker');
const reminderCheckerJob = require('./src/jobs/reminderChecker');
const roleSynchronizerJob = require('./src/jobs/roleSynchronizer');
const paymentReconciliationJob = require('./src/jobs/paymentReconciliation');
const cleanupJob = require('./src/jobs/cleanup');
const healthCheckJob = require('./src/jobs/healthCheck');
const youtubeAutomaticScannerJob = require('./src/jobs/youtubeAutomaticScanner');
const verificationExpirationCheckerJob = require('./src/jobs/verificationExpirationChecker');
const verificationRecoveryJob = require('./src/jobs/verificationRecovery');

/**
 * WNERSDEV ULTIMATE ABONE ROL SYSTEM - ana giris dosyasi.
 * Sirasiyla: ayarlar.json yukle -> logger -> config validasyonu -> MongoDB baglantisi
 * (basarisiz olsa da process crash etmez) -> cache/queue/scheduler/componentRouter
 * -> komutlari yukle -> Discord client olustur -> event/component handler'lari bagla
 * -> slash komutlarini kaydet -> zamanlanmis gorevleri baslat -> webhook sunucusu
 * (yapilandirilmissa) -> giris yap.
 */
async function bootstrap() {
  const settingsPath = path.join(__dirname, 'ayarlar.json');
  if (!fs.existsSync(settingsPath)) {
    // eslint-disable-next-line no-console
    console.error('ayarlar.json bulunamadi. Lutfen proje kok dizininde ayarlar.json dosyasini olusturun.');
    process.exit(1);
  }

  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

  const logger = initLogger(settings);
  logger.info('WNERSDEV ULTIMATE ABONE ROL SYSTEM baslatiliyor...');

  const { report } = validateConfig(settings);
  if (!report.discord.ok) {
    logger.error('Discord yapilandirmasi eksik (token/clientId). Bot baslatilamiyor.');
    process.exit(1);
  }

  initCache(settings);
  initQueue(settings);
  const scheduler = initScheduler();
  const componentRouter = initComponentRouter();

  componentRouter.register('abonelik', subscriptionRouteHandler.handle);
  componentRouter.register('plan', plansRouteHandler.handle);
  componentRouter.register('admin', adminRouteHandler.handle);
  componentRouter.register('foto', photoRouteHandler.handle);

  const dbResult = await connectDatabase(settings);
  if (dbResult.ok) {
    await ensureIndexes();
  } else {
    logger.warn(`MongoDB baglantisi kurulamadi (${dbResult.reason}). Bot sinirli modda calisacak; veritabani gerektiren komutlar "Yapilandirilmamis" mesaji dondurecek.`);
  }

  const commandsDir = path.join(__dirname, 'src', 'commands');
  const commands = loadCommandFiles(commandsDir);
  logger.info(`${commands.size} komut yuklendi.`);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
    ],
    partials: [Partials.GuildMember, Partials.User],
  });

  const ctx = { settings, client };

  readyEvent.register(client);
  guildCreateEvent.register(client);
  guildDeleteEvent.register(client);
  interactionCreateEvent.register(client, { commands, componentRouter, ctx });
  messageCreateEvent.register(client, ctx);

  await registerSlashCommands(settings, commands);

  // --- Zamanlanmis gorevler ---
  const schedulerCfg = settings.scheduler || {};
  scheduler.register('expirationChecker', schedulerCfg.expirationCheckIntervalMs, () => expirationCheckerJob.run(client));
  scheduler.register('reminderChecker', schedulerCfg.reminderCheckIntervalMs, () => reminderCheckerJob.run(client, settings));
  scheduler.register('roleSynchronizer', schedulerCfg.roleSyncIntervalMs, () => roleSynchronizerJob.run(client));
  scheduler.register('paymentReconciliation', schedulerCfg.paymentReconciliationIntervalMs, () => paymentReconciliationJob.run(settings));
  scheduler.register('cleanup', schedulerCfg.cleanupIntervalMs, () => cleanupJob.run(settings));
  scheduler.register('healthCheck', schedulerCfg.healthCheckIntervalMs, () => healthCheckJob.run(client, settings));
  scheduler.register('youtubeAutomaticScanner', schedulerCfg.reminderCheckIntervalMs || 300000, () => youtubeAutomaticScannerJob.run(client, settings));
  scheduler.register('verificationExpirationChecker', schedulerCfg.expirationCheckIntervalMs, () => verificationExpirationCheckerJob.run(client));
  scheduler.register('verificationRecovery', schedulerCfg.healthCheckIntervalMs || 60000, () => verificationRecoveryJob.run(client, settings));

  const webhookServer = startWebhookServer(settings);

  await client.login(settings.discord.token);

  // --- Duzenli kapatma (madde 78, 86) ---
  const shutdown = async (signal) => {
    logger.info(`${signal} alindi, sistem kapatiliyor...`);
    scheduler.stopAll();
    if (webhookServer) webhookServer.close();
    client.destroy();
    await disconnectDatabase();
    logger.info('Sistem duzgun sekilde kapatildi.');
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (err) => {
    logger.error('Yakalanmamis Promise reddi.', { message: err && err.message });
  });
  process.on('uncaughtException', (err) => {
    logger.error('Yakalanmamis istisna.', { message: err && err.message });
  });

  return { client, settings };
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Sistem baslatilirken kritik hata olustu:', err);
  process.exit(1);
});
