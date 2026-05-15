import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { COMMANDS_PAGES, buildCommandsRow } from '../../handlers/commandsButtons.js';

export default {
    data: new SlashCommandBuilder()
        .setName('commands')
        .setDescription('Shows a full list of all available bot commands'),

    async execute(interaction) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn('Commands interaction defer failed', {
                userId:      interaction.user.id,
                guildId:     interaction.guildId,
                commandName: 'commands',
            });
            return;
        }

        try {
            await InteractionHelper.safeEditReply(interaction, {
                embeds:     [COMMANDS_PAGES[0]],
                components: COMMANDS_PAGES.length > 1
                    ? [buildCommandsRow(0, COMMANDS_PAGES.length)]
                    : [],
            });
        } catch (error) {
            logger.error('Commands command error:', error);
            try {
                await InteractionHelper.safeReply(interaction, {
                    embeds: [createEmbed({
                        title:       'System Error',
                        description: 'Could not load the command list at this time.',
                        color:       'error',
                    })],
                    flags: MessageFlags.Ephemeral,
                });
            } catch (replyError) {
                logger.error('Failed to send error reply:', replyError);
            }
        }
    },
};
