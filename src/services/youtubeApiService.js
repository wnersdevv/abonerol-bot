'use strict';

const { ConfigurationError, ValidationError, TransientError } = require('../utils/errors');
const { getCache } = require('../core/cache');
const { getLogger } = require('../utils/logger');
const crypto = require('crypto');

/**
 * Gercek YouTube Data API v3 entegrasyonu (doc-1 madde 3-4, doc-2 madde 53-54, 69-70).
 * API key yoksa "Yapilandirilmamis" doner, ASLA sahte veri uretmez.
 *
 * - URL normalizasyonu (channel/@handle/c/user formatlari)
 * - Guvenlik: yalnizca youtube.com/youtu.be domainlerine izin verir, HTTPS zorunlu
 * - Request coalescing: ayni channelId icin ayni anda gelen istekler tek API cagrisini paylasir
 * - Basit quota sayaci (gunluk, process-local; kalici izleme icin genisletilebilir)
 */

const inFlightRequests = new Map(); // channelId/handle -> Promise
const quotaState = { used: 0, resetAt: startOfNextDayUtc(), failedCalls: 0, lastCallAt: null };

function startOfNextDayUtc() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next;
}

function resetQuotaIfNeeded() {
  if (Date.now() >= quotaState.resetAt.getTime()) {
    quotaState.used = 0;
    quotaState.failedCalls = 0;
    quotaState.resetAt = startOfNextDayUtc();
  }
}

function getQuotaStatus(dailyLimit) {
  resetQuotaIfNeeded();
  return {
    used: quotaState.used,
    remainingEstimate: Math.max(0, (dailyLimit || 10000) - quotaState.used),
    resetAt: quotaState.resetAt,
    failedCalls: quotaState.failedCalls,
    lastCallAt: quotaState.lastCallAt,
  };
}

/**
 * Kullanicinin verdigi URL/handle/ID'yi guvenli sekilde parse eder (doc-2 madde 53-54).
 * Yalnizca gecerli YouTube domainlerine izin verir; sifir HTTP istegi burada yapilmaz.
 */
function parseChannelInput(rawInput) {
  const input = (rawInput || '').trim();
  if (!input) throw new ValidationError('Kanal bilgisi bos olamaz.');

  // Dogrudan Channel ID formati: UCxxxxxxxxxxxxxxxxxxxxxx
  if (/^UC[a-zA-Z0-9_-]{22}$/.test(input)) {
    return { type: 'id', value: input };
  }

  // Dogrudan handle formati: @kullaniciadi
  if (/^@[a-zA-Z0-9_.-]{3,30}$/.test(input)) {
    return { type: 'handle', value: input };
  }

  let url;
  try {
    url = new URL(input.startsWith('http') ? input : `https://${input}`);
  } catch (err) {
    throw new ValidationError('Gecersiz kanal bilgisi. Gecerli bir YouTube URL, handle (@ad) veya Channel ID girin.');
  }

  const allowedHosts = ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'];
  if (!allowedHosts.includes(url.hostname)) {
    throw new ValidationError('Yalnizca YouTube baglantilari kabul edilir (guvenlik nedeniyle harici URL islenmez).');
  }
  if (url.protocol !== 'https:') {
    throw new ValidationError('Kanal baglantisi HTTPS olmalidir.');
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length === 0) throw new ValidationError('URL icinde kanal bilgisi bulunamadi.');

  if (parts[0] === 'channel' && parts[1]) return { type: 'id', value: parts[1] };
  if (parts[0].startsWith('@')) return { type: 'handle', value: parts[0] };
  if (parts[0] === 'c' && parts[1]) return { type: 'customUrl', value: parts[1] };
  if (parts[0] === 'user' && parts[1]) return { type: 'legacyUsername', value: parts[1] };

  throw new ValidationError('Desteklenmeyen YouTube URL formati.');
}

