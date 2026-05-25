# スクリムエントリーBOT

## セットアップ

### 1. 依存パッケージをインストール

```bash
npm install
```

### 2. 環境変数を設定

`.env.example` をコピーして `.env` を作成し、各値を入力する。

```bash
cp .env.example .env
```

| 変数名 | 説明 | 必須 |
|---|---|---|
| `BOT_TOKEN` | BotのToken（Discord Developer Portal → Bot → Reset Token） | ✅ |
| `CLIENT_ID` | アプリケーションID（General Information → Application ID） | ✅ |
| `GUILD_ID` | サーバーID（サーバー名を右クリック → IDをコピー） | ✅ |
| `ENTRY_ROLE_ID` | エントリー時に付与するロールID | ✅ |
| `VC_TRIGGER_CHANNEL_ID` | 自動VC作成のトリガーチャンネルID（`/vc-setup` 実行後に設定） | 任意 |
| `VC_CATEGORY_ID` | エントリーVC作成先のカテゴリID | 任意 |

### 3. 起動

```bash
npm start
```

---

## コマンド一覧

| コマンド | 説明 |
|---|---|
| `/entry team:チーム名 member1:@ユーザー member2:@ユーザー` | スクリムエントリー（VC自動作成・ロール付与） |
| `/list` | エントリー一覧を表示 |
| `/cancel` | 自分のエントリーを取消（VC削除・ロール解除） |
| `/vc-setup` | 自動VC作成チャンネルをセットアップ（管理者のみ） |

---

## 仕様

- **締切**: 毎日 22:00 以降はエントリー不可
- **上限**: 100人（50チーム）
- **チーム構成**: メンバー①・メンバー②の2人
- **エントリー時**: チームVC自動作成・2人にロール付与
- **キャンセル時**: チームVC自動削除・2人のロール解除
- **自動VC**: 「➕ VCを作成」に入ると専用VCが作成され、全員退出で自動削除

---

## ホスティングサービスでの運用

Railway / Render / Fly.io などの場合、`.env` の代わりにサービスの環境変数設定画面で各値を入力してください。

`npm start` がエントリーポイントです。
