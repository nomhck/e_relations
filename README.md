# E Relations

EPC工程の依存関係をGUIで編集するローカル実行可能なMVPです。

## 構成

```txt
web/      ブラウザ画面
api/      APIハンドラと保存ロジック
server/   ローカル開発サーバー
data/     ローカルJSON保存先
docs/     設計資料
```

本番想定では `web/` を Azure Static Web Apps、`api/` を Azure Functions、保存先を Azure Blob Storage に置き換えます。
ローカルではAzureを使わず、`data/plans/*.json` に保存します。

## 起動

```bash
node server/dev-server.js
```

ブラウザで開く:

```txt
http://localhost:3000
```

## チェック

```bash
node --check server/dev-server.js
node --check api/handlers/plans.js
node --check api/lib/storage.local.js
node --check web/app.js
```

`npm` がある環境では `npm run dev` と `npm run check` でも実行できます。
