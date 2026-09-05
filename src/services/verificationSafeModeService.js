'use strict';

const { getLogger } = require('../utils/logger');
const auditService = require('./auditService');

/**
 * Safe Mode + Kill Switch sistemi (doc-2 madde 31-32, 61-63).
 * Bellek-ici tutulur (process bazli); guild bazinda ayri ayri yonetilir.
 * Amac: API/anomali sorunlarinda TOPLU rol kaldirmayi durdurmak, mevcut
 * rolleri korumak. Kalici olmasi gerekmiyor - process yeniden basladiginda
 * varsayilan (hepsi acik) duruma doner ve ilk saglik kontrolu yeniden degerlendirir.
 */
const guildState = new Map(); // guildId -> { safeMode, killSwitches, reason, since }

function defaultState() {
  return {
    safeMode: false,
    killSwitches: { ROLE_ASSIGNMENT: false, ROLE_REMOVAL: false, AUTO_SCAN: false, AI_ANALYSIS: false },
    reason: null,
    since: null,
  };
}

function getState(guildId) {
  if (!guildState.has(guildId)) guildState.set(guildId, defaultState());
  return guildState.get(guildId);
}

async function enterSafeMode(guildId, reason, actorType = 'system') {
  const state = getState(guildId);
  state.safeMode = true;
  state.reason = reason;
  state.since = new Date();
  state.killSwitches.ROLE_REMOVAL = true;
  getLogger().error(`SAFE MODE aktiflestirildi: ${guildId} - ${reason}`);

  await auditService.record({
    guildId,
    actorType,
    action: 'verification.safe_mode_entered',
    details: { reason },
    success: false,
    errorMessage: reason,
  });

  return state;
}

async function exitSafeMode(guildId, actorId) {
  const state = getState(guildId);
  state.safeMode = false;
  state.reason = null;
  state.since = null;
  state.killSwitches = defaultState().killSwitches;

  await auditService.record({
    guildId,
    actorId,
    actorType: 'user',
    action: 'verification.safe_mode_exited',
  });

  return state;
}

async function setKillSwitch(guildId, switchName, value, actorId) {
  const state = getState(guildId);
  if (!(switchName in state.killSwitches)) {
    throw new Error(`Bilinmeyen kill switch: ${switchName}`);
  }
  state.killSwitches[switchName] = value;

  await auditService.record({
    guildId,
    actorId,
    actorType: 'user',
    action: `verification.kill_switch.${switchName}.${value ? 'on' : 'off'}`,
  });

  return state;
}

function isOperationAllowed(guildId, operation) {
  const state = getState(guildId);
  if (state.safeMode && operation === 'ROLE_REMOVAL') return false;
  return !state.killSwitches[operation];
}

module.exports = { getState, enterSafeMode, exitSafeMode, setKillSwitch, isOperationAllowed };
