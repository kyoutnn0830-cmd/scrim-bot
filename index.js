require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    ChannelType,
    PermissionFlagsBits
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const ENTRY_ROLE_ID = process.env.ENTRY_ROLE_ID;

const ENTRY_DEADLINE = "22:00";
const ENTRY_LIMIT = 100; // エントリー人数上限（メンバー①+メンバー②=2人/チーム）

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// エントリー情報の永続化（再起動後も保持）
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'entries.json');

function loadEntries() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('エントリー読込失敗:', e.message);
    }
    return [];
}

function saveEntries() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(entries, null, 2));
    } catch (e) {
        console.error('エントリー保存失敗:', e.message);
    }
}

const entries = loadEntries();

// =====================
// ユーティリティ
// =====================

function isDeadlinePassed() {
    const now = new Date();
    const [hour, minute] = ENTRY_DEADLINE.split(":");
    const deadline = new Date();
    deadline.setHours(parseInt(hour));
    deadline.setMinutes(parseInt(minute));
    deadline.setSeconds(0);
    return now >= deadline;
}

async function getRole(guild) {
    if (!ENTRY_ROLE_ID) return null;
    return guild.roles.cache.get(ENTRY_ROLE_ID)
        ?? await guild.roles.fetch(ENTRY_ROLE_ID);
}

async function addRoleToUser(guild, userId) {
    try {
        const role = await getRole(guild);
        if (!role) return;
        const member = await guild.members.fetch(userId);
        if (member) await member.roles.add(role);
    } catch (e) {
        console.error(`ロール付与失敗 (${userId}):`, e.message);
    }
}

async function removeRoleFromUser(guild, userId) {
    try {
        const role = await getRole(guild);
        if (!role) return;
        const member = await guild.members.fetch(userId);
        if (member) await member.roles.remove(role);
    } catch (e) {
        console.error(`ロール解除失敗 (${userId}):`, e.message);
    }
}

// =====================
// 起動
// =====================

client.once('clientReady', () => {
    console.log(`${client.user.tag} 起動`);
});

// =====================
// スラッシュコマンド
// =====================

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    try {
        // エントリー
        if (interaction.commandName === 'entry') {
            if (isDeadlinePassed()) {
                return await interaction.reply({
                    content: `⛔ エントリーは締め切られました\n締切: ${ENTRY_DEADLINE}`,
                    ephemeral: true
                });
            }

            const currentCount = entries.length * 2;
            if (currentCount + 2 > ENTRY_LIMIT) {
                return await interaction.reply({
                    content: `⛔ エントリー上限（${ENTRY_LIMIT}人）に達しました\n現在: ${currentCount}人 / ${ENTRY_LIMIT}人`,
                    ephemeral: true
                });
            }

            const team = interaction.options.getString('team');
            const member1 = interaction.options.getUser('member1');
            const member2 = interaction.options.getUser('member2');

            // メンバー①またはメンバー②がすでにエントリー済みかチェック
            const already = entries.find(e =>
                e.member1 === interaction.user.id ||
                e.member2 === interaction.user.id ||
                e.member1 === member1.id ||
                e.member2 === member1.id ||
                e.member1 === member2.id ||
                e.member2 === member2.id
            );
            if (already) {
                return await interaction.reply({
                    content: '既にエントリー済みのメンバーが含まれています',
                    ephemeral: true
                });
            }

            // submitter = エントリーを送信した人（キャンセル権限の管理用）
            entries.push({
                team,
                submitter: interaction.user.id,
                member1: member1.id,
                member2: member2.id,
                vcChannelId: null
            });
            saveEntries();

            await Promise.all([
                addRoleToUser(interaction.guild, member1.id),
                addRoleToUser(interaction.guild, member2.id)
            ]);

            await interaction.reply({
                content:
`✅ エントリー完了

🏷️ チーム名: ${team}
👤 メンバー①: <@${member1.id}>
👤 メンバー②: <@${member2.id}>
🎭 参加者ロール付与済み
🕒 締切: ${ENTRY_DEADLINE}`
            });
        }

        // 一覧
        else if (interaction.commandName === 'list') {
            if (entries.length === 0) {
                return await interaction.reply('現在エントリーはありません');
            }

            const total = entries.length * 2;
            let text = `## エントリー一覧　${total} / ${ENTRY_LIMIT}人\n\n`;
            entries.forEach((e, i) => {
                text +=
`${i + 1}. ${e.team}
👤 <@${e.member1}>
👤 <@${e.member2}>

`;
            });

            await interaction.reply(text);
        }

        // キャンセル（エントリーした本人またはメンバーが実行可能）
        else if (interaction.commandName === 'cancel') {
            const index = entries.findIndex(e =>
                e.submitter === interaction.user.id ||
                e.member1 === interaction.user.id ||
                e.member2 === interaction.user.id
            );
            if (index === -1) {
                return await interaction.reply({
                    content: 'エントリーしていません',
                    ephemeral: true
                });
            }

            const cancelled = entries.splice(index, 1)[0];
            saveEntries();
            await Promise.all([
                removeRoleFromUser(interaction.guild, cancelled.member1),
                removeRoleFromUser(interaction.guild, cancelled.member2)
            ]);

            // チーム用VCを削除
            if (cancelled.vcChannelId) {
                try {
                    const vc = interaction.guild.channels.cache.get(cancelled.vcChannelId);
                    if (vc) await vc.delete();
                } catch (e) {
                    console.error('エントリーVC削除失敗:', e.message);
                }
            }

            await interaction.reply('❌ エントリー削除 & ロール解除 & VC削除完了');
        }

    } catch (e) {
        console.error('コマンド処理エラー:', e.message);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'エラーが発生しました', ephemeral: true }).catch(() => {});
        }
    }
});

// =====================
// スラッシュコマンド登録
// =====================

const commands = [
    new SlashCommandBuilder()
        .setName('entry')
        .setDescription('スクリムエントリー')
        .addStringOption(option =>
            option.setName('team')
                .setDescription('チーム名')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('member1')
                .setDescription('メンバー①')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('member2')
                .setDescription('メンバー②')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('list')
        .setDescription('エントリー一覧'),

    new SlashCommandBuilder()
        .setName('cancel')
        .setDescription('エントリー取消')
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    try {
        console.log('スラッシュコマンド登録中...');
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands }
        );
        console.log('コマンド登録完了');
    } catch (error) {
        console.error('コマンド登録失敗:', error.message);
        process.exit(1);
    }

    await client.login(TOKEN);
})();
