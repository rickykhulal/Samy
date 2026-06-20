// src/commands/Core/request.js
import {
    SlashCommandBuilder,
    MessageFlags,
    EmbedBuilder,
    PermissionFlagsBits,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import {
    ADMIN_IDS, OWNER_ID,
    STATUS,
    getRequest,
    updateRequest,
    deductCredit,
    refundCredit,
    getCredits,
    statusBadge,
    statusColor,
    appendLog,
    DB,
} from '../../utils/loms.js';

export default {
    data: new SlashCommandBuilder()
        .setName('request')
        .setDescription('Manage individual license requests')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub
            .setName('assign')
            .setDescription('Manually assign a key to an approved request')
            .addStringOption(opt => opt
                .setName('request_id')
                .setDescription('The request ID (e.g. REQ-ABC123-XYZ)')
                .setRequired(true)
            )
            .addStringOption(opt => opt
                .setName('key')
                .setDescription('The license key to assign')
                .setRequired(true)
            )
        )
        .addSubcommand(sub => sub
            .setName('deny')
            .setDescription('Deny a pending or approved request')
            .addStringOption(opt => opt
                .setName('request_id')
                .setDescription('The request ID')
                .setRequired(true)
            )
            .addStringOption(opt => opt
                .setName('reason')
                .setDescription('Reason for denial (optional)')
                .setRequired(false)
            )
        )
        .addSubcommand(sub => sub
            .setName('details')
            .setDescription('View full details of a request')
            .addStringOption(opt => opt
                .setName('request_id')
                .setDescription('The request ID')
                .setRequired(true)
            )
        ),

    async execute(interaction, guildConfig, client) {
        if (!ADMIN_IDS.includes(interaction.user.id)) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('❌ Access Denied', 'Only admins can manage requests.')],
                flags: MessageFlags.Ephemeral,
            });
        }

        const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferSuccess) return;

        const sub = interaction.options.getSubcommand();

        try {
            // ── ASSIGN ────────────────────────────────────────
            if (sub === 'assign') {
                const reqId  = interaction.options.getString('request_id').trim().toUpperCase();
                const key    = interaction.options.getString('key').trim();
                const req    = await getRequest(client, reqId);

                if (!req) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Not Found', `Request \`${reqId}\` not found.`)],
                    });
                }

                if (req.status !== STATUS.APPROVED) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Wrong Status',
                            `This request has status **${statusBadge(req.status)}**.\n` +
                            `Only **APPROVED** requests can have keys assigned.\n\n` +
                            `If the request is pending, approve it first via DM buttons.`)],
                    });
                }

                // Update to KEY_ASSIGNED
                await updateRequest(client, reqId, {
                    status:      STATUS.KEY_ASSIGNED,
                    assignedKey: key,
                    assignedBy:  interaction.user.id,
                    assignedAt:  new Date().toISOString(),
                });

                // Confirm to admin
                await interaction.editReply({
                    embeds: [successEmbed('✅ Key Assigned',
                        `Key assigned to request \`${reqId}\`.\nSending delivery DM to user now...`)],
                });

                // Send key to user via DM
                try {
                    const user = await client.users.fetch(req.userId);

                    const keyEmbed = new EmbedBuilder()
                        .setColor(0x2ECC71)
                        .setTitle('🔑 Your License Key is Ready!')
                        .setDescription(
                            `Your custom license request has been fulfilled.\n` +
                            `Please copy your key from below:`
                        )
                        .addFields(
                            { name: '🗝️ License Key',   value: `\`\`\`\n${key}\n\`\`\``,                     inline: false },
                            { name: '📦 Product',        value: req.productName,                               inline: true  },
                            { name: '🏷️ License Name',  value: req.licenseName,                               inline: true  },
                            { name: '⏱️ Duration',       value: `${req.duration} Day${req.duration !== 1 ? 's' : ''}`, inline: true },
                            { name: '🆔 Request ID',     value: `\`${reqId}\``,                               inline: false },
                        )
                        .setFooter({ text: 'Thank you for your purchase • Keep this key safe' })
                        .setTimestamp();

                    await user.send({ embeds: [keyEmbed] });

                    // Also notify in original channel if possible
                    try {
                        const guild   = await client.guilds.fetch(req.guildId).catch(() => null);
                        const channel = guild ? await guild.channels.fetch(req.channelId).catch(() => null) : null;
                        if (channel?.isSendable()) {
                            await channel.send({
                                content: `<@${req.userId}>`,
                                embeds: [new EmbedBuilder()
                                    .setColor(0x2ECC71)
                                    .setTitle('✅ License Key Ready')
                                    .setDescription(
                                        `Your license key for request \`${reqId}\` has been sent to your **DMs**.\n` +
                                        `Check your Direct Messages!`
                                    )
                                    .addFields(
                                        { name: '📦 Product',      value: req.productName, inline: true },
                                        { name: '🏷️ License Name', value: req.licenseName, inline: true },
                                    )
                                    .setTimestamp()
                                ],
                            });
                        }
                    } catch (_) {}

                } catch (dmErr) {
                    logger.warn(`Could not DM user ${req.userId}:`, dmErr.message);
                    // If DM fails, try to post in original channel
                    try {
                        const guild   = await client.guilds.fetch(req.guildId).catch(() => null);
                        const channel = guild ? await guild.channels.fetch(req.channelId).catch(() => null) : null;
                        if (channel?.isSendable()) {
                            await channel.send({
                                content: `<@${req.userId}>`,
                                embeds: [new EmbedBuilder()
                                    .setColor(0x2ECC71)
                                    .setTitle('🔑 Your License Key is Ready!')
                                    .setDescription('*(DM delivery failed — key shown here)*')
                                    .addFields(
                                        { name: '🗝️ License Key',  value: `\`\`\`\n${key}\n\`\`\``, inline: false },
                                        { name: '📦 Product',       value: req.productName,          inline: true  },
                                        { name: '🏷️ License Name', value: req.licenseName,           inline: true  },
                                        { name: '⏱️ Duration',      value: `${req.duration} days`,   inline: true  },
                                    )
                                    .setTimestamp()
                                ],
                            });
                        }
                    } catch (_) {}
                }

                await appendLog(client, DB.auditLog(), {
                    type: 'KEY_ASSIGNED', reqId, adminId: interaction.user.id,
                    userId: req.userId, key, ts: new Date().toISOString(),
                });

                return;
            }

            // ── DENY ──────────────────────────────────────────
            if (sub === 'deny') {
                const reqId  = interaction.options.getString('request_id').trim().toUpperCase();
                const reason = interaction.options.getString('reason') || 'No reason provided';
                const req    = await getRequest(client, reqId);

                if (!req) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Not Found', `Request \`${reqId}\` not found.`)],
                    });
                }

                if (![STATUS.PENDING_APPROVAL, STATUS.APPROVED].includes(req.status)) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Cannot Deny',
                            `Request \`${reqId}\` has status **${statusBadge(req.status)}** and cannot be denied.`)],
                    });
                }

                // Refund credit if it was already approved (credit was deducted at approval)
                if (req.status === STATUS.APPROVED) {
                    await refundCredit(client, req.userId, `Request ${reqId} denied after approval`);
                }

                await updateRequest(client, reqId, {
                    status:     STATUS.DENIED,
                    deniedBy:   interaction.user.id,
                    deniedAt:   new Date().toISOString(),
                    denyReason: reason,
                });

                await interaction.editReply({
                    embeds: [successEmbed('✅ Request Denied',
                        `Request \`${reqId}\` has been denied.\n` +
                        (req.status === STATUS.APPROVED ? '💳 Credit has been refunded.\n' : '') +
                        `**Reason:** ${reason}`)],
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
                                .addFields(
                                    { name: '🆔 Request ID',  value: `\`${reqId}\``, inline: true },
                                    { name: '📦 Product',     value: req.productName, inline: true },
                                    { name: '📝 Reason',      value: reason,          inline: false },
                                    ...(req.status === STATUS.APPROVED
                                        ? [{ name: '💳 Credits', value: 'Refunded', inline: true }]
                                        : []),
                                )
                                .setTimestamp()
                            ],
                        });
                    }
                } catch (_) {}

                return;
            }

            // ── DETAILS ───────────────────────────────────────
            if (sub === 'details') {
                const reqId = interaction.options.getString('request_id').trim().toUpperCase();
                const req   = await getRequest(client, reqId);

                if (!req) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Not Found', `Request \`${reqId}\` not found.`)],
                    });
                }

                const createdTs  = Math.floor(new Date(req.createdAt).getTime() / 1000);
                const updatedTs  = Math.floor(new Date(req.updatedAt).getTime() / 1000);

                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(statusColor(req.status))
                        .setTitle(`📋 Request Details — \`${reqId}\``)
                        .addFields(
                            { name: '📊 Status',       value: statusBadge(req.status),                     inline: true  },
                            { name: '📦 Product',      value: req.productName,                             inline: true  },
                            { name: '\u200B',           value: '\u200B',                                   inline: true  },
                            { name: '👤 Requester',    value: `<@${req.userId}> (${req.userTag})`,         inline: true  },
                            { name: '🏷️ License Name', value: req.licenseName,                             inline: true  },
                            { name: '⏱️ Duration',     value: `${req.duration} days`,                      inline: true  },
                            { name: '💳 Credits (req)', value: `${req.creditsAtReq}`,                     inline: true  },
                            { name: '📅 Created',      value: `<t:${createdTs}:F>`,                        inline: true  },
                            { name: '🔄 Updated',      value: `<t:${updatedTs}:R>`,                        inline: true  },
                            ...(req.approvedBy ? [{ name: '✅ Approved By', value: `<@${req.approvedBy}>`, inline: true }] : []),
                            ...(req.deniedBy   ? [{ name: '❌ Denied By',   value: `<@${req.deniedBy}>`,   inline: true }] : []),
                            ...(req.denyReason ? [{ name: '📝 Deny Reason', value: req.denyReason,        inline: false }] : []),
                            ...(req.assignedKey ? [{ name: '🗝️ Assigned Key', value: `\`${req.assignedKey}\``, inline: false }] : []),
                            ...(req.assignedBy  ? [{ name: '🔑 Assigned By', value: `<@${req.assignedBy}>`, inline: true }] : []),
                        )
                        .setTimestamp()
                    ],
                });
            }

        } catch (err) {
            logger.error('request command error:', err.message);
            return interaction.editReply({
                embeds: [errorEmbed('Error', 'Something went wrong.')],
            });
        }
    },
};
