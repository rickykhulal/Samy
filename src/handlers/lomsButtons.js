// src/handlers/lomsButtons.js
// Handles: approve, deny, get instant key, cancel buttons

import {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { errorEmbed } from '../utils/embeds.js';
import {
    ADMIN_IDS, OWNER_ID, MOD_ID,
    pendingApprovals,
    STATUS,
    getActiveProducts,
    getCredits,
    hasProductAccess,
    deductCredit,
    refundCredit,
    getRequest,
    updateRequest,
    findBestKey,
    consumeKey,
    appendLog,
    DB,
    statusColor,
    statusBadge,
} from '../utils/loms.js';

// ─────────────────────────────────────────────────────────────
//  APPROVE  (loms_approve_<reqId>)
// ─────────────────────────────────────────────────────────────
const lomsApproveHandler = {
    name: 'loms_approve',
    async execute(interaction, client) {
        try {
            if (!ADMIN_IDS.includes(interaction.user.id)) {
                return interaction.reply({ content: '❌ Unauthorized.', flags: MessageFlags.Ephemeral });
            }

            const reqId = interaction.customId.replace('loms_approve_', '');
            const req   = await getRequest(client, reqId);

            if (!req) {
                return interaction.update({
                    embeds: [errorEmbed('❌ Not Found', 'Request not found.')],
                    components: [],
                });
            }

            if (req.status !== STATUS.PENDING_APPROVAL) {
                return interaction.update({
                    embeds: [new EmbedBuilder()
                        .setColor(0x95A5A6)
                        .setTitle('⚠️ Already Handled')
                        .setDescription(`This request is already: **${statusBadge(req.status)}**`)
                        .setTimestamp()
                    ],
                    components: [],
                });
            }

            // Deduct credit
            await deductCredit(client, req.userId, `Request ${reqId} approved`);
            const remaining = await getCredits(client, req.userId);

            // Update request status
            await updateRequest(client, reqId, {
                status:     STATUS.APPROVED,
                approvedBy: interaction.user.id,
                approvedAt: new Date().toISOString(),
            });

            // Remove from pending
            pendingApprovals.delete(reqId);

            // Update DM
            await interaction.update({
                embeds: [new EmbedBuilder()
                    .setColor(0x2ECC71)
                    .setTitle('✅ Request Approved')
                    .setDescription(`You approved request \`${reqId}\` from **${req.userTag}**.`)
                    .addFields(
                        { name: '📦 Product',      value: req.productName,  inline: true },
                        { name: '🏷️ License Name', value: req.licenseName, inline: true },
                        { name: '⏱️ Duration',     value: `${req.duration} days`, inline: true },
                        { name: '💳 Credits Left', value: `${remaining}`,  inline: true },
                    )
                    .setFooter({ text: 'Use /request assign to deliver the key when ready.' })
                    .setTimestamp()
                ],
                components: [],
            });

            // Notify user
            try {
                const guild   = await client.guilds.fetch(req.guildId).catch(() => null);
                const channel = guild ? await guild.channels.fetch(req.channelId).catch(() => null) : null;

                if (channel?.isSendable()) {
                    await channel.send({
                        content: `<@${req.userId}>`,
                        embeds: [new EmbedBuilder()
                            .setColor(0x2ECC71)
                            .setTitle('✅ License Request Approved')
                            .setDescription(
                                `Your custom license request has been **approved** and is currently being processed.\n\n` +
                                `You will receive your license key shortly via DM once it is assigned.`
                            )
                            .addFields(
                                { name: '🆔 Request ID',   value: `\`${reqId}\``,     inline: true },
                                { name: '📦 Product',      value: req.productName,     inline: true },
                                { name: '🏷️ License Name', value: req.licenseName,    inline: true },
                                { name: '⏱️ Duration',     value: `${req.duration} days`, inline: true },
                                { name: '📊 Status',       value: '⏳ Awaiting Key Assignment', inline: true },
                            )
                            .setFooter({ text: 'Keep this message for your records.' })
                            .setTimestamp()
                        ],
                    });
                }
            } catch (err) {
                logger.warn('Could not notify user of approval:', err.message);
            }

            await appendLog(client, DB.auditLog(), {
                type: 'REQUEST_APPROVED', reqId, adminId: interaction.user.id,
                userId: req.userId, ts: new Date().toISOString(),
            });

        } catch (err) {
            logger.error('lomsApprove error:', err.message);
        }
    },
};

// ─────────────────────────────────────────────────────────────
//  DENY  (loms_deny_<reqId>)
// ─────────────────────────────────────────────────────────────
const lomsDenyHandler = {
    name: 'loms_deny',
    async execute(interaction, client) {
        try {
            if (!ADMIN_IDS.includes(interaction.user.id)) {
                return interaction.reply({ content: '❌ Unauthorized.', flags: MessageFlags.Ephemeral });
            }

            const reqId = interaction.customId.replace('loms_deny_', '');
            const req   = await getRequest(client, reqId);

            if (!req || req.status !== STATUS.PENDING_APPROVAL) {
                return interaction.update({
                    embeds: [new EmbedBuilder()
                        .setColor(0x95A5A6)
                        .setTitle('⚠️ Already Handled')
                        .setDescription('This request has already been handled.')
                        .setTimestamp()
                    ],
                    components: [],
                });
            }

            // No credit deduction on deny
            await updateRequest(client, reqId, {
                status:   STATUS.DENIED,
                deniedBy: interaction.user.id,
                deniedAt: new Date().toISOString(),
            });

            pendingApprovals.delete(reqId);

            await interaction.update({
                embeds: [new EmbedBuilder()
                    .setColor(0xED4245)
                    .setTitle('❌ Request Denied')
                    .setDescription(`Denied request \`${reqId}\` from **${req.userTag}**.\nNo credits were deducted.`)
                    .setTimestamp()
                ],
                components: [],
            });

            // Notify user
            try {
                const guild   = await client.guilds.fetch(req.guildId).catch(() => null);
                const channel = guild ? await guild.channels.fetch(req.channelId).catch(() => null) : null;

                if (channel?.isSendable()) {
                    await channel.send({
                        content: `<@${req.userId}>`,
                        embeds: [new EmbedBuilder()
                            .setColor(0xED4245)
                            .setTitle('❌ License Request Denied')
                            .setDescription('Your license request has been denied by the administrator.\nNo credits were deducted.')
                            .addFields(
                                { name: '🆔 Request ID', value: `\`${reqId}\``, inline: true },
                                { name: '📦 Product',    value: req.productName, inline: true },
                            )
                            .setTimestamp()
                        ],
                    });
                }
            } catch (err) {
                logger.warn('Could not notify user of denial:', err.message);
            }

            await appendLog(client, DB.auditLog(), {
                type: 'REQUEST_DENIED', reqId, adminId: interaction.user.id,
                userId: req.userId, ts: new Date().toISOString(),
            });

        } catch (err) {
            logger.error('lomsDeny error:', err.message);
        }
    },
};

// ─────────────────────────────────────────────────────────────
//  GET INSTANT KEY  (loms_getinstant_<productId>_<reqId>)
// ─────────────────────────────────────────────────────────────
const lomsGetInstantHandler = {
    name: 'loms_getinstant',
    async execute(interaction, client) {
        try {
            const parts     = interaction.customId.replace('loms_getinstant_', '').split('_');
            const reqId     = parts[parts.length - 1];
            const productId = parts.slice(0, -1).join('_');

            // Only original requester
            const req = await getRequest(client, reqId);
            if (!req || interaction.user.id !== req.userId) {
                return interaction.reply({ content: '❌ This button is not for you.', flags: MessageFlags.Ephemeral });
            }

            // Ask for desired days
            await interaction.update({
                embeds: [new EmbedBuilder()
                    .setColor(0x3498DB)
                    .setTitle('⚡ Instant Key — Select Duration')
                    .setDescription('How many days do you need the key for?')
                    .setTimestamp()
                ],
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`loms_instant_1_${productId}_${reqId}`).setLabel('1 Day').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId(`loms_instant_3_${productId}_${reqId}`).setLabel('3 Days').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId(`loms_instant_7_${productId}_${reqId}`).setLabel('7 Days').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId(`loms_instant_30_${productId}_${reqId}`).setLabel('30 Days').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId(`loms_instant_90_${productId}_${reqId}`).setLabel('90 Days').setStyle(ButtonStyle.Primary),
                    ),
                ],
            });

        } catch (err) {
            logger.error('lomsGetInstant error:', err.message);
        }
    },
};

