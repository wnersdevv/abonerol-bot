'use strict';

const { getQueue } = require('../core/queue');
const { getCache } = require('../core/cache');
const { canBotManageRole } = require('../utils/permissions');
const { RoleAssignmentError, TransientError } = require('../utils/errors');
const { FailedJob } = require('../database/models');
const { isDatabaseReady } = require('../database/connection');
const { getLogger } = require('../utils/logger');
const auditService = require('./auditService');

/**
 * Abone rol atama/kaldirma islemlerini yonetir (madde 7).
 * Kontroller:
 *  - rol mevcut mu?
 *  - botun rolu yeterince yukarida mi?
 *  - Manage Roles yetkisi var mi?
 *  - rol silinmis mi?
 *  - kullanici sunucuda mi?
 * Basarisiz olursa: aboneligi kaybetmez, retry queue'ya alir, yoneticiyi
 * bilgilendirir (audit log + FailedJob), fake basari donmez.
 */

async function persistFailedJob(jobType, guildId, payload, err, attempts) {
  if (!isDatabaseReady()) return;
  try {
    await FailedJob.create({
      jobType,
      guildId,
      payload,
      attempts,
      lastError: err.message,
      status: 'exhausted',
      nextRetryAt: null,
    });
  } catch (persistErr) {
    getLogger().error('FailedJob kaydi olusturulamadi.', { message: persistErr.message });
  }
}

function preflightCheck(guild, discordId, roleId) {
  const role = guild.roles.cache.get(roleId);
  if (!role) {
    return { ok: false, reason: 'Rol sunucuda bulunamadi (silinmis olabilir).', role: null, member: null };
  }

  const botCheck = canBotManageRole(guild, role);
  if (!botCheck.ok) {
    return { ok: false, reason: botCheck.reason, role, member: null };
  }

  const member = guild.members.cache.get(discordId);
  if (!member) {
    return { ok: false, reason: 'Kullanici sunucuda bulunamadi.', role, member: null };
  }

  return { ok: true, reason: null, role, member };
}

async function assignRole(guild, discordId, roleId, { guildId, actorId = null, actorType = 'system' } = {}) {
  const logger = getLogger();
  const effectiveGuildId = guildId || guild.id;

  const cacheKeyMember = `member:${effectiveGuildId}:${discordId}`;
  let member = getCache().get(cacheKeyMember);
  if (!member) {
    try {
      member = await guild.members.fetch(discordId);
      getCache().set(cacheKeyMember, member, 30000);
    } catch (err) {
      member = null;
    }
  }

  const check = preflightCheck(guild, discordId, roleId);
  if (!check.ok) {
    await auditService.record({
      guildId: effectiveGuildId,
      actorId,
      actorType,
      action: 'role.assign.preflight_failed',
      targetType: 'Subscriber',
      targetId: discordId,
      details: { roleId, reason: check.reason },
      success: false,
      errorMessage: check.reason,
    });
    throw new RoleAssignmentError(check.reason, { discordId, roleId });
  }

  const task = () => getQueue().push(
    async () => {
      if (check.member.roles.cache.has(roleId)) return { alreadyAssigned: true };
      await check.member.roles.add(roleId, 'WNERSDEV Abone Rol Sistemi - abonelik aktivasyonu');
      return { alreadyAssigned: false };
    },
    {
      name: `rol-ata:${effectiveGuildId}:${discordId}:${roleId}`,
      onExhausted: async (err, attempts) => {
        await persistFailedJob('role_assign', effectiveGuildId, { discordId, roleId }, err, attempts);
        await auditService.record({
          guildId: effectiveGuildId,
          actorId,
          actorType,
          action: 'role.assign.failed',
          targetType: 'Subscriber',
          targetId: discordId,
          details: { roleId, attempts },
          success: false,
          errorMessage: err.message,
        });
      },
    }
  );

  try {
    const result = await task();
    await auditService.record({
      guildId: effectiveGuildId,
      actorId,
      actorType,
      action: 'role.assign.success',
      targetType: 'Subscriber',
      targetId: discordId,
      details: { roleId, alreadyAssigned: result.alreadyAssigned },
    });
    return result;
  } catch (err) {
    logger.error('Rol atama nihai olarak basarisiz.', { discordId, roleId, message: err.message });
    throw new TransientError('Rol atanamadi, islem yeniden deneme kuyruguna alindi ve yonetici bilgilendirildi.', {
      discordId,
      roleId,
      cause: err.message,
    });
  }
}

async function removeRole(guild, discordId, roleId, { guildId, actorId = null, actorType = 'system', reason = 'Abonelik sona erdi' } = {}) {
  const effectiveGuildId = guildId || guild.id;
  const role = guild.roles.cache.get(roleId);

  if (!role) {
    await auditService.record({
      guildId: effectiveGuildId,
      actorId,
      actorType,
      action: 'role.remove.role_missing',
      targetType: 'Subscriber',
      targetId: discordId,
      details: { roleId },
      success: false,
      errorMessage: 'Rol sunucuda bulunamadi, kaldirma islemine gerek yok.',
    });
    return { skipped: true, reason: 'role_missing' };
  }

  let member;
  try {
    member = await guild.members.fetch(discordId);
  } catch (err) {
    await auditService.record({
      guildId: effectiveGuildId,
      actorId,
      actorType,
      action: 'role.remove.member_missing',
      targetType: 'Subscriber',
      targetId: discordId,
      details: { roleId },
      success: false,
      errorMessage: 'Kullanici sunucuda bulunamadi.',
    });
    return { skipped: true, reason: 'member_missing' };
  }

  const botCheck = canBotManageRole(guild, role);
  if (!botCheck.ok) {
    await auditService.record({
      guildId: effectiveGuildId,
      actorId,
      actorType,
      action: 'role.remove.preflight_failed',
      targetType: 'Subscriber',
      targetId: discordId,
      details: { roleId, reason: botCheck.reason },
      success: false,
      errorMessage: botCheck.reason,
    });
    throw new RoleAssignmentError(botCheck.reason, { discordId, roleId });
  }

  const task = () => getQueue().push(
    async () => {
      if (!member.roles.cache.has(roleId)) return { alreadyRemoved: true };
      await member.roles.remove(roleId, reason);
      return { alreadyRemoved: false };
    },
    {
      name: `rol-kaldir:${effectiveGuildId}:${discordId}:${roleId}`,
      onExhausted: async (err, attempts) => {
        await persistFailedJob('role_remove', effectiveGuildId, { discordId, roleId }, err, attempts);
        await auditService.record({
          guildId: effectiveGuildId,
          actorId,
          actorType,
          action: 'role.remove.failed',
          targetType: 'Subscriber',
          targetId: discordId,
          details: { roleId, attempts },
          success: false,
          errorMessage: err.message,
        });
      },
    }
  );

  try {
    const result = await task();
    await auditService.record({
      guildId: effectiveGuildId,
      actorId,
      actorType,
      action: 'role.remove.success',
      targetType: 'Subscriber',
      targetId: discordId,
      details: { roleId, alreadyRemoved: result.alreadyRemoved },
    });
    return result;
  } catch (err) {
    throw new TransientError('Rol kaldirilamadi, islem yeniden deneme kuyruguna alindi ve yonetici bilgilendirildi.', {
      discordId,
      roleId,
      cause: err.message,
    });
  }
}

module.exports = { assignRole, removeRole, preflightCheck };
