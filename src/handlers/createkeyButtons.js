import { EmbedBuilder, MessageFlags } from 'discord.js';
import { errorEmbed, successEmbed } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';
import { refundCredit, pendingKeyRequests } from '../commands/Core/createkey.js';

const APPROVER_USER_ID = '1190844956395446397';

// ── Shared: only approver can click ──────────────────────
async function checkApprover(interaction) {
    if (interaction.user.id !== APPROVER_USER_ID) {
        await interaction.reply({
            content: '❌ Only the authorized approver can use these buttons.',
            flags: MessageFlags.Ephemeral,
        });
        return false;
    }
    return true;
}

// ── APPROVE ──────────────────────────────────────────────
const keyApproveHandler = {
    name: 'keyapprove',
    async execute(interaction, client) {
        try {
            if (!(await checkApprover(interaction))) return;

            // Extract requestId from customId: "keyapprove_<requestId>"
            const requestId = interaction.customId.replace('keyapprove_', '');
            const request   = pendingKeyRequests.get(requestId);

            if (!request) {
                return interaction.reply({
                    embeds: [errorEmbed('❌ Expired', 'This request has already been processed or expired.')],
                    flags: MessageFlags.Ephemeral,
                });
            }

            pendingKeyRequests.delete(requestId);

            // ── Update the DM embed to show approved ──
            await interaction.update({
                embeds: [new EmbedBuilder()
                    .setColor(0x2ECC71)
                    .setTitle('✅ Key Request Approved')
                    .setDescription(`You approved the key request from **${request.userTag}**.`)
                    .addFields(
                        { name: '🔑 Key Name', value: `\`${request.keyName}\``, inline: true },
                        { name: '📅 Validity', value: `${request.days} Day${request.days !== 1 ? 's' : ''}`, inline: true },
                    )
                    .setTimestamp()
                ],
                components: [],
            });

            // ── Send success message to original channel ──
            try {
                const guild   = await client.guilds.fetch(request.guildId).catch(() => null);
                const channel = guild ? await guild.channels.fetch(request.channelId).catch(() => null) : null;

                if (channel?.isSendable()) {
                    const successEmbed = new EmbedBuilder()
                        .setColor(0x2ECC71)
                        .setTitle('🔑 License Key Generated')
                        .setDescription('Your license key has been successfully created.\nPlease copy it from the block below:')
                        .addFields(
                            { name: '🗒️ Generated Key', value: `\`\`\`\n${request.keyName}\n\`\`\``, inline: false },
                            { name: '🔑 Key Name',       value: request.keyName,                                   inline: true },
                            { name: '📅 Validity',       value: `${request.days} Day${request.days !== 1 ? 's' : ''}`, inline: true },
                            { name: '💳 Remaining Credits', value: `${request.remainingCredits} Credits`,          inline: true },
                        )
                        .setFooter({ text: `Requested by ${request.userTag} • Automated System` })
                        .setTimestamp();

                    await channel.send({
                        content: `<@${request.userId}>`,
                        embeds:  [successEmbed],
                    });
                }
            } catch (sendError) {
                logger.error('Failed to send key approval to channel:', sendError);
            }

        } catch (error) {
            logger.error('keyApprove handler error:', error?.message);
            try {
                await interaction.reply({
                    embeds: [errorEmbed('Error', 'Something went wrong while approving.')],
                    flags: MessageFlags.Ephemeral,
                });
            } catch (_) {}
        }
    },
};

// ── DENY ─────────────────────────────────────────────────
const keyDenyHandler = {
    name: 'keydeny',
    async execute(interaction, client) {
        try {
            if (!(await checkApprover(interaction))) return;

            const requestId = interaction.customId.replace('keydeny_', '');
            const request   = pendingKeyRequests.get(requestId);

            if (!request) {
                return interaction.reply({
                    embeds: [errorEmbed('❌ Expired', 'This request has already been processed or expired.')],
                    flags: MessageFlags.Ephemeral,
                });
            }

            pendingKeyRequests.delete(requestId);

            // ── Refund the credit ──
            await refundCredit(client, request.guildId, request.userId);

            // ── Update DM embed to show denied ──
            await interaction.update({
                embeds: [new EmbedBuilder()
                    .setColor(0xED4245)
                    .setTitle('❌ Key Request Denied')
                    .setDescription(`You denied the key request from **${request.userTag}**.\nTheir credit has been refunded.`)
                    .addFields(
                        { name: '🔑 Key Name', value: `\`${request.keyName}\``, inline: true },
                        { name: '📅 Validity', value: `${request.days} Day${request.days !== 1 ? 's' : ''}`, inline: true },
                    )
                    .setTimestamp()
                ],
                components: [],
            });

            // ── Notify user in original channel ──
            try {
                const guild   = await client.guilds.fetch(request.guildId).catch(() => null);
                const channel = guild ? await guild.channels.fetch(request.channelId).catch(() => null) : null;

                if (channel?.isSendable()) {
                    await channel.send({
                        content: `<@${request.userId}>`,
                        embeds: [new EmbedBuilder()
                            .setColor(0xED4245)
                            .setTitle('❌ Key Request Denied')
                            .setDescription('Your license key request has been denied by the administrator.\nYour credit has been refunded.')
                            .addFields(
                                { name: '🔑 Key Name', value: `\`${request.keyName}\``, inline: true },
                                { name: '📅 Validity', value: `${request.days} Day${request.days !== 1 ? 's' : ''}`, inline: true },
                            )
                            .setTimestamp()
                        ],
                    });
                }
            } catch (sendError) {
                logger.error('Failed to send key denial to channel:', sendError);
            }

        } catch (error) {
            logger.error('keyDeny handler error:', error?.message);
            try {
                await interaction.reply({
                    embeds: [errorEmbed('Error', 'Something went wrong while denying.')],
                    flags: MessageFlags.Ephemeral,
                });
            } catch (_) {}
        }
    },
};

export default keyApproveHandler;
export { keyDenyHandler };
