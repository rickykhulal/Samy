import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getUserCredits, setUserCredits, DEFAULT_CREDITS } from './createkey.js';

export default {
    data: new SlashCommandBuilder()
        .setName('credits')
        .setDescription('Manage key generation credits for users')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub
            .setName('check')
            .setDescription('Check a user\'s remaining credits')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('The user to check')
                .setRequired(true)
            )
        )
        .addSubcommand(sub => sub
            .setName('set')
            .setDescription('Set a user\'s credits to a specific amount')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('The user to update')
                .setRequired(true)
            )
            .addIntegerOption(opt => opt
                .setName('amount')
                .setDescription('Number of credits (0-99)')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(99)
            )
        )
        .addSubcommand(sub => sub
            .setName('add')
            .setDescription('Add credits to a user')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('The user to add credits to')
                .setRequired(true)
            )
            .addIntegerOption(opt => opt
                .setName('amount')
                .setDescription('Number of credits to add')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(99)
            )
        )
        .addSubcommand(sub => sub
            .setName('reset')
            .setDescription('Reset a user\'s credits back to default (99)')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('The user to reset')
                .setRequired(true)
            )
        ),

    async execute(interaction, guildConfig, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferSuccess) return;

        const subcommand = interaction.options.getSubcommand();
        const targetUser = interaction.options.getUser('user');

        try {
            switch (subcommand) {
                case 'check': {
                    const credits = await getUserCredits(client, interaction.guildId, targetUser.id);
                    return interaction.editReply({
                        embeds: [createEmbed({
                            title: '💳 Credit Balance',
                            description: `**${targetUser.tag}** has **${credits}** remaining credits.`,
                            color: 'info',
                        })],
                    });
                }

                case 'set': {
                    const amount = interaction.options.getInteger('amount');
                    await setUserCredits(client, interaction.guildId, targetUser.id, amount);
                    return interaction.editReply({
                        embeds: [successEmbed('✅ Credits Updated',
                            `Set **${targetUser.tag}**'s credits to **${amount}**.`)],
                    });
                }

                case 'add': {
                    const amount  = interaction.options.getInteger('amount');
                    const current = await getUserCredits(client, interaction.guildId, targetUser.id);
                    const newTotal = Math.min(99, current + amount);
                    await setUserCredits(client, interaction.guildId, targetUser.id, newTotal);
                    return interaction.editReply({
                        embeds: [successEmbed('✅ Credits Added',
                            `Added **${amount}** credits to **${targetUser.tag}**.\nNew balance: **${newTotal}** credits.`)],
                    });
                }

                case 'reset': {
                    await setUserCredits(client, interaction.guildId, targetUser.id, DEFAULT_CREDITS);
                    return interaction.editReply({
                        embeds: [successEmbed('✅ Credits Reset',
                            `Reset **${targetUser.tag}**'s credits to **${DEFAULT_CREDITS}**.`)],
                    });
                }
            }
        } catch (error) {
            logger.error('Credits command error:', error?.message);
            return interaction.editReply({
                embeds: [errorEmbed('Error', 'Something went wrong managing credits.')],
            });
        }
    },
};
