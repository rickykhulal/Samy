// src/commands/Core/createkey.js
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
    ADMIN_IDS,
    getActiveProducts,
    getUser,
    getCredits,
    hasProductAccess,
} from '../../utils/loms.js';

export default {
    data: new SlashCommandBuilder()
        .setName('createkey')
        .setDescription('Request a custom license key'),

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

        // ── Filter to products user has access to ─────────────
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

        // ── Product selection dropdown ────────────────────────
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('createkey_product_select')
            .setPlaceholder('Select a product...')
            .addOptions(
                accessible.map(p =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(p.name)
                        .setValue(p.id)
                        .setDescription(`Request a custom ${p.name} license`)
                )
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        return InteractionHelper.safeReply(interaction, {
            embeds: [new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle('🔑 Create Key — Select Product')
                .setDescription(
                    `**Available Credits:** ${credits}\n\n` +
                    `Select the product you want to request a license for.`
                )
                .setFooter({ text: 'Selection expires in 60 seconds' })
                .setTimestamp()
            ],
            components: [row],
            flags: MessageFlags.Ephemeral,
        });
    },
};
