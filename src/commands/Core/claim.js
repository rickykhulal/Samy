// src/commands/Core/claim.js
import {
    SlashCommandBuilder,
    EmbedBuilder,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import { errorEmbed } from '../../utils/embeds.js';
import {
    ADMIN_IDS,
    getActiveProducts,
    findBestKey,
    consumeKey,
    getPool,
    appendLog,
    DB,
    generateRequestId,
} from '../../utils/loms.js';

const MEMBER_ROLE_ID = '1504644347256242252';
// Per-product claim durations (in days). Adjust each independently.
const PRODUCT_CHOICES = [
    { id: 'uid_bypass', label: 'UID Bypass', emoji: '🛡️', durationDays: 3 },
    { id: 'external_exclusive', label: 'External Panel', emoji: '🖥️', durationDays: 1 },
];

function claimKey(userId, productId) {
    return `loms:member_claim:${userId}:${productId}`;
}

// Tracks which users have ever claimed something, so admins can reset everyone at once.
export const CLAIM_USERLIST_KEY = 'loms:claim_userlist';

export default {
    data: new SlashCommandBuilder()
        .setName('claim')
        .setDescription('Claim a free 1-day license — one claim per product'),

    async execute(interaction, guildConfig, client) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            if (!interaction.member.roles.cache.has(MEMBER_ROLE_ID)) {
                return interaction.editReply({
                    embeds: [errorEmbed('❌ Access Denied', 'You need the Member role to use this command.')],
                });
            }

            const allProducts = await getActiveProducts(client);
            if (!allProducts || allProducts.length === 0) {
                return interaction.editReply({
                    embeds: [errorEmbed('❌ Unavailable', 'No products are configured right now. Try again later.')],
                });
            }

            // Filter down to only the two choosable products that are actually active.
            const allChoosable = PRODUCT_CHOICES
                .map(choice => ({ choice, product: allProducts.find(p => p.id === choice.id) }))
                .filter(entry => entry.product);

            if (allChoosable.length === 0) {
                return interaction.editReply({
                    embeds: [errorEmbed('❌ Unavailable', 'No claimable products are configured right now. Try again later.')],
                });
            }

            // Only offer products this user hasn't already claimed.
            const claimedFlags = await Promise.all(
                allChoosable.map(entry => client.db.get(claimKey(interaction.user.id, entry.product.id)).catch(() => null))
            );
            const choosable = allChoosable.filter((_, i) => !claimedFlags[i]);

            if (choosable.length === 0) {
                return interaction.editReply({
                    embeds: [errorEmbed('❌ Already Claimed', 'You have already claimed all available products. Contact an admin if you need a reset.')],
                });
            }

            const row = new ActionRowBuilder().addComponents(
                choosable.map(({ choice }) =>
                    new ButtonBuilder()
                        .setCustomId(`claimchoice_${choice.id}`)
                        .setLabel(choice.label)
                        .setEmoji(choice.emoji)
                        .setStyle(ButtonStyle.Primary)
                )
            );

            const chooseEmbed = new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle('🎁 Choose Your Free Claim')
                .setDescription('Pick one of the following. You can claim each product once.');

            const promptMessage = await interaction.editReply({
                embeds: [chooseEmbed],
                components: [row],
            });

            let choiceInteraction;
            try {
                choiceInteraction = await promptMessage.awaitMessageComponent({
                    componentType: ComponentType.Button,
                    time: 30_000,
                    filter: (i) => i.user.id === interaction.user.id,
                });
            } catch (_) {
                return interaction.editReply({
                    embeds: [errorEmbed('⌛ Timed Out', 'You didn\'t choose in time. Run `/claim` again to try again — your claim was not used.')],
                    components: [],
                });
            }

            const chosenId = choiceInteraction.customId.replace('claimchoice_', '');
            const chosenEntry = choosable.find(entry => entry.choice.id === chosenId);
            const product = chosenEntry.product;
            const durationDays = chosenEntry.choice.durationDays;

            await choiceInteraction.deferUpdate();

            // Re-check in case it was claimed in the moments between showing buttons and clicking (race condition)
            const stillUnclaimed = !(await client.db.get(claimKey(interaction.user.id, product.id)).catch(() => null));
            if (!stillUnclaimed) {
                return interaction.editReply({
                    embeds: [errorEmbed('❌ Already Claimed', `You've already claimed **${product.name}**. Try another product by running \`/claim\` again.`)],
                    components: [],
                });
            }

            // Verify stock for the chosen product before consuming anything
            const pool = await getPool(client, product.id);
            if (!pool || pool.length === 0) {
                return interaction.editReply({
                    embeds: [errorEmbed('❌ Out of Stock', `**${product.name}** has no keys available right now. Try again later — your claim was not used.`)],
                    components: [],
                });
            }

            const result = await findBestKey(client, product.id, durationDays);
            if (!result) {
                return interaction.editReply({
                    embeds: [errorEmbed('❌ Out of Stock', `**${product.name}** has no keys available right now. Try again later — your claim was not used.`)],
                    components: [],
                });
            }

            const key = result.exact ? result.key : result.nearest[0];

            // Consume the key and lock the claim
            const reqId = generateRequestId();
            await consumeKey(client, product.id, key.id, interaction.user.id, reqId);
            await client.db.set(claimKey(interaction.user.id, product.id), true);

            // Track this user so admins can bulk-reset all claimants later
            const claimantList = (await client.db.get(CLAIM_USERLIST_KEY).catch(() => null)) || [];
            if (!claimantList.includes(interaction.user.id)) {
                claimantList.push(interaction.user.id);
                await client.db.set(CLAIM_USERLIST_KEY, claimantList).catch(() => {});
            }

            const keyEmbed = new EmbedBuilder()
                .setColor(0x2ECC71)
                .setTitle('🎁 Free Claim')
                .setDescription('Here is your free license key (one-time claim).')
                .addFields({
                    name: `🗝️ ${product.name}`,
                    value: `\`\`\`\n${key.key}\n\`\`\`\nDuration: ${key.durationDays} day(s)`,
                    inline: false,
                })
                .setTimestamp();

            try {
                const user = await client.users.fetch(interaction.user.id);
                await user.send({ embeds: [keyEmbed] });
                await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(0x2ECC71)
                        .setTitle('✅ Claimed!')
                        .setDescription('Your key has been sent via DM. Check your messages!')
                    ],
                    components: [],
                });
            } catch (_) {
                // DMs closed — fall back to showing it ephemerally in-channel
                await interaction.editReply({ embeds: [keyEmbed], components: [] });
            }

            for (const adminId of ADMIN_IDS) {
                try {
                    const admin = await client.users.fetch(adminId);
                    await admin.send({
                        embeds: [new EmbedBuilder()
                            .setColor(0x3498DB)
                            .setTitle('🎁 Free Claim')
                            .addFields(
                                { name: '👤 User', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: false },
                                { name: product.name, value: `\`${key.key}\` (${key.durationDays}d)`, inline: true },
                            )
                            .setTimestamp()
                        ],
                    });
                } catch (_) {}
            }

            await appendLog(client, DB.keyLog(), {
                type: 'MEMBER_CLAIM',
                reqId,
                userId: interaction.user.id,
                products: [{ productId: product.id, keyId: key.id, days: key.durationDays }],
                ts: new Date().toISOString(),
            });

        } catch (err) {
            logger.error('claim command error: ' + err.message, { stack: err.stack });
            try {
                await interaction.editReply({
                    embeds: [errorEmbed('❌ Error', 'Something went wrong while processing your claim.')],
                    components: [],
                });
            } catch (_) {}
        }
    },
};
