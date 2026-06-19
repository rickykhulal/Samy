// src/handlers/createkeyModal.js
import {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { errorEmbed } from '../utils/embeds.js';
import {
    MASTER_USERS,
    pendingRequests,
    getCredits,
    deductCredit,
    refundCredit,
    findBestKey,
    consumeKey,
} from '../utils/keySystem.js';

const VALID_DAYS     = [1, 3, 7, 30];
const TIMEOUT_MS     = 2 * 60 * 1000; // 2 minutes
const APPROVER_ID    = '1190844956395446397';

// ── Validate note: letters, numbers, hyphens only ─────────────
function isValidNote(note) {
    return /^[a-zA-Z0-9-]+$/.test(note);
}

// ── Build key success embed ────────────────────────────────────
function buildKeyEmbed({ keyValue, assignedExpiry, actualDays, note, userTag, credits }) {
    const ts = Math.floor(assignedExpiry / 1000);
    return new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('🔑 License Key Generated')
        .setDescription('Your license key has been successfully created.\nPlease copy it from the block below:')
        .addFields(
            { name: '🗝️ Generated Key',  value: `\`\`\`\n${keyValue}\n\`\`\``,                        inline: false },
            { name: '📅 Expires',         value: `<t:${ts}:F> (<t:${ts}:R>)`,                          inline: true  },
            { name: '⏱️ Validity',        value: `${actualDays} Day${actualDays !== 1 ? 's' : ''}`,     inline: true  },
            { name: '💳 Credits Left',    value: `${credits}`,                                          inline: true  },
            ...(note ? [{ name: '📝 Note', value: note, inline: false }] : []),
        )
        .setFooter({ text: `Requested by ${userTag} • Automated System` })
        .setTimestamp();
}

const createKeyModalHandler = {
    name: 'createkey_modal',
    async execute(interaction, client) {
        try {
            const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferSuccess) return;

            const note    = interaction.fields.getTextInputValue('note').trim();
            const daysRaw = interaction.fields.getTextInputValue('days').trim();
            const days    = parseInt(daysRaw, 10);

            // ── Validate note ──
            if (!isValidNote(note)) {
                return interaction.editReply({
                    embeds: [errorEmbed('❌ Invalid Note',
                        'Note can only contain **letters**, **numbers**, and **hyphens** (`-`).')],
                });
            }

            // ── Validate days ──
            if (!VALID_DAYS.includes(days)) {
                return interaction.editReply({
                    embeds: [errorEmbed('❌ Invalid Days',
                        'Please enter one of: **1, 3, 7, or 30** days.')],
                });
            }

            // ── Credit check ──
            const credits = await getCredits(client, interaction.guildId, interaction.user.id);
            if (credits <= 0) {
                return interaction.editReply({
                    embeds: [errorEmbed('❌ No Credits', 'You have no remaining credits.')],
                });
            }

            // ── Build request object ──
            const requestId = `cr_${interaction.user.id}_${Date.now()}`;
            const request = {
                requestId,
                userId:    interaction.user.id,
                userTag:   interaction.user.tag,
                guildId:   interaction.guildId,
                channelId: interaction.channelId,
                note,
                days,
                status:    'pending', // pending | approved | denied | timeout
                createdAt: Date.now(),
            };
            pendingRequests.set(requestId, request);

            // ── Send approval DM ──
            let dmMessage = null;
            try {
                const approver = await client.users.fetch(APPROVER_ID);

                const dmEmbed = new EmbedBuilder()
                    .setColor(0xF1C40F)
                    .setTitle('🔑 Key Generation Request')
                    .setDescription('A user has requested a license key.\n⏳ **You have 2 minutes to respond.**')
                    .addFields(
                        { name: '👤 User',      value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true  },
                        { name: '🏠 Server',    value: interaction.guild.name,                                 inline: true  },
                        { name: '\u200B',        value: '\u200B',                                              inline: true  },
                        { name: '📝 Note',      value: note,                                                   inline: true  },
                        { name: '⏱️ Days',      value: `${days} Day${days !== 1 ? 's' : ''}`,                 inline: true  },
                        { name: '💳 Credits',   value: `${credits}`,                                          inline: true  },
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

                dmMessage = await approver.send({ embeds: [dmEmbed], components: [row] });
                request.dmMessageId = dmMessage.id;

            } catch (dmErr) {
                logger.warn('Could not send approval DM:', dmErr.message);
                // DM failed — skip to auto-pool flow immediately
                request.status = 'timeout';
            }

            // ── Confirm to user ──
            const countdown = Math.floor((Date.now() + TIMEOUT_MS) / 1000);
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor(0xF1C40F)
                    .setTitle('⏳ Request Submitted')
                    .setDescription(`Your request has been sent for approval.\nWaiting for response — expires <t:${countdown}:R>.`)
                    .addFields(
                        { name: '📝 Note',   value: note,                                  inline: true },
                        { name: '⏱️ Days',  value: `${days} Day${days !== 1 ? 's' : ''}`, inline: true },
                    )
                    .setTimestamp()
                ],
            });

            // ── 2 min timeout ──────────────────────────────────
            setTimeout(async () => {
                const req = pendingRequests.get(requestId);
                if (!req || req.status !== 'pending') return; // already handled

                req.status = 'timeout';
                pendingRequests.set(requestId, req);

                // Disable DM buttons
                if (dmMessage) {
                    try {
                        await dmMessage.edit({ components: [] });
                    } catch (_) {}
                }

                // ── Notify user: offer pre-made keys ──
                try {
                    const guild   = await client.guilds.fetch(req.guildId).catch(() => null);
                    const channel = guild ? await guild.channels.fetch(req.channelId).catch(() => null) : null;
                    if (!channel?.isSendable()) return;

                    const offerRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`keypool_yes_${requestId}`)
                            .setLabel('✅ Yes, use pre-made key')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`keypool_no_${requestId}`)
                            .setLabel('❌ No, cancel')
                            .setStyle(ButtonStyle.Danger),
                    );

                    await channel.send({
                        content: `<@${req.userId}>`,
                        embeds: [new EmbedBuilder()
                            .setColor(0xFF8C00)
                            .setTitle('⚠️ Request Timed Out')
                            .setDescription('The approval is taking longer than expected.\n\n**Would you like to use a pre-made key from the pool instead?**')
                            .setTimestamp()
                        ],
                        components: [offerRow],
                    });
                } catch (err) {
                    logger.error('Timeout notify error:', err.message);
                }

            }, TIMEOUT_MS);

        } catch (error) {
            logger.error('createkey modal error: ' + error?.message, { stack: error?.stack });
            try {
                await interaction.editReply({
                    embeds: [errorEmbed('Error', 'Something went wrong. Please try again.')],
                });
            } catch (_) {}
        }
    },
};

export default createKeyModalHandler;
