import { logger } from '../utils/logger.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { COMMANDS_PAGES, buildCommandsRow } from '../commands/Core/commands.js';

async function handlePageChange(interaction, direction) {
    try {
        const parts = interaction.customId.split('_');
        const currentPage = parseInt(parts[2], 10);
        const newPage = direction === 'next' ? currentPage + 1 : currentPage - 1;

        if (newPage < 0 || newPage >= COMMANDS_PAGES.length) return;

        await interaction.update({
            embeds: [COMMANDS_PAGES[newPage]],
            components: [buildCommandsRow(newPage, COMMANDS_PAGES.length)],
        });
    } catch (error) {
        logger.error('Error handling commands pagination:', error);
    }
}

export const commandsPrevHandler = {
    name: 'commands_prev',
    async execute(interaction, client) {
        await handlePageChange(interaction, 'prev');
    },
};

export const commandsNextHandler = {
    name: 'commands_next',
    async execute(interaction, client) {
        await handlePageChange(interaction, 'next');
    },
};
