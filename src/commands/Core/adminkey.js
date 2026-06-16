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
    DB_KEYS,
    DEFAULT_LIMIT,
    getCredits,
    setCredits,
    getCreditLimit,
    setCreditLimit,
    getAllowedUsers,
    getPool,
    getUsedKeys,
    addToUsed,
} from './getkey.js';

// ── Only master users can use /adminkey ────────────────────────
function isMaster(userId) {
    return MASTER_USERS.includes(userId);
}

export default {
    data: new SlashCommandBuilder()
        .setName('adminkey')
        .setDescription('Admin panel for key pool, credits, and access management')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

        // ── Key management ──────────────────────────────────────
        .addSubcommandGroup(group => group
            .setName('keys')
            .setDescription('Manage the key pool')
            .addSubcommand(sub => sub
                .setName('add')
                .setDescription('Add a key to the pool')
                .addStringOption(opt => opt
                    .setName('key')
                    .setDescription('The key value (any format)')
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
                .setDescription('Show history of used/distributed keys')
            )
            .addSubcommand(sub => sub
                .setName('remove')
                .setDescription('Remove a key from the pool by value')
                .addStringOption(opt => opt
                    .setName('key')
                    .setDescription('The exact key value to remove')
                    .setRequired(true)
                )
            )
            .addSubcommand(sub => sub
                .setName('clear')
                .setDescription('Clear all keys from the pool (cannot be undone!)')
            )
        )

        // ── Credit management ───────────────────────────────────
        .addSubcommandGroup(group => group
            .setName('credits')
            .setDescription('Manage user credits')
            .addSubcommand(sub => sub
                .setName('check')
                .setDescription('Check a user\'s credits and limit')
                .addUserOption(opt => opt
                    .setName('user')
                    .setDescription('The user to check')
                    .setRequired(true)
                )
            )
            .addSubcommand(sub => sub
                .setName('set')
                .setDescription('Set a user\'s current credits')
                .addUserOption(opt => opt
                    .setName('user')
                    .setDescription('The user')
                    .setRequired(true)
                )
                .addIntegerOption(opt => opt
                    .setName('amount')
                    .setDescription('Credit amount (0-999)')
                    .setRequired(true)
                    .setMinValue(0)
                    .setMaxValue(999)
                )
            )
            .addSubcommand(sub => sub
                .setName('add')
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
                    .setMaxValue(999)
                )
            )
            .addSubcommand(sub => sub
                .setName('setlimit')
                .setDescription('Set the maximum credit limit for a user')
                .addUserOption(opt => opt
                    .setName('user')
                    .setDescription('The user')
                    .setRequired(true)
                )
                .addIntegerOption(opt => opt
                    .setName('limit')
                    .setDescription('Max credits this user can have (e.g. 10)')
                    .setRequired(true)
                    .setMinValue(1)
                    .setMaxValue(999)
                )
            )
            .addSubcommand(sub => sub
                .setName('reset')
                .setDescription('Reset a user\'s credits to their limit')
                .addUserOption(opt => opt
                    .setName('user')
                    .setDescription('The user')
                    .setRequired(true)
                )
            )
        )

        // ── Access management ───────────────────────────────────
        .addSubcommandGroup(group => group
            .setName('access')
            .setDescription('Manage who can use /getkey')
            .addSubcommand(sub => sub
                .setName('grant')
                .setDescription('Allow a user to use /getkey')
                .addUserOption(opt => opt
                    .setName('user')
                    .setDescription('The user to grant access')
                    .setRequired(true)
                )
            )
            .addSubcommand(sub => sub
                .setName('revoke')
                .setDescription('Remove a user\'s access to /getkey')
                .addUserOption(opt => opt
                    .setName('user')
                    .setDescription('The user to revoke')
                    .setRequired(true)
                )
            )
            .addSubcommand(sub => sub
                .setName('list')
                .setDescription('List all users who have access to /getkey')
            )
        ),

    async execute(interaction, guildConfig, client) {
        // Only master users can use /adminkey
        if (!isMaster(interaction.user.id)) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('❌ Access Denied', 'Only authorized admins can use this command.')],
                flags: MessageFlags.Ephemeral,
            });
        }

        const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferSuccess) return;

        const group = interaction.options.getSubcommandGroup();
        const sub   = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        try {
            // ════════════════════════════════════════════════════
            //  KEY MANAGEMENT
            // ════════════════════════════════════════════════════
            if (group === 'keys') {

                if (sub === 'add') {
                    const keyValue  = interaction.options.getString('key').trim();
                    const expiryStr = interaction.options.getString('expiry').trim();

                    // Validate date format
                    const expiryDate = new Date(expiryStr);
                    if (isNaN(expiryDate.getTime())) {
                        return interaction.editReply({
                            embeds: [errorEmbed('❌ Invalid Date',
                                'Please use the format **YYYY-MM-DD** (e.g. `2025-08-31`).')],
                        });
                    }

                    if (expiryDate.getTime() <= Date.now()) {
                        return interaction.editReply({
                            embeds: [errorEmbed('❌ Date in the Past',
                                'The expiry date must be in the future.')],
                        });
                    }

                    const pool = await getPool(client, guildId);

                    // Check for duplicate
                    if (pool.some(k => k.value === keyValue)) {
                        return interaction.editReply({
                            embeds: [errorEmbed('❌ Duplicate Key',
                                'This key already exists in the pool.')],
                        });
                    }

                    const newKey = {
                        id:        `key_${Date.now()}`,
                        value:     keyValue,
                        expiry:    expiryDate.toISOString(),
                        addedBy:   interaction.user.id,
                        addedAt:   new Date().toISOString(),
                    };

                    pool.push(newKey);
                    await client.db.set(DB_KEYS.pool(guildId), pool);

                    return interaction.editReply({
                        embeds: [successEmbed('✅ Key Added',
                            `Key added to pool.\n\n**Key:** \`${keyValue}\`\n**Expires:** <t:${Math.floor(expiryDate.getTime() / 1000)}:D>\n**Pool size:** ${pool.length} keys`)],
                    });
                }

                if (sub === 'list') {
                    const pool = await getPool(client, guildId);
                    const now  = Date.now();
                    const valid = pool
                        .filter(k => new Date(k.expiry).getTime() > now)
                        .sort((a, b) => new Date(a.expiry) - new Date(b.expiry));

                    if (valid.length === 0) {
                        return interaction.editReply({
                            embeds: [errorEmbed('📭 Pool Empty', 'No valid keys in the pool.')],
                        });
                    }

                    const lines = valid.map((k, i) => {
                        const ts = Math.floor(new Date(k.expiry).getTime() / 1000);
                        return `**${i + 1}.** \`${k.value}\` — expires <t:${ts}:D>`;
                    });

                    // Split into pages of 10
                    const pages = [];
                    for (let i = 0; i < lines.length; i += 10) {
                        pages.push(lines.slice(i, i + 10).join('\n'));
                    }

                    return interaction.editReply({
                        embeds: [new EmbedBuilder()
                            .setColor(0x3498DB)
                            .setTitle(`🗝️ Key Pool — ${valid.length} Available`)
                            .setDescription(pages[0])
                            .setFooter({ text: pages.length > 1 ? `Showing 1-10 of ${valid.length}` : `${valid.length} total` })
                            .setTimestamp()
                        ],
                    });
                }

                if (sub === 'used') {
                    const used = await getUsedKeys(client, guildId);

                    if (used.length === 0) {
                        return interaction.editReply({
                            embeds: [errorEmbed('📭 No Used Keys', 'No keys have been distributed yet.')],
                        });
                    }

                    const lines = used.slice(0, 10).map((u, i) => {
                        const ts = Math.floor(new Date(u.usedAt).getTime() / 1000);
                        return `**${i + 1}.** \`${u.keyValue}\` → <@${u.assignedTo}> (<t:${ts}:R>)${u.note !== 'None' ? ` — *${u.note}*` : ''}`;
                    });

                    return interaction.editReply({
                        embeds: [new EmbedBuilder()
                            .setColor(0x9B59B6)
                            .setTitle(`📋 Used Keys — ${used.length} Total`)
                            .setDescription(lines.join('\n'))
                            .setFooter({ text: used.length > 10 ? `Showing latest 10 of ${used.length}` : `${used.length} total` })
                            .setTimestamp()
                        ],
                    });
                }

                if (sub === 'remove') {
                    const keyValue = interaction.options.getString('key').trim();
                    const pool     = await getPool(client, guildId);
                    const filtered = pool.filter(k => k.value !== keyValue);

                    if (filtered.length === pool.length) {
                        return interaction.editReply({
                            embeds: [errorEmbed('❌ Not Found', `Key \`${keyValue}\` was not found in the pool.`)],
                        });
                    }

                    await client.db.set(DB_KEYS.pool(guildId), filtered);
                    return interaction.editReply({
                        embeds: [successEmbed('✅ Key Removed',
                            `Removed \`${keyValue}\` from the pool.\nRemaining: **${filtered.length}** keys`)],
                    });
                }

                if (sub === 'clear') {
                    await client.db.set(DB_KEYS.pool(guildId), []);
                    return interaction.editReply({
                        embeds: [successEmbed('✅ Pool Cleared', 'All keys have been removed from the pool.')],
                    });
                }
            }

            // ════════════════════════════════════════════════════
            //  CREDIT MANAGEMENT
            // ════════════════════════════════════════════════════
            if (group === 'credits') {
                const targetUser = interaction.options.getUser('user');

                if (sub === 'check') {
                    const credits = await getCredits(client, guildId, targetUser.id);
                    const limit   = await getCreditLimit(client, guildId, targetUser.id);
                    const lastKey = DB_KEYS.lastUsed(guildId, targetUser.id);
                    const lastUsed = await client.db.get(lastKey);

                    return interaction.editReply({
                        embeds: [new EmbedBuilder()
                            .setColor(0x3498DB)
                            .setTitle('💳 Credit Balance')
                            .addFields(
                                { name: '👤 User',           value: `${targetUser.tag}`, inline: true },
                                { name: '💳 Credits',        value: `${credits} / ${limit}`, inline: true },
                                { name: '📅 Last Used',      value: lastUsed ? `<t:${Math.floor(Number(lastUsed) / 1000)}:R>` : 'Never', inline: true },
                            )
                            .setThumbnail(targetUser.displayAvatarURL())
                            .setTimestamp()
                        ],
                    });
                }

                if (sub === 'set') {
                    const amount = interaction.options.getInteger('amount');
                    await setCredits(client, guildId, targetUser.id, amount);
                    return interaction.editReply({
                        embeds: [successEmbed('✅ Credits Set',
                            `Set **${targetUser.tag}**'s credits to **${amount}**.`)],
                    });
                }

                if (sub === 'add') {
                    const amount  = interaction.options.getInteger('amount');
                    const current = await getCredits(client, guildId, targetUser.id);
                    const limit   = await getCreditLimit(client, guildId, targetUser.id);
                    const newVal  = Math.min(limit, current + amount);
                    await setCredits(client, guildId, targetUser.id, newVal);
                    return interaction.editReply({
                        embeds: [successEmbed('✅ Credits Added',
                            `Added **${amount}** credits to **${targetUser.tag}**.\nNew balance: **${newVal} / ${limit}**`)],
                    });
                }

                if (sub === 'setlimit') {
                    const limit = interaction.options.getInteger('limit');
                    await setCreditLimit(client, guildId, targetUser.id, limit);
                    return interaction.editReply({
                        embeds: [successEmbed('✅ Limit Set',
                            `Set **${targetUser.tag}**'s credit limit to **${limit}**.\nTheir credits will be capped at this number.`)],
                    });
                }

                if (sub === 'reset') {
                    const limit = await getCreditLimit(client, guildId, targetUser.id);
                    await setCredits(client, guildId, targetUser.id, limit);
                    return interaction.editReply({
                        embeds: [successEmbed('✅ Credits Reset',
                            `Reset **${targetUser.tag}**'s credits to their limit (**${limit}**).`)],
                    });
                }
            }

            // ════════════════════════════════════════════════════
            //  ACCESS MANAGEMENT
            // ════════════════════════════════════════════════════
            if (group === 'access') {
                if (sub === 'grant') {
                    const targetUser = interaction.options.getUser('user');
                    if (MASTER_USERS.includes(targetUser.id)) {
                        return interaction.editReply({
                            embeds: [errorEmbed('ℹ️ Already a Master User',
                                `${targetUser.tag} is already a master user with full access.`)],
                        });
                    }

                    const allowed = await getAllowedUsers(client, guildId);
                    if (allowed.includes(targetUser.id)) {
                        return interaction.editReply({
                            embeds: [errorEmbed('ℹ️ Already Has Access',
                                `${targetUser.tag} already has access to /getkey.`)],
                        });
                    }

                    allowed.push(targetUser.id);
                    await client.db.set(DB_KEYS.access(guildId), allowed);

                    return interaction.editReply({
                        embeds: [successEmbed('✅ Access Granted',
                            `**${targetUser.tag}** can now use \`/getkey\`.`)],
                    });
                }

                if (sub === 'revoke') {
                    const targetUser = interaction.options.getUser('user');
                    if (MASTER_USERS.includes(targetUser.id)) {
                        return interaction.editReply({
                            embeds: [errorEmbed('❌ Cannot Revoke',
                                'Cannot revoke access from a master user.')],
                        });
                    }

                    const allowed  = await getAllowedUsers(client, guildId);
                    const filtered = allowed.filter(id => id !== targetUser.id);

                    if (filtered.length === allowed.length) {
                        return interaction.editReply({
                            embeds: [errorEmbed('❌ Not Found',
                                `${targetUser.tag} does not have granted access.`)],
                        });
                    }

                    await client.db.set(DB_KEYS.access(guildId), filtered);
                    return interaction.editReply({
                        embeds: [successEmbed('✅ Access Revoked',
                            `**${targetUser.tag}** can no longer use \`/getkey\`.`)],
                    });
                }

                if (sub === 'list') {
                    const allowed = await getAllowedUsers(client, guildId);

                    const masterLines  = MASTER_USERS.map(id => `👑 <@${id}> (master)`);
                    const grantedLines = allowed.length > 0
                        ? allowed.map(id => `✅ <@${id}>`)
                        : ['*No additional users granted*'];

                    return interaction.editReply({
                        embeds: [new EmbedBuilder()
                            .setColor(0x3498DB)
                            .setTitle('🔐 /getkey Access List')
                            .addFields(
                                { name: '👑 Master Users', value: masterLines.join('\n'), inline: false },
                                { name: '✅ Granted Users', value: grantedLines.join('\n'), inline: false },
                            )
                            .setTimestamp()
                        ],
                    });
                }
            }

        } catch (error) {
            logger.error('adminkey error: ' + error?.message, { stack: error?.stack });
            return interaction.editReply({
                embeds: [errorEmbed('Error', 'Something went wrong. Please try again.')],
            });
        }
    },
};
