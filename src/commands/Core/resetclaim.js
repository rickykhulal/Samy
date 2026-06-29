// src/commands/Core/resetclaim.js
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { ADMIN_IDS } from '../../utils/loms.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';

export default {
    data: new SlashCommandBuilder()
        .setName('resetclaim')
        .setDescription('[Admin] Reset free bundle claim(s)')
        .addStringOption(opt =>
            opt.setName('type')
                .setDescription('Reset a single user or all members')
                .setRequired(true)
                .addChoices(
                    { name: 'Manual (single user)', value: 'manual' },
                    { name: 'Reset All', value: 'all' },
                )
        )
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('User to reset (required for Manual)')
                .setRequired(false)
        )
        .addBooleanOption(opt =>
            opt.setName('confirm')
                .setDescription('Set to True to confirm resetting ALL members (required for Reset All)')
                .setRequired(false)
        ),

    async execute(interaction, guildConfig, client) {
        // Auth check
        if (!ADMIN_IDS.includes(interaction.user.id)) {
            return interaction.reply({
                embeds: [errorEmbed('❌ Access Denied', 'Admins only.')],
                flags: MessageFlags.Ephemeral,
            });
        }

        const type = interaction.options.getString('type');

        // ── 1. MANUAL (single user) ──────────────────────────────────────
        if (type === 'manual') {
            const target = interaction.options.getUser('user');

            if (!target) {
                return interaction.reply({
                    embeds: [errorEmbed('❌ Missing User', 'Please provide a user when using **Manual** reset.')],
                    flags: MessageFlags.Ephemeral,
                });
            }

            await client.db.set(`loms:member_claim:${target.id}`, false).catch(() => {});

            return interaction.reply({
                embeds: [successEmbed('✅ Reset', `${target.tag}'s claim has been reset. They can use \`/claim\` again.`)],
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── 2. RESET ALL ─────────────────────────────────────────────────
        if (type === 'all') {
            const confirmed = interaction.options.getBoolean('confirm');

            if (!confirmed) {
                return interaction.reply({
                    embeds: [errorEmbed(
                        '⚠️ Confirmation Required',
                        'This will reset **all** members\' claims.\nRe-run the command with `confirm: True` to proceed.'
                    )],
                    flags: MessageFlags.Ephemeral,
                });
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                // Fetch all guild members
                const members = await interaction.guild.members.fetch();

                // Reset every member's claim key
                await Promise.all(
                    members.map(member =>
                        client.db.set(`loms:member_claim:${member.id}`, false).catch(() => {})
                    )
                );

                return interaction.editReply({
                    embeds: [successEmbed(
                        '✅ All Claims Reset',
                        `Successfully reset **${members.size}** member claim(s). Everyone can use \`/claim\` again.`
                    )],
                });

            } catch (err) {
                console.error('[resetclaim] Reset all failed:', err);
                return interaction.editReply({
                    embeds: [errorEmbed('❌ Error', 'Failed to fetch guild members. Please try again.')],
                });
            }
        }
    },
};
