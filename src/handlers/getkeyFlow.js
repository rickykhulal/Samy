// src/handlers/getkeyFlow.js
// Handles: product select → duration buttons → exact/nearest → delivery

import {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { errorEmbed } from '../utils/embeds.js';
import {
    ADMIN_IDS, OWNER_ID, MOD_ID,
    getActiveProducts,
    getCredits,
    hasProductAccess,
    deductCredit,
    findBestKey,
    consumeKey,
    getPool,
    appendLog,
    DB,
    generateRequestId,
} from '../utils/loms.js';

// ─────────────────────────────────────────────────────────────
//  1. PRODUCT SELECT  →  show duration buttons
// ─────────────────────────────────────────────────────────────
const getkeyProductSelectHandler = {
    name: 'getkey_product_select',
    async execute(interaction, client) {
        try {
            const productId = interaction.values[0];
            const products  = await getActiveProducts(client);
            const product   = products.find(p => p.id === productId);

            if (!product) {
                return interaction.update({
                    embeds: [errorEmbed('❌ Product Not Found', 'This product no longer exists.')],
                    components: [],
                });
            }

            // Permission check
            const hasAccess = await hasProductAccess(client, interaction.user.id, productId);
            if (!hasAccess) {
                return interaction.update({
                    embeds: [errorEmbed('❌ Access Denied',
                        `You do not have access to **${product.name}**.`)],
                    components: [],
                });
            }

            // Check pool availability
            const pool = await getPool(client, productId);
            if (pool.length === 0) {
                return interaction.update({
                    embeds: [new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ No Keys Available')
                        .setDescription(
                            `There are currently no **${product.name}** keys in inventory.\n` +
                            `Contact <@${OWNER_ID}> to add more keys.`
                        )
                        .setTimestamp()
                    ],
                    components: [],
                });
            }

            // Show available durations from pool
            const availableDays = [...new Set(pool.map(k => k.durationDays))].sort((a, b) => a - b);
            const credits       = await getCredits(client, interaction.user.id);

            // Build duration buttons (max 5 per row)
            const buttons = availableDays.slice(0, 5).map(d =>
                new ButtonBuilder()
                    .setCustomId(`getkey_days_${d}_${productId}`)
                    .setLabel(`${d} Day${d !== 1 ? 's' : ''}`)
                    .setStyle(ButtonStyle.Primary)
            );

            // Add "Custom" button for other durations
            buttons.push(
                new ButtonBuilder()
                    .setCustomId(`getkey_custom_${productId}`)
                    .setLabel('🔢 Custom Days')
                    .setStyle(ButtonStyle.Secondary)
            );

            await interaction.update({
                embeds: [new EmbedBuilder()
                    .setColor(0x2ECC71)
                    .setTitle(`⚡ ${product.name} — Select Duration`)
                    .setDescription(
                        `**${pool.length}** keys available in inventory.\n` +
                        `**Your Credits:** ${credits}\n\n` +
                        `Select how many days you need:`
                    )
                    .addFields({
                        name:  '📋 Available Durations',
                        value: availableDays.map(d => `• ${d} day${d !== 1 ? 's' : ''}`).join('\n'),
                        inline: false,
                    })
                    .setTimestamp()
                ],
                components: [new ActionRowBuilder().addComponents(...buttons)],
            });

        } catch (err) {
            logger.error('getkeyProductSelect error:', err.message);
        }
    },
};

// ─────────────────────────────────────────────────────────────
//  2. CUSTOM DAYS BUTTON  →  show modal
// ─────────────────────────────────────────────────────────────
const getkeyCustomHandler = {
    name: 'getkey_custom',
    async execute(interaction, client) {
        try {
            const productId = interaction.customId.replace('getkey_custom_', '');

            const modal = new ModalBuilder()
                .setCustomId(`getkey_customdays_${productId}`)
                .setTitle('🔢 Enter Custom Duration');

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('days')
                        .setLabel('How many days? (any positive number)')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('e.g. 14, 45, 180')
                        .setRequired(true)
                        .setMinLength(1)
                        .setMaxLength(5)
                )
            );

            await interaction.showModal(modal);

        } catch (err) {
            logger.error('getkeyCustom error:', err.message);
        }
    },
};

