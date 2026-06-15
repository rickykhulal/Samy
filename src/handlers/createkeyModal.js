import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { errorEmbed, successEmbed } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { getUserCredits, deductCredit, refundCredit, pendingKeyRequests, DEFAULT_CREDITS } from '../commands/Core/createkey.js';

const APPROVER_USER_ID = '1190844956395446397';
const MAX_DAYS = 30;

// ── Validate key name: letters, numbers, hyphens only ──
function isValidKeyName(name) {
    return /^[a-zA-Z0-9-]+$/.test(name);
}

const createKeyModalHandler = {
    name: 'createkey_modal',
    async execute(interaction, client) {
        try {
            const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferSuccess) return;

            const keyName = interaction.fields.getTextInputValue('key_name').trim();
            const daysRaw = interaction.fields.getTextInputValue('days').trim();
            const days    = parseInt(daysRaw, 10);

            // ── Validate key name ──
            if (!isValidKeyName(keyName)) {
                return interaction.editReply({
                    embeds: [errorEmbed('❌ Invalid Key Name',
                        'Key name can only contain **letters**, **numbers**, and **hyphens** (`-`).\nNo spaces or special characters allowed.')],
                });
            }

            // ── Validate days ──
            if (isNaN(days) || days < 1 || days > MAX_DAYS) {
                return interaction.editReply({
                    embeds: [errorEmbed('❌ Invalid Days',
                        `Please enter a number between **1** and **${MAX_DAYS}**.`)],
                });
            }

            // ── Check & deduct credit ──
            const deducted = await deductCredit(client, interaction.guildId, interaction.user.id);
            if (!deducted) {
                return interaction.editReply({
                    embeds: [errorEmbed('❌ No Credits',
                        'You have no remaining credits. Contact an admin to get more.')],
                });
            }

            const remainingCredits = await getUserCredits(client, interaction.guildId, interaction.user.id);

            // ── Store pending request ──
            const requestId = `${interaction.user.id}-${Date.now()}`;
            pendingKeyRequests.set(requestId, {
                requestId,
                userId:      interaction.user.id,
                userTag:     interaction.user.tag,
                guildId:     interaction.guildId,
                channelId:   interaction.channelId,
                keyName,
                days,
                remainingCredits,
                requestedAt: new Date().toISOString(),
            });

            // ── Send approval DM to approver ──
            try {
                const approver = await client.users.fetch(APPROVER_USER_ID);

                const approvalEmbed = new EmbedBuilder()
                    .setColor(0xF1C40F)
                    .setTitle('🔑 New Key Generation Request')
                    .setDescription('A user has requested a license key. Approve or deny below.')
                    .addFields(
                        { name: '👤 Requested By', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
                        { name: '🏠 Server',        value: interaction.guild.name, inline: true },
                        { name: '\u200B',            value: '\u200B', inline: true },
                        { name: '🔑 Key Name',      value: `\`${keyName}\``, inline: true },
                        { name: '📅 Validity',      value: `${days} Day${days !== 1 ? 's' : ''}`, inline: true },
                        { name: '💳 Credits Left',  value: `${remainingCredits} Credits`, inline: true },
                    )
                    .setFooter({ text: `Request ID: ${requestId}` })
                    .setTimestamp();

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`keyapprove_${requestId}`)
                        .setLabel('✅ Approve')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`keydeny_${requestId}`)
                        .setLabel('❌ Deny')
                        .setStyle(ButtonStyle.Danger),
                );

                await approver.send({ embeds: [approvalEmbed], components: [row] });
            } catch (dmError) {
                logger.error('Failed to send approval DM:', dmError);
                // Refund credit since DM failed
                await refundCredit(client, interaction.guildId, interaction.user.id);
                pendingKeyRequests.delete(requestId);
                return interaction.editReply({
                    embeds: [errorEmbed('❌ Error', 'Could not send the approval request. Please try again later.')],
                });
            }

            // ── Confirm to user ──
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor(0xF1C40F)
                    .setTitle('⏳ Request Submitted')
                    .setDescription('Your key generation request has been sent for approval.\nYou will receive a response in this channel once it is reviewed.')
                    .addFields(
                        { name: '🔑 Key Name',     value: `\`${keyName}\``, inline: true },
                        { name: '📅 Validity',     value: `${days} Day${days !== 1 ? 's' : ''}`, inline: true },
                        { name: '💳 Credits Left', value: `${remainingCredits} Credits`, inline: true },
                    )
                    .setTimestamp()
                ],
            });

        } catch (error) {
            logger.error('createkey modal error:', error?.message, { stack: error?.stack });
            try {
                await interaction.editReply({
                    embeds: [errorEmbed('Error', 'Something went wrong. Please try again.')],
                });
            } catch (_) {}
        }
    },
};

export default createKeyModalHandler;
