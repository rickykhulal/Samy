// src/commands/Core/keypool.js
import {
    SlashCommandBuilder,
    MessageFlags,
    EmbedBuilder,
    PermissionFlagsBits,
    AttachmentBuilder,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import {
    ADMIN_IDS,
    getActiveProducts,
    getPool,
    getRawPool,
    getUsedKeys,
    addKeyToPool,
    bulkAddKeys,
    removeKeyFromPool,
    appendLog,
    DB,
} from '../../utils/loms.js';

export default {
    data: new SlashCommandBuilder()
        .setName('keypool')
        .setDescription('Manage the license key inventory pool')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

        .addSubcommand(sub => sub
            .setName('add')
            .setDescription('Add a single key to the inventory')
            .addStringOption(opt => opt
                .setName('product')
                .setDescription('Product ID (e.g. uid_bypass)')
                .setRequired(true)
            )
            .addStringOption(opt => opt
                .setName('key')
                .setDescription('The license key value')
                .setRequired(true)
            )
            .addIntegerOption(opt => opt
                .setName('duration')
                .setDescription('Duration in days (e.g. 30)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(36500)
            )
        )

        .addSubcommand(sub => sub
            .setName('bulkadd')
            .setDescription('Add multiple keys at once (paste newline-separated keys)')
            .addStringOption(opt => opt
                .setName('product')
                .setDescription('Product ID')
                .setRequired(true)
            )
            .addIntegerOption(opt => opt
                .setName('duration')
                .setDescription('Duration in days for ALL keys in this batch')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(36500)
            )
            .addStringOption(opt => opt
                .setName('keys')
                .setDescription('Keys separated by commas or new lines')
                .setRequired(true)
            )
        )

        .addSubcommand(sub => sub
            .setName('inventory')
            .setDescription('View available keys in inventory')
            .addStringOption(opt => opt
                .setName('product')
                .setDescription('Product ID to filter by (leave empty for all)')
                .setRequired(false)
            )
        )

        .addSubcommand(sub => sub
            .setName('used')
            .setDescription('View used/distributed keys history')
            .addStringOption(opt => opt
                .setName('product')
                .setDescription('Product ID to filter by')
                .setRequired(false)
            )
        )

        .addSubcommand(sub => sub
            .setName('remove')
            .setDescription('Remove a key from inventory')
            .addStringOption(opt => opt
                .setName('product')
                .setDescription('Product ID')
                .setRequired(true)
            )
            .addStringOption(opt => opt
                .setName('key')
                .setDescription('The exact key value to remove')
                .setRequired(true)
            )
        )

        .addSubcommand(sub => sub
            .setName('shortage')
            .setDescription('Show products with low key stock')
            .addIntegerOption(opt => opt
                .setName('threshold')
                .setDescription('Alert if keys below this number (default: 5)')
                .setRequired(false)
                .setMinValue(1)
            )
        )

        .addSubcommand(sub => sub
            .setName('stats')
            .setDescription('Show full inventory statistics')
        ),

    async execute(interaction, guildConfig, client) {
        if (!ADMIN_IDS.includes(interaction.user.id)) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('❌ Access Denied', 'Only admins can manage the key pool.')],
                flags: MessageFlags.Ephemeral,
            });
        }

        const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferSuccess) return;

        const sub      = interaction.options.getSubcommand();
        const products = await getActiveProducts(client);

        try {
            // ── ADD ───────────────────────────────────────────
            if (sub === 'add') {
                const productId = interaction.options.getString('product').trim();
                const keyValue  = interaction.options.getString('key').trim();
                const duration  = interaction.options.getInteger('duration');

                const product = products.find(p => p.id === productId);
                if (!product) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Invalid Product',
                            `Product \`${productId}\` not found.\n\n` +
                            `Valid products:\n${products.map(p => `• \`${p.id}\` — ${p.name}`).join('\n')}`)],
                    });
                }

                const result = await addKeyToPool(client, productId, keyValue, duration, interaction.user.id);

                if (!result.success) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Failed', result.error || 'Could not add key.')],
                    });
                }

                const pool = await getPool(client, productId);

                await appendLog(client, DB.auditLog(), {
                    type: 'KEY_ADDED', adminId: interaction.user.id,
                    productId, keyValue, duration, ts: new Date().toISOString(),
                });

                return interaction.editReply({
                    embeds: [successEmbed('✅ Key Added',
                        `Key added to **${product.name}** inventory.\n\n` +
                        `**Key:** \`${keyValue}\`\n` +
                        `**Duration:** ${duration} days\n` +
                        `**Pool Size:** ${pool.length} available keys`)],
                });
            }

            // ── BULK ADD ──────────────────────────────────────
            if (sub === 'bulkadd') {
                const productId = interaction.options.getString('product').trim();
                const duration  = interaction.options.getInteger('duration');
                const keysRaw   = interaction.options.getString('keys');

                const product = products.find(p => p.id === productId);
                if (!product) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Invalid Product',
                            `Valid products:\n${products.map(p => `• \`${p.id}\` — ${p.name}`).join('\n')}`)],
                    });
                }

                // Split by comma or newline
                const keys = keysRaw.split(/[\n,]+/).map(k => k.trim()).filter(Boolean);

                if (keys.length === 0) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ No Keys', 'No valid keys found in input.')],
                    });
                }

                const result = await bulkAddKeys(client, productId, keys, duration, interaction.user.id);
                const pool   = await getPool(client, productId);

                await appendLog(client, DB.auditLog(), {
                    type: 'BULK_KEYS_ADDED', adminId: interaction.user.id,
                    productId, count: result.added, duration, ts: new Date().toISOString(),
                });

                return interaction.editReply({
                    embeds: [successEmbed('✅ Bulk Keys Added',
                        `Added **${result.added}** keys to **${product.name}**.\n` +
                        (result.skipped > 0 ? `⚠️ Skipped **${result.skipped}** duplicate keys.\n` : '') +
                        `\n📦 **Total pool size:** ${pool.length} keys`)],
                });
            }

            // ── INVENTORY ─────────────────────────────────────
            if (sub === 'inventory') {
                const filterProduct = interaction.options.getString('product');

                const targetProducts = filterProduct
                    ? products.filter(p => p.id === filterProduct)
                    : products;

                if (targetProducts.length === 0) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Not Found', 'No products found.')],
                    });
                }

                const fields = [];
                for (const product of targetProducts) {
                    const pool = await getPool(client, product.id);

                    if (pool.length === 0) {
                        fields.push({
                            name:   `📦 ${product.name}`,
                            value:  '❌ No keys available',
                            inline: false,
                        });
                        continue;
                    }

                    const byDuration = {};
                    for (const k of pool) {
                        const d = k.durationDays;
                        byDuration[d] = (byDuration[d] || 0) + 1;
                    }

                    const summary = Object.entries(byDuration)
                        .sort(([a], [b]) => Number(a) - Number(b))
                        .map(([d, count]) => `• ${d} days — **${count}** keys`)
                        .join('\n');

                    fields.push({
                        name:   `📦 ${product.name} — ${pool.length} total`,
                        value:  summary,
                        inline: false,
                    });
                }

                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(0x3498DB)
                        .setTitle('🗝️ Key Inventory')
                        .addFields(fields)
                        .setTimestamp()
                    ],
                });
            }

            // ── USED ──────────────────────────────────────────
            if (sub === 'used') {
                const filterProduct = interaction.options.getString('product');
                const targetProducts = filterProduct
                    ? products.filter(p => p.id === filterProduct)
                    : products;

                const allUsed = [];
                for (const product of targetProducts) {
                    const used = await getUsedKeys(client, product.id);
                    allUsed.push(...used.map(k => ({ ...k, productName: product.name })));
                }

                allUsed.sort((a, b) => new Date(b.usedAt) - new Date(a.usedAt));

                if (allUsed.length === 0) {
                    return interaction.editReply({
                        embeds: [errorEmbed('📭 No History', 'No keys have been distributed yet.')],
                    });
                }

                const lines = allUsed.slice(0, 10).map((k, i) => {
                    const ts = Math.floor(new Date(k.usedAt).getTime() / 1000);
                    return `**${i + 1}.** \`${k.key}\` → <@${k.usedBy}> | ${k.productName} | ${k.durationDays}d | <t:${ts}:R>`;
                });

                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(0x9B59B6)
                        .setTitle(`📋 Used Keys — ${allUsed.length} Total`)
                        .setDescription(lines.join('\n'))
                        .setFooter({ text: allUsed.length > 10 ? `Showing latest 10 of ${allUsed.length}` : `${allUsed.length} total` })
                        .setTimestamp()
                    ],
                });
            }

            // ── REMOVE ────────────────────────────────────────
            if (sub === 'remove') {
                const productId = interaction.options.getString('product').trim();
                const keyValue  = interaction.options.getString('key').trim();

                const removed = await removeKeyFromPool(client, productId, keyValue);

                if (!removed) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Not Found',
                            `Key \`${keyValue}\` not found in **${productId}** pool.`)],
                    });
                }

                const pool = await getPool(client, productId);
                return interaction.editReply({
                    embeds: [successEmbed('✅ Key Removed',
                        `Removed \`${keyValue}\` from inventory.\nRemaining: **${pool.length}** keys`)],
                });
            }

            // ── SHORTAGE ──────────────────────────────────────
            if (sub === 'shortage') {
                const threshold = interaction.options.getInteger('threshold') || 5;
                const fields    = [];

                for (const product of products) {
                    const pool = await getPool(client, product.id);
                    if (pool.length < threshold) {
                        fields.push({
                            name:   `⚠️ ${product.name}`,
                            value:  `Only **${pool.length}** keys remaining (threshold: ${threshold})`,
                            inline: false,
                        });
                    }
                }

                if (fields.length === 0) {
                    return interaction.editReply({
                        embeds: [successEmbed('✅ Stock OK',
                            `All products have **${threshold}+** keys in inventory.`)],
                    });
                }

                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(0xFF8C00)
                        .setTitle('⚠️ Low Stock Alert')
                        .addFields(fields)
                        .setFooter({ text: `Threshold: ${threshold} keys` })
                        .setTimestamp()
                    ],
                });
            }

            // ── STATS ─────────────────────────────────────────
            if (sub === 'stats') {
                const fields = [];
                let totalAvailable = 0, totalUsed = 0;

                for (const product of products) {
                    const pool = await getPool(client, product.id);
                    const used = await getUsedKeys(client, product.id);
                    totalAvailable += pool.length;
                    totalUsed      += used.length;

                    fields.push({
                        name:   `📦 ${product.name}`,
                        value:  `✅ ${pool.length} available | 📋 ${used.length} used`,
                        inline: false,
                    });
                }

                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(0x3498DB)
                        .setTitle('📊 Inventory Statistics')
                        .addFields(
                            { name: '🗝️ Total Available', value: `${totalAvailable}`, inline: true },
                            { name: '📋 Total Distributed', value: `${totalUsed}`,  inline: true },
                            { name: '\u200B', value: '\u200B', inline: true },
                            ...fields,
                        )
                        .setTimestamp()
                    ],
                });
            }

        } catch (err) {
            logger.error('keypool command error:', err.message);
            return interaction.editReply({
                embeds: [errorEmbed('Error', 'Something went wrong.')],
            });
        }
    },
};
