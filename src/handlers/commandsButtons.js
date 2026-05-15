import { MessageFlags } from 'discord.js';
import { createEmbed } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { COMMANDS_PAGES, buildCommandsRow } from '../commands/Core/commands.js';

// ─────────────────────────────────────────
//  commands_prev  — go to previous page
// ─────────────────────────────────────────
const commandsPrevHandler = {
    name: 'commands_prev',
    async execute(interaction, client) {
        try {
            await handleCommandsPage(interaction, 'prev');
        } catch (error) {
            logger.error('Commands prev button error:', error);
            await safeEphemeralError(interaction, 'Failed to navigate to the previous page.');
        }
    },
};

// ─────────────────────────────────────────
//  commands_next  — go to next page
// ─────────────────────────────────────────
const commandsNextHandler = {
    name: 'commands_next',
    async execute(interaction, client) {
        try {
            await handleCommandsPage(interaction, 'next');
        } catch (error) {
            logger.error('Commands next button error:', error);
            await safeEphemeralError(interaction, 'Failed to navigate to the next page.');
        }
    },
};

// ─────────────────────────────────────────
//  Shared pagination logic
// ─────────────────────────────────────────
async function handleCommandsPage(interaction, direction) {
    // Only the original invoker can flip pages
    const originalUserId = interaction.message.interaction?.user?.id;
    if (originalUserId && interaction.user.id !== originalUserId) {
        return interaction.reply({
            embeds: [createEmbed({
                title:       '❌ Access Denied',
                description: 'Only the person who ran `/commands` can flip pages.',
                color:       'error',
            })],
            flags: MessageFlags.Ephemeral,
        });
    }

    // Parse current page from customId  e.g. "commands_next_2"  →  2
    const currentPage = parseInt(interaction.customId.split('_')[2], 10);
    const totalPages  = COMMANDS_PAGES.length;

    let newPage = currentPage;
    if (direction === 'prev') newPage = Math.max(0, currentPage - 1);
    if (direction === 'next') newPage = Math.min(totalPages - 1, currentPage + 1);

    await interaction.update({
        embeds:     [COMMANDS_PAGES[newPage]],
        components: [buildCommandsRow(newPage, totalPages)],
    });
}

// ─────────────────────────────────────────
//  Helper — safe ephemeral error reply
// ─────────────────────────────────────────
async function safeEphemeralError(interaction, message) {
    try {
        const payload = {
            embeds: [createEmbed({
                title:       'Error',
                description: message,
                color:       'error',
            })],
            flags: MessageFlags.Ephemeral,
        };
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply(payload);
        } else if (interaction.deferred) {
            await interaction.editReply(payload);
        }
    } catch (e) {
        logger.error('Failed to send commands button error reply:', e);
    }
}

export default commandsPrevHandler;
export { commandsNextHandler };
