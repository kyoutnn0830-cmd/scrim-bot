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
// エントリーに必須のロール（メンバー①②が両方持っている必要がある）
const REQUIRED_ROLE_ID = process.env.REQUIRED_ROLE_ID || '1444402009058054144';

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

// 手動締切の状態（管理者が /close で締切、/open で再開）
const STATE_FILE = path.join(DATA_DIR, 'state.json');

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('状態読込失敗:', e.message);
    }
    return { manuallyClosed: false };
}

function saveState() {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (e) {
        console.error('状態保存失敗:', e.message);
    }
}

const state = loadState();

// =====================
// ユーティリティ
// =====================

// エントリーが締め切られているか（管理者による手動締切のみ）
function isEntryClosed() {
    return state.manuallyClosed;
}

async function getRole(guild) {
    if (!ENTRY_ROLE_ID) return null;
    return guild.roles.cache.get(ENTRY_ROLE_ID)
        ?? await guild.roles.fetch(ENTRY_ROLE_ID);
}

async function hasRequiredRole(guild, userId) {
    if (!REQUIRED_ROLE_ID) return true;
    try {
        const member = await guild.members.fetch(userId);
        return member.roles.cache.has(REQUIRED_ROLE_ID);
    } catch (e) {
        console.error(`ロール確認失敗 (${userId}):`, e.message);
        return false;
    }
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
            if (isEntryClosed()) {
                return await interaction.reply({
                    content: '⛔ エントリーは締め切られました（管理者により締め切られています）',
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

            // メンバー①と②が同一人物でないかチェック
            if (member1.id === member2.id) {
                return await interaction.reply({
                    content: 'メンバー①とメンバー②は別の人を指定してください',
                    ephemeral: true
                });
            }

            // メンバー①②が両方とも必須ロールを持っているかチェック
            const [m1HasRole, m2HasRole] = await Promise.all([
                hasRequiredRole(interaction.guild, member1.id),
                hasRequiredRole(interaction.guild, member2.id)
            ]);
            if (!m1HasRole || !m2HasRole) {
                const missing = [];
                if (!m1HasRole) missing.push(`<@${member1.id}>`);
                if (!m2HasRole) missing.push(`<@${member2.id}>`);
                return await interaction.reply({
                    content: `⛔ エントリーには必須ロール <@&${REQUIRED_ROLE_ID}> が必要です\nロール未所持: ${missing.join(' ')}`,
                    ephemeral: true
                });
            }

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
🎭 参加者ロール付与済み`
            });
        }

        // 一覧
        else if (interaction.commandName === 'list') {
            if (entries.length === 0) {
                return await interaction.reply('現在エントリーはありません');
            }

            const total = entries.length * 2;

            const getName = async (id) => {
                try {
                    const m = await interaction.guild.members.fetch(id);
                    return m.displayName;
                } catch {
                    return '不明なユーザー';
                }
            };

            let text = `## エントリー一覧　${total} / ${ENTRY_LIMIT}人\n\n`;
            for (let i = 0; i < entries.length; i++) {
                const e = entries[i];
                const [name1, name2] = await Promise.all([
                    getName(e.member1),
                    getName(e.member2)
                ]);
                text +=
`${i + 1}. ${e.team}
👤 ${name1}
👤 ${name2}

`;
            }

            await interaction.reply({ content: text, allowedMentions: { parse: [] } });
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

        // 代理エントリー（管理者のみ）
        else if (interaction.commandName === 'add') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return await interaction.reply({
                    content: '⛔ このコマンドは管理者のみ使用できます',
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

            // メンバー①と②が同一人物でないかチェック
            if (member1.id === member2.id) {
                return await interaction.reply({
                    content: 'メンバー①とメンバー②は別の人を指定してください',
                    ephemeral: true
                });
            }

            // すでにエントリー済みのメンバーが含まれていないかチェック
            const already = entries.find(e =>
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
`✅ 代理エントリー完了

🏷️ チーム名: ${team}
👤 メンバー①: <@${member1.id}>
👤 メンバー②: <@${member2.id}>
🎭 参加者ロール付与済み`
            });
        }

        // 代理キャンセル（管理者のみ・/list の番号で指定）
        else if (interaction.commandName === 'remove') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return await interaction.reply({
                    content: '⛔ このコマンドは管理者のみ使用できます',
                    ephemeral: true
                });
            }

            const number = interaction.options.getInteger('number');
            const index = number - 1;
            if (index < 0 || index >= entries.length) {
                return await interaction.reply({
                    content: `⛔ 番号 ${number} のエントリーは存在しません（/list で確認してください）`,
                    ephemeral: true
                });
            }

            const removed = entries.splice(index, 1)[0];
            saveEntries();
            await Promise.all([
                removeRoleFromUser(interaction.guild, removed.member1),
                removeRoleFromUser(interaction.guild, removed.member2)
            ]);

            await interaction.reply(`❌ ${number}. ${removed.team} を削除しました（ロール解除済み）`);
        }

        // 手動締切（管理者のみ）
        else if (interaction.commandName === 'close') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return await interaction.reply({
                    content: '⛔ このコマンドは管理者のみ使用できます',
                    ephemeral: true
                });
            }

            if (state.manuallyClosed) {
                return await interaction.reply({
                    content: 'ℹ️ エントリーは既に締め切られています',
                    ephemeral: true
                });
            }

            state.manuallyClosed = true;
            saveState();
            await interaction.reply('🔒 エントリーを締め切りました（/open で再開できます）');
        }

        // 締切解除・再開（管理者のみ）
        else if (interaction.commandName === 'open') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return await interaction.reply({
                    content: '⛔ このコマンドは管理者のみ使用できます',
                    ephemeral: true
                });
            }

            if (!state.manuallyClosed) {
                return await interaction.reply({
                    content: 'ℹ️ エントリーは現在受付中です',
                    ephemeral: true
                });
            }

            state.manuallyClosed = false;
            saveState();
            await interaction.reply('🔓 エントリーを再開しました');
        }

        // 全リセット（管理者のみ）
        else if (interaction.commandName === 'reset') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return await interaction.reply({
                    content: '⛔ このコマンドは管理者のみ使用できます',
                    ephemeral: true
                });
            }

            if (entries.length === 0) {
                return await interaction.reply({
                    content: 'ℹ️ エントリーはありません（リセット不要）',
                    ephemeral: true
                });
            }

            const count = entries.length;
            // 全エントリーのメンバーIDを集めてロールを外す
            const memberIds = new Set();
            entries.forEach(e => {
                memberIds.add(e.member1);
                memberIds.add(e.member2);
            });

            entries.length = 0;
            saveEntries();

            await Promise.all(
                [...memberIds].map(id => removeRoleFromUser(interaction.guild, id))
            );

            await interaction.reply(`🗑️ エントリーを全てリセットしました（${count}チーム削除・ロール解除済み）`);
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
        .setDescription('エントリー取消'),

    new SlashCommandBuilder()
        .setName('add')
        .setDescription('代理エントリー（管理者のみ）')
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
        .setName('remove')
        .setDescription('代理キャンセル（管理者のみ・/list の番号で指定）')
        .addIntegerOption(option =>
            option.setName('number')
                .setDescription('/list に表示される番号')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('close')
        .setDescription('エントリーを締め切る（管理者のみ）'),

    new SlashCommandBuilder()
        .setName('open')
        .setDescription('エントリーを再開する（管理者のみ）'),

    new SlashCommandBuilder()
        .setName('reset')
        .setDescription('エントリー情報を全て消去する（管理者のみ）')
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
