// ─────────────────────────────────────────────────────────────
//  src/utils/keySystem.js
//  Shared utilities for the entire key generation system
// ─────────────────────────────────────────────────────────────

export const MASTER_USERS = ['768020734231969793', '1190844956395446397'];
export const VALID_DAYS   = [1, 3, 7, 30];

// ── DB key helpers ─────────────────────────────────────────────
export const DB = {
    pool:     (gid)       => `keysys:pool:${gid}`,
    used:     (gid)       => `keysys:used:${gid}`,
    credits:  (gid, uid)  => `keysys:credits:${gid}:${uid}`,
    access:   (gid)       => `keysys:access:${gid}`,
    pending:  (gid, uid)  => `keysys:pending:${gid}:${uid}`,
};

// ── In-memory pending requests map ────────────────────────────
// Map<requestId, requestObject>
export const pendingRequests = new Map();

// ── Access helpers ─────────────────────────────────────────────
export async function hasAccess(client, guildId, userId) {
    if (MASTER_USERS.includes(userId)) return true;
    const list = await getAccessList(client, guildId);
    return list.some(u => u.userId === userId);
}

export async function getAccessList(client, guildId) {
    const val = await client.db.get(DB.access(guildId));
    return Array.isArray(val) ? val : [];
}

export async function grantAccess(client, guildId, userId, credits) {
    const list = await getAccessList(client, guildId);
    const existing = list.findIndex(u => u.userId === userId);
    if (existing >= 0) {
        list[existing].credits = credits;
        list[existing].updatedAt = new Date().toISOString();
    } else {
        list.push({ userId, credits, grantedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
    await client.db.set(DB.access(guildId), list);
}

export async function revokeAccess(client, guildId, userId) {
    const list = await getAccessList(client, guildId);
    const filtered = list.filter(u => u.userId !== userId);
    await client.db.set(DB.access(guildId), filtered);
    return filtered.length < list.length;
}

// ── Credit helpers ─────────────────────────────────────────────
export async function getCredits(client, guildId, userId) {
    if (MASTER_USERS.includes(userId)) return 9999;
    const list = await getAccessList(client, guildId);
    const user = list.find(u => u.userId === userId);
    return user ? Number(user.credits) : 0;
}

export async function deductCredit(client, guildId, userId) {
    if (MASTER_USERS.includes(userId)) return true;
    const list = await getAccessList(client, guildId);
    const idx  = list.findIndex(u => u.userId === userId);
    if (idx < 0 || list[idx].credits <= 0) return false;
    list[idx].credits -= 1;
    list[idx].updatedAt = new Date().toISOString();
    await client.db.set(DB.access(guildId), list);
    return true;
}

export async function refundCredit(client, guildId, userId) {
    if (MASTER_USERS.includes(userId)) return;
    const list = await getAccessList(client, guildId);
    const idx  = list.findIndex(u => u.userId === userId);
    if (idx < 0) return;
    list[idx].credits += 1;
    list[idx].updatedAt = new Date().toISOString();
    await client.db.set(DB.access(guildId), list);
}

export async function addCredits(client, guildId, userId, amount) {
    const list = await getAccessList(client, guildId);
    const idx  = list.findIndex(u => u.userId === userId);
    if (idx < 0) return false;
    list[idx].credits += amount;
    list[idx].updatedAt = new Date().toISOString();
    await client.db.set(DB.access(guildId), list);
    return true;
}

// ── Key pool helpers ───────────────────────────────────────────
export async function getPool(client, guildId) {
    const val = await client.db.get(DB.pool(guildId));
    const now = Date.now();
    const pool = Array.isArray(val) ? val : [];
    // Auto-filter expired keys
    return pool.filter(k => new Date(k.expiry).getTime() > now);
}

export async function getUsedKeys(client, guildId) {
    const val = await client.db.get(DB.used(guildId));
    return Array.isArray(val) ? val : [];
}

export async function addKeyToPool(client, guildId, keyValue, expiry, addedBy) {
    const raw  = await client.db.get(DB.pool(guildId));
    const pool = Array.isArray(raw) ? raw : [];
    const newKey = {
        id:      `k_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        value:   keyValue,
        expiry:  new Date(expiry).toISOString(),
        addedBy,
        addedAt: new Date().toISOString(),
    };
    pool.push(newKey);
    await client.db.set(DB.pool(guildId), pool);
    return newKey;
}

/**
 * Find best key for requested days.
 * Returns { key, assignedExpiry, exact } where exact=true if same days available.
 * Returns null if pool empty.
 */
export async function findBestKey(client, guildId, requestedDays) {
    const pool = await getPool(client, guildId);
    if (pool.length === 0) return null;

    const now     = Date.now();
    const wantMs  = requestedDays * 24 * 60 * 60 * 1000;
    const wantExp = now + wantMs;

    // Sort soonest expiry first
    pool.sort((a, b) => new Date(a.expiry) - new Date(b.expiry));

    // Try to find a key that covers the requested days
    const exact = pool.find(k => new Date(k.expiry).getTime() >= wantExp);
    const key   = exact || pool[0]; // fallback to soonest expiry

    const keyExpMs      = new Date(key.expiry).getTime();
    const assignedExpiry = Math.min(keyExpMs, wantExp);
    const actualDays    = Math.floor((assignedExpiry - now) / (24 * 60 * 60 * 1000));

    return {
        key,
        assignedExpiry,
        actualDays,
        exact: !!exact,
    };
}

export async function consumeKey(client, guildId, keyId, usedEntry) {
    const raw  = await client.db.get(DB.pool(guildId));
    const pool = Array.isArray(raw) ? raw : [];
    const filtered = pool.filter(k => k.id !== keyId);
    await client.db.set(DB.pool(guildId), filtered);

    const used = await getUsedKeys(client, guildId);
    used.unshift(usedEntry);
    await client.db.set(DB.used(guildId), used);
}

// ── Build the public key embed ─────────────────────────────────
export function buildKeyEmbed(opts) {
    const { EmbedBuilder } = require('discord.js');
    const { keyValue, assignedExpiry, actualDays, note, requestedBy, credits } = opts;
    const ts = Math.floor(assignedExpiry / 1000);
    return new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('🔑 License Key Generated')
        .setDescription('Your license key has been successfully created.\nPlease copy it from the block below:')
        .addFields(
            { name: '🗝️ Generated Key',    value: `\`\`\`\n${keyValue}\n\`\`\``,                           inline: false },
            { name: '📅 Expires',           value: `<t:${ts}:F> (<t:${ts}:R>)`,                             inline: true  },
            { name: '⏱️ Validity',          value: `${actualDays} Day${actualDays !== 1 ? 's' : ''}`,        inline: true  },
            { name: '💳 Credits Left',      value: `${credits}`,                                             inline: true  },
            ...(note ? [{ name: '📝 Note', value: note, inline: false }] : []),
        )
        .setFooter({ text: `Requested by ${requestedBy} • Automated System` })
        .setTimestamp();
}
