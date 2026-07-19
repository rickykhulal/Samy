// src/commands/Core/resetclaimall.js
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { ADMIN_IDS } from '../../utils/loms.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { CLAIM_USERLIST_KEY } from './claim.js';

const PRODUCT_IDS = ['uid_bypass', 'external_exclusive'];

function claimKey(userId, productId) {
    return `loms:member_claim:${userId}:${productId}`;
}

export default {
    data: new SlashCommandBuilder()
        .setName('resetclaimall')
        .setDescription('[Admin] Reset the free claim for every member who has claimed something'),

    async execute(interaction, guildConfig, client) {
        if (!ADMIN_IDS.includes(interaction.user.id)) {
            return interaction.reply({
                embeds: [errorEmbed('❌ Access Denied', 'Admins only.')],
                flags: MessageFlags.Ephemeral,
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const claimantList = (await client.db.get(CLAIM_USERLIST_KEY).catch(() => null)) || [];

        if (claimantList.length === 0) {
            return interaction.editReply({
                embeds: [successEmbed('✅ Nothing To Reset', 'No members have claimed anything yet.')],
            });
        }

        let resetCount = 0;
        for (const userId of claimantList) {
            for (const productId of PRODUCT_IDS) {
                await client.db.set(claimKey(userId, productId), false).catch(() => {});
            }
            resetCount++;
        }

        // Clear the tracked claimant list since everyone is now reset
        await client.db.set(CLAIM_USERLIST_KEY, []).catch(() => {});

        await interaction.editReply({
            embeds: [successEmbed('✅ Reset Complete', `Reset claims for **${resetCount}** member(s). Everyone can use \`/claim\` again.`)],
        });
    },
};