async function callYoutubeApi(endpoint, params, settings) {
  const apiKey = settings.youtube && settings.youtube.apiKey;
  if (!apiKey) {
    throw new ConfigurationError('YouTube API anahtari yapilandirilmamis. Dogrulama yapilamiyor.');
  }

  resetQuotaIfNeeded();
  const timeoutMs = (settings.youtube && settings.youtube.requestTimeoutMs) || 10000;

  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  url.searchParams.set('key', apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    quotaState.lastCallAt = new Date();
    const response = await fetch(url.toString(), { signal: controller.signal });
    quotaState.used += 1;

    if (response.status === 429) {
      quotaState.failedCalls += 1;
      throw new TransientError('YouTube API hiz limiti asildi (429).', { endpoint });
    }
    if (response.status >= 500) {
      quotaState.failedCalls += 1;
      throw new TransientError(`YouTube API gecici olarak kullanilamiyor (${response.status}).`, { endpoint });
    }
    if (!response.ok) {
      quotaState.failedCalls += 1;
      const body = await response.text();
      throw new ValidationError(`YouTube API hatasi: ${response.status} ${body}`.slice(0, 300));
    }

    return await response.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      quotaState.failedCalls += 1;
      throw new TransientError('YouTube API istegi zaman asimina ugradi.', { endpoint });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Gercek kanal verisini ceker. Request coalescing ile ayni anahtar icin
 * es zamanli tekrarli cagrilari tekillestirir (doc-2 madde 69).
 */
async function fetchChannelData(parsedInput, settings) {
  const logger = getLogger();
  const coalesceKey = `${parsedInput.type}:${parsedInput.value}`;

  if (inFlightRequests.has(coalesceKey)) {
    return inFlightRequests.get(coalesceKey);
  }

  const cacheKey = `yt-channel:${coalesceKey}`;
  const cached = getCache().get(cacheKey);
  if (cached) return { ...cached, source: 'cache' };

  const promise = (async () => {
    const params = { part: 'snippet,statistics,status' };
    if (parsedInput.type === 'id') params.id = parsedInput.value;
    else if (parsedInput.type === 'handle') params.forHandle = parsedInput.value.replace(/^@/, '');
    else if (parsedInput.type === 'legacyUsername') params.forUsername = parsedInput.value;
    else if (parsedInput.type === 'customUrl') params.forHandle = parsedInput.value;

    const data = await callYoutubeApi('channels', params, settings);

    if (!data.items || data.items.length === 0) {
      throw new ValidationError('Belirtilen YouTube kanali bulunamadi. Fake/gecersiz kanal kabul edilmez.');
    }

    const channel = data.items[0];
    const result = {
      channelId: channel.id,
      channelName: channel.snippet && channel.snippet.title,
      channelHandle: channel.snippet && channel.snippet.customUrl,
      channelUrl: `https://www.youtube.com/channel/${channel.id}`,
      subscriberCount: channel.statistics && !channel.statistics.hiddenSubscriberCount ? Number(channel.statistics.subscriberCount) : null,
      videoCount: channel.statistics ? Number(channel.statistics.videoCount) : null,
      viewCount: channel.statistics ? Number(channel.statistics.viewCount) : null,
      channelCreatedAt: channel.snippet && channel.snippet.publishedAt ? new Date(channel.snippet.publishedAt) : null,
      channelVisibility: channel.status && channel.status.privacyStatus,
      hiddenSubscriberCount: !!(channel.statistics && channel.statistics.hiddenSubscriberCount),
      source: 'api',
      fetchedAt: new Date(),
    };

    getCache().set(cacheKey, result, 300000); // 5 dakika cache
    return result;
  })();

  inFlightRequests.set(coalesceKey, promise);
  try {
    return await promise;
  } finally {
    inFlightRequests.delete(coalesceKey);
  }
}

/**
 * Kanal verisinin degisip degismedigini tespit etmek icin deterministik hash
 * uretir (doc-2 madde 27 - Smart Scan: veri degismediyse gereksiz AI cagrisi yapma).
 */
function hashChannelData(channelData) {
  const relevant = {
    subscriberCount: channelData.subscriberCount,
    videoCount: channelData.videoCount,
    viewCount: channelData.viewCount,
    channelVisibility: channelData.channelVisibility,
  };
  return crypto.createHash('sha256').update(JSON.stringify(relevant)).digest('hex');
}

module.exports = { parseChannelInput, fetchChannelData, getQuotaStatus, hashChannelData };
