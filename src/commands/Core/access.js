// src/commands/Core/access.js
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
    getAccessList,
    grantAccess,
    revokeAccess,
    getCredits,
    addCredits,
} from '../../utils/keySystem.js';

export default {
    data: new SlashCommandBuilder()
        .setName('access')
        .setDescription('Manage user access to key generation commands')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub
            .setName('grant')
            .setDescription('Give a user access to /createkey and /getkey with credits')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('The user to grant access')
                .setRequired(true)
            )
            .addIntegerOption(opt => opt
                .setName('credits')
                .setDescription('How many credits to give them (e.g. 10)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(999)
            )
        )
        .addSubcommand(sub => sub
            .setName('revoke')
            .setDescription('Remove a user\'s access completely')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('The user to revoke')
                .setRequired(true)
            )
        )
        .addSubcommand(sub => sub
            .setName('addcredits')
            .setDescription('Add more credits to an existing user')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('The user to add credits to')
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
            .setName('setcredits')
            .setDescription('Set a user\'s credits to a specific number')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('The user')
                .setRequired(true)
            )
            .addIntegerOption(opt => opt
                .setName('amount')
                .setDescription('New credit amount')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(999)
            )
        )
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('List all users who have access')
        )
        .addSubcommand(sub => sub
            .setName('check')
            .setDescription('Check a user\'s access and credits')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('The user to check')
                .setRequired(true)
            )
        ),

    async execute(interaction, guildConfig, client) {
        // Only master users can manage access
        if (!MASTER_USERS.includes(interaction.user.id)) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('❌ Access Denied', 'Only master admins can manage access.')],
                flags: MessageFlags.Ephemeral,
            });
        }

        const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferSuccess) return;

        const sub     = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        try {
            // ── Grant ──────────────────────────────────────────
            if (sub === 'grant') {
                const targetUser = interaction.options.getUser('user');
                const credits    = interaction.options.getInteger('credits');

                if (MASTER_USERS.includes(targetUser.id)) {
                    return interaction.editReply({
                        embeds: [errorEmbed('ℹ️ Already Master', `${targetUser.tag} is already a master user.`)],
                    });
                }

                await grantAccess(client, guildId, targetUser.id, credits);

                // DM the user about their access
                try {
                    const user = await client.users.fetch(targetUser.id);
                    await user.send({
                        embeds: [new EmbedBuilder()
                            .setColor(0x2ECC71)
                            .setTitle('✅ Access Granted')
                            .setDescription(`You have been granted access to use key generation commands in **${interaction.guild.name}**.`)
                            .addFields(
                                { name: '💳 Credits', value: `${credits}`, inline: true },
                            )
                            .setTimestamp()
                        ],
                    });
                } catch (_) {}

                return interaction.editReply({
                    embeds: [successEmbed('✅ Access Granted',
                        `**${targetUser.tag}** can now use \`/createkey\` and \`/getkey\`.\n💳 Credits assigned: **${credits}**`)],
                });
            }

            // ── Revoke ─────────────────────────────────────────
            if (sub === 'revoke') {
                const targetUser = interaction.options.getUser('user');

                if (MASTER_USERS.includes(targetUser.id)) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Cannot Revoke', 'Cannot revoke master user access.')],
                    });
                }

                const removed = await revokeAccess(client, guildId, targetUser.id);

                if (!removed) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Not Found', `${targetUser.tag} does not have granted access.`)],
                    });
                }

                // DM user about revocation
                try {
                    const user = await client.users.fetch(targetUser.id);
                    await user.send({
                        embeds: [new EmbedBuilder()
                            .setColor(0xED4245)
                            .setTitle('❌ Access Revoked')
                            .setDescription(`Your access to key generation commands in **${interaction.guild.name}** has been revoked.`)
                            .setTimestamp()
                        ],
                    });
                } catch (_) {}

                return interaction.editReply({
                    embeds: [successEmbed('✅ Access Revoked',
                        `**${targetUser.tag}**'s access has been removed.`)],
                });
            }

            // ── Add Credits ────────────────────────────────────
            if (sub === 'addcredits') {
                const targetUser = interaction.options.getUser('user');
                const amount     = interaction.options.getInteger('amount');

                const success = await addCredits(client, guildId, targetUser.id, amount);

                if (!success) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Not Found',
                            `${targetUser.tag} does not have access yet. Use \`/access grant\` first.`)],
                    });
                }

                const newCredits = await getCredits(client, guildId, targetUser.id);

                // DM user
                try {
                    const user = await client.users.fetch(targetUser.id);
                    await user.send({
                        embeds: [new EmbedBuilder()
                            .setColor(0x3498DB)
                            .setTitle('💳 Credits Added')
                            .setDescription(`**${amount}** credits have been added to your account in **${interaction.guild.name}**.`)
                            .addFields({ name: '💳 New Balance', value: `${newCredits}`, inline: true })
                            .setTimestamp()
                        ],
                    });
                } catch (_) {}

                return interaction.editReply({
                    embeds: [successEmbed('✅ Credits Added',
                        `Added **${amount}** credits to **${targetUser.tag}**.\nNew balance: **${newCredits}**`)],
                });
            }

            // ── Set Credits ────────────────────────────────────
            if (sub === 'setcredits') {
                const targetUser = interaction.options.getUser('user');
                const amount     = interaction.options.getInteger('amount');

                const list = await getAccessList(client, guildId);
                const idx  = list.findIndex(u => u.userId === targetUser.id);

                if (idx < 0) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Not Found',
                            `${targetUser.tag} does not have access yet. Use \`/access grant\` first.`)],
                    });
                }

                list[idx].credits   = amount;
                list[idx].updatedAt = new Date().toISOString();
                await client.db.set(`keysys:access:${guildId}`, list);

                return interaction.editReply({
                    embeds: [successEmbed('✅ Credits Set',
                        `Set **${targetUser.tag}**'s credits to **${amount}**.`)],
                });
            }

            // ── List ───────────────────────────────────────────
            if (sub === 'list') {
                const list = await getAccessList(client, guildId);

                const masterLines = MASTER_USERS.map(id => `👑 <@${id}> — Master (unlimited)`);

                const userLines = list.length > 0
                    ? list.map(u => `✅ <@${u.userId}> — **${u.credits}** credits`)
                    : ['*No users granted access yet*'];

                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(0x3498DB)
                        .setTitle('🔐 Access List')
                        .addFields(
                            { name: '👑 Master Users',  value: masterLines.join('\n'), inline: false },
                            { name: '✅ Granted Users', value: userLines.join('\n'),   inline: false },
                        )
                        .setFooter({ text: `${list.length} user(s) with granted access` })
                        .setTimestamp()
                    ],
                });
            }

            // ── Check ──────────────────────────────────────────
            if (sub === 'check') {
                const targetUser = interaction.options.getUser('user');
                const isMaster   = MASTER_USERS.includes(targetUser.id);
                const credits    = await getCredits(client, guildId, targetUser.id);

                const list = await getAccessList(client, guildId);
                const entry = list.find(u => u.userId === targetUser.id);

                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(isMaster ? 0xF1C40F : (entry ? 0x2ECC71 : 0xED4245))
                        .setTitle('👤 User Access Info')
                        .setThumbnail(targetUser.displayAvatarURL())
                        .addFields(
                            { name: '👤 User',      value: targetUser.tag,                                       inline: true  },
                            { name: '🔐 Access',    value: isMaster ? '👑 Master' : (entry ? '✅ Granted' : '❌ None'), inline: true },
                            { name: '💳 Credits',   value: isMaster ? 'Unlimited' : `${credits}`,               inline: true  },
                            ...(entry ? [{ name: '📅 Granted', value: `<t:${Math.floor(new Date(entry.grantedAt).getTime() / 1000)}:R>`, inline: true }] : []),
                        )
                        .setTimestamp()
                    ],
                });
            }

        } catch (error) {
            logger.error('access command error:', error?.message);
            return interaction.editReply({
                embeds: [errorEmbed('Error', 'Something went wrong. Please try again.')],
            });
        }
    },
};