// ─────────────────────────────────────────────────────────────
//  INSTANT DAY SELECTION  (loms_instant_<days>_<productId>_<reqId>)
// ─────────────────────────────────────────────────────────────
const lomsInstantDaysHandler = {
    name: 'loms_instant',
    async execute(interaction, client) {
        try {
            const parts     = interaction.customId.replace('loms_instant_', '').split('_');
            const days      = parseInt(parts[0], 10);
            const reqId     = parts[parts.length - 1];
            const productId = parts.slice(1, -1).join('_');

            const req = await getRequest(client, reqId);
            if (!req || interaction.user.id !== req.userId) {
                return interaction.reply({ content: '❌ Not authorized.', flags: MessageFlags.Ephemeral });
            }

            // Check credits
            const credits = await getCredits(client, interaction.user.id);
            if (credits <= 0) {
                return interaction.update({
                    embeds: [errorEmbed('❌ No Credits', 'You have no remaining credits.')],
                    components: [],
                });
            }

            // Find best key
            const result = await findBestKey(client, productId, days);

            if (!result) {
                return interaction.update({
                    embeds: [new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ No Keys Available')
                        .setDescription(
                            `No keys available for **${req.productName}** right now.\n` +
                            `Contact <@${OWNER_ID}> to add more keys to the inventory.`
                        )
                        .setTimestamp()
                    ],
                    components: [],
                });
            }

            // Exact match — deliver immediately
            if (result.exact) {
                return deliverInstantKey(interaction, client, req, result.key, days, productId, reqId);
            }

            // Nearest match — offer choices
            const nearestButtons = result.nearest.map(k =>
                new ButtonBuilder()
                    .setCustomId(`loms_instantconfirm_${k.id}_${productId}_${reqId}`)
                    .setLabel(`${k.durationDays} Days`)
                    .setStyle(ButtonStyle.Primary)
            );

            nearestButtons.push(
                new ButtonBuilder()
                    .setCustomId(`loms_cancel_${reqId}`)
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary)
            );

            await interaction.update({
                embeds: [new EmbedBuilder()
                    .setColor(0xFF8C00)
                    .setTitle('⚠️ Exact Duration Not Available')
                    .setDescription(
                        `No **${days}-day** key available for **${req.productName}**.\n\n` +
                        `Here are the nearest available options:`
                    )
                    .addFields(
                        result.nearest.map(k => ({
                            name:   `${k.durationDays} Days`,
                            value:  '1 Credit',
                            inline: true,
                        }))
                    )
                    .setTimestamp()
                ],
                components: [new ActionRowBuilder().addComponents(...nearestButtons)],
            });

        } catch (err) {
            logger.error('lomsInstantDays error:', err.message);
        }
    },
};

