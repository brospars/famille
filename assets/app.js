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
    btn.disabled = true; msg.textContent = "Déchiffrement…";
    try {
      const data = await Vault.unlockWithPassword(pw.value, document.getElementById("remember").checked);
      pw.value = ""; msg.textContent = "";
      start(data);
    } catch (err) {
      msg.textContent = err && err.message === "vault"
        ? "Les données sont introuvables. Réessayez plus tard."
        : "Mot de passe incorrect.";
      pw.select();
    } finally { btn.disabled = false; }
  });
  document.getElementById("logout").addEventListener("click", () => { Vault.forget(); location.hash = ""; location.reload(); });
  Vault.unlockFromStorage().then(d => { if (d) start(d); else pw.focus(); }).catch(() => pw.focus());
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
    if (m && day) s = `${+day} ${MONTHS[+m - 1]} ${y}`;
    else if (m) s = `${MONTHS[+m - 1]} ${y}`;
    return d.original ? `${d.original} (${s})` : s;
  }
  const placeName = id => (id && places[id] ? places[id].name : "");
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
    const b = year(p.birth), d = year(p.death);
    if (b && d) return `${b} – ${d}`;
    if (b) return `né${p.sex === "F" ? "e" : ""} en ${b}`;
    if (d) return `† ${d}`;
    const u = unionsOf(p.id).find(u => u.date);
    return u ? `marié${p.sex === "F" ? "e" : ""} en ${u.date.slice(0, 4)}` : "";
  }
  const unionsOf = id => unions.filter(u => u.husband === id || u.wife === id);
  const childrenOf = id => family.persons.filter(c => c.father === id || c.mother === id);
  const STATUS = { doc: "Relevé familial", oral: "Transmis oralement", unknown: "À rechercher" };

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
  function closePanel() { panel.hidden = true; d3.selectAll(".node,.sib").classed("selected", false); }

  function eventRow(label, d) {
    if (!d || (!d.date && !d.place)) return "";
    const place = d.place ? ` à <button type="button" class="placelink" data-place="${esc(d.place)}">${esc(placeName(d.place))}</button>${places[d.place] && places[d.place].uncertain ? " (lieu incertain)" : ""}` : "";
    return `<dt>${label}</dt><dd>${esc(fmtDate(d)) || "date inconnue"}${place}</dd>`;
  }
  function relButton(p, role) {
    if (!p) return "";
    return `<button type="button" data-person="${esc(p.id)}">${esc(fullName(p))} <small>· ${role}${lifespan(p) ? " · " + esc(lifespan(p)) : ""}</small></button>`;
  }
  function openPerson(id) {
    const p = people.get(id); if (!p) return;
    const n = sosa.get(id);
    const g = genOf(id);
    const father = people.get(p.father), mother = people.get(p.mother);
    const us = unionsOf(id);
    const kids = childrenOf(id);
    let dl = "";
    if (!hidden(p)) {
      dl += eventRow("Naissance", p.birth);
      us.forEach(u => {
        const other = people.get(u.husband === id ? u.wife : u.husband);
        if (u.date || u.place) dl += eventRow("Mariage", u).replace("</dd>", other ? ` avec ${esc(fullName(other))}</dd>` : "</dd>");
      });
      dl += eventRow("Décès", p.death);
    }
    panelBody.innerHTML = `
      <p class="who">${n ? `Sosa n° ${n} · génération ${g}` : "Hors ascendance directe"}</p>
      <h2 id="panel-name">${esc(given(p))} ${surname(p) ? `<span class="sn">${esc(surname(p))}</span>` : ""}</h2>
      <span class="badge">${STATUS[p.status] || ""}</span>
      ${hidden(p) ? `<p class="note">Personne vivante : dates et lieux masqués.</p>` : (dl ? `<dl>${dl}</dl>` : `<p class="note">Aucune date ni aucun lieu connus pour l'instant.</p>`)}
      ${p.notes ? `<p class="note">${esc(p.notes)}</p>` : ""}
      ${(father || mother) ? `<h3>Parents</h3><div class="rel">${relButton(father, "père")}${relButton(mother, "mère")}</div>` : ""}
      ${us.length ? `<h3>Conjoint${us.length > 1 ? "s" : ""}</h3><div class="rel">${us.map(u => relButton(people.get(u.husband === id ? u.wife : u.husband), p.sex === "F" ? "époux" : "épouse")).join("")}</div>` : ""}
      ${kids.length ? `<h3>Enfant${kids.length > 1 ? "s" : ""}</h3><div class="rel">${kids.map(k => relButton(k, k.sex === "F" ? "fille" : "fils")).join("")}</div>` : ""}
      <div class="actions"><button type="button" class="btn" data-center="${esc(id)}">Voir dans l'arbre</button></div>`;
    panel.hidden = false;
    d3.selectAll(".node").classed("selected", d => d && d.data.id === id);
    d3.selectAll(".sib").classed("selected", s => s === id);
  }
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-person],[data-place],[data-center]");
    if (!t) return;
    if (t.dataset.person) openPerson(t.dataset.person);
    else if (t.dataset.place) { location.hash = "carte"; setTimeout(() => focusPlace(t.dataset.place), 60); }
    else if (t.dataset.center) { const id = t.dataset.center; location.hash = "arbre"; setTimeout(() => centerOn(id, true), 60); }
  });

  // ---------- tree ----------
  const svg = d3.select("#tree");
  const gRoot = svg.append("g");
  const gLinks = gRoot.append("g");
  const gNodes = gRoot.append("g");
  const NODE_W = 210, NODE_H = 54, COL = 260, ROW = 66;
  const SIB_HEAD = 30, SIB_LINE = 24;
  const zoom = d3.zoom().scaleExtent([0.15, 2.5]).on("zoom", ev => gRoot.attr("transform", ev.transform));
  svg.call(zoom).on("dblclick.zoom", null);
  const ROOT_ID = "__start";
  let layout;

  // Every known person ends with both parents: a real one, or a dashed "unknown" box.
  function buildHierarchy(id) {
    const p = people.get(id);
    const node = { id, p, children: [] };
    if (p.father && people.has(p.father)) node.children.push(buildHierarchy(p.father));
    else node.children.push({ id: `ghost-f-${id}`, ghost: "père" });
    if (p.mother && people.has(p.mother)) node.children.push(buildHierarchy(p.mother));
    else node.children.push({ id: `ghost-m-${id}`, ghost: "mère" });
    return node;
  }
  // Starting point: the sibling group in settings.start, who share the same parents.
  function buildStart() {
    const ids = START.filter(id => people.has(id));
    const first = people.get(ids[0]);
    const tmp = buildHierarchy(first.id);
    return { id: ROOT_ID, siblings: ids, children: tmp.children };
  }
  const rootH = () => SIB_HEAD + START.length * SIB_LINE + 8;
  const nodeH = d => (d.data.id === ROOT_ID ? rootH() : NODE_H);
  function treeHas(id) { return layout && layout.descendants().some(d => d.data.id === id || (d.data.siblings || []).includes(id)); }
  function buildTree() {
    const h = d3.hierarchy(buildStart());
    layout = d3.tree().nodeSize([ROW, COL]).separation((a, b) => (a.parent === b.parent ? 1 : 1.15))(h);
    drawTree();
  }
  function trimText(t, max) { return t.length > max ? t.slice(0, max - 1) + "…" : t; }
  function drawTree() {
    const nodes = layout.descendants(), links = layout.links();
    gLinks.selectAll("path").data(links, d => d.target.data.id).join("path")
      .attr("class", "link")
      .attr("d", d => {
        const sx = d.source.y + NODE_W, sy = d.source.x, tx = d.target.y, ty = d.target.x, mx = (sx + tx) / 2;
        return `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
      });

    const people_ = nodes.filter(d => d.data.id !== ROOT_ID);
    const sel = gNodes.selectAll("g.node").data(people_, d => d.data.id).join(enter => {
      const g = enter.append("g");
      g.append("rect").attr("class", "box").attr("rx", 8).attr("width", NODE_W).attr("height", NODE_H).attr("y", -NODE_H / 2);
      g.append("rect").attr("class", "stripe").attr("width", 4).attr("height", NODE_H - 12).attr("x", 0).attr("y", -NODE_H / 2 + 6).attr("rx", 2);
      g.append("text").attr("class", "n1").attr("x", 14).attr("y", -4);
      g.append("text").attr("class", "n2").attr("x", 14).attr("y", 14);
      g.append("text").attr("class", "sosa").attr("x", NODE_W - 8).attr("y", -NODE_H / 2 + 13).attr("text-anchor", "end");
      g.append("title");
      return g;
    });
    sel.attr("class", d => (d.data.ghost ? "node ghost unknown" : `node ${d.data.p.status || "unknown"}`))
      .attr("transform", d => `translate(${d.y},${d.x})`)
      .attr("tabindex", d => (d.data.ghost ? null : 0))
      .attr("role", d => (d.data.ghost ? null : "button"));
    sel.select(".n1").text(d => (d.data.ghost ? (d.data.ghost === "père" ? "Père inconnu" : "Mère inconnue") : trimText(fullName(d.data.p), 27)));
    sel.select(".n2").text(d => {
      if (d.data.ghost) return "à rechercher";
      const p = d.data.p, ls = lifespan(p);
      const pl = hidden(p) ? "" : placeName((p.birth && p.birth.place) || (p.death && p.death.place));
      return trimText([ls, pl].filter(Boolean).join(" · "), 32);
    });
    sel.select(".sosa").text(d => (!d.data.ghost && sosa.has(d.data.id) ? sosa.get(d.data.id) : ""));
    sel.select("title").text(d => (d.data.ghost ? "" : fullName(d.data.p)));
    sel.on("click", (ev, d) => { if (!d.data.ghost) openPerson(d.data.id); })
      .on("keydown", (ev, d) => { if ((ev.key === "Enter" || ev.key === " ") && !d.data.ghost) { ev.preventDefault(); openPerson(d.data.id); } });

    // starting card: the siblings, one clickable line each
    const root = nodes.find(d => d.data.id === ROOT_ID);
    const H = rootH();
    const g = gNodes.selectAll("g.start").data([root]).join("g").attr("class", "start")
      .attr("transform", d => `translate(${d.y},${d.x})`);
    g.selectAll("rect.start-box").data([0]).join("rect").attr("class", "start-box").attr("rx", 10)
      .attr("width", NODE_W).attr("height", H).attr("y", -H / 2);
    g.selectAll("text.start-title").data([0]).join("text").attr("class", "start-title")
      .attr("x", 14).attr("y", -H / 2 + 21).text(START.length > 1 ? "Les enfants" : "Point de départ");
    const lines = g.selectAll("g.sib").data(root.data.siblings, id => id).join(enter => {
      const l = enter.append("g").attr("class", "sib").attr("tabindex", 0).attr("role", "button");
      l.append("rect").attr("class", "sib-hit").attr("x", 6).attr("width", NODE_W - 12).attr("height", SIB_LINE - 2).attr("rx", 5);
      l.append("text").attr("class", "sib-name").attr("x", 14).attr("y", 15);
      l.append("text").attr("class", "sib-year").attr("x", NODE_W - 12).attr("y", 15).attr("text-anchor", "end");
      return l;
    });
    lines.attr("transform", (id, i) => `translate(0,${-H / 2 + SIB_HEAD + i * SIB_LINE})`)
      .attr("data-person", id => id).attr("aria-label", id => fullName(people.get(id)));
    lines.select(".sib-name").text(id => trimText(fullName(people.get(id)), 24));
    lines.select(".sib-year").text(id => (hidden(people.get(id)) ? "" : year(people.get(id).birth) || ""));
    lines.on("keydown", (ev, id) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openPerson(id); } });

    // generation labels
    const maxDepth = d3.max(nodes, d => d.depth);
    const minX = d3.min(nodes, d => d.x - nodeH(d) / 2);
    gRoot.selectAll("g.gen-axis").data([0]).join("g").attr("class", "gen-axis")
      .selectAll("text").data(d3.range(maxDepth + 1)).join("text")
      .attr("x", d => d * COL + 10).attr("y", minX - 18)
      .text(d => (d === 0 ? "Génération 1" : `${d + 1}`));
  }
  function bounds() {
    const n = layout.descendants();
    return { x0: d3.min(n, d => d.y) - 20, x1: d3.max(n, d => d.y) + NODE_W + 20, y0: d3.min(n, d => d.x - nodeH(d) / 2) - 40, y1: d3.max(n, d => d.x + nodeH(d) / 2) + 20 };
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
    const d = layout.descendants().find(n => n.data.id === id || (n.data.siblings || []).includes(id)); if (!d) return;
    const k = W < 600 ? 0.85 : 1;
    const x = d.depth === 0 ? 16 + (W < 600 ? 0 : 24) : W / 2 - (NODE_W * k) / 2;
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
