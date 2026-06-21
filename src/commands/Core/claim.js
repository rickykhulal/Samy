// src/commands/Core/claim.js
import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
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
const CLAIM_DURATION_DAYS = 1;

function claimKey(userId) {
    return `loms:member_claim:${userId}`;
}

export default {
    data: new SlashCommandBuilder()
        .setName('claim')
        .setDescription('Claim your free 1-day bundle license (all products) — one time only'),

    async execute(interaction, guildConfig, client) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            if (!interaction.member.roles.cache.has(MEMBER_ROLE_ID)) {
                return interaction.editReply({
                    embeds: [errorEmbed('❌ Access Denied', 'You need the Member role to use this command.')],
                });
            }

            const alreadyClaimed = await client.db.get(claimKey(interaction.user.id)).catch(() => null);
            if (alreadyClaimed) {
                return interaction.editReply({
                    embeds: [errorEmbed('❌ Already Claimed', 'You have already used your free claim. Contact an admin if you need a reset.')],
                });
            }

            const products = await getActiveProducts(client);
            if (!products || products.length === 0) {
                return interaction.editReply({
                    embeds: [errorEmbed('❌ Unavailable', 'No products are configured right now. Try again later.')],
                });
            }

            // Verify stock for EVERY product before consuming anything
            const resolvedKeys = [];
            for (const product of products) {
                const pool = await getPool(client, product.id);
                if (!pool || pool.length === 0) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Out of Stock', `**${product.name}** has no keys available right now. Try again later — your claim was not used.`)],
                    });
                }

                const result = await findBestKey(client, product.id, CLAIM_DURATION_DAYS);
                if (!result) {
                    return interaction.editReply({
                        embeds: [errorEmbed('❌ Out of Stock', `**${product.name}** has no keys available right now. Try again later — your claim was not used.`)],
                    });
                }

                const key = result.exact ? result.key : result.nearest[0];
                resolvedKeys.push({ product, key });
            }

            // All products have stock — consume everything and lock the claim
            const reqId = generateRequestId();
            for (const { product, key } of resolvedKeys) {
                await consumeKey(client, product.id, key.id, interaction.user.id, reqId);
            }
            await client.db.set(claimKey(interaction.user.id), true);

            const keyEmbed = new EmbedBuilder()
                .setColor(0x2ECC71)
                .setTitle('🎁 Free Bundle Claimed')
                .setDescription('Here are your free license keys (one-time claim).')
                .setTimestamp();

            for (const { product, key } of resolvedKeys) {
                keyEmbed.addFields({
                    name: `🗝️ ${product.name}`,
                    value: `\`\`\`\n${key.key}\n\`\`\`\nDuration: ${key.durationDays} day(s)`,
                    inline: false,
                });
            }

            try {
                const user = await client.users.fetch(interaction.user.id);
                await user.send({ embeds: [keyEmbed] });
                await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(0x2ECC71)
                        .setTitle('✅ Claimed!')
                        .setDescription('Your bundle has been sent via DM. Check your messages!')
                    ],
                });
            } catch (_) {
                // DMs closed — fall back to showing it ephemerally in-channel
                await interaction.editReply({ embeds: [keyEmbed] });
            }

            for (const adminId of ADMIN_IDS) {
                try {
                    const admin = await client.users.fetch(adminId);
                    await admin.send({
                        embeds: [new EmbedBuilder()
                            .setColor(0x3498DB)
                            .setTitle('🎁 Free Bundle Claimed')
                            .addFields(
                                { name: '👤 User', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: false },
                                ...resolvedKeys.map(({ product, key }) => ({
                                    name: product.name,
                                    value: `\`${key.key}\` (${key.durationDays}d)`,
                                    inline: true,
                                })),
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
                products: resolvedKeys.map(r => ({ productId: r.product.id, keyId: r.key.id, days: r.key.durationDays })),
                ts: new Date().toISOString(),
            });

        } catch (err) {
            logger.error('claim command error: ' + err.message, { stack: err.stack });
            try {
                await interaction.editReply({
                    embeds: [errorEmbed('❌ Error', 'Something went wrong while processing your claim.')],
                });
            } catch (_) {}
        }
    },
};
