// src/commands/Core/access.js
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
    getActiveProducts,
    getUser,
    getAllUsers,
    grantAccess,
    revokeAccess,
    getCredits,
    addCredits,
    removeCredits,
    updateUserProducts,
    appendLog,
    DB,
} from '../../utils/loms.js';

export default {
    data: new SlashCommandBuilder()
        .setName('access')
        .setDescription('Manage reseller access, credits and product permissions')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

        // ── Grant ──────────────────────────────────────────────
        .addSubcommand(sub => sub
            .setName('grant')
            .setDescription('Grant a user access with credits and product permissions')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('The user to grant access')
                .setRequired(true)
            )
            .addIntegerOption(opt => opt
                .setName('credits')
                .setDescription('Starting credits (e.g. 10, 50)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(9999)
            )
            .addStringOption(opt => opt
                .setName('products')
                .setDescription('Product IDs separated by commas (e.g. uid_bypass,external_exclusive)')
                .setRequired(true)
            )
        )

        // ── Revoke ─────────────────────────────────────────────
        .addSubcommand(sub => sub
            .setName('revoke')
            .setDescription('Completely remove a user\'s access')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('The user to revoke')
                .setRequired(true)
            )
        )

        // ── Add Credits ────────────────────────────────────────
        .addSubcommand(sub => sub
            .setName('addcredits')
            .setDescription('Add credits to a user')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('The user')
                .setRequired(true)
            )
            .addIntegerOption(opt => opt
                .setName('amount')
                .setDescription('Credits to add')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(9999)
            )
            .addStringOption(opt => opt
                .setName('reason')
                .setDescription('Reason for adding credits')
                .setRequired(false)
            )
        )

        // ── Remove Credits ─────────────────────────────────────
        .addSubcommand(sub => sub
            .setName('removecredits')
            .setDescription('Remove credits from a user')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('The user')
                .setRequired(true)
            )
            .addIntegerOption(opt => opt
                .setName('amount')
                .setDescription('Credits to remove')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(9999)
            )
            .addStringOption(opt => opt
                .setName('reason')
                .setDescription('Reason for removing credits')
                .setRequired(false)
            )
        )

        // ── Update Products ────────────────────────────────────
        .addSubcommand(sub => sub
            .setName('products')
            .setDescription('Update which products a user can access')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('The user')
                .setRequired(true)
            )
            .addStringOption(opt => opt
                .setName('products')
                .setDescription('New product list (comma separated, e.g. uid_bypass,external_exclusive)')
                .setRequired(true)
            )
        )

        // ── Check ──────────────────────────────────────────────
        .addSubcommand(sub => sub
            .setName('check')
            .setDescription('Check a user\'s access details')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('The user to check')
                .setRequired(true)
            )
        )

        // ── List ───────────────────────────────────────────────
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('List all users with access')
        ),

    async execute(interaction, guildConfig, client) {
        if (!ADMIN_IDS.includes(interaction.user.id)) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('❌ Access Denied', 'Only admins can manage access.')],
                flags: MessageFlags.Ephemeral,
            });
        }

        const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferSuccess) return;

        const sub = interaction.options.getSubcommand();

        try {
            // ── GRANT ─────────────────────────────────────────
            if (sub === 'grant') {
                const targetUser = interaction.options.getUser('user');
                const credits    = interaction.options.getInteger('credits');
                const productStr = interaction.options.getString('products');
                const productIds = productStr.split(',').map(p => p.trim()).filter(Boolean);

                if (ADMIN_IDS.includes(targetUser.id)) {
                    return interaction.editReply({
                        embeds: [errorEmbed('ℹ️ Already Admin', `${targetUser.tag} is already an admin.`)],
                    });
                }

                // Validate products
                const allProducts = await getActiveProducts(client);
                const validIds    = allProducts.map(p => p.id);
                const invalid     = productIds.filter(id => !validIds.includes(id));

                if (invalid.length > 0) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Invalid Products',
                            `Unknown product IDs: **${invalid.join(', ')}**\n\n` +
                            `Valid products:\n${allProducts.map(p => `• \`${p.id}\` — ${p.name}`).join('\n')}`)],
                    });
                }

                const userData = await grantAccess(client, targetUser.id, credits, productIds);

                // DM user
                try {
                    const user = await client.users.fetch(targetUser.id);
                    await user.send({
                        embeds: [new EmbedBuilder()
                            .setColor(0x2ECC71)
                            .setTitle('✅ Access Granted')
                            .setDescription(`You have been granted access to the license system in **${interaction.guild.name}**.`)
                            .addFields(
                                { name: '💳 Credits',   value: `${userData.credits}`, inline: true },
                                { name: '📦 Products',  value: productIds.map(id => {
                                    const p = allProducts.find(p => p.id === id);
                                    return `• ${p?.name || id}`;
                                }).join('\n'), inline: false },
                            )
                            .setTimestamp()
                        ],
                    });
                } catch (_) {}

                await appendLog(client, DB.auditLog(), {
                    type: 'ACCESS_GRANTED', adminId: interaction.user.id,
                    userId: targetUser.id, credits, productIds,
                    ts: new Date().toISOString(),
                });

                return interaction.editReply({
                    embeds: [successEmbed('✅ Access Granted',
                        `**${targetUser.tag}** has been granted access.\n\n` +
                        `💳 Credits: **${userData.credits}**\n` +
                        `📦 Products: **${productIds.map(id => allProducts.find(p => p.id === id)?.name || id).join(', ')}**`)],
                });
            }

            // ── REVOKE ────────────────────────────────────────
            if (sub === 'revoke') {
                const targetUser = interaction.options.getUser('user');

                if (ADMIN_IDS.includes(targetUser.id)) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Cannot Revoke', 'Cannot revoke admin access.')],
                    });
                }

                const existing = await getUser(client, targetUser.id);
                if (!existing) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Not Found', `${targetUser.tag} does not have access.`)],
                    });
                }

                await revokeAccess(client, targetUser.id);

                // DM user
                try {
                    const user = await client.users.fetch(targetUser.id);
                    await user.send({
                        embeds: [new EmbedBuilder()
                            .setColor(0xED4245)
                            .setTitle('❌ Access Revoked')
                            .setDescription(`Your access to the license system in **${interaction.guild.name}** has been revoked.`)
                            .setTimestamp()
                        ],
                    });
                } catch (_) {}

                await appendLog(client, DB.auditLog(), {
                    type: 'ACCESS_REVOKED', adminId: interaction.user.id,
                    userId: targetUser.id, ts: new Date().toISOString(),
                });

                return interaction.editReply({
                    embeds: [successEmbed('✅ Access Revoked',
                        `**${targetUser.tag}**'s access has been completely removed.`)],
                });
            }

            // ── ADD CREDITS ───────────────────────────────────
            if (sub === 'addcredits') {
                const targetUser = interaction.options.getUser('user');
                const amount     = interaction.options.getInteger('amount');
                const reason     = interaction.options.getString('reason') || 'Admin credit addition';

                const existing = await getUser(client, targetUser.id);
                if (!existing && !ADMIN_IDS.includes(targetUser.id)) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Not Found',
                            `${targetUser.tag} does not have access yet.\nUse \`/access grant\` first.`)],
                    });
                }

                const result = await addCredits(client, targetUser.id, amount, reason, interaction.user.id);

                // DM user
                try {
                    const user = await client.users.fetch(targetUser.id);
                    await user.send({
                        embeds: [new EmbedBuilder()
                            .setColor(0x3498DB)
                            .setTitle('💳 Credits Added')
                            .addFields(
                                { name: '➕ Added',      value: `${amount}`,          inline: true },
                                { name: '💳 New Balance', value: `${result.after}`,   inline: true },
                            )
                            .setTimestamp()
                        ],
                    });
                } catch (_) {}

                return interaction.editReply({
                    embeds: [successEmbed('✅ Credits Added',
                        `Added **${amount}** credits to **${targetUser.tag}**.\n` +
                        `New balance: **${result.after}** credits`)],
                });
            }

            // ── REMOVE CREDITS ────────────────────────────────
            if (sub === 'removecredits') {
                const targetUser = interaction.options.getUser('user');
                const amount     = interaction.options.getInteger('amount');
                const reason     = interaction.options.getString('reason') || 'Admin credit removal';

                const existing = await getUser(client, targetUser.id);
                if (!existing) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Not Found', `${targetUser.tag} does not have access.`)],
                    });
                }

                const result = await removeCredits(client, targetUser.id, amount, reason, interaction.user.id);

                return interaction.editReply({
                    embeds: [successEmbed('✅ Credits Removed',
                        `Removed **${amount}** credits from **${targetUser.tag}**.\n` +
                        `New balance: **${result.after}** credits`)],
                });
            }

            // ── UPDATE PRODUCTS ───────────────────────────────
            if (sub === 'products') {
                const targetUser = interaction.options.getUser('user');
                const productStr = interaction.options.getString('products');
                const productIds = productStr.split(',').map(p => p.trim()).filter(Boolean);

                const allProducts = await getActiveProducts(client);
                const validIds    = allProducts.map(p => p.id);
                const invalid     = productIds.filter(id => !validIds.includes(id));

                if (invalid.length > 0) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Invalid Products',
                            `Unknown product IDs: **${invalid.join(', ')}**\n\n` +
                            `Valid products:\n${allProducts.map(p => `• \`${p.id}\` — ${p.name}`).join('\n')}`)],
                    });
                }

                const success = await updateUserProducts(client, targetUser.id, productIds);
                if (!success) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Not Found', `${targetUser.tag} does not have access.`)],
                    });
                }

                return interaction.editReply({
                    embeds: [successEmbed('✅ Products Updated',
                        `**${targetUser.tag}**'s products updated to:\n` +
                        productIds.map(id => `• ${allProducts.find(p => p.id === id)?.name || id}`).join('\n'))],
                });
            }

            // ── CHECK ─────────────────────────────────────────
            if (sub === 'check') {
                const targetUser = interaction.options.getUser('user');
                const isAdmin    = ADMIN_IDS.includes(targetUser.id);
                const userData   = await getUser(client, targetUser.id);

                if (!userData && !isAdmin) {
                    return interaction.editReply({
                        embeds: [new EmbedBuilder()
                            .setColor(0xED4245)
                            .setTitle('👤 User — No Access')
                            .setDescription(`**${targetUser.tag}** has no access to the license system.`)
                            .setThumbnail(targetUser.displayAvatarURL())
                            .setTimestamp()
                        ],
                    });
                }

                const allProducts = await getActiveProducts(client);
                const credits     = await getCredits(client, targetUser.id);
                const products    = isAdmin ? allProducts.map(p => p.name) :
                    (userData?.products || []).map(id => allProducts.find(p => p.id === id)?.name || id);

                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(isAdmin ? 0xF1C40F : 0x2ECC71)
                        .setTitle(`👤 ${targetUser.tag}`)
                        .setThumbnail(targetUser.displayAvatarURL())
                        .addFields(
                            { name: '🔐 Role',      value: isAdmin ? '👑 Admin' : '✅ Reseller',   inline: true },
                            { name: '💳 Credits',   value: isAdmin ? 'Unlimited' : `${credits}`,   inline: true },
                            { name: '📦 Products',  value: products.length > 0
                                ? products.map(p => `• ${p}`).join('\n')
                                : '*None*',                                                         inline: false },
                            ...(!isAdmin && userData?.grantedAt ? [{
                                name:  '📅 Granted',
                                value: `<t:${Math.floor(new Date(userData.grantedAt).getTime() / 1000)}:R>`,
                                inline: true,
                            }] : []),
                        )
                        .setTimestamp()
                    ],
                });
            }

            // ── LIST ──────────────────────────────────────────
            if (sub === 'list') {
                const userIds    = await getAllUsers(client);
                const allProducts = await getActiveProducts(client);

                if (userIds.length === 0) {
                    return interaction.editReply({
                        embeds: [new EmbedBuilder()
                            .setColor(0x95A5A6)
                            .setTitle('👥 Reseller List')
                            .setDescription('No resellers have been granted access yet.')
                            .setTimestamp()
                        ],
                    });
                }

                const lines = [];
                for (const uid of userIds.slice(0, 15)) {
                    const ud      = await getUser(client, uid);
                    const credits = await getCredits(client, uid);
                    const prods   = (ud?.products || [])
                        .map(id => allProducts.find(p => p.id === id)?.name || id)
                        .join(', ') || 'None';
                    lines.push(`<@${uid}> — 💳 **${credits}** credits | 📦 ${prods}`);
                }

                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(0x3498DB)
                        .setTitle(`👥 Reseller List — ${userIds.length} Users`)
                        .setDescription(lines.join('\n'))
                        .setFooter({ text: userIds.length > 15 ? `Showing 15 of ${userIds.length}` : `${userIds.length} total` })
                        .setTimestamp()
                    ],
                });
            }

        } catch (err) {
            logger.error('access command error:', err.message);
            return interaction.editReply({
                embeds: [errorEmbed('Error', 'Something went wrong.')],
            });
        }
    },
};
