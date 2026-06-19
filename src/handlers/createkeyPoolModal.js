// src/handlers/createkeyPoolModal.js
import {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { errorEmbed } from '../utils/embeds.js';
import { pendingRequests, findBestKey, getCredits } from '../utils/keySystem.js';

const VALID_DAYS = [1, 3, 7, 30];

const keyPoolDaysModalHandler = {
    name: 'keypool_days',
    async execute(interaction, client) {
        try {
            const requestId = interaction.customId.replace('keypool_days_', '');
            const req       = pendingRequests.get(requestId);

            if (!req || interaction.user.id !== req.userId) {
                return interaction.reply({
                    embeds: [errorEmbed('❌ Error', 'Request not found or expired.')],
                    flags: MessageFlags.Ephemeral,
                });
            }

            const daysRaw = interaction.fields.getTextInputValue('days').trim();
            const days    = parseInt(daysRaw, 10);

            if (!VALID_DAYS.includes(days)) {
                return interaction.reply({
                    embeds: [errorEmbed('❌ Invalid Days', 'Please enter one of: **1, 3, 7, or 30** days.')],
                    flags: MessageFlags.Ephemeral,
                });
            }

            // Check credits
            const credits = await getCredits(client, req.guildId, req.userId);
            if (credits <= 0) {
                return interaction.reply({
                    embeds: [errorEmbed('❌ No Credits', 'You have no remaining credits.')],
                    flags: MessageFlags.Ephemeral,
                });
            }

            // Find best key
            const keyResult = await findBestKey(client, req.guildId, days);

            if (!keyResult) {
                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ No Keys Available')
                        .setDescription('There are no keys available in the pool right now.\nContact <@768020734231969793> to add more keys.')
                        .setTimestamp()
                    ],
                    flags: MessageFlags.Ephemeral,
                });
            }

            req.poolDays = days;
            pendingRequests.set(requestId, req);

            // If exact match — show confirm
            if (keyResult.exact) {
                const ts = Math.floor(keyResult.assignedExpiry / 1000);
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`keypoolconfirm_${requestId}`)
                        .setLabel('✅ Get Key')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`keypool_no_${requestId}`)
                        .setLabel('❌ Cancel')
                        .setStyle(ButtonStyle.Danger),
                );

                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor(0x3498DB)
                        .setTitle('🔑 Key Available')
                        .setDescription(`A **${days}-day** key is available in the pool.`)
                        .addFields(
                            { name: '⏱️ Duration', value: `${keyResult.actualDays} Days`, inline: true },
                            { name: '📅 Expires',  value: `<t:${ts}:D>`,                  inline: true },
                            { name: '💳 Cost',     value: '1 Credit',                     inline: true },
                        )
                        .setTimestamp()
                    ],
                    components: [row],
                    flags: MessageFlags.Ephemeral,
                });
            }

            // Nearest match — ask user to confirm
            const ts = Math.floor(keyResult.assignedExpiry / 1000);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`keypoolconfirm_${requestId}`)
                    .setLabel(`✅ Yes, use ${keyResult.actualDays}-day key`)
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`keypool_no_${requestId}`)
                    .setLabel('❌ Cancel')
                    .setStyle(ButtonStyle.Danger),
            );

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor(0xFF8C00)
                    .setTitle('⚠️ Exact Duration Not Available')
                    .setDescription(
                        `No **${days}-day** key is available right now.\n\n` +
                        `The nearest available key expires in **${keyResult.actualDays} days**.\n` +
                        `Would you like to use this key instead?`
                    )
                    .addFields(
                        { name: '📅 Expires', value: `<t:${ts}:F>`, inline: true },
                        { name: '💳 Cost',    value: '1 Credit',     inline: true },
                    )
                    .setTimestamp()
                ],
                components: [row],
                flags: MessageFlags.Ephemeral,
            });

        } catch (err) {
            logger.error('keyPoolDaysModal error:', err.message);
            try {
                await interaction.reply({
                    embeds: [errorEmbed('Error', 'Something went wrong. Please try again.')],
                    flags: MessageFlags.Ephemeral,
                });
            } catch (_) {}
        }
    },
};

export default keyPoolDaysModalHandler;
