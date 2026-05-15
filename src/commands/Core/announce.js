import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Send a custom announcement to any channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('The channel to send the announcement to')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('title')
                .setDescription('The title of the announcement')
                .setRequired(true)
                .setMaxLength(256)
        )
        .addStringOption(option =>
            option
                .setName('message')
                .setDescription('The announcement message content')
                .setRequired(true)
                .setMaxLength(4000)
        )
        .addStringOption(option =>
            option
                .setName('color')
                .setDescription('Embed color (hex code e.g. #FF0000) — default is red')
                .setRequired(false)
        )
        .addAttachmentOption(option =>
            option
                .setName('image')
                .setDescription('Optional image to attach to the announcement')
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('footer')
                .setDescription('Optional footer text')
                .setRequired(false)
                .setMaxLength(256)
        )
        .addBooleanOption(option =>
            option
                .setName('ping_everyone')
                .setDescription('Ping @everyone with this announcement? (default: false)')
                .setRequired(false)
        ),

    async execute(interaction) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferSuccess) {
            logger.warn('Announce interaction defer failed', {
                userId:      interaction.user.id,
                guildId:     interaction.guildId,
                commandName: 'announce',
            });
            return;
        }

        try {
            // ── Gather options ──────────────────────────────
            const channel     = interaction.options.getChannel('channel');
            const title       = interaction.options.getString('title');
            const message     = interaction.options.getString('message');
            const colorInput  = interaction.options.getString('color');
            const image       = interaction.options.getAttachment('image');
            const footerText  = interaction.options.getString('footer');
            const pingEveryone = interaction.options.getBoolean('ping_everyone') ?? false;

            // ── Validate channel is text-based ──────────────
            if (!channel.isTextBased()) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [createEmbed({
                        title:       '❌ Invalid Channel',
                        description: 'Please select a text-based channel.',
                        color:       'error',
                    })],
                });
            }

            // ── Validate color ──────────────────────────────
            let embedColor = 0xE03131; // default red
            if (colorInput) {
                const hex = colorInput.replace('#', '');
                const parsed = parseInt(hex, 16);
                if (isNaN(parsed) || hex.length !== 6) {
                    return await InteractionHelper.safeEditReply(interaction, {
                        embeds: [createEmbed({
                            title:       '❌ Invalid Color',
                            description: 'Please provide a valid hex color code, e.g. `#FF0000`.',
                            color:       'error',
                        })],
                    });
                }
                embedColor = parsed;
            }

            // ── Validate image is actually an image ─────────
            if (image && !image.contentType?.startsWith('image/')) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [createEmbed({
                        title:       '❌ Invalid File',
                        description: 'The attachment must be an image file (PNG, JPG, GIF, etc.).',
                        color:       'error',
                    })],
                });
            }

            // ── Build the announcement embed ────────────────
            // Replace literal \n in the message string with real newlines
            const formattedMessage = message.replace(/\\n/g, '\n');

            const announcementEmbed = new EmbedBuilder()
                .setColor(embedColor)
                .setTitle(title)
                .setDescription(formattedMessage)
                .setTimestamp()
                .setFooter({
                    text: footerText || `Announced by ${interaction.user.username}`,
                    iconURL: interaction.user.displayAvatarURL({ dynamic: true }),
                });

            if (image) {
                announcementEmbed.setImage(image.url);
            }

            // ── Send to target channel ──────────────────────
            await channel.send({
                content: pingEveryone ? '@everyone' : null,
                embeds:  [announcementEmbed],
            });

            // ── Confirm to admin ────────────────────────────
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({
                    title:       '✅ Announcement Sent',
                    description: `Your announcement was successfully sent to ${channel}.`,
                    color:       'success',
                })],
            });

            logger.info('Announcement sent', {
                guildId:   interaction.guildId,
                channelId: channel.id,
                userId:    interaction.user.id,
                title,
            });

        } catch (error) {
            logger.error('Announce command error:', error);
            try {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [createEmbed({
                        title:       'System Error',
                        description: 'Could not send the announcement. Make sure I have permission to send messages in that channel.',
                        color:       'error',
                    })],
                });
            } catch (replyError) {
                logger.error('Failed to send error reply:', replyError);
            }
        }
    },
};
