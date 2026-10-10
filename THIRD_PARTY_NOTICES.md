# Third-Party Notices

更新者：ClaudeC
最終更新日時：2026-10-10 14:06

QBDrumMap Web 自体のソースコードは MIT License（`LICENSE`）です。本書は第三者パッケージの一覧で、`LICENSE` とは別の権利関係です。`public/samples/DrumMap.qbd` に含まれる市販音源等の名称は各権利者に帰属し、MIT の許諾の対象ではありません（README 参照）。

## 1. 配信物にバンドルされるパッケージ（27件）

公開する `assets/*.js` に実際に組み込まれるパッケージです（本番ビルドのソースマップで確認）。各ライセンス全文と著作権表示は、リポジトリの [`public/THIRD_PARTY_LICENSES.txt`](public/THIRD_PARTY_LICENSES.txt) にあり、公開サイトでもビルド成果物として `./THIRD_PARTY_LICENSES.txt`（トップページと同じ階層）から取得できます。

| パッケージ | ライセンス | 著作権表示（LICENSEファイルの記載） |
| --- | --- | --- |
| @babel/runtime@7.29.10 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @emotion/cache@11.14.0 | MIT | Copyright (c) Emotion team and other contributors |
| @emotion/hash@0.9.2 | MIT | Copyright (c) Emotion team and other contributors |
| @emotion/is-prop-valid@1.4.0 | MIT | Copyright (c) Emotion team and other contributors |
| @emotion/memoize@0.9.0 | MIT | Copyright (c) Emotion team and other contributors |
| @emotion/react@11.14.0 | MIT | Copyright (c) Emotion team and other contributors |
| @emotion/serialize@1.3.3 | MIT | Copyright (c) Emotion team and other contributors |
| @emotion/sheet@1.4.0 | MIT | Copyright (c) Emotion team and other contributors |
| @emotion/styled@11.14.1 | MIT | Copyright (c) Emotion team and other contributors |
| @emotion/unitless@0.10.0 | MIT | Copyright (c) Emotion team and other contributors |
| @emotion/use-insertion-effect-with-fallbacks@1.2.0 | MIT | Copyright (c) Emotion team and other contributors |
| @emotion/utils@1.4.2 | MIT | Copyright (c) Emotion team and other contributors |
| @mui/material@9.4.0 | MIT | Copyright (c) 2014 Call-Em-All |
| @mui/private-theming@9.4.0 | MIT | Copyright (c) 2014 Call-Em-All |
| @mui/styled-engine@9.4.0 | MIT | Copyright (c) 2014 Call-Em-All |
| @mui/system@9.4.0 | MIT | Copyright (c) 2014 Call-Em-All |
| @mui/utils@9.4.0 | MIT | Copyright (c) 2014 Call-Em-All |
| @popperjs/core@2.11.8 | MIT | Copyright (c) 2019 Federico Zivolo |
| clsx@2.1.1 | MIT | Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com) |
| hoist-non-react-statics@3.3.2 | BSD-3-Clause | Copyright (c) 2015, Yahoo! Inc. All rights reserved. |
| react-dom@19.3.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| react-is@16.13.1 | MIT | Copyright (c) Facebook, Inc. and its affiliates. |
| react-is@19.3.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| react-transition-group@4.4.5 | BSD-3-Clause | Copyright (c) 2018, React Community |
| react@19.3.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| scheduler@0.28.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| stylis@4.2.0 | MIT | Copyright (c) 2016-present Sultan Tarimo |

## 2. package-lock.json の本番依存のうち、配信物にバンドルされないもの（56件）

`npm ci` でインストールされますが、公開する `dist-web/` には含まれません（ビルド時のみ使われる推移的依存など）。配布していないため全文は同梱しません。各ライセンスは各パッケージの npm 配布物を参照してください。