// ─────────────────────────────────────────────────────────────
//  3. CUSTOM DAYS MODAL  →  search pool
// ─────────────────────────────────────────────────────────────
const getkeyCustomDaysModalHandler = {
    name: 'getkey_customdays',
    async execute(interaction, client) {
        try {
            const deferSuccess = await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const productId    = interaction.customId.replace('getkey_customdays_', '');
            const daysRaw      = interaction.fields.getTextInputValue('days').trim();
            const days         = parseInt(daysRaw, 10);

            if (isNaN(days) || days < 1) {
                return interaction.editReply({
                    embeds: [errorEmbed('❌ Invalid Days', 'Please enter a valid positive number.')],
                });
            }

            await searchAndDeliver(interaction, client, productId, days);

        } catch (err) {
            logger.error('getkeyCustomDaysModal error:', err.message);
        }
    },
};

// ─────────────────────────────────────────────────────────────
//  4. DAY BUTTON  →  search pool
// ─────────────────────────────────────────────────────────────
const getkeyDaysHandler = {
    name: 'getkey_days',
    async execute(interaction, client) {
        try {
            const parts     = interaction.customId.replace('getkey_days_', '').split('_');
            const days      = parseInt(parts[0], 10);
            const productId = parts.slice(1).join('_');

            await interaction.deferUpdate();
            await searchAndDeliver(interaction, client, productId, days, true);

        } catch (err) {
            logger.error('getkeyDays error:', err.message);
        }
    },
};

// ─────────────────────────────────────────────────────────────
//  5. NEAREST CONFIRM  (getkey_confirm_<keyId>_<productId>)
// ─────────────────────────────────────────────────────────────
const getkeyConfirmHandler = {
    name: 'getkey_confirm',
    async execute(interaction, client) {
        try {
            const parts     = interaction.customId.replace('getkey_confirm_', '').split('_');
            const keyId     = parts[0];
            const productId = parts.slice(1).join('_');

            await interaction.deferUpdate();

            const credits = await getCredits(client, interaction.user.id);
            if (credits <= 0) {
                return interaction.editReply({
                    embeds: [errorEmbed('❌ No Credits', 'You have no remaining credits.')],
                    components: [],
                });
            }

            const pool = await getPool(client, productId);
            const key  = pool.find(k => k.id === keyId);

            if (!key) {
                return interaction.editReply({
                    embeds: [errorEmbed('❌ Key Gone', 'This key was just taken. Please try /getkey again.')],
                    components: [],
                });
            }

            await doDeliverKey(interaction, client, key, productId);

        } catch (err) {
            logger.error('getkeyConfirm error:', err.message);
        }
    },
};

// ─────────────────────────────────────────────────────────────
//  SHARED: Search pool and deliver or offer nearest
// ─────────────────────────────────────────────────────────────
async function searchAndDeliver(interaction, client, productId, days, isUpdate = false) {
    const products = await getActiveProducts(client);
    const product  = products.find(p => p.id === productId);
    const credits  = await getCredits(client, interaction.user.id);

    if (credits <= 0) {
        const payload = { embeds: [errorEmbed('❌ No Credits', 'You have no remaining credits.')], components: [] };
        return isUpdate ? interaction.editReply(payload) : interaction.editReply(payload);
    }

    const result = await findBestKey(client, productId, days);

    if (!result) {
        const payload = {
            embeds: [new EmbedBuilder()
                .setColor(0xED4245)
                .setTitle('❌ No Keys Available')
                .setDescription(
                    `No **${product?.name || productId}** keys available in inventory.\n` +
                    `Contact <@${OWNER_ID}> to add more keys.`
                )
                .setTimestamp()
            ],
            components: [],
        };
        return isUpdate ? interaction.editReply(payload) : interaction.editReply(payload);
    }

    // Exact match — deliver straight away
    if (result.exact) {
        return doDeliverKey(interaction, client, result.key, productId, isUpdate);
    }

    // Nearest match — show options
    const nearestButtons = result.nearest.map(k =>
        new ButtonBuilder()
            .setCustomId(`getkey_confirm_${k.id}_${productId}`)
            .setLabel(`✅ ${k.durationDays} Days`)
            .setStyle(ButtonStyle.Primary)
    );

    nearestButtons.push(
        new ButtonBuilder()
            .setCustomId('getkey_cancelnearest')
            .setLabel('❌ Cancel')
            .setStyle(ButtonStyle.Secondary)
    );

    const payload = {
        embeds: [new EmbedBuilder()
            .setColor(0xFF8C00)
            .setTitle('⚠️ Exact Duration Not Available')
            .setDescription(
                `No **${days}-day** key available for **${product?.name || productId}**.\n\n` +
                `**Nearest available options:**`
            )
            .addFields(
                result.nearest.map(k => ({
                    name:   `${k.durationDays} Day${k.durationDays !== 1 ? 's' : ''}`,
                    value:  '1 Credit',
                    inline: true,
                }))
            )
            .setFooter({ text: 'Select one of the options above or cancel' })
            .setTimestamp()
        ],
        components: [new ActionRowBuilder().addComponents(...nearestButtons)],
    };

    return isUpdate ? interaction.editReply(payload) : interaction.editReply(payload);
}