// ─────────────────────────────────────────────────────────────
//  INSTANT CONFIRM (nearest match)  (loms_instantconfirm_<keyId>_<productId>_<reqId>)
// ─────────────────────────────────────────────────────────────
const lomsInstantConfirmHandler = {
    name: 'loms_instantconfirm',
    async execute(interaction, client) {
        try {
            const parts     = interaction.customId.replace('loms_instantconfirm_', '').split('_');
            const reqId     = parts[parts.length - 1];
            const productId = parts.slice(1, -1).join('_');
            const keyId     = parts[0];

            const req = await getRequest(client, reqId);
            if (!req || interaction.user.id !== req.userId) {
                return interaction.reply({ content: '❌ Not authorized.', flags: MessageFlags.Ephemeral });
            }

            // Find key by ID
            const pool = await (await import('../utils/loms.js')).getPool(client, productId);
            const key  = pool.find(k => k.id === keyId);

            if (!key) {
                return interaction.update({
                    embeds: [errorEmbed('❌ Key No Longer Available', 'This key was just taken. Please try again.')],
                    components: [],
                });
            }

            await deliverInstantKey(interaction, client, req, key, key.durationDays, productId, reqId);

        } catch (err) {
            logger.error('lomsInstantConfirm error:', err.message);
        }
    },
};

