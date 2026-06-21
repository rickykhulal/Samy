// src/commands/Core/resetclaim.js
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { ADMIN_IDS } from '../../utils/loms.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';


export default {
    data: new SlashCommandBuilder()
        .setName('resetclaim')
        .setDescription('[Admin] Reset a member\'s free bundle claim so they can use /claim again')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('User to reset')
                .setRequired(true)
        ),

    async execute(interaction, guildConfig, client) {
        if (!ADMIN_IDS.includes(interaction.user.id)) {
            return interaction.reply({
                embeds: [errorEmbed('❌ Access Denied', 'Admins only.')],
                flags: MessageFlags.Ephemeral,
            });
        }

        const target = interaction.options.getUser('user');
        await client.db.set(`loms:member_claim:${target.id}`, false).catch(() => {});

        await interaction.reply({
            embeds: [successEmbed('✅ Reset', `${target.tag}'s claim has been reset. They can use \`/claim\` again.`)],
            flags: MessageFlags.Ephemeral,
        });
    },
};