// ─────────────────────────────────────────────────────────────
//  SHARED: Deliver key to user
// ─────────────────────────────────────────────────────────────
async function doDeliverKey(interaction, client, key, productId, isUpdate = false) {
    const products = await getActiveProducts(client);
    const product  = products.find(p => p.id === productId);
    const reqId    = generateRequestId();

    // Deduct credit
    await deductCredit(client, interaction.user.id, `getkey ${productId}`);
    const remaining = await getCredits(client, interaction.user.id);

    // Consume key
    await consumeKey(client, productId, key.id, interaction.user.id, reqId);

    // Update message
    const updatePayload = {
        embeds: [new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('✅ Key Delivered')
            .setDescription('Your key has been sent via **Direct Message**.\nCheck your DMs!')
            .setTimestamp()
        ],
        components: [],
    };
    if (isUpdate) {
        await interaction.editReply(updatePayload);
    } else {
        await interaction.editReply(updatePayload);
    }

    // Build key embed
    const keyEmbed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('🔑 License Key Delivered')
        .setDescription('Your instant pre-made key has been assigned from inventory.')
        .addFields(
            { name: '🗝️ License Key',   value: `\`\`\`\n${key.key}\n\`\`\``,                          inline: false },
            { name: '📦 Product',        value: product?.name || productId,                             inline: true  },
            { name: '⏱️ Duration',       value: `${key.durationDays} Day${key.durationDays !== 1 ? 's' : ''}`, inline: true },
            { name: '💳 Credits Left',   value: `${remaining}`,                                        inline: true  },
            { name: '🆔 Ref ID',         value: `\`${reqId}\``,                                        inline: false },
        )
        .setFooter({ text: `${interaction.user.tag} • Automated System` })
        .setTimestamp();

    // Send via DM
    try {
        const user = await client.users.fetch(interaction.user.id);
        await user.send({ embeds: [keyEmbed] });
    } catch (_) {
        // DM failed — send ephemeral
        try {
            await interaction.followUp({ embeds: [keyEmbed], flags: MessageFlags.Ephemeral });
        } catch (_) {}
    }

    // Notify admins
    for (const adminId of ADMIN_IDS) {
        try {
            const admin = await client.users.fetch(adminId);
            await admin.send({
                embeds: [new EmbedBuilder()
                    .setColor(0x3498DB)
                    .setTitle('📋 /getkey — Key Delivered')
                    .addFields(
                        { name: '👤 User',     value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
                        { name: '📦 Product',  value: product?.name || productId,                           inline: true },
                        { name: '🗝️ Key',     value: `\`${key.key}\``,                                     inline: false },
                        { name: '⏱️ Duration', value: `${key.durationDays} days`,                          inline: true },
                        { name: '💳 Credits',  value: `${remaining} left`,                                 inline: true },
                    )
                    .setTimestamp()
                ],
            });
        } catch (_) {}
    }

    await appendLog(client, DB.keyLog(), {
        type: 'GETKEY_DELIVERED', reqId, userId: interaction.user.id,
        productId, keyId: key.id, days: key.durationDays,
        ts: new Date().toISOString(),
    });
}

// Cancel nearest
const getkeyCancelNearestHandler = {
    name: 'getkey_cancelnearest',
    async execute(interaction, client) {
        await interaction.update({
            embeds: [new EmbedBuilder()
                .setColor(0x95A5A6)
                .setTitle('🚫 Cancelled')
                .setDescription('No key was assigned. No credits were deducted.')
                .setTimestamp()
            ],
            components: [],
        });
    },
};

export default getkeyProductSelectHandler;
export {
    getkeyCustomHandler,
    getkeyCustomDaysModalHandler,
    getkeyDaysHandler,
    getkeyConfirmHandler,
    getkeyCancelNearestHandler,
};
