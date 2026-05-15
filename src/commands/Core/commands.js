import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// ──────────────────────────────────────────
//  ALL COMMANDS  grouped by category
//  Edit this object to add / remove commands
// ──────────────────────────────────────────
export const COMMANDS_BY_CATEGORY = {
    '⚙️ Core': [
        'bug', 'overview', 'ping', 'stats', 'support', 'uptime',
    ],
    '🎮 Voice': [
        'activity blazing8s', 'activity bobble', 'activity checkers', 'activity chess',
        'activity knowwhat', 'activity landio', 'activity letter-league', 'activity poker',
        'activity puttparty', 'activity sketch', 'activity spellcast', 'activity youtube',
    ],
    '🏘️ Community': [
        'app-admin dashboard', 'app-admin list', 'app-admin review', 'app-admin setup',
        'apply list', 'apply status', 'apply submit',
    ],
    '👋 Welcome': [
        'autorole add', 'autorole list', 'autorole remove',
        'goodbye setup', 'greet dashboard', 'welcome setup',
    ],
    '✅ Verification': [
        'autoverify dashboard', 'autoverify setup',
        'verification dashboard', 'verification remove', 'verification setup', 'verify',
    ],
    '🔧 Utility': [
        'avatar', 'firstmsg', 'report file', 'report setchannel',
        'serverinfo', 'todo add', 'todo complete', 'todo list', 'todo remove',
        'todo share add', 'todo share addtask', 'todo share create', 'todo share remove',
        'todo share view', 'userinfo', 'weather', 'wipedata',
    ],
    '💰 Economy': [
        'balance', 'beg', 'buy', 'crime', 'daily', 'deposit', 'eleaderboard',
        'fish', 'gamble', 'inventory', 'mine', 'pay', 'rob', 'shop browse',
        'shop config setrole', 'slut', 'withdraw', 'work',
    ],
    '🔨 Moderation': [
        'ban', 'cases', 'dm', 'kick', 'lock', 'massban', 'masskick',
        'purge', 'timeout', 'unban', 'unlock', 'untimeout', 'usernotes add',
        'usernotes clear', 'usernotes remove', 'usernotes view', 'warn', 'warnings',
    ],
    '🛠️ Tools': [
        'baseconvert', 'calculate', 'countdown', 'embedbuilder', 'generatepassword',
        'hexcolor', 'poll', 'randomuser', 'shorten', 'time', 'unixtime',
    ],
    '😄 Fun': [
        'fact', 'fight', 'flip', 'mock', 'reverse', 'roll', 'ship', 'wanted',
    ],
    '🔍 Search': [
        'define', 'google', 'movie', 'urban',
    ],
    '🎉 Giveaway': [
        'gcreate', 'gdelete', 'gend', 'greroll',
    ],
    '📈 Leveling': [
        'leaderboard', 'level dashboard', 'level setup',
        'leveladd', 'levelremove', 'levelset', 'rank',
    ],
    '📋 Logging': [
        'logging dashboard', 'logging filter add', 'logging filter remove', 'logging setchannel',
    ],
    '🎫 Ticket': [
        'claim', 'close', 'priority', 'ticket dashboard', 'ticket setup',
    ],
    '🔗 JoinToCreate': [
        'jointocreate dashboard', 'jointocreate setup',
    ],
    '📊 ServerStats': [
        'serverstats create', 'serverstats delete', 'serverstats list', 'serverstats update',
    ],
    '😮 Reaction Roles': [
        'reactroles dashboard', 'reactroles setup',
    ],
    '🎂 Birthday': [
        'birthday info', 'birthday list', 'birthday next',
        'birthday remove', 'birthday set', 'birthday setchannel',
    ],
};

const TOTAL_COMMANDS   = Object.values(COMMANDS_BY_CATEGORY).reduce((n, c) => n + c.length, 0);
const TOTAL_CATEGORIES = Object.keys(COMMANDS_BY_CATEGORY).length;
const FIELDS_PER_PAGE  = 8; // categories per page

// ──────────────────────────────────────────
//  BUILD PAGES  (pre-built once at startup)
// ──────────────────────────────────────────
function buildPages() {
    const allFields = Object.entries(COMMANDS_BY_CATEGORY).map(([cat, cmds]) => ({
        name: cat,
        value: cmds.map(c => `\`/${c}\``).join('  '),
        inline: false,
    }));

    const chunks = [];
    for (let i = 0; i < allFields.length; i += FIELDS_PER_PAGE) {
        chunks.push(allFields.slice(i, i + FIELDS_PER_PAGE));
    }

    const total = chunks.length;
    return chunks.map((fields, i) =>
        createEmbed({
            title: '📋  Bot Command List',
            description: [
                `> Use \`/\` followed by any command name to run it.`,
                `> **${TOTAL_COMMANDS} commands** across **${TOTAL_CATEGORIES} categories**`,
            ].join('\n'),
            color: 'primary',
        })
        .addFields(fields)
        .setFooter({ text: `Page ${i + 1} of ${total}  •  Titan Bot` })
        .setTimestamp()
    );
}

// ──────────────────────────────────────────
//  PAGINATION ROW  — exported for button handler
// ──────────────────────────────────────────
export function buildCommandsRow(currentPage, totalPages) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`commands_prev_${currentPage}`)
            .setLabel('◀  Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === 0),
        new ButtonBuilder()
            .setCustomId(`commands_next_${currentPage}`)
            .setLabel('Next  ▶')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === totalPages - 1),
    );
}

// Pre-built pages shared with the button handler via named export
export const COMMANDS_PAGES = buildPages();

// ──────────────────────────────────────────
//  COMMAND EXPORT  (default — matches your loader pattern)
// ──────────────────────────────────────────
export default {
    data: new SlashCommandBuilder()
        .setName('commands')
        .setDescription('Shows a full list of all available bot commands'),

    async execute(interaction) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn('Commands interaction defer failed', {
                userId:      interaction.user.id,
                guildId:     interaction.guildId,
                commandName: 'commands',
            });
            return;
        }

        try {
            await InteractionHelper.safeEditReply(interaction, {
                embeds:     [COMMANDS_PAGES[0]],
                components: COMMANDS_PAGES.length > 1
                    ? [buildCommandsRow(0, COMMANDS_PAGES.length)]
                    : [],
            });
        } catch (error) {
            logger.error('Commands command error:', error);
            try {
                await InteractionHelper.safeReply(interaction, {
                    embeds: [createEmbed({
                        title:       'System Error',
                        description: 'Could not load the command list at this time.',
                        color:       'error',
                    })],
                    flags: MessageFlags.Ephemeral,
                });
            } catch (replyError) {
                logger.error('Failed to send error reply:', replyError);
            }
        }
    },
};
