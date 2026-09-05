'use strict';

const { PermissionFlagsBits } = require('discord.js');

/**
 * Yetki katmanlari (madde 24):
 *  User   -> ozel bir yetki gerektirmez
 *  Staff  -> ayarlar.json icindeki staffRoleIds
 *  Manager-> ayarlar.json icindeki managerRoleIds VEYA Discord "Manage Guild" izni
 *  Owner  -> ayarlar.json icindeki ownerIds VEYA sunucu sahibi
 *
 * Discord permissions + configured roles + ownerIds birlikte degerlendirilir.
 */

const ROLE_LEVELS = { user: 0, staff: 1, manager: 2, owner: 3 };

function resolveMemberLevel(member, settings, guild) {
  if (!member) return ROLE_LEVELS.user;

  const ownerIds = (settings.discord && settings.discord.ownerIds) || [];
  if (ownerIds.includes(member.id)) return ROLE_LEVELS.owner;
  if (guild && guild.ownerId === member.id) return ROLE_LEVELS.owner;

  const managerRoleIds = (settings.discord && settings.discord.managerRoleIds) || [];
  const staffRoleIds = (settings.discord && settings.discord.staffRoleIds) || [];

  const memberRoleIds = member.roles && member.roles.cache ? [...member.roles.cache.keys()] : [];

  if (managerRoleIds.some((id) => memberRoleIds.includes(id))) return ROLE_LEVELS.manager;
  if (member.permissions && member.permissions.has(PermissionFlagsBits.ManageGuild)) return ROLE_LEVELS.manager;
  if (staffRoleIds.some((id) => memberRoleIds.includes(id))) return ROLE_LEVELS.staff;

  return ROLE_LEVELS.user;
}

function hasLevel(member, settings, guild, requiredLevel) {
  return resolveMemberLevel(member, settings, guild) >= requiredLevel;
}

function isOwner(member, settings, guild) {
  return resolveMemberLevel(member, settings, guild) >= ROLE_LEVELS.owner;
}

function isManagerOrAbove(member, settings, guild) {
  return resolveMemberLevel(member, settings, guild) >= ROLE_LEVELS.manager;
}

function isStaffOrAbove(member, settings, guild) {
  return resolveMemberLevel(member, settings, guild) >= ROLE_LEVELS.staff;
}

/**
 * Botun kendi rolunun, verilmek/kaldirilmak istenen role gore hiyerarside
 * yeterince yukarida olup olmadigini kontrol eder (madde 7).
 */
function canBotManageRole(guild, role) {
  if (!guild || !role) return { ok: false, reason: 'Sunucu veya rol bulunamadi.' };
  const botMember = guild.members.me;
  if (!botMember) return { ok: false, reason: 'Bot uyesi bulunamadi.' };
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { ok: false, reason: 'Botun Rolleri Yonet (Manage Roles) izni yok.' };
  }
  if (botMember.roles.highest.position <= role.position) {
    return { ok: false, reason: 'Botun rolu, verilecek rolden hiyerarside daha yukarida degil.' };
  }
  if (role.managed) {
    return { ok: false, reason: 'Bu rol Discord tarafindan yonetilen (entegrasyon) bir rol, atanamaz.' };
  }
  return { ok: true, reason: null };
}

module.exports = {
  ROLE_LEVELS,
  resolveMemberLevel,
  hasLevel,
  isOwner,
  isManagerOrAbove,
  isStaffOrAbove,
  canBotManageRole,
};
