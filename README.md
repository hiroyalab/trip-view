# ハワイ旅行プラン

スマホで見るための旅行プランページです。画面上部の地図と下部のプランが連動し、スクロールして見ているスポットに地図のピンが移動します。
プランの内容は `data/plan.json` から読み込むので、HTMLを触らずに何度でも変更できます。

## フォルダ構成

```
.
├── index.html            ページ本体
├── css/style.css         見た目
├── js/app.js             地図連動・JSON読み込み
├── data/plan.json        旅行プラン（ここを編集する）
├── images/               スポットの写真を置く場所
├── vendor/leaflet/       地図ライブラリ Leaflet 1.9.4（BSD-2-Clause）
└── vercel.json           Vercel用の設定（セキュリティヘッダーなど）
```

ビルドは不要です。ファイルをそのまま配信する静的サイトです。

## ローカルで確認する

`index.html` をダブルクリックで開くと、ブラウザの制限でJSONと地図が読み込めません。簡易サーバーを立てて開いてください。

```bash
npx serve .
# または
python3 -m http.server 8000
```

スマホで確認するときは、同じWi-Fiにつないで `http://<PCのIPアドレス>:8000` を開きます。

## Vercelにデプロイする

1. このフォルダをGitHubのリポジトリとしてpushします。
   ```bash
   git init
   git add .
   git commit -m "first commit"
   git branch -M main
   git remote add origin https://github.com/<ユーザー名>/<リポジトリ名>.git
   git push -u origin main
   ```
2. Vercelのダッシュボードで **Add New → Project** を選び、リポジトリをインポートします。
3. Framework Preset は **Other** を選び、Build Command と Output Directory は空のまま **Deploy** します。

以後は `main` にpushするたびに自動で再デプロイされます。

## プランを編集する

`data/plan.json` を書き換えてpushするだけです。`data/` 配下はキャッシュしない設定なので、デプロイ後すぐに反映されます。

```json
{
  "title": "オアフ島 4日間",
  "subtitle": "2026年11月20日〜23日",
  "days": [
    {
      "label": "1日目",
      "date": "11/20 (金)",
      "theme": "到着してワイキキへ",
      "spots": [
        {
          "time": "13:00",
          "name": "ワイキキビーチ",
          "address": "Waikiki Beach, Honolulu, HI 96815",
          "lat": 21.2766,
          "lng": -157.8278,
          "photo": { "commons": "File:Waikiki Beach (2024)-L1004709.jpg" },
          "description": "まずは海へ。",
          "tags": ["ビーチ"],
          "url": "https://example.com/"
        }
      ]
    }
  ]
}
```

| 項目 | 必須 | 内容 |
|---|---|---|
| `name` | ○ | スポット名 |
| `address` | | 住所。タップでGoogleマップが開く |
| `lat` / `lng` | | 緯度・経度。省略すると住所から自動取得（精度は住所次第なので、入れておくのがおすすめ） |
| `time` | | 時刻 |
| `photo` | | 写真。書き方は下の「写真と権利」を参照。読めない場合はスポット名入りの色面を表示 |
| `description` | | 説明文 |
| `tags` | | タグの配列 |
| `url` | | 公式サイトなどのリンク |
| `zoom` | | 表示中の地図の拡大率（既定 14） |

緯度・経度はGoogleマップで場所を長押しすると表示されます。

## 写真と権利

`photo` は4通りの書き方ができます。

| 書き方 | 例 | 権利の確認 |
|---|---|---|
| Commonsの写真を指定 | `{ "commons": "File:Waikiki Beach (2024)-L1004709.jpg" }` | 自動（下記） |
| Commonsから自動で探す | `{ "search": "Hanauma Bay" }` | 自動（下記） |
| 自分で用意した写真 | `"images/waikiki.jpg"` | 自分で撮った写真を使う |
| 他サイトの写真 | `{ "url": "https://...", "credit": "作者名", "license": "CC BY 4.0", "licenseUrl": "https://creativecommons.org/licenses/by/4.0/", "source": "https://元ページ" }` | 自分で確認してクレジットを書く |

`commons` と `search` を使った場合は、表示のたびに [Wikimedia Commons](https://commons.wikimedia.org/) の公式APIでライセンスを確認します。

- 採用するのは、ライセンスが **CC0 / パブリックドメイン / CC BY / CC BY-SA** の写真だけです。それ以外のライセンスの写真は表示しません。
- 写真の下に、作者・ライセンス・元ページへのリンクを自動で表示します（CC BY / BY-SA は作者表記が利用条件です）。
- `search` は検索で上位に出た横長の写真を自動で選びます。イメージと違う写真が出たら、Commonsで気に入った写真を探し、そのファイル名を `commons` に書いて固定してください。
- 確認結果はブラウザに7日間キャッシュします。

ストックフォト、Instagram、Googleマップの写真、お店の公式サイトの写真などは、許可なく使えません。

### 写真URLをJSONに書き込む

`search` / `commons` のままでも表示できますが、実際のURLとクレジットをJSONに固定したいときは次を実行します（Node.js 18以上）。

```bash
node tools/resolve-photos.mjs data/waikiki.json
```

Commons APIでライセンスを確認し、条件に合う写真だけを `{ "url", "credit", "license", "licenseUrl", "source" }` に書き換えます。実行後に `git diff` で選ばれた写真を確認してからpushしてください。

## AIにプランを作ってもらうとき

`prompts/plan-prompt.md` に、そのまま貼り付けて使えるプロンプトを置いています。冒頭の【 】の部分（行き先・日程・同行者・移動手段・やりたいこと）を書き換えて使ってください。

出てきたJSONは `data/` に保存し、写真を固定するために次を実行します。

```bash
node tools/resolve-photos.mjs data/<ファイル名>.json
```

### 複数のプランを持つ

`data/` に別のJSON（例：`data/maui.json`）を置き、`https://<ドメイン>/?plan=data/maui.json` で開けます。同じサイト内の `.json` しか指定できません。

## セキュリティについて

- JSONの内容はすべて文字列としてページに入れており、HTMLとして実行されません（XSS対策）。
- 写真とリンクは `http(s)` と相対パスだけを受け付け、`javascript:` などは無視します。Commonsの作者欄（HTML）は文字だけを取り出して表示します。
- `vercel.json` でContent-Security-Policyを設定し、スクリプトはこのサイト自身のファイルからしか読み込めないようにしています。外部のスクリプトを追加する場合は `script-src` に追記が必要です。
- 公開URLは誰でも閲覧できます。予約番号や連絡先など、他人に見られたくない情報は `plan.json` に書かないでください。限られた人だけに見せたい場合は、VercelのDeployment Protection（パスワード保護）を検討してください。

## 地図について

地図は OpenStreetMap の公式タイル（APIキー不要）を使っています。[利用ポリシー](https://operations.osmfoundation.org/policies/tiles/)上、個人利用程度のアクセスを想定したものです。多くの人に公開する場合は、MapTilerなどキー付きのタイルサービスに切り替えてください（ドメイン制限をかけたキーを使い、`vercel.json` の `img-src` も合わせて更新します）。

Commonsの写真の確認には Wikimedia Commons API を、住所からの位置取得には OpenStreetMap の Nominatim を使っています（1秒に1件まで。結果はブラウザに保存して再取得しません）。
