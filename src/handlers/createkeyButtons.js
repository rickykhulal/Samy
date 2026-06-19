// src/handlers/createkeyButtons.js
import {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { logger } from '../utils/logger.js';
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

const APPROVER_ID = '1190844956395446397';
const VALID_DAYS  = [1, 3, 7, 30];

// ── Build key embed ───────────────────────────────────────────
function buildKeyEmbed({ keyValue, assignedExpiry, actualDays, note, userTag, credits }) {
    const ts = Math.floor(assignedExpiry / 1000);
    return new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('🔑 License Key Generated')
        .setDescription('Your license key has been successfully created.\nPlease copy it from the block below:')
        .addFields(
            { name: '🗝️ Generated Key',  value: `\`\`\`\n${keyValue}\n\`\`\``,                       inline: false },
            { name: '📅 Expires',         value: `<t:${ts}:F> (<t:${ts}:R>)`,                         inline: true  },
            { name: '⏱️ Validity',        value: `${actualDays} Day${actualDays !== 1 ? 's' : ''}`,    inline: true  },
            { name: '💳 Credits Left',    value: `${credits}`,                                         inline: true  },
            ...(note ? [{ name: '📝 Note', value: note, inline: false }] : []),
        )
        .setFooter({ text: `Requested by ${userTag} • Automated System` })
        .setTimestamp();
}

// ── Helper: send key to original channel ─────────────────────
async function deliverKey(client, req, keyResult) {
    try {
        const guild   = await client.guilds.fetch(req.guildId).catch(() => null);
        const channel = guild ? await guild.channels.fetch(req.channelId).catch(() => null) : null;
        if (!channel?.isSendable()) return false;

        const credits = await getCredits(client, req.guildId, req.userId);

        const embed = buildKeyEmbed({
            keyValue:      keyResult.key.value,
            assignedExpiry: keyResult.assignedExpiry,
            actualDays:    keyResult.actualDays,
            note:          req.note,
            userTag:       req.userTag,
            credits,
        });

        await channel.send({ content: `<@${req.userId}>`, embeds: [embed] });

        // Record to used bucket
        await consumeKey(client, req.guildId, keyResult.key.id, {
            keyValue:       keyResult.key.value,
            keyId:          keyResult.key.id,
            assignedTo:     req.userId,
            assignedTag:    req.userTag,
            note:           req.note,
            requestedDays:  req.days,
            actualDays:     keyResult.actualDays,
            assignedExpiry: keyResult.assignedExpiry,
            usedAt:         new Date().toISOString(),
            guildId:        req.guildId,
            method:         'createkey',
        });

        // Notify approver DM of auto-delivery if it was pool fallback
        if (req.method === 'pool') {
            try {
                const approver = await client.users.fetch(APPROVER_ID);
                await approver.send({
                    embeds: [new EmbedBuilder()
                        .setColor(0x3498DB)
                        .setTitle('📋 Auto Key Delivered (Pool)')
                        .setDescription(`A pre-made key was auto-assigned from the pool.`)
                        .addFields(
                            { name: '👤 User',   value: `${req.userTag} (<@${req.userId}>)`, inline: true },
                            { name: '🗝️ Key',   value: `\`${keyResult.key.value}\``,         inline: true },
                            { name: '⏱️ Days',  value: `${keyResult.actualDays}`,             inline: true },
                        )
                        .setTimestamp()
                    ],
                });
            } catch (_) {}
        }

        return true;
    } catch (err) {
        logger.error('deliverKey error:', err.message);
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════
//  APPROVE BUTTON  (keyapprove_<requestId>)
// ═══════════════════════════════════════════════════════════════
const keyApproveHandler = {
    name: 'keyapprove',
    async execute(interaction, client) {
        try {
            if (interaction.user.id !== APPROVER_ID) {
                return interaction.reply({
                    content: '❌ Only the authorized approver can use this.',
                    flags: MessageFlags.Ephemeral,
                });
            }

            const requestId = interaction.customId.replace('keyapprove_', '');
            const req       = pendingRequests.get(requestId);

            if (!req || req.status !== 'pending') {
                return interaction.update({
                    embeds: [new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('⚠️ Request Expired')
                        .setDescription('This request has already been handled or timed out.')
                        .setTimestamp()
                    ],
                    components: [],
                });
            }

            req.status = 'approved';
            pendingRequests.set(requestId, req);

            // Find key from pool
            const keyResult = await findBestKey(client, req.guildId, req.days);

            if (!keyResult) {
                // No key in pool — deny and refund
                req.status = 'denied';
                await interaction.update({
                    embeds: [new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ No Keys in Pool')
                        .setDescription(`Approved but **no keys available** in the pool.\nRequest cancelled, credit refunded to ${req.userTag}.`)
                        .setTimestamp()
                    ],
                    components: [],
                });

                // Notify user
                const guild   = await client.guilds.fetch(req.guildId).catch(() => null);
                const channel = guild ? await guild.channels.fetch(req.channelId).catch(() => null) : null;
                if (channel?.isSendable()) {
                    await channel.send({
                        content: `<@${req.userId}>`,
                        embeds: [errorEmbed('❌ No Keys Available',
                            'Your request was approved but there are no keys in the pool.\nYour credit has been refunded. Contact the admin to add keys.')],
                    });
                }
                return;
            }

            // Deduct credit
            await deductCredit(client, req.guildId, req.userId);
            const credits = await getCredits(client, req.guildId, req.userId);

            // Update DM
            await interaction.update({
                embeds: [new EmbedBuilder()
                    .setColor(0x2ECC71)
                    .setTitle('✅ Request Approved')
                    .setDescription(`Key delivered to **${req.userTag}**.`)
                    .addFields(
                        { name: '🗝️ Key',   value: `\`${keyResult.key.value}\``,                       inline: true },
                        { name: '⏱️ Days',  value: `${keyResult.actualDays}`,                           inline: true },
                        { name: '📝 Note',  value: req.note,                                            inline: true },
                    )
                    .setTimestamp()
                ],
                components: [],
            });

            // Deliver to channel
            await deliverKey(client, { ...req, credits }, keyResult);

        } catch (err) {
            logger.error('keyApprove error:', err.message);
        }
    },
};

// ═══════════════════════════════════════════════════════════════
//  DENY BUTTON  (keydeny_<requestId>)
// ═══════════════════════════════════════════════════════════════
const keyDenyHandler = {
    name: 'keydeny',
    async execute(interaction, client) {
        try {
            if (interaction.user.id !== APPROVER_ID) {
                return interaction.reply({
                    content: '❌ Only the authorized approver can use this.',
                    flags: MessageFlags.Ephemeral,
                });
            }

            const requestId = interaction.customId.replace('keydeny_', '');
            const req       = pendingRequests.get(requestId);

            if (!req || req.status !== 'pending') {
                return interaction.update({
                    embeds: [new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('⚠️ Request Expired')
                        .setDescription('This request has already been handled or timed out.')
                        .setTimestamp()
                    ],
                    components: [],
                });
            }

            req.status = 'denied';
            pendingRequests.set(requestId, req);

            // Update DM
            await interaction.update({
                embeds: [new EmbedBuilder()
                    .setColor(0xED4245)
                    .setTitle('❌ Request Denied')
                    .setDescription(`Denied key request from **${req.userTag}**.\nCredit has been refunded.`)
                    .setTimestamp()
                ],
                components: [],
            });

            // Notify user in channel
            const guild   = await client.guilds.fetch(req.guildId).catch(() => null);
            const channel = guild ? await guild.channels.fetch(req.channelId).catch(() => null) : null;
            if (channel?.isSendable()) {
                await channel.send({
                    content: `<@${req.userId}>`,
                    embeds: [new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ Key Request Denied')
                        .setDescription('Your key request has been denied by the administrator.\nYour credit has been refunded.')
                        .setTimestamp()
                    ],
                });
            }

        } catch (err) {
            logger.error('keyDeny error:', err.message);
        }
    },
};

// ═══════════════════════════════════════════════════════════════
//  POOL YES BUTTON  (keypool_yes_<requestId>)
// ═══════════════════════════════════════════════════════════════
const keyPoolYesHandler = {
    name: 'keypool_yes',
    async execute(interaction, client) {
        try {
            const requestId = interaction.customId.replace('keypool_yes_', '');
            const req       = pendingRequests.get(requestId);

            // Only the original requester can click
            if (!req || interaction.user.id !== req.userId) {
                return interaction.reply({
                    content: '❌ This button is not for you.',
                    flags: MessageFlags.Ephemeral,
                });
            }

            if (req.status !== 'timeout') {
                return interaction.update({ components: [] });
            }

            // Show days selection modal
            const modal = new ModalBuilder()
                .setCustomId(`keypool_days_${requestId}`)
                .setTitle('🔑 Select Key Duration');

            const daysInput = new TextInputBuilder()
                .setCustomId('days')
                .setLabel('Validity Days (1, 3, 7, or 30)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Enter: 1 / 3 / 7 / 30')
                .setValue(String(req.days))
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(2);

            modal.addComponents(new ActionRowBuilder().addComponents(daysInput));

            // Remove buttons from message first
            await interaction.update({ components: [] });
            await interaction.followUp({
                content: 'Please enter how many days you need:',
                flags: MessageFlags.Ephemeral,
            });

            // We store that user wants pool
            req.wantsPool = true;
            pendingRequests.set(requestId, req);

            // Show modal via followUp since we already updated
            // We'll handle this via the keypool_days modal handler

        } catch (err) {
            logger.error('keyPoolYes error:', err.message);
        }
    },
};

// ═══════════════════════════════════════════════════════════════
//  POOL NO BUTTON  (keypool_no_<requestId>)
// ═══════════════════════════════════════════════════════════════
const keyPoolNoHandler = {
    name: 'keypool_no',
    async execute(interaction, client) {
        try {
            const requestId = interaction.customId.replace('keypool_no_', '');
            const req       = pendingRequests.get(requestId);

            if (!req || interaction.user.id !== req.userId) {
                return interaction.reply({
                    content: '❌ This button is not for you.',
                    flags: MessageFlags.Ephemeral,
                });
            }

            req.status = 'cancelled';
            pendingRequests.set(requestId, req);

            await interaction.update({
                embeds: [new EmbedBuilder()
                    .setColor(0x95A5A6)
                    .setTitle('🚫 Request Cancelled')
                    .setDescription('Your key request has been cancelled. No credits were deducted.')
                    .setTimestamp()
                ],
                components: [],
            });

        } catch (err) {
            logger.error('keyPoolNo error:', err.message);
        }
    },
};

// ═══════════════════════════════════════════════════════════════
//  POOL CONFIRM BUTTON  (keypoolconfirm_<requestId>)
//  Shown when nearest key found (not exact match)
// ═══════════════════════════════════════════════════════════════
const keyPoolConfirmHandler = {
    name: 'keypoolconfirm',
    async execute(interaction, client) {
        try {
            const requestId = interaction.customId.replace('keypoolconfirm_', '');
            const req       = pendingRequests.get(requestId);

            if (!req || interaction.user.id !== req.userId) {
                return interaction.reply({
                    content: '❌ This button is not for you.',
                    flags: MessageFlags.Ephemeral,
                });
            }

            await interaction.update({ components: [] });

            // Check credits
            const credits = await getCredits(client, req.guildId, req.userId);
            if (credits <= 0) {
                return interaction.followUp({
                    embeds: [errorEmbed('❌ No Credits', 'You have no remaining credits.')],
                    flags: MessageFlags.Ephemeral,
                });
            }

            // Find key again (in case pool changed)
            const keyResult = await findBestKey(client, req.guildId, req.poolDays || req.days);

            if (!keyResult) {
                return interaction.followUp({
                    embeds: [errorEmbed('❌ No Keys Available',
                        'There are no available keys in the pool right now.\nContact <@768020734231969793> to add more keys.')],
                    flags: MessageFlags.Ephemeral,
                });
            }

            // Deduct credit
            await deductCredit(client, req.guildId, req.userId);
            req.method = 'pool';

            // Deliver key
            await deliverKey(client, req, keyResult);

            await interaction.followUp({
                embeds: [new EmbedBuilder()
                    .setColor(0x2ECC71)
                    .setTitle('✅ Key Assigned')
                    .setDescription('Your key has been posted in the channel.')
                    .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral,
            });

        } catch (err) {
            logger.error('keyPoolConfirm error:', err.message);
        }
    },
};

export default keyApproveHandler;
export { keyDenyHandler, keyPoolYesHandler, keyPoolNoHandler, keyPoolConfirmHandler };
