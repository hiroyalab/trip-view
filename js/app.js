(() => {
  "use strict";

  // ===== 設定 =====
  const DAY_COLORS = ["#0E7C86", "#D64C7F", "#C98A12", "#4B4FA6", "#3E8E4F", "#B5562E"];
  const FOCUS_RATIO = 0.3;   // プラン領域の上から30%の位置にあるスポットを「表示中」とみなす
  const SPOT_ZOOM = 14;
  const MAX_JSON_BYTES = 2 * 1024 * 1024;

  // ?plan=data/xxx.json で別のプランを開ける（同一オリジンの相対パスのみ許可）
  function resolvePlanPath() {
    const p = new URLSearchParams(location.search).get("plan");
    if (!p) return "data/plan.json";
    try {
      const u = new URL(p, location.href);
      if (u.origin === location.origin && u.pathname.endsWith(".json")) return u.href;
    } catch (_) {}
    console.warn("plan パラメータが不正なため data/plan.json を使います:", p);
    return "data/plan.json";
  }

  // ===== ユーティリティ（JSONの値は必ず textContent で入れる：XSS対策） =====
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = String(text);
    return e;
  }
  // http/https と、ローカル表示時の相対パスだけ許可（javascript: などを弾く）
  function safeUrl(raw) {
    if (typeof raw !== "string" || !raw.trim()) return null;
    try {
      const u = new URL(raw, location.href);
      if (u.protocol === "https:" || u.protocol === "http:") return u.href;
      if (u.protocol === "file:" && location.protocol === "file:") return u.href;
    } catch (_) {}
    return null;
  }
  const str = (v) => (v == null ? "" : String(v));
  const coord = (lat, lng) => {
    const a = Number(lat), o = Number(lng);
    return Number.isFinite(a) && Number.isFinite(o) && Math.abs(a) <= 90 && Math.abs(o) <= 180 ? [a, o] : null;
  };

  // ===== 写真（Wikimedia Commons でライセンスを確認して表示） =====
  // photo の書き方：
  //   "images/xxx.jpg" / "https://..."                 … そのまま表示（権利は自分で確認）
  //   { "commons": "File:ファイル名.jpg" }              … Commons の特定の写真を使う
  //   { "search": "Hanauma Bay" }                       … Commons から自動で探す
  //   { "url": "https://...", "credit": "作者", "license": "CC BY 4.0", "licenseUrl": "https://..." }
  // Commons の写真は、下の許可リストに合うライセンスのものだけを表示し、作者とライセンスを必ず表記する。
  const ALLOWED_LICENSE = /^(CC0|Public domain|CC BY(-SA)? \d\.\d)/i;
  const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
  // Commons の画像配信ホスト（サムネイルは thumb.wikimedia.org から返ることがある）
  const WIKIMEDIA_IMAGE_HOST = /^https:\/\/(upload|thumb)\.wikimedia\.org\//;
  const CACHE_DAYS = 7;
  const CACHE_DAYS_MISS = 1;   // 見つからなかった場合は短めにして再挑戦する

  // Commons の作者欄はHTMLなので、文字だけ取り出す（DOMParser はスクリプトを実行しない）
  function plain(html) {
    if (!html) return "";
    const doc = new DOMParser().parseFromString(String(html), "text/html");
    return (doc.body.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
  }

  async function lookupCommons(q) {
    const key = "commons:" + JSON.stringify(q);
    try {
      const c = JSON.parse(localStorage.getItem(key));
      if (c && Date.now() - c.at < (c.v ? CACHE_DAYS : CACHE_DAYS_MISS) * 864e5) return c.v;
    } catch (_) {}

    const params = new URLSearchParams({
      action: "query", format: "json", origin: "*", prop: "imageinfo",
      iiprop: "url|size|extmetadata", iiurlwidth: "1200",
      iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist"
    });
    if (q.commons) {
      const t = str(q.commons).trim();
      params.set("titles", /^file:/i.test(t) ? t : "File:" + t);
    } else {
      params.set("generator", "search");
      params.set("gsrnamespace", "6");
      params.set("gsrsearch", str(q.search) + " filetype:bitmap");
      params.set("gsrlimit", "10");
    }
    const r = await fetch(COMMONS_API + "?" + params);
    if (!r.ok) throw new Error("Commons API " + r.status);
    const j = await r.json();
    const pages = Object.values(j.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));

    let v = null;
    for (const pg of pages) {
      const ii = pg.imageinfo?.[0];
      if (!ii) continue;
      const m = ii.extmetadata || {};
      const license = plain(m.LicenseShortName?.value);
      if (!ALLOWED_LICENSE.test(license)) continue;               // 許可リスト外のライセンスは使わない
      if (q.search && ii.width < ii.height) continue;              // 自動検索では横長の写真を優先
      const src = safeUrl(ii.thumburl || ii.url);
      if (!src || !WIKIMEDIA_IMAGE_HOST.test(src)) continue;
      v = {
        src,
        author: plain(m.Artist?.value) || "作者不明",
        license,
        licenseUrl: safeUrl(plain(m.LicenseUrl?.value)),
        page: safeUrl(ii.descriptionurl)
      };
      break;
    }
    try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), v })); } catch (_) {}
    return v;
  }

  function link(text, href) {
    const a = el("a", null, text);
    a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer";
    a.addEventListener("click", e => e.stopPropagation());
    return a;
  }

  function renderCredit(credit, info) {
    const parts = [document.createTextNode("写真: " + info.author)];
    if (info.license) parts.push(document.createTextNode(" / "), info.licenseUrl ? link(info.license, info.licenseUrl) : el("span", null, info.license));
    if (info.page) parts.push(document.createTextNode(" / "), link("Wikimedia Commons", info.page));
    credit.replaceChildren(...parts);
  }

  // img は「先に DOM へ入れてから src をセット」する。
  // 未挿入(detached)のまま loading="lazy" を付けると、ブラウザが表示判定できず
  // 読み込みを開始しないことがあり、onload が来ないまま画像が出なくなる。
  function showImage(spot, photo, src, onLoaded) {
    const img = el("img");
    img.alt = str(spot.name);
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("load", () => {
      photo.querySelector(".ph")?.remove();   // 読み込めてからプレースホルダーを消す
      onLoaded?.();
    });
    img.addEventListener("error", () => {
      img.remove();                            // 失敗したらプレースホルダーに戻す
      console.warn("写真を表示できませんでした:", spot.name, src);
    });
    photo.append(img);
    img.loading = "lazy";
    img.src = src;
  }

  async function loadPhoto(spot, photo, credit) {
    const p = spot.photo;
    if (typeof p === "string") {
      const src = safeUrl(p);
      if (src) showImage(spot, photo, src);
      else console.warn("photo のURLが不正です:", spot.name, p);
      return;
    }
    if (!p || typeof p !== "object") return;
    if (p.url) {
      const src = safeUrl(p.url);
      if (!src) { console.warn("photo.url が不正です:", spot.name, p.url); return; }
      const info = { src, author: str(p.credit) || "作者不明", license: str(p.license), licenseUrl: safeUrl(p.licenseUrl), page: safeUrl(p.source) };
      showImage(spot, photo, src, () => { if (p.credit || p.license) renderCredit(credit, info); });
      return;
    }
    if (p.commons || p.search) {
      try {
        const info = await lookupCommons(p.commons ? { commons: p.commons } : { search: p.search });
        if (!info) { console.warn("条件に合う写真が見つかりませんでした:", spot.name, p.commons || p.search); return; }
        showImage(spot, photo, info.src, () => renderCredit(credit, info));
      } catch (e) {
        console.warn("写真を取得できませんでした:", spot.name, e);
      }
    }
  }

  // ===== 地図 =====
  // OpenStreetMap公式タイル（APIキー不要）
  const map = L.map("map", { zoomControl: false, attributionControl: true }).setView([21.46, -157.98], 9);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  // ===== 状態 =====
  let items = [];        // {spot, dayIndex, card, marker, pinEl}
  let activeIndex = -1;

  function pinIcon(color, num) {
    // num は内部で付けた連番のみ（JSONの値は入れない）
    // CSPでインラインstyle属性を禁止しているため、DOM APIで組み立てる
    const pin = el("div", "pin dim");
    pin.style.setProperty("--c", color);
    pin.append(el("span", null, num));
    return L.divIcon({ className: "", html: pin, iconSize: [26, 26], iconAnchor: [13, 26], tooltipAnchor: [0, -26] });
  }

  function addMarker(item, latlng) {
    const color = DAY_COLORS[item.dayIndex % DAY_COLORS.length];
    const m = L.marker(latlng, { icon: pinIcon(color, item.num), keyboard: true, title: str(item.spot.name) }).addTo(map);
    const tip = el("span", null, item.spot.name);   // DOM要素で渡す（文字列だとHTMLとして解釈される）
    m.bindTooltip(tip, { direction: "top" });
    m.on("click", () => scrollToItem(item.idx));
    item.marker = m;
    item.latlng = latlng;
    item.pinEl = () => m.getElement()?.querySelector(".pin");
  }

  function drawRoutes() {
    const byDay = {};
    items.forEach(it => { if (it.latlng) (byDay[it.dayIndex] ||= []).push(it.latlng); });
    Object.entries(byDay).forEach(([d, pts]) => {
      if (pts.length > 1) L.polyline(pts, { color: DAY_COLORS[d % DAY_COLORS.length], weight: 2, opacity: .5, dashArray: "4 6" }).addTo(map);
    });
  }

  function fitAll() {
    const pts = items.filter(i => i.latlng).map(i => i.latlng);
    if (pts.length) map.fitBounds(pts, { padding: [24, 24] });
  }

  // ===== 表示中スポットの切り替え =====
  function setActive(idx) {
    if (idx === activeIndex || !items[idx]) return;
    const prev = items[activeIndex];
    if (prev) {
      prev.card.classList.remove("active");
      prev.pinEl?.()?.classList.remove("active");
      prev.marker?.setZIndexOffset(0).closeTooltip();
    }
    activeIndex = idx;
    const it = items[idx];
    it.card.classList.add("active");
    if (it.marker) {
      it.pinEl()?.classList.add("active");
      it.marker.setZIndexOffset(1000).openTooltip();
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      map.flyTo(it.latlng, Math.max(map.getZoom(), it.spot.zoom || SPOT_ZOOM), { duration: reduce ? 0 : 0.8 });
    }
  }

  const plan = document.getElementById("plan");
  function onScroll() {
    const focusY = plan.scrollTop + plan.clientHeight * FOCUS_RATIO;
    let idx = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i].card.offsetTop <= focusY) idx = i; else break;
    }
    setActive(idx);
  }
  let ticking = false;
  plan.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; onScroll(); });
  }, { passive: true });

  function scrollToItem(idx) {
    const card = items[idx]?.card;
    if (!card) return;
    plan.scrollTo({ top: card.offsetTop - plan.clientHeight * FOCUS_RATIO + 8 });
  }

  // ===== 描画 =====
  function render(data) {
    if (!data || !Array.isArray(data.days)) throw new Error("days 配列が見つかりません");
    document.getElementById("title").textContent = str(data.title) || "旅行プラン";
    document.getElementById("subtitle").textContent = str(data.subtitle);
    document.title = str(data.title) || "旅行プラン";

    const list = document.getElementById("list");
    list.replaceChildren();
    items.forEach(i => i.marker?.remove());
    items = []; activeIndex = -1;
    let num = 0;

    data.days.forEach((day, d) => {
      const color = DAY_COLORS[d % DAY_COLORS.length];
      const section = el("section");
      section.style.setProperty("--day", color);

      const head = el("div", "day-head");
      head.append(el("span", "label", day.label || `${d + 1}日目`), el("span", "date", day.date), el("span", "theme", day.theme));
      section.append(head);

      const ul = el("ul", "spots");
      (Array.isArray(day.spots) ? day.spots : []).forEach(spot => {
        num++;
        const item = { spot, dayIndex: d, num, idx: items.length };
        const li = el("li", "spot");

        const rail = el("div", "rail");
        rail.append(el("div", "dot"), el("div", "time", spot.time));

        const body = el("div", "body");
        const photo = el("div", "photo");
        const credit = el("p", "credit");
        photo.append(el("span", "ph", spot.name));
        loadPhoto(spot, photo, credit);

        body.append(photo, credit, el("h2", "name", spot.name));
        if (spot.address) {
          const a = el("a", "addr", "📍 " + spot.address);
          a.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(str(spot.address));
          a.target = "_blank"; a.rel = "noopener noreferrer";
          a.addEventListener("click", e => e.stopPropagation());
          body.append(a);
        }
        if (spot.description) body.append(el("p", "desc", spot.description));
        if (Array.isArray(spot.tags) && spot.tags.length) {
          const tags = el("ul", "tags");
          spot.tags.forEach(t => tags.append(el("li", null, t)));
          body.append(tags);
        }
        const link = safeUrl(spot.url);
        if (link && /^https?:/.test(link)) {
          const a = el("a", "more", "公式サイトを開く");
          a.href = link; a.target = "_blank"; a.rel = "noopener noreferrer";
          a.addEventListener("click", e => e.stopPropagation());
          body.append(a);
        }

        li.append(rail, body);
        li.addEventListener("click", () => scrollToItem(item.idx));
        item.card = li;
        ul.append(li);
        items.push(item);

        const ll = coord(spot.lat, spot.lng);
        if (ll) addMarker(item, ll);
      });
      section.append(ul);
      list.append(section);
    });

    list.append(el("div", "end", "おつかれさまでした。良い旅を。"), el("div", "spacer"));
    drawRoutes();
    fitAll();
    setTimeout(onScroll, 300);
    geocodeMissing();
  }

  // ===== lat/lng が無いスポットは住所から座標を取得（OpenStreetMap Nominatim） =====
  // 利用規約上 1秒1件まで。結果は端末に保存して次回から再取得しない。
  async function geocodeMissing() {
    const targets = items.filter(i => !i.latlng && i.spot.address);
    for (const it of targets) {
      const key = "geo:" + str(it.spot.address);
      let ll = null;
      try { ll = JSON.parse(localStorage.getItem(key)); } catch (_) {}
      if (!coord(ll?.[0], ll?.[1])) {
        try {
          const r = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(str(it.spot.address)));
          const j = await r.json();
          ll = j[0] ? [Number(j[0].lat), Number(j[0].lon)] : null;
          if (ll) try { localStorage.setItem(key, JSON.stringify(ll)); } catch (_) {}
        } catch (e) { console.warn("住所から位置を取得できませんでした:", it.spot.address); }
        await new Promise(r => setTimeout(r, 1100));
      }
      const c = coord(ll?.[0], ll?.[1]);
      if (c) addMarker(it, c);
    }
    if (targets.length) { fitAll(); const a = activeIndex; activeIndex = -1; setActive(a < 0 ? 0 : a); }
  }

  // ===== JSON読み込み =====
  function showFilePicker(reason) {
    document.getElementById("title").textContent = "プランを読み込めませんでした";
    const box = el("div", "notice");
    box.append(
      el("div", null, reason),
      el("div", null, "ファイルを直接開いている場合は、下のボタンから plan.json を選んでください。"),
    );
    const label = el("label", null, "plan.json を選ぶ");
    const input = el("input");
    input.type = "file"; input.accept = "application/json,.json";
    input.addEventListener("change", () => {
      const f = input.files?.[0];
      if (!f) return;
      if (f.size > MAX_JSON_BYTES) { alert("ファイルが大きすぎます（2MBまで）"); return; }
      f.text().then(t => { box.remove(); render(JSON.parse(t)); })
             .catch(e => alert("JSONの形式が正しくありません: " + e.message));
    });
    label.append(input);
    box.append(label);
    document.getElementById("list").replaceChildren(box);
  }

  fetch(resolvePlanPath(), { cache: "no-cache" })
    .then(r => { if (!r.ok) throw new Error(`plan.json が見つかりません（${r.status}）`); return r.json(); })
    .then(render)
    .catch(e => showFilePicker(e.message || "plan.json を読み込めませんでした。"));
})();