| パッケージ | ライセンス | 著作権表示（LICENSEファイルの記載） |
| --- | --- | --- |
| @babel/code-frame@7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @babel/generator@7.29.8 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @babel/helper-globals@7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @babel/helper-module-imports@7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @babel/helper-string-parser@7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @babel/helper-validator-identifier@7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @babel/parser@7.29.9 | MIT | Copyright (C) 2012-2014 by various contributors (see AUTHORS) |
| @babel/template@7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @babel/traverse@7.29.10 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @babel/types@7.29.8 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @emotion/babel-plugin@11.13.5 | MIT | Copyright (c) Emotion team and other contributors |
| @emotion/weak-memoize@0.4.0 | MIT | Copyright (c) Emotion team and other contributors |
| @jridgewell/gen-mapping@0.3.13 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> |
| @jridgewell/resolve-uri@3.1.2 | MIT | Copyright 2019 Justin Ridgewell <jridgewell@google.com> |
| @jridgewell/sourcemap-codec@1.6.0 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> |
| @jridgewell/trace-mapping@0.3.31 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> |
| @mui/core-downloads-tracker@9.4.0 | MIT | Copyright (c) 2014 Call-Em-All |
| @mui/types@9.4.0 | MIT | Copyright (c) 2014 Call-Em-All |
| @types/parse-json@4.0.2 | MIT | Copyright (c) Microsoft Corporation. |
| @types/prop-types@15.7.15 | MIT | Copyright (c) Microsoft Corporation. |
| @types/react-transition-group@4.4.12 | MIT | Copyright (c) Microsoft Corporation. |
| @types/react@19.3.0 | MIT | Copyright (c) Microsoft Corporation. |
| babel-plugin-macros@3.1.0 | MIT | Copyright (c) 2020 Kent C. Dodds |
| callsites@3.1.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| convert-source-map@1.9.0 | MIT | Copyright 2013 Thorsten Lorenz. |
| cosmiconfig@7.1.0 | MIT | Copyright (c) 2015 David Clark |
| csstype@3.2.3 | MIT | Copyright (c) 2017-2018 Fredrik Nicol |
| debug@4.4.3 | MIT | Copyright (c) 2014-2017 TJ Holowaychuk <tj@vision-media.ca> |
| dom-helpers@5.2.1 | MIT | Copyright (c) 2015 Jason Quense |
| error-ex@1.3.4 | MIT | Copyright (c) 2015 JD Ballard |
| es-errors@1.3.0 | MIT | Copyright (c) 2024 Jordan Harband |
| escape-string-regexp@4.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| find-root@1.1.0 | MIT | Copyright © 2017 jsdnxx |
| function-bind@1.1.2 | MIT | Copyright (c) 2013 Raynos. |
| hasown@2.0.4 | MIT | Copyright (c) Jordan Harband and contributors |
| import-fresh@3.3.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| is-arrayish@0.2.1 | MIT | Copyright (c) 2015 JD Ballard |
| is-core-module@2.17.0 | MIT | Copyright (c) 2014 Dave Justice |
| js-tokens@4.0.0 | MIT | Copyright (c) 2014, 2015, 2016, 2017, 2018 Simon Lydell |
| jsesc@3.1.0 | MIT | Copyright Mathias Bynens <https://mathiasbynens.be/> |
| json-parse-even-better-errors@2.3.1 | MIT | Copyright 2017 Kat Marchán |
| lines-and-columns@1.2.4 | MIT | Copyright (c) 2015 Brian Donovan |
| loose-envify@1.4.0 | MIT | Copyright (c) 2015 Andres Suarez <zertosh@gmail.com> |
| ms@2.1.3 | MIT | Copyright (c) 2020 Vercel, Inc. |
| object-assign@4.1.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| parent-module@1.0.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| parse-json@5.2.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| path-parse@1.0.7 | MIT | Copyright (c) 2015 Javier Blanco |
| path-type@4.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| picocolors@1.1.1 | ISC | Copyright (c) 2021-2024 Oleksii Raspopov, Kostiantyn Denysov, Anton Verinov |
| prop-types@15.8.1 | MIT | Copyright (c) 2013-present, Facebook, Inc. |
| resolve-from@4.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| resolve@1.22.13 | MIT | Copyright (c) 2012 James Halliday |
| source-map@0.5.7 | BSD-3-Clause | Copyright (c) 2009-2011, Mozilla Foundation and contributors |
| supports-preserve-symlinks-flag@1.0.0 | MIT | Copyright (c) 2022 Inspect JS |
| yaml@1.10.3 | ISC | Copyright 2018 Eemeli Aro <eemeli@gmail.com> |

## 3. 補足

- 本一覧は `package-lock.json` と本番ビルドから機械的に生成しました。依存を更新した場合は再生成してください（手順は `THIRD_PARTY_LICENSES.txt` の生成元と同じ：ビルドのソースマップから `node_modules` 配下のパッケージを列挙）。
- 開発用依存（テスト・ビルドツール）は配信しないため対象外です。
