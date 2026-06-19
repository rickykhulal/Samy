// src/commands/Core/keypool.js
import {
    SlashCommandBuilder,
    MessageFlags,
    EmbedBuilder,
    PermissionFlagsBits,
} from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import {
    MASTER_USERS,
    DB,
    getPool,
    getUsedKeys,
    addKeyToPool,
} from '../../utils/keySystem.js';

export default {
    data: new SlashCommandBuilder()
        .setName('keypool')
        .setDescription('Manage the pre-made key pool')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub
            .setName('add')
            .setDescription('Add a key to the pool')
            .addStringOption(opt => opt
                .setName('key')
                .setDescription('The key value (any format accepted)')
                .setRequired(true)
            )
            .addStringOption(opt => opt
                .setName('expiry')
                .setDescription('Absolute expiry date (YYYY-MM-DD)')
                .setRequired(true)
            )
        )
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('List all available keys in the pool')
        )
        .addSubcommand(sub => sub
            .setName('used')
            .setDescription('Show history of distributed keys')
        )
        .addSubcommand(sub => sub
            .setName('remove')
            .setDescription('Remove a specific key from the pool')
            .addStringOption(opt => opt
                .setName('key')
                .setDescription('The exact key value to remove')
                .setRequired(true)
            )
        )
        .addSubcommand(sub => sub
            .setName('clear')
            .setDescription('⚠️ Clear ALL keys from the pool')
        )
        .addSubcommand(sub => sub
            .setName('stats')
            .setDescription('Show pool statistics')
        ),

    async execute(interaction, guildConfig, client) {
        if (!MASTER_USERS.includes(interaction.user.id)) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('❌ Access Denied', 'Only master admins can manage the key pool.')],
                flags: MessageFlags.Ephemeral,
            });
        }

        const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferSuccess) return;

        const sub     = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        try {
            // ── Add ────────────────────────────────────────────
            if (sub === 'add') {
                const keyValue  = interaction.options.getString('key').trim();
                const expiryStr = interaction.options.getString('expiry').trim();

                const expiryDate = new Date(expiryStr);
                if (isNaN(expiryDate.getTime())) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Invalid Date',
                            'Use format **YYYY-MM-DD** (e.g. `2025-08-31`).')],
                    });
                }

                if (expiryDate.getTime() <= Date.now()) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Date in the Past', 'Expiry date must be in the future.')],
                    });
                }

                const raw  = await client.db.get(DB.pool(guildId));
                const pool = Array.isArray(raw) ? raw : [];

                if (pool.some(k => k.value === keyValue)) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Duplicate Key', 'This key already exists in the pool.')],
                    });
                }

                const newKey = await addKeyToPool(client, guildId, keyValue, expiryDate, interaction.user.id);
                const updatedPool = await getPool(client, guildId);

                return interaction.editReply({
                    embeds: [successEmbed('✅ Key Added to Pool',
                        `**Key:** \`${keyValue}\`\n**Expires:** <t:${Math.floor(expiryDate.getTime() / 1000)}:D>\n**Pool size:** ${updatedPool.length} valid keys`)],
                });
            }

            // ── List ───────────────────────────────────────────
            if (sub === 'list') {
                const pool = await getPool(client, guildId);

                if (pool.length === 0) {
                    return interaction.editReply({
                        embeds: [errorEmbed('📭 Pool Empty', 'No valid keys in the pool.')],
                    });
                }

                pool.sort((a, b) => new Date(a.expiry) - new Date(b.expiry));

                const lines = pool.map((k, i) => {
                    const ts = Math.floor(new Date(k.expiry).getTime() / 1000);
                    return `**${i + 1}.** \`${k.value}\` — expires <t:${ts}:D>`;
                });

                // Max 15 per embed
                const display = lines.slice(0, 15).join('\n');

                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(0x3498DB)
                        .setTitle(`🗝️ Key Pool — ${pool.length} Available`)
                        .setDescription(display)
                        .setFooter({ text: pool.length > 15 ? `Showing 1-15 of ${pool.length}` : `${pool.length} total` })
                        .setTimestamp()
                    ],
                });
            }

            // ── Used ───────────────────────────────────────────
            if (sub === 'used') {
                const used = await getUsedKeys(client, guildId);

                if (used.length === 0) {
                    return interaction.editReply({
                        embeds: [errorEmbed('📭 No History', 'No keys have been distributed yet.')],
                    });
                }

                const lines = used.slice(0, 10).map((u, i) => {
                    const ts = Math.floor(new Date(u.usedAt).getTime() / 1000);
                    return `**${i + 1}.** \`${u.keyValue}\` → <@${u.assignedTo}> (<t:${ts}:R>) [${u.actualDays}d]${u.note && u.note !== 'None' ? ` *${u.note}*` : ''}`;
                });

                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(0x9B59B6)
                        .setTitle(`📋 Distributed Keys — ${used.length} Total`)
                        .setDescription(lines.join('\n'))
                        .setFooter({ text: used.length > 10 ? `Showing latest 10 of ${used.length}` : `${used.length} total` })
                        .setTimestamp()
                    ],
                });
            }

            // ── Remove ─────────────────────────────────────────
            if (sub === 'remove') {
                const keyValue = interaction.options.getString('key').trim();
                const raw      = await client.db.get(DB.pool(guildId));
                const pool     = Array.isArray(raw) ? raw : [];
                const filtered = pool.filter(k => k.value !== keyValue);

                if (filtered.length === pool.length) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Not Found', `\`${keyValue}\` was not found in the pool.`)],
                    });
                }

                await client.db.set(DB.pool(guildId), filtered);

                return interaction.editReply({
                    embeds: [successEmbed('✅ Key Removed',
                        `Removed \`${keyValue}\` from pool.\nRemaining: **${filtered.length}** keys`)],
                });
            }

            // ── Clear ──────────────────────────────────────────
            if (sub === 'clear') {
                await client.db.set(DB.pool(guildId), []);
                return interaction.editReply({
                    embeds: [successEmbed('✅ Pool Cleared', 'All keys have been removed from the pool.')],
                });
            }

            // ── Stats ──────────────────────────────────────────
            if (sub === 'stats') {
                const pool = await getPool(client, guildId);
                const used = await getUsedKeys(client, guildId);
                const now  = Date.now();

                const expiringSoon = pool.filter(k => {
                    const diff = new Date(k.expiry).getTime() - now;
                    return diff < 7 * 24 * 60 * 60 * 1000; // within 7 days
                }).length;

                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(0x3498DB)
                        .setTitle('📊 Key Pool Statistics')
                        .addFields(
                            { name: '🗝️ Available Keys',  value: `${pool.length}`,      inline: true },
                            { name: '📋 Keys Distributed', value: `${used.length}`,     inline: true },
                            { name: '⚠️ Expiring Soon',   value: `${expiringSoon}`,     inline: true },
                        )
                        .setTimestamp()
                    ],
                });
            }

        } catch (error) {
            logger.error('keypool command error:', error?.message);
            return interaction.editReply({
                embeds: [errorEmbed('Error', 'Something went wrong. Please try again.')],
            });
        }
    },
};