// ─────────────────────────────────────────────────────────────
//  CANCEL  (loms_cancel_<reqId>)
// ─────────────────────────────────────────────────────────────
const lomsCancelHandler = {
    name: 'loms_cancel',
    async execute(interaction, client) {
        try {
            const reqId = interaction.customId.replace('loms_cancel_', '');
            const req   = await getRequest(client, reqId);

            if (req && interaction.user.id !== req.userId) {
                return interaction.reply({ content: '❌ Not authorized.', flags: MessageFlags.Ephemeral });
            }

            await interaction.update({
                embeds: [new EmbedBuilder()
                    .setColor(0x95A5A6)
                    .setTitle('🚫 Cancelled')
                    .setDescription('Your request has been cancelled. No credits were deducted.')
                    .setTimestamp()
                ],
                components: [],
            });

            if (req) {
                await updateRequest(client, reqId, { status: STATUS.CANCELLED });
            }

        } catch (err) {
            logger.error('lomsCancel error:', err.message);
        }
    },
};

// ─────────────────────────────────────────────────────────────
//  HELPER: Deliver instant key
// ─────────────────────────────────────────────────────────────
async function deliverInstantKey(interaction, client, req, key, days, productId, reqId) {
    // Deduct credit
    await deductCredit(client, req.userId, `Instant key delivery ${reqId}`);
    const remaining = await getCredits(client, req.userId);

    // Consume key from pool
    await consumeKey(client, productId, key.id, req.userId, reqId);

    // Update request
    await updateRequest(client, reqId, {
        status:      STATUS.KEY_ASSIGNED,
        assignedKey: key.key,
        assignedBy:  'AUTO_INSTANT',
        assignedAt:  new Date().toISOString(),
    });

    // Update message
    await interaction.update({
        embeds: [new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('✅ Key Delivered')
            .setDescription('Your key has been sent to you via DM.\nCheck your Direct Messages.')
            .setTimestamp()
        ],
        components: [],
    });

    // Send key via DM (or ephemeral if DM disabled)
    const keyEmbed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('🔑 License Key Delivered')
        .setDescription('Your instant pre-made key has been assigned.')
        .addFields(
            { name: '🗝️ License Key',   value: `\`\`\`\n${key.key}\n\`\`\``,              inline: false },
            { name: '📦 Product',        value: req.productName,                           inline: true  },
            { name: '⏱️ Duration',       value: `${days} Day${days !== 1 ? 's' : ''}`,     inline: true  },
            { name: '💳 Credits Left',   value: `${remaining}`,                            inline: true  },
            { name: '🆔 Request ID',     value: `\`${reqId}\``,                            inline: false },
        )
        .setFooter({ text: `Delivered to ${req.userTag} • Automated System` })
        .setTimestamp();

    try {
        const user = await client.users.fetch(req.userId);
        await user.send({ embeds: [keyEmbed] });
    } catch (_) {
        // DM failed — send ephemeral in channel
        try {
            await interaction.followUp({ embeds: [keyEmbed], flags: MessageFlags.Ephemeral });
        } catch (_) {}
    }

    // Notify admins
    for (const adminId of ADMIN_IDS) {
        try {
            const admin = await client.users.fetch(adminId);
            await admin.send({
                embeds: [new EmbedBuilder()
                    .setColor(0x3498DB)
                    .setTitle('📋 Instant Key Delivered')
                    .addFields(
                        { name: '👤 User',     value: `${req.userTag} (<@${req.userId}>)`, inline: true },
                        { name: '📦 Product',  value: req.productName,                     inline: true },
                        { name: '🗝️ Key',     value: `\`${key.key}\``,                    inline: true },
                        { name: '⏱️ Duration', value: `${days} days`,                      inline: true },
                        { name: '🆔 Req ID',   value: `\`${reqId}\``,                      inline: true },
                    )
                    .setTimestamp()
                ],
            });
        } catch (_) {}
    }

    await appendLog(client, DB.keyLog(), {
        type: 'INSTANT_KEY_DELIVERED', reqId, userId: req.userId,
        productId, keyId: key.id, days, ts: new Date().toISOString(),
    });
}

export default lomsApproveHandler;
export {
    lomsDenyHandler,
    lomsGetInstantHandler,
    lomsInstantDaysHandler,
    lomsInstantConfirmHandler,
    lomsCancelHandler,
};
