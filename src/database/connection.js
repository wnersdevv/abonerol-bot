'use strict';

const mongoose = require('mongoose');
const { getLogger } = require('../utils/logger');

let connectionState = 'disconnected'; // disconnected | connecting | connected | error
let lastError = null;

/**
 * MongoDB'ye baglanir. Eksik/gecersiz URI durumunda botu crash ettirmez (madde 4),
 * bunun yerine connectionState = 'error' olarak isaretler ve health/config
 * sistemleri bunu "Yapilandirilmamis" olarak raporlayabilir.
 */
async function connectDatabase(settings) {
  const logger = getLogger();
  const uri = settings && settings.mongodb && settings.mongodb.uri;
  const dbName = (settings && settings.mongodb && settings.mongodb.dbName) || 'wnersdev_abone_rol';

  if (!uri) {
    connectionState = 'error';
    lastError = 'MongoDB uri ayarlar.json icinde tanimli degil.';
    logger.warn('MongoDB baglantisi kurulamadi: uri yapilandirilmamis. Sistem sinirli modda calisacak.');
    return { ok: false, reason: lastError };
  }

  connectionState = 'connecting';
  mongoose.set('strictQuery', true);

  mongoose.connection.on('connected', () => {
    connectionState = 'connected';
    lastError = null;
    logger.info('MongoDB baglantisi kuruldu.');
  });

  mongoose.connection.on('error', (err) => {
    connectionState = 'error';
    lastError = err.message;
    logger.error('MongoDB baglanti hatasi.', { message: err.message });
  });

  mongoose.connection.on('disconnected', () => {
    if (connectionState !== 'error') connectionState = 'disconnected';
    logger.warn('MongoDB baglantisi kesildi.');
  });

  try {
    await mongoose.connect(uri, {
      dbName,
      serverSelectionTimeoutMS: 8000,
      maxPoolSize: 20,
    });
    return { ok: true };
  } catch (err) {
    connectionState = 'error';
    lastError = err.message;
    logger.error('MongoDB ilk baglanti denemesi basarisiz oldu.', { message: err.message });
    return { ok: false, reason: err.message };
  }
}

function getConnectionState() {
  return { state: connectionState, lastError };
}

function isDatabaseReady() {
  return connectionState === 'connected' && mongoose.connection.readyState === 1;
}

async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
}

module.exports = { connectDatabase, disconnectDatabase, getConnectionState, isDatabaseReady };
