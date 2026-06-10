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

## 機能要件

機能要件は [docs/functional-requirements.md](docs/functional-requirements.md) に整理しています。
添付仕様のRelation Tool v2.1を参考にしつつ、初期版は軽く動くMVPとして次を優先します。

- タスクの追加、編集、ドラッグ配置
- FS / SS / FF / SF とラグ付き依存線の作成
- 循環依存の防止
- CPM計算、クリティカル、余裕日数の表示
- ネットワーク図、ガント、表ビュー
- 領域フィルター、検索、フォーカス一覧
- localStorage、ローカルJSON、将来のBlob Storage保存

## 起動

```bash
node server/dev-server.js
```

ブラウザで開く:

```txt
http://127.0.0.1:3000
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

公開URL:

```txt
https://nomhck.github.io/e_relations/
```

注意:

- `server/` と `api/` はGitHub Pagesでは動きません。
- 複数人で同じ工程を保存・共有する場合はAzure Static Web Apps + APIへ移行します。

## Security Notes

- このリポジトリには秘密情報、APIキー、GitHub token、Azure接続文字列を入れない
- `.env`, `.env.*`, `local.settings.json`, `data/plans/*.json` はgit管理対象外です。
- ローカル開発サーバーは既定で `127.0.0.1` のみにbindします。
- GitHub Pages版は公開UIデモです。業務上の実データや機密工程を埋め込まないでください。
- `server/` のAPIはMVP用です。インターネット公開する場合は認証・編集キー・保存データ検証を追加してください。
