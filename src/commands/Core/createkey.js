import { SlashCommandBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// ── Config ─────────────────────────────────────────────
const APPROVER_USER_ID = '1190844956395446397';
const DEFAULT_CREDITS   = 99;
const MAX_DAYS          = 30;

// ── Credit helpers (stored in bot DB) ─────────────────
export async function getUserCredits(client, guildId, userId) {
    const key = `keyauth:credits:${guildId}:${userId}`;
    const val = await client.db.get(key);
    return val === null || val === undefined ? DEFAULT_CREDITS : Number(val);
}

export async function setUserCredits(client, guildId, userId, amount) {
    const key = `keyauth:credits:${guildId}:${userId}`;
    await client.db.set(key, amount);
}

export async function deductCredit(client, guildId, userId) {
    const current = await getUserCredits(client, guildId, userId);
    if (current <= 0) return false;
    await setUserCredits(client, guildId, userId, current - 1);
    return true;
}

export async function refundCredit(client, guildId, userId) {
    const current = await getUserCredits(client, guildId, userId);
    await setUserCredits(client, guildId, userId, Math.min(DEFAULT_CREDITS, current + 1));
}

// ── Pending requests (in-memory, survives until bot restart) ──
export const pendingKeyRequests = new Map();

export default {
    data: new SlashCommandBuilder()
        .setName('createkey')
        .setDescription('Request a license key generation'),

    async execute(interaction, guildConfig, client) {
        // ── Check credits ──────────────────────────────
        const credits = await getUserCredits(client, interaction.guildId, interaction.user.id);
        if (credits <= 0) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('❌ No Credits', 'You have no remaining credits to generate a key.\nContact an admin to get more credits.')],
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── Show modal ─────────────────────────────────
        const modal = new ModalBuilder()
            .setCustomId('createkey_modal')
            .setTitle('🔑 Request License Key');

        const keyNameInput = new TextInputBuilder()
            .setCustomId('key_name')
            .setLabel('Key Name (letters, numbers, hyphens only)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g. RXY1 or MY-KEY-001')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(32);

        const daysInput = new TextInputBuilder()
            .setCustomId('days')
            .setLabel(`Validity Days (1 - ${MAX_DAYS})`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(`Enter a number between 1 and ${MAX_DAYS}`)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(2);

        modal.addComponents(
            new ActionRowBuilder().addComponents(keyNameInput),
            new ActionRowBuilder().addComponents(daysInput),
        );

        await interaction.showModal(modal);
    },
};
