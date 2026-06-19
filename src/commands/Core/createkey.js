// src/commands/Core/createkey.js
import {
    SlashCommandBuilder,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { errorEmbed } from '../../utils/embeds.js';
import {
    MASTER_USERS,
    hasAccess,
    getCredits,
} from '../../utils/keySystem.js';

export default {
    data: new SlashCommandBuilder()
        .setName('createkey')
        .setDescription('Request a license key generation'),

    async execute(interaction, guildConfig, client) {
        // ── Access check ──────────────────────────────────────
        const access = await hasAccess(client, interaction.guildId, interaction.user.id);
        if (!access) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('❌ Access Denied',
                    'You do not have permission to use this command.\nContact an admin to get access.')],
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── Credit check ──────────────────────────────────────
        const credits = await getCredits(client, interaction.guildId, interaction.user.id);
        if (credits <= 0) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('❌ No Credits',
                    'You have no remaining credits.\nContact an admin to get more credits.')],
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── Show modal ────────────────────────────────────────
        const modal = new ModalBuilder()
            .setCustomId('createkey_modal')
            .setTitle('🔑 Request License Key');

        const noteInput = new TextInputBuilder()
            .setCustomId('note')
            .setLabel('Key Note (letters, numbers, hyphens only)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g. RXY1 or John-Server')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(32);

        const daysInput = new TextInputBuilder()
            .setCustomId('days')
            .setLabel('Validity Days (1, 3, 7, or 30)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter: 1 / 3 / 7 / 30')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(2);

        modal.addComponents(
            new ActionRowBuilder().addComponents(noteInput),
            new ActionRowBuilder().addComponents(daysInput),
        );

        await interaction.showModal(modal);
    },
};
