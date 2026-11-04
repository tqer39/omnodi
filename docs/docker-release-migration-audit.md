# Docker 配布の移行監査

2026年11月3日に、Omnodi への改名後もクイックスタートが旧版を参照していた問題を調査しました。
調査対象はリポジトリ内の追跡対象ファイル全体、Docker ビルド入力、CI・Release ワークフロー、GHCR・GitHub Release の現況です。
関連する terraform-github の main にあるリポジトリ管理設定も読み取り確認しました。

## 発見した問題と対応

| 対象               | 問題                                                                                 | 対応                                                                               |
| ------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| README             | 起動例・ファイル指定例・pull 例・GHCR リンク・最新版案内が旧イメージの v0.1.1 を参照 | 公開確認後に `ghcr.io/tqer39/omnodi:0.2.0` と新配布先の `latest` へ統一            |
| Release の事前照合 | 新規パッケージへの匿名認証が403となり、最初のビルドへ進めない                        | publish の事前照合だけ既存 `GITHUB_TOKEN` で認証。404 以外の失敗は引き続き停止     |
| 初回 Public 設定   | パッケージの初期状態は Private。通常のリポジトリ公開とは別に設定が必要               | 初回 push 後の可視性確認・必要時の Public 設定・匿名検証・失敗ジョブ再実行を手順化 |
| リリース手順       | 読み取り検証例が旧リポジトリ名・v0.1.0・旧 digest で固定                             | 新配布イメージの実際の版・SHA・digest に更新                                       |
| 公開監査           | 過去の `latest` の記録が現在の配布先と混同され得る                                   | 履歴であることと新しい配布先への案内を追記                                         |

Release 本文の「使い方」リンクも、公開前の旧イメージ案内を含むタグ内 README を参照していました。
今後生成する本文と v0.2.0 の本文は main の最新 README に誘導し、版固定の起動コマンドとソース SHA は維持します。

パイプラインの生成イメージ名は `GITHUB_REPOSITORY` 由来で、新名への対応済みでした。
Dockerfile のソースラベル、通常 Docker CI のタグ、CLI、package/lockfile の名前、画面タイトル、HTML 出力、ライセンス表記も Omnodi でした。
依存パッケージ自身の名前や履歴上の表記まで一括置換する変更は行っていません。

## 維持する旧名

| 対象                                                                        | 維持する理由                                                                 |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/assistant/settings-store.ts` の旧ディレクトリー名と `infra-canvas.llm` | 既存設定と OS 資格情報ストアの保存済み API キーを引き継ぐため                |
| `src/viewer/CvePanel.tsx` の `infra-canvas-cve`                             | IndexedDB の既存 CVE キャッシュを失わないため                                |
| `src/export.ts`・`src/viewer/main.tsx` の `__INFRA_CANVAS*`                 | 旧 HTML のモデル読み込み互換性を維持するため                                 |
| Release 本文の `infra-canvas-release`                                       | 公開済み Release の同一 SHA・digest を識別し、再実行時の上書きを防ぐため     |
| `docs/verification.md` の旧レイアウト版・過去のリリースノート・監査記録     | 当時の検証結果と履歴を正確に保存するため                                     |
| 旧 GHCR パッケージの v0.1.0・v0.1.1・latest                                 | 既存利用者の固定参照を維持するため。今後の更新先は新パッケージ               |
| terraform-github の backend key に含まれる旧名                              | 既存 state の継続利用のため。main の管理対象リポジトリは `omnodi` に変更済み |

GitHub の contributors に残る `infra-canvas-icon-updater` は既存 GitHub App の識別名です。
Omnodi の配布イメージ名ではなく、この作業では App の名称・認証情報・権限を変更していません。

## 検証

[リリース準備 PR #76](https://github.com/tqer39/omnodi/pull/76) で次を確認しました。

- `mise run check`、`mise run standards:verify`・`finish`、差分検査が成功。
- 単体テスト291件、ブラウザーテスト215件、アイコン検証11件が成功。
- ローカルの arm64 と amd64 の Docker 起動・HTTP・API 保護・非 root・編集・DSL 保存/読み込み・healthcheck・読み取り専用マウントが成功。amd64 は Apple Silicon 上の互換実行です。
- PR の通常 CI 全3分割、GitHub-hosted runner の Docker 両 CPU、共通ルール検証、自動レビューが成功。
- 回帰テストで初回照合の404、認証付き照合、認証失敗・通信障害時の停止を確認。匿名クライアントが GitHub 認証情報を送らないことも確認。

[Release 実行](https://github.com/tqer39/omnodi/actions/runs/41583538637) は全ジョブ成功し、
[Omnodi v0.2.0](https://github.com/tqer39/omnodi/releases/tag/v0.2.0) を公開しました。

- ソース SHA: `e19e233ce1bc04593495d100b0ff3ff40bd4de50`
- `ghcr.io/tqer39/omnodi:0.2.0` と `latest` の digest: `sha256:f252f2a5695e0c71bc4bd12b5c345c5b8261a01387b49c20465f173d0807ba23`
- Public 表示と匿名取得を確認しました。この実行では可視性の変更操作は不要でした。
- GitHub-hosted の arm64・amd64 で配布済み digest の匿名 pull、起動・ブラウザー操作・保存・マウント等が成功した後に `latest` を更新しました。
- 旧パッケージの v0.1.0・v0.1.1・latest は公開前後で SHA・digest・版が不変でした。

旧 v0.1.0 の digest は `sha256:66fe8b3cbac5d3dc845275b6a941fa79f6785df0e828e4a551f33a6c0fc64de9`、
旧 v0.1.1・latest は `sha256:5fcc842a0f7b745add4f54d6e387559d9bc080fa7b006d285e9157d8ccb959d4` です。

## 調査の範囲と制約

名称・版・公開先・参照リンク・互換性・配布手順の整合を対象としています。
全依存関係の脆弱性修正や未マージ PR の取り込み、別プロジェクトの Terraform 適用は対象外です。
調査時に確認した `re2js` の既存 Dependabot アラートは開発依存に関するもので、この作業では変更していません。
過去の GitHub Release と旧イメージの内容は変更しません。
