# E Relations

EPC工程の依存関係をGUIで編集するローカル実行可能なMVPです。

## 構成

```txt
web/      ブラウザ画面
api/      APIハンドラと保存ロジック
server/   ローカル開発サーバー
data/     ローカルJSON保存先
docs/     GitHub Pages公開用ファイルと設計資料
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

## GitHub Pages

`docs/` 配下に静的GUIを配置しています。GitHub PagesではAPIは動かないため、保存はブラウザのlocalStorageのみです。

公開設定:

```txt
GitHub repo > Settings > Pages
Source: Deploy from a branch
Branch: main
Folder: /docs
```

公開URL:

```txt
https://nomhck.github.io/e_relations/
```

注意:

- `server/` と `api/` はGitHub Pagesでは動きません。
- 複数人で同じ工程を保存・共有する場合はAzure Static Web Apps + APIへ移行します。
