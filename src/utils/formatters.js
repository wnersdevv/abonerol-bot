'use strict';

/**
 * Tum kullaniciya gorunen metinler Turkce olmalidir (proje kurali).
 * Bu modul, tarih/sure/para birimi gibi degerleri Turkce kullanici arayuzune
 * uygun sekilde formatlamak icin merkezi bir yerdir.
 */

function formatRemainingTime(expiresAt) {
  const now = Date.now();
  const target = new Date(expiresAt).getTime();
  const diffMs = target - now;

  if (diffMs <= 0) return 'Suresi doldu';

  const minutes = Math.floor(diffMs / (60 * 1000));
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (days >= 1) return `${days} gun kaldi`;
  if (hours >= 1) return `${hours} saat kaldi`;
  if (minutes >= 1) return `${minutes} dakika kaldi`;
  return 'Az kaldi';
}

function formatDate(date) {
  if (!date) return 'Belirtilmemis';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return 'Gecersiz tarih';
  const gun = String(d.getDate()).padStart(2, '0');
  const ay = String(d.getMonth() + 1).padStart(2, '0');
  const yil = d.getFullYear();
  const saat = String(d.getHours()).padStart(2, '0');
  const dakika = String(d.getMinutes()).padStart(2, '0');
  return `${gun}.${ay}.${yil} ${saat}:${dakika}`;
}

function formatCurrency(amount, currency) {
  if (typeof amount !== 'number') return `0 ${currency || ''}`.trim();
  return `${amount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}`.trim();
}

const STATUS_LABELS_TR = {
  pending: '🟡 Beklemede',
  active: '🟢 Aktif',
  trial: '🎁 Deneme',
  expired: '🔴 Suresi Dolmus',
  cancelled: '⚫ Iptal Edilmis',
  suspended: '🟠 Askiya Alinmis',
  paused: '⏸️ Duraklatilmis',
  failed: '❌ Basarisiz',
};

function statusLabelTr(status) {
  return STATUS_LABELS_TR[status] || `❔ ${status}`;
}

function unconfiguredLabel() {
  return '🟡 Yapilandirilmamis';
}

const DURATION_UNIT_LABELS_TR = {
  minute: 'dakika',
  hour: 'saat',
  day: 'gun',
  week: 'hafta',
  month: 'ay',
  year: 'yil',
};

function formatDuration(duration, unit) {
  const label = DURATION_UNIT_LABELS_TR[unit] || unit;
  return `${duration} ${label}`;
}

module.exports = {
  formatRemainingTime,
  formatDate,
  formatCurrency,
  statusLabelTr,
  unconfiguredLabel,
  formatDuration,
};
