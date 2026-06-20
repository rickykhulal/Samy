// src/commands/Core/requests.js
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
    ADMIN_IDS,
    STATUS,
    getRequest,
    getRequestsByStatus,
    updateRequest,
    deductCredit,
    getCredits,
    statusBadge,
    statusColor,
    appendLog,
    DB,
} from '../../utils/loms.js';

export default {
    data: new SlashCommandBuilder()
        .setName('requests')
        .setDescription('View and manage the license request queue')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub
            .setName('pending')
            .setDescription('Show all pending approval requests')
        )
        .addSubcommand(sub => sub
            .setName('approved')
            .setDescription('Show all approved requests awaiting key assignment')
        )
        .addSubcommand(sub => sub
            .setName('assigned')
            .setDescription('Show all requests with keys already assigned')
        )
        .addSubcommand(sub => sub
            .setName('all')
            .setDescription('Show all requests (any status)')
            .addStringOption(opt => opt
                .setName('status')
                .setDescription('Filter by status')
                .addChoices(
                    { name: 'Pending Approval', value: STATUS.PENDING_APPROVAL },
                    { name: 'Approved',         value: STATUS.APPROVED         },
                    { name: 'Key Assigned',     value: STATUS.KEY_ASSIGNED     },
                    { name: 'Denied',           value: STATUS.DENIED           },
                    { name: 'Expired',          value: STATUS.EXPIRED          },
                )
                .setRequired(false)
            )
        ),

    async execute(interaction, guildConfig, client) {
        if (!ADMIN_IDS.includes(interaction.user.id)) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('❌ Access Denied', 'Only admins can view requests.')],
                flags: MessageFlags.Ephemeral,
            });
        }

        const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferSuccess) return;

        const sub = interaction.options.getSubcommand();

        try {
            let statusFilter = null;

            if (sub === 'pending')  statusFilter = STATUS.PENDING_APPROVAL;
            if (sub === 'approved') statusFilter = STATUS.APPROVED;
            if (sub === 'assigned') statusFilter = STATUS.KEY_ASSIGNED;
            if (sub === 'all')      statusFilter = interaction.options.getString('status') || null;

            const requests = await getRequestsByStatus(client, statusFilter);

            if (requests.length === 0) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(0x95A5A6)
                        .setTitle('📋 No Requests Found')
                        .setDescription(statusFilter
                            ? `No requests with status **${statusBadge(statusFilter)}**.`
                            : 'No requests found.')
                        .setTimestamp()
                    ],
                });
            }

            // Show latest 10
            const display = requests.slice(0, 10);
            const lines   = display.map((r, i) => {
                const ts = Math.floor(new Date(r.createdAt).getTime() / 1000);
                return [
                    `**${i + 1}. \`${r.requestId}\`**`,
                    `👤 <@${r.userId}> | 📦 ${r.productName}`,
                    `🏷️ ${r.licenseName} | ⏱️ ${r.duration}d | ${statusBadge(r.status)}`,
                    `📅 <t:${ts}:R>`,
                ].join('\n');
            });

            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor(statusFilter ? statusColor(statusFilter) : 0x3498DB)
                    .setTitle(`📋 Requests — ${statusFilter ? statusBadge(statusFilter) : 'All'} (${requests.length} total)`)
                    .setDescription(lines.join('\n\n'))
                    .setFooter({ text: requests.length > 10 ? `Showing 10 of ${requests.length}` : `${requests.length} total` })
                    .setTimestamp()
                ],
            });

        } catch (err) {
            logger.error('requests command error:', err.message);
            return interaction.editReply({
                embeds: [errorEmbed('Error', 'Something went wrong.')],
            });
        }
    },
};
