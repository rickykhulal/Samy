// src/handlers/createkeyFlow.js
// Handles: product select menu → modal → DM approval → timeout flow

import {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { errorEmbed } from '../utils/embeds.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import {
    ADMIN_IDS, OWNER_ID, MOD_ID,
    pendingApprovals,
    STATUS,
    getActiveProducts,
    getCredits,
    hasProductAccess,
    deductCredit,
    refundCredit,
    createRequest,
    updateRequest,
    getRequest,
    appendLog,
    DB,
    statusColor,
} from '../utils/loms.js';

const TIMEOUT_MS = 120_000; // 2 minutes

// ─────────────────────────────────────────────────────────────
//  1. PRODUCT SELECT MENU  →  show modal
// ─────────────────────────────────────────────────────────────
const createkeyProductSelectHandler = {
    name: 'createkey_product_select',
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
                        `You do not have access to **${product.name}**.\nContact an admin.`)],
                    components: [],
                });
            }

            // Credit check
            const credits = await getCredits(client, interaction.user.id);
            if (credits <= 0) {
                return interaction.update({
                    embeds: [errorEmbed('❌ No Credits', 'You have no remaining credits.')],
                    components: [],
                });
            }

            // Show modal
            const modal = new ModalBuilder()
                .setCustomId(`createkey_modal_${productId}`)
                .setTitle(`🔑 ${product.name} — License Request`);

            const licenseNameInput = new TextInputBuilder()
                .setCustomId('license_name')
                .setLabel('Requested License Name')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. RIXXY-PRO, JOHN-2025, MY-KEY')
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(64);

            const durationInput = new TextInputBuilder()
                .setCustomId('duration')
                .setLabel('Duration (days) — any positive number')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. 30, 60, 90, 365')
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(5);

            modal.addComponents(
                new ActionRowBuilder().addComponents(licenseNameInput),
                new ActionRowBuilder().addComponents(durationInput),
            );

            // Remove dropdown, show modal
            await interaction.update({ components: [] });
            await interaction.followUp({
                content: `✅ Selected: **${product.name}** — Fill in the form below.`,
                flags: MessageFlags.Ephemeral,
            });

            // Store product selection temporarily
            pendingApprovals.set(`product_${interaction.user.id}`, {
                productId,
                productName: product.name,
            });

            // We can't show modal after update — store and handle via button
            // Instead show a "Fill Request" button that opens the modal
            const fillRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`createkey_openmodal_${productId}`)
                    .setLabel(`📝 Fill ${product.name} Request`)
                    .setStyle(ButtonStyle.Primary)
            );

            await interaction.followUp({
                embeds: [new EmbedBuilder()
                    .setColor(0x3498DB)
                    .setTitle(`🔑 ${product.name} Selected`)
                    .setDescription('Click the button below to fill in your license request details.')
                    .addFields({ name: '💳 Your Credits', value: `${credits}`, inline: true })
                    .setTimestamp()
                ],
                components: [fillRow],
                flags: MessageFlags.Ephemeral,
            });

        } catch (err) {
            logger.error('createkeyProductSelect error:', err.message);
        }
    },
};

// ─────────────────────────────────────────────────────────────
//  2. OPEN MODAL BUTTON
// ─────────────────────────────────────────────────────────────
const createkeyOpenModalHandler = {
    name: 'createkey_openmodal',
    async execute(interaction, client) {
        try {
            const productId   = interaction.customId.replace('createkey_openmodal_', '');
            const products    = await getActiveProducts(client);
            const product     = products.find(p => p.id === productId);
            if (!product) return;

            const modal = new ModalBuilder()
                .setCustomId(`createkey_modal_${productId}`)
                .setTitle(`🔑 ${product.name} — License Request`);

            const licenseNameInput = new TextInputBuilder()
                .setCustomId('license_name')
                .setLabel('Requested License Name')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. RIXXY-PRO, JOHN-2025')
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(64);

            const durationInput = new TextInputBuilder()
                .setCustomId('duration')
                .setLabel('Duration (days) — any positive number')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. 30, 60, 90, 365')
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(5);

            modal.addComponents(
                new ActionRowBuilder().addComponents(licenseNameInput),
                new ActionRowBuilder().addComponents(durationInput),
            );

            await interaction.showModal(modal);

        } catch (err) {
            logger.error('createkeyOpenModal error:', err.message);
        }
    },
};

