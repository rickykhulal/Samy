// src/commands/Core/getkey.js
import {
    SlashCommandBuilder,
    MessageFlags,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    EmbedBuilder,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { errorEmbed } from '../../utils/embeds.js';
import {
    ADMIN_IDS, OWNER_ID,
    getActiveProducts,
    getUser,
    getCredits,
    hasProductAccess,
} from '../../utils/loms.js';

export default {
    data: new SlashCommandBuilder()
        .setName('getkey')
        .setDescription('Get an instant pre-made license key from inventory'),

    async execute(interaction, guildConfig, client) {
        // ── Access check ──────────────────────────────────────
        const user = await getUser(client, interaction.user.id);
        if (!user && !ADMIN_IDS.includes(interaction.user.id)) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('❌ Access Denied',
                    'You do not have permission to use this command.\nContact an admin to get access.')],
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── Credit check ──────────────────────────────────────
        const credits = await getCredits(client, interaction.user.id);
        if (credits <= 0) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('❌ No Credits',
                    'You have no remaining credits.\nContact an admin to get more.')],
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── Load active products ──────────────────────────────
        const products = await getActiveProducts(client);
        if (products.length === 0) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('❌ No Products', 'No active products available.')],
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── Filter to accessible products ─────────────────────
        const accessible = ADMIN_IDS.includes(interaction.user.id)
            ? products
            : products.filter(p => user?.products?.includes(p.id));

        if (accessible.length === 0) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('❌ No Product Access',
                    'You do not have access to any products.\nContact an admin.')],
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── Product dropdown ──────────────────────────────────
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('getkey_product_select')
            .setPlaceholder('Select a product...')
            .addOptions(
                accessible.map(p =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(p.name)
                        .setValue(p.id)
                        .setDescription(`Get instant ${p.name} key from inventory`)
                )
            );

        return InteractionHelper.safeReply(interaction, {
            embeds: [new EmbedBuilder()
                .setColor(0x2ECC71)
                .setTitle('⚡ Get Instant Key — Select Product')
                .setDescription(
                    `**Available Credits:** ${credits}\n\n` +
                    `Select the product you want an instant key for.\n` +
                    `Keys are delivered from pre-made inventory — no approval required.`
                )
                .setFooter({ text: 'No approval needed • Instant delivery' })
                .setTimestamp()
            ],
            components: [new ActionRowBuilder().addComponents(selectMenu)],
            flags: MessageFlags.Ephemeral,
        });
    },
};
