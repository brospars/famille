/* Arbre d'ascendance, carte des lieux, liste des personnes.
   Les données arrivent chiffrées (data/vault.json) et sont déchiffrées par assets/vault.js. */
(function () {
  "use strict";
  const lock = document.getElementById("lock");
  const form = document.getElementById("lock-form");
  const msg = document.getElementById("lock-msg");
  const pw = document.getElementById("pw");
  const btn = document.getElementById("unlock");

  function start(data) {
    lock.hidden = true;
    document.getElementById("app").hidden = false;
    run(data);
  }
  form.addEventListener("submit", async e => {
    e.preventDefault();
    btn.disabled = true; msg.classList.add("ok"); msg.textContent = "Déchiffrement…";
    try {
      const data = await Vault.unlockWithPassword(pw.value, document.getElementById("remember").checked);
      pw.value = ""; msg.textContent = "";
      msg.classList.remove("ok");
      start(data);
    } catch (err) {
      msg.classList.remove("ok");
      msg.textContent = err && err.message === "vault"
        ? "Les données sont introuvables. Réessayez plus tard."
        : "Mot de passe incorrect.";
      pw.select();
    } finally { btn.disabled = false; }
  });
  document.getElementById("logout").addEventListener("click", () => { Vault.forget(); location.hash = ""; location.reload(); });
  // Invitation link: …/#mdp=… (or ?mdp=…). The password is read, then removed from the
  // address bar and history so the link shown or copied afterwards no longer carries it.
  function takePasswordFromUrl() {
    const url = new URL(location.href);
    let value = url.searchParams.get("mdp");
    let found = value !== null;
    if (found) url.searchParams.delete("mdp");
    const m = url.hash.match(/^#mdp=(.*)$/);
    if (m) {
      found = true;
      try { value = decodeURIComponent(m[1].replace(/\+/g, " ")); } catch (e) { value = m[1]; }
      url.hash = "";
    }
    if (!found) return null;
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    return value;
  }
  const fromUrl = takePasswordFromUrl();
  function prefill() {
    if (fromUrl) {
      pw.value = fromUrl;
      msg.textContent = "Mot de passe pré-rempli depuis le lien d'invitation. Cliquez sur « Ouvrir ».";
      msg.classList.add("ok");
      btn.focus();
    } else pw.focus();
  }
  Vault.unlockFromStorage().then(d => { if (d) start(d); else prefill(); }).catch(prefill);
})();

function run(data) {
  "use strict";
  const family = data.family, places = data.places, notes = data.notes || [];
  const S = family.settings || {};
  const people = new Map(family.persons.map(p => [p.id, p]));
  const unions = family.unions || [];
  const NOW = new Date().getFullYear();

  // ---------- helpers ----------
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MONTHS = ["janv.", "févr.", "mars", "avril", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const year = d => (d && d.date ? +d.date.slice(0, 4) : null);
  function fmtDate(d) {
    if (!d || !d.date) return "";
    const [y, m, day] = d.date.split("-");
    let s = y;
    if (m && day) s = `${+day === 1 ? "1er" : +day} ${MONTHS[+m - 1]} ${y}`;
    else if (m) s = `${MONTHS[+m - 1]} ${y}`;
    if (d.approx) s = `vers ${s}`;
    if (d.time) { const [h, mi] = d.time.split(":"); s += ` à ${+h} h ${mi}`; }
    return d.original ? `${d.original} (${s})` : s;
  }
  const placeName = id => (id && places[id] ? places[id].name : "");
  // "à Le Chesnay" -> "au Chesnay", "à Les Andelys" -> "aux Andelys"
  const atPrefix = name => (/^Le /.test(name) ? ["au ", name.slice(3)] : /^Les /.test(name) ? ["aux ", name.slice(4)] : ["à ", name]);
  function isLiving(p) {
    if (p.living !== undefined) return p.living;
    if (p.death) return false;
    const y = year(p.birth);
    return y !== null && y > NOW - (S.livingIfBornAfterYears || 100);
  }
  const hidden = p => S.hideLivingDetails && isLiving(p);
  const given = p => p.given || "Prénom inconnu";
  const surname = p => p.surname || "";
  const fullName = p => `${given(p)}${surname(p) ? " " + surname(p) : ""}`;
  function lifespan(p) {
    if (hidden(p)) return "Personne vivante";
    const b = year(p.birth) && (p.birth.approx ? "v. " : "") + year(p.birth), d = year(p.death);
    if (b && d) return `${b} – ${d}`;
    if (b) return p.birth.approx ? `né${p.sex === "F" ? "e" : ""} vers ${year(p.birth)}` : `né${p.sex === "F" ? "e" : ""} en ${b}`;
    if (d) return `† ${d}`;
    const u = unionsOf(p.id).find(u => u.date);
    return u ? `marié${p.sex === "F" ? "e" : ""} en ${u.date.slice(0, 4)}` : "";
  }
  const unionsOf = id => unions.filter(u => u.husband === id || u.wife === id);
  const childrenOf = id => family.persons.filter(c => c.father === id || c.mother === id);
  // Full or half siblings: share the father or the mother. Sorted by birth date.
  function siblingsOf(id) {
    const p = people.get(id); if (!p || (!p.father && !p.mother)) return [];
    return family.persons
      .filter(o => o.id !== id && ((p.father && o.father === p.father) || (p.mother && o.mother === p.mother)))
      .sort((a, b) => ((a.birth && a.birth.date) || "9999").localeCompare((b.birth && b.birth.date) || "9999"));
  }
  const STATUS = { doc: "Document familial ou officiel", oral: "Transmis oralement", tree: "Source publique, à vérifier", unknown: "À rechercher" };

  // Sosa numbers relative to the first root
  const sosa = new Map();
  (function number(id, n) {
    if (!id || !people.has(id) || sosa.has(id)) return;
    sosa.set(id, n);
    const p = people.get(id);
    number(p.father, 2 * n);
    number(p.mother, 2 * n + 1);
  })(null, 0);
  const START = S.start || (S.roots ? [S.roots[0]] : []);
  (function numberFrom(ids) {
    ids.forEach(id => sosa.set(id, 1));
    const first = people.get(ids[0]); if (!first) return;
    const walk = (id, n) => {
      if (!id || !people.has(id) || sosa.has(id)) return;
      sosa.set(id, n);
      walk(people.get(id).father, 2 * n); walk(people.get(id).mother, 2 * n + 1);
    };
    walk(first.father, 2); walk(first.mother, 3);
  })(START);
  const genOf = id => (sosa.has(id) ? Math.floor(Math.log2(sosa.get(id))) + 1 : null);

  // ---------- header ----------
  document.getElementById("site-title").textContent = S.title || "Famille";
  document.title = S.title || "Famille";

  // ---------- views / routing ----------
  const VIEWS = ["arbre", "carte", "personnes", "notes"];
  let mapReady = false;
  function show(view) {
    if (!VIEWS.includes(view)) view = "arbre";
    VIEWS.forEach(v => { document.getElementById("view-" + v).hidden = v !== view; });
    document.querySelectorAll(".tabs a").forEach(a => {
      if (a.dataset.view === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    if (view === "carte") { if (!mapReady) initMap(); else map.invalidateSize(); }
    if (view === "arbre") resizeTree();
  }
  window.addEventListener("hashchange", () => { closePanel(); show(location.hash.slice(1)); });
  const headerH = () => document.querySelector(".top").offsetHeight;
  document.documentElement.style.setProperty("--header-h", headerH() + "px");

  // ---------- person panel ----------
  const panel = document.getElementById("panel");
  const panelBody = document.getElementById("panel-body");
  document.getElementById("panel-close").addEventListener("click", closePanel);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closePanel(); });
  function closePanel() { panel.hidden = true; d3.selectAll("#tree [data-person]").classed("selected", false); currentPanelId = null; }

  function eventRow(label, d) {
    if (!d || (!d.date && !d.place)) return "";
    const [pre, nm] = atPrefix(placeName(d.place));
    const place = d.place ? ` ${pre}<button type="button" class="placelink" data-place="${esc(d.place)}">${esc(nm)}</button>${places[d.place] && places[d.place].uncertain ? " (lieu incertain)" : ""}` : "";
    return `<dt>${label}</dt><dd>${esc(fmtDate(d)) || "date inconnue"}${place}</dd>`;
  }
  function relButton(p, role) {
    if (!p) return "";
    return `<button type="button" data-person="${esc(p.id)}">${esc(fullName(p))} <small>· ${role}${lifespan(p) ? " · " + esc(lifespan(p)) : ""}</small></button>`;
  }
  let currentPanelId = null;
  function openPerson(id) {
    const p = people.get(id); if (!p) return;
    const n = sosa.get(id);
    const g = genOf(id);
    const father = people.get(p.father), mother = people.get(p.mother);
    const us = unionsOf(id);
    const kids = childrenOf(id);
    const sibs = siblingsOf(id);
    let dl = "";
    if (!hidden(p)) {
      dl += eventRow("Naissance", p.birth);
      us.forEach(u => {
        const other = people.get(u.husband === id ? u.wife : u.husband);
        if (u.date || u.place) dl += eventRow("Mariage", u).replace("</dd>", (other ? ` avec ${esc(fullName(other))}` : "") + (u.notes ? `<br><small>${esc(u.notes)}</small>` : "") + "</dd>");
      });
      dl += eventRow("Décès", p.death);
    }
    panelBody.innerHTML = `
      <p class="who">${n ? `Sosa n° ${n} · génération ${g}` : "Frère, sœur ou collatéral (hors ascendance directe)"}</p>
      <h2 id="panel-name">${esc(given(p))} ${surname(p) ? `<span class="sn">${esc(surname(p))}</span>` : ""}</h2>
      <span class="badge">${STATUS[p.status] || ""}</span>
      ${hidden(p) ? `<p class="note">Personne vivante : dates et lieux masqués.</p>` : (dl ? `<dl>${dl}</dl>` : `<p class="note">Aucune date ni aucun lieu connus pour l'instant.</p>`)}
      ${p.notes ? `<p class="note">${esc(p.notes)}</p>` : ""}
      ${p.source ? `<p class="src">Source : ${esc(p.source)}</p>` : ""}
      ${(father || mother) ? `<h3>Parents</h3><div class="rel">${relButton(father, "père")}${relButton(mother, "mère")}</div>` : ""}
      ${us.length ? `<h3>Conjoint${us.length > 1 ? "s" : ""}</h3><div class="rel">${us.map(u => relButton(people.get(u.husband === id ? u.wife : u.husband), p.sex === "F" ? "époux" : "épouse")).join("")}</div>` : ""}
      ${sibs.length ? `<h3>Frères et sœurs</h3><div class="rel">${sibs.map(k => relButton(k, k.sex === "F" ? "sœur" : "frère")).join("")}</div>` : ""}
      ${kids.length ? `<h3>Enfant${kids.length > 1 ? "s" : ""}</h3><div class="rel">${kids.map(k => relButton(k, k.sex === "F" ? "fille" : "fils")).join("")}</div>` : ""}
      <div class="actions"><button type="button" class="btn" data-center="${esc(id)}">Voir dans l'arbre</button></div>`;
    panel.hidden = false;
    currentPanelId = id;
    d3.selectAll("#tree [data-person]").classed("selected", function () { return this.getAttribute("data-person") === id; });
  }
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-person],[data-place],[data-center]");
    if (!t) return;
    if (t.dataset.person) openPerson(t.dataset.person);
    else if (t.dataset.place) { location.hash = "carte"; setTimeout(() => focusPlace(t.dataset.place), 60); }
    else if (t.dataset.center) { const id = t.dataset.center; location.hash = "arbre"; setTimeout(() => centerOn(id, true), 60); }
  });

  // ---------- tree ----------
  // Two views share one SVG: "personnes" (one card per ancestor) and "familles" (one card per
  // couple, listing all its children; the child on the direct line is highlighted).
  const svg = d3.select("#tree");
  const gRoot = svg.append("g");
  const gAxis = gRoot.append("g").attr("class", "gen-axis");
  const gLinks = gRoot.append("g");
  const gNodes = gRoot.append("g");
  const NODE_W = 210, NODE_H = 54, COL = 260, GAP = 12;
  const SIB_HEAD = 30, SIB_LINE = 24;
  const FAM_W = 252, FAM_COL = 300, FAM_HEAD = 46, FAM_LINE = 21, FAM_PAD = 10;
  const zoom = d3.zoom().scaleExtent([0.15, 2.5]).on("zoom", ev => gRoot.attr("transform", ev.transform));
  svg.call(zoom).on("dblclick.zoom", null);
  const ROOT_ID = "__start";
  const modeToggle = document.getElementById("family-view");
  let familyMode = !!S.familyViewByDefault;
  try { const v = localStorage.getItem("famille-vue"); if (v !== null) familyMode = v === "familles"; } catch (e) {}
  modeToggle.checked = familyMode;
  const famLegend = document.querySelector(".fam-legend");
  const syncLegend = () => { famLegend.hidden = !familyMode; };
  syncLegend();
  let layout;
  const firstGiven = p => (p && p.given ? p.given.split(/\s+/)[0] : "?");
  const birthKey = p => (p.birth && p.birth.date) || "9999";
  const childrenOfCouple = (f, m) => family.persons
    .filter(c => (f ? c.father === f : !c.father) && (m ? c.mother === m : !c.mother) && (f || m))
    .sort((a, b) => birthKey(a).localeCompare(birthKey(b)));
  const unionOf = (f, m) => unions.find(u => u.husband === f && u.wife === m);

  // ----- person view -----
  // Every known person ends with both parents: a real one, or a dashed "unknown" box.
  function buildPersons(id) {
    const p = people.get(id);
    const node = { id, p, children: [] };
    if (p.father && people.has(p.father)) node.children.push(buildPersons(p.father));
    else node.children.push({ id: `ghost-f-${id}`, ghost: "père" });
    if (p.mother && people.has(p.mother)) node.children.push(buildPersons(p.mother));
    else node.children.push({ id: `ghost-m-${id}`, ghost: "mère" });
    return node;
  }
  function buildPersonRoot() {
    const ids = START.filter(id => people.has(id));
    return { id: ROOT_ID, siblings: ids, children: buildPersons(ids[0]).children };
  }

  // ----- family view -----
  // A family = the couple (father, mother) and all their children. `line` is the child who
  // continues the direct line (highlighted). Its parents' families come next, father first.
  function buildFamily(fId, mId, line) {
    const fam = { id: `fam:${fId || "?"}:${mId || "?"}`, fam: true, f: fId, m: mId, line,
      kids: childrenOfCouple(fId, mId).map(c => c.id), children: [] };
    [fId, mId].forEach(pid => {
      const p = pid && people.get(pid);
      if (!p) return;
      if (p.father || p.mother) fam.children.push(buildFamily(p.father, p.mother, pid));
      else fam.children.push({ id: `ghost-fam-${pid}`, ghost: "parents", of: pid });
    });
    return fam;
  }
  function buildFamilyRoot() {
    const first = people.get(START[0]);
    const root = buildFamily(first.father, first.mother, null);
    root.id = ROOT_ID; root.start = true;
    return root;
  }

  // ----- sizes -----
  const famH = data => (data.fam ? FAM_HEAD + Math.max(1, data.kids.length) * FAM_LINE + FAM_PAD : NODE_H);
  const rootH = () => SIB_HEAD + START.length * SIB_LINE + 8;
  const blockH = data => (familyMode ? famH(data) : data.id === ROOT_ID ? rootH() : NODE_H);
  const nodeH = d => blockH(d.data);
  const curW = () => (familyMode ? FAM_W : NODE_W);
  const curCol = () => (familyMode ? FAM_COL : COL);

  function findNode(id) {
    const all = layout.descendants();
    if (familyMode) {
      return all.find(n => n.data.fam && (n.data.f === id || n.data.m === id))
        || all.find(n => n.data.fam && n.data.kids.includes(id));
    }
    return all.find(n => n.data.id === id || (n.data.siblings || []).includes(id));
  }
  function treeHas(id) { return !!(layout && findNode(id)); }
  function buildTree() {
    const data = familyMode ? buildFamilyRoot() : buildPersonRoot();
    const flex = d3.flextree({ nodeSize: n => [blockH(n.data) + GAP, curCol()], spacing: (a, b) => (a.parent === b.parent ? 0 : 8) });
    layout = flex(flex.hierarchy(data));
    gLinks.selectAll("*").remove(); gNodes.selectAll("*").remove(); gAxis.selectAll("*").remove();
    familyMode ? drawFamilies() : drawPersons();
    drawLinks();
  }
  function trimText(t, max) { return t.length > max ? t.slice(0, max - 1) + "…" : t; }
  function drawLinks() {
    const W = curW();
    gLinks.selectAll("path").data(layout.links()).join("path").attr("class", "link")
      .attr("d", d => {
        const sx = d.source.y + W, sy = d.source.x, tx = d.target.y, ty = d.target.x, mx = (sx + tx) / 2;
        return `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
      });
  }
  function ghostCard(g, title, sub) {
    g.attr("class", "node ghost unknown");
    const W = curW();
    g.append("rect").attr("class", "box").attr("rx", 8).attr("width", W).attr("height", NODE_H).attr("y", -NODE_H / 2);
    g.append("rect").attr("class", "stripe").attr("width", 4).attr("height", NODE_H - 12).attr("y", -NODE_H / 2 + 6).attr("rx", 2);
    g.append("text").attr("class", "n1").attr("x", 14).attr("y", -4).text(title);
    g.append("text").attr("class", "n2").attr("x", 14).attr("y", 14).text(sub);
  }

  function drawPersons() {
    const nodes = layout.descendants();
    nodes.forEach(d => {
      const g = gNodes.append("g").attr("transform", `translate(${d.y},${d.x})`);
      if (d.data.id === ROOT_ID) return drawStart(g, d);
      if (d.data.ghost) return ghostCard(g, d.data.ghost === "père" ? "Père inconnu" : "Mère inconnue", "à rechercher");
      const p = d.data.p;
      g.attr("class", `node ${p.status || "unknown"}`).attr("tabindex", 0).attr("role", "button").attr("data-person", p.id);
      g.append("rect").attr("class", "box").attr("rx", 8).attr("width", NODE_W).attr("height", NODE_H).attr("y", -NODE_H / 2);
      g.append("rect").attr("class", "stripe").attr("width", 4).attr("height", NODE_H - 12).attr("y", -NODE_H / 2 + 6).attr("rx", 2);
      g.append("text").attr("class", "n1").attr("x", 14).attr("y", -4).text(trimText(fullName(p), 27));
      const pl = hidden(p) ? "" : placeName((p.birth && p.birth.place) || (p.death && p.death.place));
      g.append("text").attr("class", "n2").attr("x", 14).attr("y", 14).text(trimText([lifespan(p), pl].filter(Boolean).join(" · "), 32));
      if (sosa.has(p.id)) g.append("text").attr("class", "sosa").attr("x", NODE_W - 8).attr("y", -NODE_H / 2 + 13).attr("text-anchor", "end").text(sosa.get(p.id));
      g.append("title").text(fullName(p));
    });
    // generation labels
    const maxDepth = d3.max(nodes, d => d.depth);
    const minX = d3.min(nodes, d => d.x - nodeH(d) / 2);
    gAxis.selectAll("text").data(d3.range(maxDepth + 1)).join("text")
      .attr("x", d => d * COL + 10).attr("y", minX - 18).text(d => (d === 0 ? "Génération 1" : `${d + 1}`));
  }
  function drawStart(g, d) {
    const H = rootH();
    g.attr("class", "start");
    g.append("rect").attr("class", "start-box").attr("rx", 10).attr("width", NODE_W).attr("height", H).attr("y", -H / 2);
    g.append("text").attr("class", "start-title").attr("x", 14).attr("y", -H / 2 + 21).text(START.length > 1 ? "Les enfants" : "Point de départ");
    d.data.siblings.forEach((id, i) => {
      const p = people.get(id);
      const l = g.append("g").attr("class", "sib").attr("tabindex", 0).attr("role", "button").attr("data-person", id)
        .attr("aria-label", fullName(p)).attr("transform", `translate(0,${-H / 2 + SIB_HEAD + i * SIB_LINE})`);
      l.append("rect").attr("class", "sib-hit").attr("x", 6).attr("width", NODE_W - 12).attr("height", SIB_LINE - 2).attr("rx", 5);
      l.append("text").attr("class", "sib-name").attr("x", 14).attr("y", 15).text(trimText(fullName(p), 24));
      l.append("text").attr("class", "sib-year").attr("x", NODE_W - 12).attr("y", 15).attr("text-anchor", "end").text(hidden(p) ? "" : year(p.birth) || "");
    });
  }

  function drawFamilies() {
    layout.descendants().forEach(d => {
      const g = gNodes.append("g").attr("transform", `translate(${d.y},${d.x})`);
      if (d.data.ghost) return ghostCard(g, `Parents de ${trimText(firstGiven(people.get(d.data.of)) + " " + surname(people.get(d.data.of)), 20)}`, "à rechercher");
      const { f, m, kids, line } = d.data;
      const fa = people.get(f), mo = people.get(m);
      const H = famH(d.data), W = FAM_W, top = -H / 2;
      g.attr("class", `fam${d.data.start ? " start-fam" : ""}`);
      g.append("rect").attr("class", "fam-box").attr("rx", 10).attr("width", W).attr("height", H).attr("y", top);
      // title: "Famille Benoît & Agnese", each first name opens that parent's card
      const t = g.append("text").attr("class", "fam-title").attr("x", 12).attr("y", top + 20);
      t.append("tspan").text("Famille ");
      const name = (p, fallback) => t.append("tspan").attr("class", p ? "fam-parent" : "fam-unknown")
        .attr("data-person", p ? p.id : null).text(p ? firstGiven(p) : fallback);
      name(fa, "?"); t.append("tspan").text(" & "); name(mo, "?");
      const u = unionOf(f, m);
      const sub = [[fa && surname(fa), mo && surname(mo)].filter(Boolean).join(" – "),
        u && u.date && !(hidden(fa || {}) || hidden(mo || {})) ? `× ${u.date.slice(0, 4)}` : ""].filter(Boolean).join("  ·  ");
      g.append("text").attr("class", "fam-sub").attr("x", 12).attr("y", top + 36).text(trimText(sub, 34));
      const n = [f, m].map(id => sosa.get(id)).filter(Boolean);
      if (n.length) g.append("text").attr("class", "sosa").attr("x", W - 10).attr("y", top + 36).attr("text-anchor", "end").text(n.join(" · "));
      if (!kids.length) {
        g.append("text").attr("class", "fam-kid other").attr("x", 14).attr("y", top + FAM_HEAD + 14).text("Enfants non renseignés");
      }
      kids.forEach((id, i) => {
        const p = people.get(id);
        const onLine = id === line || (d.data.start && START.includes(id));
        const r = g.append("g").attr("class", `fam-row${onLine ? " line" : ""} ${p.status || ""}`).attr("tabindex", 0).attr("role", "button")
          .attr("data-person", id).attr("aria-label", fullName(p)).attr("transform", `translate(0,${top + FAM_HEAD + i * FAM_LINE})`);
        r.append("rect").attr("class", "fam-hit").attr("x", 6).attr("width", W - 12).attr("height", FAM_LINE - 2).attr("rx", 5);
        if (onLine && !d.data.start) r.append("rect").attr("class", "fam-mark").attr("x", 8).attr("y", 4).attr("width", 3).attr("height", FAM_LINE - 10).attr("rx", 1.5);
        r.append("text").attr("class", `fam-kid ${onLine ? "on" : "other"}`).attr("x", 16).attr("y", 14).text(trimText(fullName(p), 28));
        r.append("text").attr("class", "fam-year").attr("x", W - 10).attr("y", 14).attr("text-anchor", "end").text(hidden(p) ? "" : year(p.birth) || "");
      });
    });
  }

  // keyboard: Enter/Space on any focusable card or row opens the person
  svg.on("keydown", ev => {
    const t = ev.target.closest && ev.target.closest("[data-person]");
    if (t && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); openPerson(t.getAttribute("data-person")); }
  });

  function bounds() {
    const n = layout.descendants(), W = curW();
    return { x0: d3.min(n, d => d.y) - 20, x1: d3.max(n, d => d.y) + W + 20, y0: d3.min(n, d => d.x - nodeH(d) / 2) - 40, y1: d3.max(n, d => d.x + nodeH(d) / 2) + 20 };
  }
  function fit(animate) {
    const el = svg.node(), W = el.clientWidth, H = el.clientHeight; if (!W || !H) return;
    const b = bounds();
    const k = Math.min(W / (b.x1 - b.x0), H / (b.y1 - b.y0), 1.2);
    const t = d3.zoomIdentity.translate((W - k * (b.x1 + b.x0)) / 2, (H - k * (b.y1 + b.y0)) / 2).scale(k);
    (animate ? svg.transition().duration(500) : svg).call(zoom.transform, t);
  }
  function centerOn(id, select) {
    const el = svg.node(), W = el.clientWidth, H = el.clientHeight;
    const d = id === ROOT_ID ? layout : findNode(id);
    if (!d) { if (select) openPerson(id); return; }
    const k = W < 600 ? 0.85 : 1;
    const x = d.depth === 0 ? 16 + (W < 600 ? 0 : 24) : W / 2 - (curW() * k) / 2;
    svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity.translate(x - d.y * k, H / 2 - d.x * k).scale(k));
    if (select) openPerson(id);
  }
  function initialView() {
    const el = svg.node(); const W = el.clientWidth;
    const b = bounds();
    const k = Math.min(W / (b.x1 - b.x0), el.clientHeight / (b.y1 - b.y0));
    if (k >= 0.45) fit(false); else centerOn(ROOT_ID, false);
  }
  let resizeTimer;
  function resizeTree() { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (layout) initialView(); }, 30); }
  window.addEventListener("resize", () => { document.documentElement.style.setProperty("--header-h", headerH() + "px"); });

  document.getElementById("zoom-in").onclick = () => svg.transition().duration(250).call(zoom.scaleBy, 1.3);
  document.getElementById("zoom-out").onclick = () => svg.transition().duration(250).call(zoom.scaleBy, 1 / 1.3);
  document.getElementById("zoom-fit").onclick = () => fit(true);
  document.getElementById("zoom-root").onclick = () => centerOn(ROOT_ID, false);
  modeToggle.addEventListener("change", () => {
    familyMode = modeToggle.checked;
    syncLegend();
    try { localStorage.setItem("famille-vue", familyMode ? "familles" : "personnes"); } catch (e) {}
    closePanel();
    buildTree();
    centerOn(ROOT_ID, false);
  });

  // ---------- map ----------
  let map, placeLayer, pathLayer, markers = {};
  const events = [];
  family.persons.forEach(p => {
    if (hidden(p)) return;
    if (p.birth && p.birth.place) events.push({ type: "naissance", ico: "°", place: p.birth.place, year: year(p.birth), date: p.birth, ids: [p.id] });
    if (p.death && p.death.place) events.push({ type: "décès", ico: "†", place: p.death.place, year: year(p.death), date: p.death, ids: [p.id] });
  });
  unions.forEach(u => {
    if (!u.place) return;
    const h = people.get(u.husband), w = people.get(u.wife);
    if ((h && hidden(h)) || (w && hidden(w))) return;
    events.push({ type: "mariage", ico: "×", place: u.place, year: u.date ? +u.date.slice(0, 4) : null, date: u, ids: [u.husband, u.wife] });
  });
  const yrs = events.map(e => e.year).filter(Boolean);
  const minYear = Math.min(...yrs), maxYear = Math.max(...yrs);
  const yearInput = document.getElementById("year"), yearOut = document.getElementById("year-out");
  yearInput.min = minYear; yearInput.max = maxYear; yearInput.value = maxYear; yearOut.textContent = maxYear;

  function initMap() {
    mapReady = true;
    map = L.map("map", { scrollWheelZoom: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18, referrerPolicy: "strict-origin-when-cross-origin", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    pathLayer = L.layerGroup().addTo(map);
    placeLayer = L.layerGroup().addTo(map);
    renderMap(true);
    yearInput.addEventListener("input", () => { yearOut.textContent = yearInput.value; renderMap(false); });
    document.getElementById("show-paths").addEventListener("change", () => renderMap(false));
  }
  function birthPlace(id) { const p = people.get(id); return p && !hidden(p) && p.birth && p.birth.place; }
  function renderMap(fitBounds) {
    const limit = +yearInput.value;
    const visible = events.filter(e => e.year === null || e.year <= limit);
    const byPlace = d3.group(visible, e => e.place);
    placeLayer.clearLayers(); pathLayer.clearLayers(); markers = {};
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#23507a";
    byPlace.forEach((evs, pid) => {
      const pl = places[pid]; if (!pl) return;
      evs.sort((a, b) => (a.year || 0) - (b.year || 0));
      const r = 7 + Math.sqrt(evs.length) * 4;
      const m = L.circleMarker([pl.lat, pl.lon], {
        radius: r, color: pl.uncertain ? "#b07a1a" : accent, weight: 2, fillColor: pl.uncertain ? "#e9c27a" : accent,
        fillOpacity: 0.35, dashArray: pl.uncertain ? "4 3" : null
      });
      const list = evs.map(e => `<li><span class="ev-ico">${e.ico}</span>${esc(fmtDate(e.date)) || "date inconnue"} · ${e.ids.map(id => people.get(id)).filter(Boolean).map(p => `<button type="button" class="plink" data-person="${esc(p.id)}">${esc(fullName(p))}</button>`).join(" et ")}</li>`).join("");
      m.bindPopup(`<h3>${esc(pl.name)}</h3><div>${esc(pl.dept)}${pl.old ? ` · autrefois ${esc(pl.old)}` : ""}</div>${pl.note ? `<p class="warn">${esc(pl.note)}</p>` : ""}<ul>${list}</ul>`, { maxWidth: 300 });
      m.bindTooltip(`${pl.name} (${evs.length})`);
      m.addTo(placeLayer);
      markers[pid] = m;
    });
    if (document.getElementById("show-paths").checked) {
      family.persons.forEach(c => {
        const cb = birthPlace(c.id); if (!cb || !places[cb]) return;
        const cy = year(c.birth); if (cy && cy > limit) return;
        [c.father, c.mother].forEach(pid => {
          const pb = birthPlace(pid); if (!pb || pb === cb || !places[pb]) return;
          L.polyline([[places[pb].lat, places[pb].lon], [places[cb].lat, places[cb].lon]], { color: accent, weight: 1.5, opacity: 0.55, dashArray: "2 5" })
            .bindTooltip(`${fullName(people.get(pid))} → ${fullName(c)}`).addTo(pathLayer);
        });
      });
    }
    if (fitBounds) {
      const pts = Object.values(places).filter(p => !p.uncertain).map(p => [p.lat, p.lon]);
      if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 11 });
    }
    const nPlaces = byPlace.size;
    document.getElementById("map-hint").textContent = `${nPlaces} lieu${nPlaces > 1 ? "x" : ""} et ${visible.length} événement${visible.length > 1 ? "s" : ""} jusqu'en ${limit}. Le cercle orange en pointillé signale un lieu incertain.`;
  }
  function focusPlace(pid) {
    if (!mapReady) initMap();
    const pl = places[pid]; if (!pl) return;
    map.invalidateSize();
    map.setView([pl.lat, pl.lon], 11);
    if (markers[pid]) markers[pid].openPopup();
  }

  // ---------- people list ----------
  const search = document.getElementById("search");
  function renderPeople() {
    const q = search.value.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    const norm = s => (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    const list = family.persons.filter(p => {
      if (!q) return true;
      const hay = [p.given, p.surname, placeName(p.birth && p.birth.place), placeName(p.death && p.death.place)].map(norm).join(" ");
      return hay.includes(q);
    });
    const groups = d3.groups(list, p => p.surname || "Nom inconnu").sort((a, b) => a[0].localeCompare(b[0], "fr"));
    document.getElementById("people").innerHTML = groups.length ? groups.map(([sn, ps]) => `
      <div class="people-group"><h3>${esc(sn)} <small>${ps.length} personne${ps.length > 1 ? "s" : ""}</small></h3>
      <div class="people-list">${ps.sort((a, b) => (year(a.birth) || 9999) - (year(b.birth) || 9999)).map(p => `
        <button type="button" class="pcard ${p.status || "unknown"}" data-person="${esc(p.id)}">
          <b>${esc(given(p))}</b><span>${esc(lifespan(p) || "dates inconnues")}${sosa.has(p.id) ? ` · Sosa ${sosa.get(p.id)}` : ""}</span>
        </button>`).join("")}</div></div>`).join("") : `<p class="empty">Aucune personne ne correspond à « ${esc(search.value)} ».</p>`;
  }
  search.addEventListener("input", renderPeople);

  // ---------- notes ----------
  const known = family.persons.filter(p => p.status !== "unknown");
  const allYears = family.persons.map(p => year(p.birth)).concat(unions.map(u => (u.date ? +u.date.slice(0, 4) : null))).filter(Boolean);
  const maxGen = d3.max([...sosa.keys()].filter(id => people.get(id).status !== "unknown"), genOf);
  document.getElementById("stats").innerHTML = [
    [known.length, "personnes identifiées"],
    [maxGen, "générations remontées"],
    [Math.min(...allYears), "plus ancienne date"],
    [Object.keys(places).length, "lieux sur la carte"]
  ].map(([b, s]) => `<div class="stat"><b>${b}</b><span>${s}</span></div>`).join("");
  document.getElementById("checks").innerHTML = notes.map(n => `<li><span class="tag ${n.kind === "fix" ? "fix" : "todo"}">${esc(n.tag)}</span><b>${esc(n.title)}</b><p>${esc(n.text)}</p></li>`).join("");
  document.getElementById("sources").innerHTML = (family.sources || []).map(s => `<li>${esc(s.title)}${s.holder ? ` · conservé par ${esc(s.holder)}` : ""}${s.date ? ` · ${esc(s.date)}` : ""}</li>`).join("");

  // ---------- start ----------
  renderPeople();
  buildTree();
  show(location.hash.slice(1) || "arbre");
  requestAnimationFrame(initialView);
}