// ─────────────────────────────────────────────────────────────
//  3. MODAL SUBMIT  →  create request + DM admins
// ─────────────────────────────────────────────────────────────
const createkeyModalHandler = {
    name: 'createkey_modal',
    async execute(interaction, client) {
        try {
            const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferSuccess) return;

            const productId   = interaction.customId.replace('createkey_modal_', '');
            const products    = await getActiveProducts(client);
            const product     = products.find(p => p.id === productId);

            if (!product) {
                return interaction.editReply({
                    embeds: [errorEmbed('❌ Product Not Found', 'This product no longer exists.')],
                });
            }

            const licenseName = interaction.fields.getTextInputValue('license_name').trim();
            const durationRaw = interaction.fields.getTextInputValue('duration').trim();
            const duration    = parseInt(durationRaw, 10);

            if (isNaN(duration) || duration < 1 || duration > 36500) {
                return interaction.editReply({
                    embeds: [errorEmbed('❌ Invalid Duration',
                        'Please enter a valid number of days (1–36500).')],
                });
            }

            // Credits check
            const credits = await getCredits(client, interaction.user.id);
            if (credits <= 0) {
                return interaction.editReply({
                    embeds: [errorEmbed('❌ No Credits', 'You have no remaining credits.')],
                });
            }

            // Create request in DB
            const request = await createRequest(client, {
                userId:      interaction.user.id,
                userTag:     interaction.user.tag,
                guildId:     interaction.guildId,
                channelId:   interaction.channelId,
                productId,
                productName: product.name,
                licenseName,
                duration,
                creditsAtReq: credits,
            });

            // Store in pending map for timeout handling
            pendingApprovals.set(request.requestId, {
                ...request,
                dmMessages: [],
            });

            // ── Send DM to Owner + Moderator ──────────────────
            const dmEmbed = new EmbedBuilder()
                .setColor(0xF1C40F)
                .setTitle('🔑 New License Key Request')
                .setDescription('A reseller has submitted a custom license request.')
                .addFields(
                    { name: '🆔 Request ID',     value: `\`${request.requestId}\``,             inline: false },
                    { name: '👤 Requester',       value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
                    { name: '📦 Product',         value: product.name,                           inline: true },
                    { name: '\u200B',             value: '\u200B',                               inline: true },
                    { name: '🏷️ License Name',   value: `\`${licenseName}\``,                   inline: true },
                    { name: '⏱️ Duration',        value: `${duration} Day${duration !== 1 ? 's' : ''}`, inline: true },
                    { name: '💳 Credits',         value: `${credits}`,                           inline: true },
                )
                .setFooter({ text: '⏰ 2 minutes to respond before this expires' })
                .setTimestamp();

            const dmRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`loms_approve_${request.requestId}`)
                    .setLabel('✅ Approve')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`loms_deny_${request.requestId}`)
                    .setLabel('❌ Deny')
                    .setStyle(ButtonStyle.Danger),
            );

            // Send to both admins
            for (const adminId of ADMIN_IDS) {
                try {
                    const admin = await client.users.fetch(adminId);
                    const msg   = await admin.send({ embeds: [dmEmbed], components: [dmRow] });
                    pendingApprovals.get(request.requestId)?.dmMessages?.push(msg);
                } catch (dmErr) {
                    logger.warn(`Could not DM admin ${adminId}:`, dmErr.message);
                }
            }

            // ── Confirm to user ──────────────────────────────
            const expiresAt = Math.floor((Date.now() + TIMEOUT_MS) / 1000);
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor(0xF1C40F)
                    .setTitle('⏳ Request Submitted')
                    .setDescription(
                        `Your license request has been sent for approval.\n` +
                        `You will be notified here when reviewed.\n\n` +
                        `⏰ Admin response deadline: <t:${expiresAt}:R>`
                    )
                    .addFields(
                        { name: '🆔 Request ID',   value: `\`${request.requestId}\``, inline: false },
                        { name: '📦 Product',      value: product.name,               inline: true  },
                        { name: '🏷️ License Name', value: licenseName,                inline: true  },
                        { name: '⏱️ Duration',     value: `${duration} days`,         inline: true  },
                    )
                    .setTimestamp()
                ],
            });

            // ── 2 min timeout ─────────────────────────────────
            setTimeout(async () => {
                const pending = pendingApprovals.get(request.requestId);
                if (!pending) return;

                // Check if still pending in DB
                const dbReq = await getRequest(client, request.requestId);
                if (!dbReq || dbReq.status !== STATUS.PENDING_APPROVAL) return;

                // Mark as expired
                await updateRequest(client, request.requestId, { status: STATUS.EXPIRED });
                pendingApprovals.delete(request.requestId);

                // Disable DM buttons
                for (const msg of (pending.dmMessages || [])) {
                    try {
                        await msg.edit({ components: [] });
                    } catch (_) {}
                }

                // Notify user with instant key option
                try {
                    const guild   = await client.guilds.fetch(request.guildId).catch(() => null);
                    const channel = guild ? await guild.channels.fetch(request.channelId).catch(() => null) : null;
                    if (!channel?.isSendable()) return;

                    const offerRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`loms_getinstant_${productId}_${request.requestId}`)
                            .setLabel('⚡ Get Instant Key')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`loms_cancel_${request.requestId}`)
                            .setLabel('🚫 Cancel')
                            .setStyle(ButtonStyle.Secondary),
                    );

                    await channel.send({
                        content: `<@${request.userId}>`,
                        embeds: [new EmbedBuilder()
                            .setColor(0xFF8C00)
                            .setTitle('⚠️ High Demand — Request Timed Out')
                            .setDescription(
                                `Currently multiple key requests are being processed.\n` +
                                `The admin did not respond within 2 minutes.\n\n` +
                                `**Would you like an instant pre-made key instead?**\n` +
                                `*(Uses 1 credit from your balance)*`
                            )
                            .addFields(
                                { name: '📦 Product',      value: product.name, inline: true },
                                { name: '🆔 Request ID',   value: `\`${request.requestId}\``, inline: true },
                            )
                            .setTimestamp()
                        ],
                        components: [offerRow],
                    });
                } catch (err) {
                    logger.error('Timeout notify error:', err.message);
                }

            }, TIMEOUT_MS);

        } catch (err) {
            logger.error('createkeyModal error:', err?.message, { stack: err?.stack });
            try {
                await interaction.editReply({
                    embeds: [errorEmbed('Error', 'Something went wrong. Please try again.')],
                });
            } catch (_) {}
        }
    },
};

export default createkeyProductSelectHandler;
export { createkeyOpenModalHandler, createkeyModalHandler };
