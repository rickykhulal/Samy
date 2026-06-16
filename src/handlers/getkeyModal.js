import { EmbedBuilder, MessageFlags } from 'discord.js';
import { errorEmbed } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import {
    getCredits, setCredits, pickKey, addToUsed,
} from '../commands/Core/getkey.js';

const VALID_DURATIONS = [1, 3, 7, 30];

const getKeyModalHandler = {
    name: 'getkey_modal',
    async execute(interaction, client) {
        try {
            const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferSuccess) return;

            const durationRaw = interaction.fields.getTextInputValue('duration').trim();
            const note        = interaction.fields.getTextInputValue('note')?.trim() || null;
            const days        = parseInt(durationRaw, 10);

            // ── Validate duration ──
            if (!VALID_DURATIONS.includes(days)) {
                return interaction.editReply({
                    embeds: [errorEmbed('❌ Invalid Duration',
                        `Please enter one of: **1, 3, 7, or 30** days.`)],
                });
            }

            // ── Re-check credits ──
            const credits = await getCredits(client, interaction.guildId, interaction.user.id);
            if (credits <= 0) {
                return interaction.editReply({
                    embeds: [errorEmbed('❌ No Credits',
                        'You have no remaining credits. Contact an admin.')],
                });
            }

            // ── Pick key from pool ──
            const keyEntry = await pickKey(client, interaction.guildId, days);

            if (!keyEntry) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ No Keys Available')
                        .setDescription('No keys available in the pool right now.\nContact <@768020734231969793> to add more keys.')
                        .setTimestamp()
                    ],
                });
            }

            // ── Deduct credit ──
            await setCredits(client, interaction.guildId, interaction.user.id, credits - 1);

            // ── Record to used bucket ──
            const usedEntry = {
                keyValue:      keyEntry.value,
                keyId:         keyEntry.id,
                assignedTo:    interaction.user.id,
                assignedTag:   interaction.user.tag,
                note:          note || 'None',
                requestedDays: days,
                assignedExpiry: keyEntry.assignedExpiry,
                absoluteExpiry: keyEntry.expiry,
                usedAt:        new Date().toISOString(),
                guildId:       interaction.guildId,
                channelId:     interaction.channelId,
            };
            await addToUsed(client, interaction.guildId, usedEntry);

            const expiryTimestamp = Math.floor(keyEntry.assignedExpiry / 1000);

            // ── Confirm to user (ephemeral — only they see the actual key value) ──
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor(0x2ECC71)
                    .setTitle('✅ Key Retrieved')
                    .setDescription('Your key has been assigned. It is shown publicly in the channel.')
                    .setTimestamp()
                ],
            });

            // ── Public message in channel ──
            const publicEmbed = new EmbedBuilder()
                .setColor(0x2ECC71)
                .setTitle('🔑 License Key Generated')
                .setDescription('A license key has been successfully assigned from the pool.')
                .addFields(
                    { name: '🗝️ Key Value',    value: `\`\`\`\n${keyEntry.value}\n\`\`\``, inline: false },
                    { name: '📅 Expires',       value: `<t:${expiryTimestamp}:F> (<t:${expiryTimestamp}:R>)`, inline: true },
                    { name: '⏱️ Duration',      value: `${days} Day${days !== 1 ? 's' : ''}`, inline: true },
                    { name: '💳 Credits Left',  value: `${credits - 1}`, inline: true },
                    ...(note ? [{ name: '📝 Note', value: note, inline: false }] : []),
                )
                .setFooter({ text: `Requested by ${interaction.user.tag}` })
                .setTimestamp();

            await interaction.channel.send({
                content: `<@${interaction.user.id}>`,
                embeds:  [publicEmbed],
            });

        } catch (error) {
            logger.error('getkey modal error: ' + error?.message, { stack: error?.stack });
            try {
                await interaction.editReply({
                    embeds: [errorEmbed('Error', 'Something went wrong. Please try again.')],
                });
            } catch (_) {}
        }
    },
};

export default getKeyModalHandler;
