# QBDrumMap Web

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![React 19](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)
![TypeScript 7](https://img.shields.io/badge/TypeScript-7-3178c6?logo=typescript&logoColor=white)
![Vite 8](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white)
![MUI 9](https://img.shields.io/badge/MUI-9-007fff?logo=mui&logoColor=white)
[![CI](https://github.com/MinMax25/QBDrumMap-Web/actions/workflows/ci.yml/badge.svg)](https://github.com/MinMax25/QBDrumMap-Web/actions/workflows/ci.yml)

Windows版 [QBDrumMap](https://github.com/MinMax25/QBDrumMap) と `.qbd` ファイルを共有する、デスクトップブラウザ向けのドラムマップ編集・MIDI変換アプリケーションです。

公開URL：https://minmax25.github.io/QBDrumMap-Web/ （GitHub Pages）

> **開発中**：機能は開発途上で、仕様が変わることがあります。

## 主な機能

- `.qbd` の読込・編集（Plugin／Kit／Pitch、Parts、DrumMap Order）・保存（ダウンロード）、Undo／Redo
- Auto Assign、Articulation のコピー、Pitch 順の整列
- Import（`.pitchlist`／`.drm`／`.tsv`）と Export（Studio One、Cubase、Cubase Base-On、Text、NoteMapper、QB Drummer）
- Convert MIDI（Kit 間の MIDI 変換）
- Settings（Export／変換の設定、画面テーマ、PartNameDictionary の編集）
- 作業状態の自動復元（ブラウザの IndexedDB）

## 使い方

1. ヘッダーの「サンプルを開く」で公開サンプル（139 Kit）を、「開く」で手元の `.qbd` を読み込みます。
2. 編集して「保存」（ダウンロード）します。サンプルを編集しても、公開側の原本は変わりません。
3. Export・Convert MIDI は左のメニューから実行します。

利用者のファイルはブラウザ内で処理し、サーバーへ送信しません。

## 対象環境と検証状況

- 想定：Windows の Chrome／Edge、macOS の Safari／Chrome（デスクトップ）。DAW は Studio One（Fender Studio Pro）と Cubase。
- 対象外：モバイル最適化、サーバー・ユーザー登録・クラウド保存。
- 検証済み：Chromium 系ブラウザでの表示・サンプル読込・自動テスト、公開サイト（GitHub Pages）での起動と「サンプルを開く」。DAW については、開発者の報告として Studio One で本アプリが変換した MIDI を読み込み、変換先 Kit 名とノート表示を確認しています。
- 未確認：すべての Kit のノート配置、音源の再生、Cubase での読込、Safari・Firefox、公開サイト上での `.qbd` の読込・保存・Export・MIDI 変換・自動復元の操作。完全な互換性を保証するものではありません。

## 注意

- 自動復元の保存先はブラウザ（オリジンごと）の IndexedDB です。サイトデータの削除やプライベートモードでは消えます。大切なデータは必ず `.qbd` として保存してください。
- ダウンロードの成否（保存先への書込み完了）はブラウザから検知できません。
- `localhost` と公開 URL では保存領域が別で、作業状態は引き継がれません。

## サンプルQBDについて

`public/samples/DrumMap.qbd` は動作確認用のサンプルです。市販ドラム音源等の名称（Plugin／Kit 名）を含みます。これらの名称・商標は各権利者に帰属し、MIT による許諾の対象ではなく、各製品の提供元との関係を示すものでもありません。

## 開発

Node.js 24 を使います。

```bash
npm ci
npm run dev          # 開発サーバー
npm run typecheck    # 型チェック
npm run test         # テスト
npm run build        # Core のビルド
npm run build:web    # 公開用ビルド（dist-web/）
```

- 技術構成：React／TypeScript／Vite／MUI。UI に依存しない純 TypeScript の Core（`src/core`）と UI（`src/ui`）に分かれています。
- CI：`.github/workflows/ci.yml`（検証のみ）。GitHub Pages へのデプロイは `.github/workflows/pages.yml` を手動起動（`workflow_dispatch`）したときだけ行います。
- `tests/golden/` の期待値は Windows 版の出力から作成したものです（再生成用のハーネスは公開リポジトリに含めていません）。

## ライセンス

このソースコードは [MIT License](LICENSE) です（Copyright (c) 2025-2026 Min Max。Windows版と同じ著作権者表記）。第三者ライブラリは別のライセンスに従います。一覧は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)、配布物にバンドルされるライブラリのライセンス全文は [public/THIRD_PARTY_LICENSES.txt](public/THIRD_PARTY_LICENSES.txt)（公開サイトでは `THIRD_PARTY_LICENSES.txt` として取得できます）にあります。サンプルQBDに含まれる名称は上記のとおり MIT の対象外です。
