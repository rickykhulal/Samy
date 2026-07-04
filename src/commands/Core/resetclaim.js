// src/commands/Core/resetclaim.js
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { ADMIN_IDS } from '../../utils/loms.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';

const PRODUCT_CHOICES = [
    { name: 'UID Bypass', value: 'uid_bypass' },
    { name: 'External Panel', value: 'external_exclusive' },
];

function claimKey(userId, productId) {
    return `loms:member_claim:${userId}:${productId}`;
}

export default {
    data: new SlashCommandBuilder()
        .setName('resetclaim')
        .setDescription('[Admin] Reset a member\'s free claim so they can use /claim again')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('User to reset')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('product')
                .setDescription('Which product to reset (leave blank to reset both)')
                .setRequired(false)
                .addChoices(...PRODUCT_CHOICES)
        ),

    async execute(interaction, guildConfig, client) {
        if (!ADMIN_IDS.includes(interaction.user.id)) {
            return interaction.reply({
                embeds: [errorEmbed('❌ Access Denied', 'Admins only.')],
                flags: MessageFlags.Ephemeral,
            });
        }

        const target = interaction.options.getUser('user');
        const productChoice = interaction.options.getString('product');

        const productsToReset = productChoice
            ? PRODUCT_CHOICES.filter(p => p.value === productChoice)
            : PRODUCT_CHOICES;

        for (const product of productsToReset) {
            await client.db.set(claimKey(target.id, product.value), false).catch(() => {});
        }

        const resetLabel = productChoice
            ? PRODUCT_CHOICES.find(p => p.value === productChoice)?.name
            : 'all products';

        await interaction.reply({
            embeds: [successEmbed('✅ Reset', `${target.tag}'s claim for **${resetLabel}** has been reset. They can use \`/claim\` again.`)],
            flags: MessageFlags.Ephemeral,
        });
    },
};
