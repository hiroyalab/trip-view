#!/usr/bin/env node
// 使い方: node tools/resolve-photos.mjs data/waikiki.json
//
// plan JSON の photo（配列の場合は各要素）が { "search": "..." } または { "commons": "File:..." } のものについて、
// Wikimedia Commons API でライセンスを確認し、実際の画像URLとクレジットに書き換える。
// 採用するのは CC0 / パブリックドメイン / CC BY / CC BY-SA の写真だけ。
// 見つからなかったスポットは元のまま残し、最後に一覧を表示する。
// Node.js 18 以上（fetch 内蔵）で動作。外部パッケージは不要。

import { readFile, writeFile } from "node:fs/promises";

const file = process.argv[2];
if (!file || !file.endsWith(".json")) {
  console.error("使い方: node tools/resolve-photos.mjs data/xxx.json");
  process.exit(1);
}

const API = "https://commons.wikimedia.org/w/api.php";
const UA = "hawaii-trip-plan/1.0 (photo license check; personal travel page)"; // Wikimedia はUA指定を推奨
const ALLOWED = /^(CC0|Public domain|CC BY(-SA)? \d\.\d)/i;
// Commons の画像配信ホスト（サムネイルは thumb.wikimedia.org から返ることがある）
const IMAGE_HOST = /^https:\/\/(upload|thumb)\.wikimedia\.org\//;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// HTML を文字だけにする（作者欄はHTMLで返る）
const plain = (h) =>
  String(h ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, 120);

async function lookup(q) {
  const params = new URLSearchParams({
    action: "query", format: "json", prop: "imageinfo",
    iiprop: "url|size|extmetadata", iiurlwidth: "1280",
    iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist",
  });
  if (q.commons) {
    const t = String(q.commons).trim();
    params.set("titles", /^file:/i.test(t) ? t : "File:" + t);
  } else {
    params.set("generator", "search");
    params.set("gsrnamespace", "6");
    params.set("gsrsearch", `${q.search} filetype:bitmap`);
    params.set("gsrlimit", "10");
  }
  const res = await fetch(`${API}?${params}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Commons API ${res.status}`);
  const json = await res.json();
  const pages = Object.values(json.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  for (const pg of pages) {
    const ii = pg.imageinfo?.[0];
    if (!ii) continue;
    const m = ii.extmetadata ?? {};
    const license = plain(m.LicenseShortName?.value);
    if (!ALLOWED.test(license)) continue;
    if (q.search && ii.width < ii.height) continue; // 自動検索では横長を優先
    const url = ii.thumburl || ii.url;
    if (!url || !IMAGE_HOST.test(url)) continue;
    const licenseUrl = plain(m.LicenseUrl?.value);
    return {
      url,
      credit: plain(m.Artist?.value) || "作者不明",
      license,
      ...(licenseUrl.startsWith("https://") || licenseUrl.startsWith("http://") ? { licenseUrl } : {}),
      source: ii.descriptionurl,
    };
  }
  return null;
}

const plan = JSON.parse(await readFile(file, "utf8"));
const missed = [];
let done = 0;

for (const day of plan.days ?? []) {
  for (const spot of day.spots ?? []) {
    // photo / photos は1件でも配列でもよい。配列の場合は要素ごとに書き換える
    for (const key of ["photos", "photo"]) {
      if (spot[key] == null) continue;
      const list = Array.isArray(spot[key]) ? spot[key] : [spot[key]];
      for (const [i, p] of list.entries()) {
        if (!p || typeof p !== "object" || !(p.search || p.commons)) continue;
        const label = list.length > 1 ? `${spot.name} [${i + 1}]` : spot.name;
        try {
          const r = await lookup(p);
          if (r) {
            list[i] = r;
            done++;
            console.log(`✓ ${label}  ${r.license} / ${r.credit}`);
          } else {
            missed.push(label);
            console.log(`– ${label}  条件に合う写真なし`);
          }
        } catch (e) {
          missed.push(label);
          console.log(`× ${label}  ${e.message}`);
        }
        await sleep(500);
      }
      if (!Array.isArray(spot[key])) spot[key] = list[0];
    }
  }
}

await writeFile(file, JSON.stringify(plan, null, 2) + "\n");
console.log(`\n${done} 件を書き換えました → ${file}`);
if (missed.length) console.log(`未設定: ${missed.join("、")}（{ "search": ... } の語句を変えるか、commons でファイルを指定して再実行）`);
