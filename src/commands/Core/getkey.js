import {
    SlashCommandBuilder,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { errorEmbed } from '../../utils/embeds.js';

// ── Master users (can use /getkey AND grant access to others) ──
export const MASTER_USERS = ['768020734231969793', '1190844956395446397'];

// ── DB key helpers ─────────────────────────────────────────────
export const DB_KEYS = {
    pool:        (guildId) => `getkey:pool:${guildId}`,
    used:        (guildId) => `getkey:used:${guildId}`,
    credits:     (guildId, userId) => `getkey:credits:${guildId}:${userId}`,
    creditLimit: (guildId, userId) => `getkey:creditlimit:${guildId}:${userId}`,
    access:      (guildId) => `getkey:access:${guildId}`,
    lastUsed:    (guildId, userId) => `getkey:lastused:${guildId}:${userId}`,
};

export const DEFAULT_CREDITS   = 99;
export const DEFAULT_LIMIT     = 99;
export const CREDIT_EXPIRY_MS  = 30 * 24 * 60 * 60 * 1000; // 30 days

// ── Credit helpers ─────────────────────────────────────────────
export async function getCredits(client, guildId, userId) {
    const key      = DB_KEYS.credits(guildId, userId);
    const lastKey  = DB_KEYS.lastUsed(guildId, userId);
    const limitKey = DB_KEYS.creditLimit(guildId, userId);

    const stored   = await client.db.get(key);
    const lastUsed = await client.db.get(lastKey);
    const limit    = await client.db.get(limitKey) ?? DEFAULT_LIMIT;

    // Expire credits after 30 days of no use
    if (lastUsed && Date.now() - Number(lastUsed) > CREDIT_EXPIRY_MS) {
        await client.db.set(key, 0);
        return 0;
    }

    return stored === null || stored === undefined ? Number(limit) : Number(stored);
}

export async function setCredits(client, guildId, userId, amount) {
    await client.db.set(DB_KEYS.credits(guildId, userId), amount);
    await client.db.set(DB_KEYS.lastUsed(guildId, userId), Date.now());
}

export async function getCreditLimit(client, guildId, userId) {
    const val = await client.db.get(DB_KEYS.creditLimit(guildId, userId));
    return val === null || val === undefined ? DEFAULT_LIMIT : Number(val);
}

export async function setCreditLimit(client, guildId, userId, limit) {
    await client.db.set(DB_KEYS.creditLimit(guildId, userId), limit);
    // Also cap current credits to new limit
    const current = await getCredits(client, guildId, userId);
    if (current > limit) await setCredits(client, guildId, userId, limit);
}

// ── Access helpers ─────────────────────────────────────────────
export async function getAllowedUsers(client, guildId) {
    const val = await client.db.get(DB_KEYS.access(guildId));
    return Array.isArray(val) ? val : [];
}

export async function hasAccess(client, guildId, userId) {
    if (MASTER_USERS.includes(userId)) return true;
    const allowed = await getAllowedUsers(client, guildId);
    return allowed.includes(userId);
}

// ── Key pool helpers ───────────────────────────────────────────
export async function getPool(client, guildId) {
    const val = await client.db.get(DB_KEYS.pool(guildId));
    return Array.isArray(val) ? val : [];
}

export async function getUsedKeys(client, guildId) {
    const val = await client.db.get(DB_KEYS.used(guildId));
    return Array.isArray(val) ? val : [];
}

export async function pickKey(client, guildId, requestedDays) {
    const pool = await getPool(client, guildId);
    const now  = Date.now();

    // Filter out expired keys
    const valid = pool.filter(k => new Date(k.expiry).getTime() > now);

    if (valid.length === 0) return null;

    // Sort by soonest expiry first
    valid.sort((a, b) => new Date(a.expiry) - new Date(b.expiry));

    const key        = valid[0];
    const keyExpiry  = new Date(key.expiry).getTime();
    const userExpiry = now + requestedDays * 24 * 60 * 60 * 1000;

    // Cap user expiry at key's absolute expiry
    const assignedExpiry = Math.min(keyExpiry, userExpiry);

    // Remove from pool
    const remaining = pool.filter(k => k.id !== key.id);
    await client.db.set(DB_KEYS.pool(guildId), remaining);

    return { ...key, assignedExpiry };
}

export async function addToUsed(client, guildId, entry) {
    const used = await getUsedKeys(client, guildId);
    used.unshift(entry); // newest first
    await client.db.set(DB_KEYS.used(guildId), used);
}

// ── Command ────────────────────────────────────────────────────
export default {
    data: new SlashCommandBuilder()
        .setName('getkey')
        .setDescription('Get a pre-made license key from the pool'),

    async execute(interaction, guildConfig, client) {
        // ── Access check ──
        const access = await hasAccess(client, interaction.guildId, interaction.user.id);
        if (!access) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('❌ Access Denied',
                    'You do not have permission to use this command.\nContact an admin to get access.')],
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── Credit check ──
        const credits = await getCredits(client, interaction.guildId, interaction.user.id);
        if (credits <= 0) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('❌ No Credits',
                    'You have no remaining credits.\nCredits expire after 30 days of inactivity.\nContact an admin to get more credits.')],
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── Check pool has keys ──
        const pool = await getPool(client, interaction.guildId);
        const now  = Date.now();
        const validKeys = pool.filter(k => new Date(k.expiry).getTime() > now);

        if (validKeys.length === 0) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [new EmbedBuilder()
                    .setColor(0xED4245)
                    .setTitle('❌ No Keys Available')
                    .setDescription('There are no available keys in the pool right now.\nContact <@768020734231969793> to add more keys.')
                    .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── Show modal ──
        const modal = new ModalBuilder()
            .setCustomId('getkey_modal')
            .setTitle('🔑 Get License Key');

        const durationInput = new TextInputBuilder()
            .setCustomId('duration')
            .setLabel('Validity (type: 1, 3, 7, or 30)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('1 / 3 / 7 / 30')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(2);

        const noteInput = new TextInputBuilder()
            .setCustomId('note')
            .setLabel('Note (optional — e.g. John-Server)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Optional label for this key')
            .setRequired(false)
            .setMaxLength(50);

        modal.addComponents(
            new ActionRowBuilder().addComponents(durationInput),
            new ActionRowBuilder().addComponents(noteInput),
        );

        await interaction.showModal(modal);
    },
};
