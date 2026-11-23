/* Harta locațiilor de filmare (Luna). Totul e decriptat AICI, în browser:
 * parola -> PBKDF2-SHA256 (iterațiile și sarea din data/meta.json) -> cheie AES-256-GCM -> data/locatii.bin + data/img/*.bin.
 * Serverul (GitHub Pages) vede și servește doar text cifrat. Cheia poate rămâne pe dispozitiv (IndexedDB, NEEXTRAGIBILĂ)
 * dacă bifezi „Ține-mă minte”. Datele din fișier sunt scrise de un model AI: se afișează DOAR cu textContent (fără HTML). */
(() => {
  'use strict';
  const S = crypto.subtle, enc = new TextEncoder(), dec = new TextDecoder();
  const $ = (s, r = document) => r.querySelector(s);
  const STATUS = ['propus', 'vizitat', 'filmat'];
  const ST_LABEL = { propus: 'propus', vizitat: 'vizitat', filmat: 'filmat' };
  const CHECK = 'luna-harta-ok';
  let KEY = null, META = null, DATA = null, map = null, layers = {}, curLayer = null, markers = new Map(), selected = null, filter = 'toate', meMarker = null;
  // fațetele (Luna le scrie la fiecare locație): în grup = SAU, între grupuri = ȘI
  const FACETS = [
    ['categorie', 'Ce e', { 'natură': '🌲', 'apă': '💧', 'patrimoniu': '🏰', 'arhitectură': '🏛️', 'urban': '🏙️', 'rural': '🏡', 'viticol': '🍇', 'industrial': '🏭' }],
    ['sezon', 'Sezon', { 'primăvară': '🌸', 'vară': '☀️', 'toamnă': '🍂', 'iarnă': '❄️', 'tot anul': '🔁' }],
    ['moment', 'Momentul zilei', { 'răsărit': '🌅', 'zi': '🌤️', 'apus': '🌇', 'ora albastră': '🌌', 'noapte': '🌙' }],
    ['stil', 'Stil', {}], ['potrivit', 'Potrivit pentru', {}], ['regiune', 'Regiune', {}], ['raion', 'Raion', {}]];
  let sel = {}, query = '';
  try { const s = JSON.parse(localStorage.getItem('harta-filtre') || '{}'); sel = s.sel || {}; query = s.q || ''; } catch { sel = {}; }
  const vals = (l, k) => { const v = l[k]; return Array.isArray(v) ? v : (v ? [v] : []); };
  const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const activeCount = () => Object.values(sel).reduce((n, a) => n + (a || []).length, 0) + (query ? 1 : 0);
  function matchFacets(l, skip) {
    for (const [k] of FACETS) { if (k === skip) continue; const s = sel[k] || []; if (s.length && !vals(l, k).some(v => s.includes(v))) return false; }
    if (query) { const h = fold([l.nume, l.zona, l.tip, l.raion, l.pe_scurt, (l.cadre || []).join(' '), (l.taguri || []).join(' '), (l.concept || []).join(' ')].join(' ')); if (!fold(query).split(/\s+/).every(w => h.includes(w))) return false; }
    return true;
  }
  const imgCache = new Map();

  // ---------- utilitare DOM sigure ----------
  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }
  const st = s => (STATUS.includes(String(s)) ? String(s) : 'propus');
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  function toast(t) { const n = $('#toast'); n.textContent = t; n.classList.add('on'); clearTimeout(n._t); n._t = setTimeout(() => n.classList.remove('on'), 2200); }
  const ll = (l) => `${(+l.lat).toFixed(5)},${(+l.lon).toFixed(5)}`;

  // ---------- criptografie ----------
  async function deriveKey(pw, meta) {
    const base = await S.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
    return S.deriveKey({ name: 'PBKDF2', salt: b64(meta.salt), iterations: meta.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  }
  async function decrypt(key, bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return new Uint8Array(await S.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, key, b.slice(12)));
  }
  async function keyWorks(key, meta) { try { return dec.decode(await decrypt(key, b64(meta.check))) === CHECK; } catch { return false; } }

  // cheia ținută minte: IndexedDB, CryptoKey neextragibil (nici scripturile nu-l pot exporta)
  function idb() { return new Promise((res, rej) => { const r = indexedDB.open('luna-harta', 1); r.onupgradeneeded = () => r.result.createObjectStore('k'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function idbDo(mode, fn) { try { const db = await idb(); return await new Promise(res => { const t = db.transaction('k', mode); const q = fn(t.objectStore('k')); t.oncomplete = () => res(q && q.result); t.onerror = () => res(undefined); }); } catch { return undefined; } }
  const savedGet = () => idbDo('readonly', s => s.get('key'));
  const savedSet = v => idbDo('readwrite', s => s.put(v, 'key'));
  const savedDel = () => idbDo('readwrite', s => s.delete('key'));

  async function fetchBytes(url, fresh) { const r = await fetch(url, { cache: fresh ? 'no-cache' : 'default' }); if (!r.ok) throw new Error(r.status + ' ' + url); return new Uint8Array(await r.arrayBuffer()); }
  async function loadMeta() { const r = await fetch('data/meta.json', { cache: 'no-cache' }); if (!r.ok) throw new Error('meta'); return r.json(); }

  async function imgUrl(im) {
    if (!im || !/^[0-9a-f]{24}$/.test(String(im.id))) return null;
    if (imgCache.has(im.id)) return imgCache.get(im.id);
    const p = (async () => {
      const bytes = await decrypt(KEY, await fetchBytes(`data/img/${im.id}.bin`));
      const type = /^image\/(jpeg|png|webp|gif)$/.test(im.type) ? im.type : 'image/jpeg';
      return URL.createObjectURL(new Blob([bytes], { type }));
    })().catch(() => null);
    imgCache.set(im.id, p);
    return p;
  }
  function photo(im, cls = 'ph', onClick) {
    const box = el('div', { class: cls });
    if (im && im.kind === 'ai') box.append(el('span', { class: 'tag', text: 'imagine generată AI' }));
    else if (im && im.kind === 'harta') box.append(el('span', { class: 'tag', text: 'satelit · direcția soarelui' }));
    if (!im) { box.style.animation = 'none'; return box; }
    imgUrl(im).then(u => {
      if (!u) { box.style.animation = 'none'; return; }
      const i = el('img', { alt: '', decoding: 'async' }); i.onload = () => { i.classList.add('ok'); box.style.animation = 'none'; };
      i.src = u; box.prepend(i);
      if (onClick) box.addEventListener('click', () => onClick(u));
    });
    return box;
  }

  // ---------- deblocare ----------
  async function unlockWith(key) {
    KEY = key;
    DATA = JSON.parse(dec.decode(await decrypt(KEY, await fetchBytes('data/locatii.bin', true))));
    $('#lock').hidden = true; $('#app').hidden = false;
    startMap();
  }
  async function boot() {
    try { META = await loadMeta(); } catch { $('#lockMsg').textContent = 'Harta nu are încă date. Luna le urcă după prima publicare.'; return; }
    const saved = await savedGet();
    if (saved && saved.salt === META.salt && saved.key && await keyWorks(saved.key, META)) {
      try { await unlockWith(saved.key); return; } catch { /* datele s-au schimbat între timp -> cere parola */ }
    } else if (saved) { await savedDel(); }
    $('#pw').focus();
  }
  $('#lockForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#unlockBtn'), msg = $('#lockMsg'), pw = $('#pw').value.trim().toUpperCase();
    if (!pw || !META) return;
    btn.classList.add('busy'); msg.textContent = '';
    try {
      const key = await deriveKey(pw, META);
      if (!(await keyWorks(key, META))) throw new Error('bad');
      if ($('#remember').checked) await savedSet({ salt: META.salt, key });
      await unlockWith(key);
    } catch {
      msg.textContent = 'Parolă greșită.';
      const c = $('.lock-card'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake');
    } finally { btn.classList.remove('busy'); }
  });

  // ---------- harta ----------
  function startMap() {
    map = L.map('map', { zoomControl: false, attributionControl: true, maxBounds: [[44.6, 25.6], [49.3, 31.2]], minZoom: 7, worldCopyJump: false }).setView([47.2, 28.6], 8);
    layers.harta = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
    layers.satelit = L.layerGroup([
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri, Maxar, Earthstar Geographics' }),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 })
    ]);
    layers.teren = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, subdomains: 'abc', attribution: '© OpenStreetMap · SRTM · © OpenTopoMap' });
    setLayer('harta');
    const locs = DATA.locations || [];
    locs.forEach((l, i) => {
      const m = L.marker([+l.lat, +l.lon], { icon: pinIcon(l, false, i), title: String(l.nume || ''), riseOnHover: true, keyboard: true });
      m.on('click', () => select(l.id));
      m.addTo(map); markers.set(l.id, { m, l, i });
    });
    if (locs.length) map.fitBounds(L.latLngBounds(locs.map(l => [+l.lat, +l.lon])).pad(0.25), { maxZoom: 11, animate: false });
    map.on('click', () => closeSheet());
    $('#q').value = query; applyFilter();
    window.addEventListener('hashchange', route); route();
  }
  function pinIcon(l, sel, i = 0) {
    return L.divIcon({ className: 'pin-wrap', html: `<div class="pin ${st(l.status)}${sel ? ' sel' : ''}" style="animation-delay:${Math.min(i, 30) * 40}ms"><span></span></div>`, iconSize: [34, 34], iconAnchor: [17, 17] });
  }
  function setLayer(k) {
    if (curLayer) map.removeLayer(curLayer);
    curLayer = layers[k]; curLayer.addTo(map);
    document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.l === k));
  }
  function visible(l) { return (filter === 'toate' || st(l.status) === filter) && matchFacets(l); }
  function updateCount() {
    const all = DATA.locations || [], n = all.filter(visible).length, a = activeCount();
    $('#count').textContent = (filter === 'toate' && !a) ? `${all.length} locații · Moldova` : `${n} din ${all.length} locații`;
    const b = $('#facetBadge'); b.hidden = !a; b.textContent = a ? String(a) : '';
  }
  function saveFacets() { try { localStorage.setItem('harta-filtre', JSON.stringify({ sel, q: query })); } catch {} }
  // panoul de filtre: fiecare valoare cu câte locații ar rămâne dacă o alegi
  function buildFacets() {
    const all = DATA.locations || [];
    const groups = FACETS.map(([k, title, icons]) => {
      const seen = new Map();
      all.forEach(l => vals(l, k).forEach(v => seen.set(v, 0)));
      if (!seen.size) return null;
      const pool = all.filter(l => (filter === 'toate' || st(l.status) === filter) && matchFacets(l, k));
      pool.forEach(l => vals(l, k).forEach(v => seen.set(v, (seen.get(v) || 0) + 1)));
      const order = Object.keys(icons);
      const items = [...seen.entries()].sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99) || b[1] - a[1] || a[0].localeCompare(b[0], 'ro'));
      return el('div', { class: 'fgroup' }, el('h4', { text: title }),
        el('div', { class: 'fchips' }, items.map(([v, n]) => {
          const on = (sel[k] || []).includes(v);
          return el('button', { class: `chip${on ? ' on' : ''}${!n && !on ? ' dim' : ''}`, 'aria-pressed': String(on), onclick: () => {
            const s = new Set(sel[k] || []); s.has(v) ? s.delete(v) : s.add(v); sel[k] = [...s]; saveFacets(); applyFilter(); buildFacets();
          } }, `${icons[v] ? icons[v] + ' ' : ''}${v}`, el('small', { text: String(n) }));
        })));
    }).filter(Boolean);
    $('#facetGroups').replaceChildren(...groups);
    const n = (DATA.locations || []).filter(visible).length;
    $('#facetApply').textContent = n ? `Arată ${n} ${n === 1 ? 'locație' : 'locații'}` : 'Nicio locație';
  }
  function toggleFacets(open) { const p = $('#facets'); if (open) buildFacets(); p.classList.toggle('open', open); p.setAttribute('aria-hidden', String(!open)); }
  function applyFilter() {
    for (const { m, l } of markers.values()) { if (visible(l)) m.addTo(map); else map.removeLayer(m); }
    updateCount(); buildList();
  }

  // ---------- cardul animat ----------
  function select(id) {
    const rec = markers.get(id); if (!rec) return;
    if (selected && markers.get(selected)) { const p = markers.get(selected); p.m.setIcon(pinIcon(p.l, false)); }
    selected = id; rec.m.setIcon(pinIcon(rec.l, true));
    const l = rec.l;
    const imgs = (l.imgs || []).slice(0, 4);
    const body = el('div', { class: 'fade-in' },
      imgs.length ? el('div', { class: 'strip' }, imgs.map(im => photo(im))) : null,
      el('h2', { text: l.nume }),
      el('div', { class: 'sub' }, el('span', { class: `stbadge ${st(l.status)}`, text: ST_LABEL[st(l.status)] }), [l.tip, l.zona].filter(Boolean).join(' · ')),
      l.pe_scurt ? el('p', { class: 'lead', text: l.pe_scurt }) : null,
      el('div', { class: 'tags one' }, chips(l).slice(0, 3)),
      el('div', { class: 'row' },
        el('button', { class: 'btn primary', text: 'Detalii →', onclick: () => { location.hash = '#/loc/' + encodeURIComponent(l.id); } }),
        el('a', { class: 'btn ghost', href: navUrl('google', l), target: '_blank', rel: 'noopener noreferrer', text: 'Navighează' }))
    );
    const sb = $('#sheetBody'); sb.replaceChildren(body);
    body.addEventListener('click', (e) => { if (!e.target.closest('a,button')) location.hash = '#/loc/' + encodeURIComponent(l.id); });
    const sh = $('#sheet'); sh.classList.add('open'); sh.setAttribute('aria-hidden', 'false');
    $('#app').classList.add('sheet-open');
    // pinul ajunge la mijlocul porțiunii de hartă rămase vizibile deasupra cardului
    const z = Math.max(map.getZoom(), 11), H = map.getSize().y, top = 110, visibleMid = top + Math.max(80, (H - sh.offsetHeight - top) / 2);
    const target = map.project([+l.lat, +l.lon], z).add([0, Math.round(H / 2 - visibleMid)]);
    map.flyTo(map.unproject(target, z), z, { duration: 0.8 });
  }
  function chips(l) {
    const c = [];
    if (l.rasarit) c.push('☀️ răsărit în cadru');
    if (l.apus) c.push('🌇 apus în cadru');
    if (l.altitudine) c.push(`⛰️ ${l.altitudine} m`);
    (l.categorie || []).forEach(x => c.push(`${FACETS[0][2][x] || ''} ${x}`.trim()));
    (l.concept || []).slice(0, 3).forEach(x => c.push(x));
    return c.map(t => el('span', { class: 'tg', text: t }));
  }
  // etichetele din pagina locației: apeși una -> harta arată doar locațiile cu ea
  function facetTags(l) {
    const out = [];
    for (const [k, title, icons] of FACETS) for (const v of vals(l, k)) out.push(el('button', { class: 'tg tgb', title, onclick: () => { sel = { [k]: [v] }; query = ''; $('#q').value = ''; saveFacets(); applyFilter(); history.back(); toast(`Filtru: ${v}`); } }, `${icons[v] ? icons[v] + ' ' : ''}${v}`));
    return out.length ? el('div', { class: 'tags' }, out) : null;
  }
  function closeSheet() {
    const sh = $('#sheet'); sh.classList.remove('open'); sh.setAttribute('aria-hidden', 'true');
    $('#app').classList.remove('sheet-open');
    if (selected && markers.get(selected)) { const p = markers.get(selected); p.m.setIcon(pinIcon(p.l, false)); }
    selected = null;
  }
  // trage cardul în jos ca să-l închizi
  (() => {
    const sh = $('#sheet'); let y0 = null, dy = 0;
    sh.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; dy = 0; sh.style.transition = 'none'; }, { passive: true });
    sh.addEventListener('touchmove', e => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); sh.style.transform = `translateY(${dy}px)`; }, { passive: true });
    sh.addEventListener('touchend', () => { sh.style.transition = ''; sh.style.transform = ''; if (dy > 90) closeSheet(); y0 = null; });
  })();

  function navUrl(kind, l) {
    const p = ll(l);
    if (kind === 'apple') return `https://maps.apple.com/?daddr=${p}`;
    if (kind === 'waze') return `https://waze.com/ul?ll=${p}&navigate=yes`;
    return `https://www.google.com/maps/dir/?api=1&destination=${p}`;
  }

  // ---------- pagina locației ----------
  function route() {
    const m = /^#\/loc\/(.+)$/.exec(location.hash);
    const d = $('#detail');
    if (!m) { d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); return; }
    const rec = markers.get(decodeURIComponent(m[1])); if (!rec) { history.replaceState(null, '', '#'); return; }
    renderDetail(rec.l); d.scrollTop = 0;
    requestAnimationFrame(() => { d.classList.add('open'); d.setAttribute('aria-hidden', 'false'); });
  }
  function sec(title, ...content) {
    const kids = content.flat().filter(x => x != null && x !== '' && x !== false);
    if (!kids.length) return null;
    return el('section', { class: 'sec' }, el('h3', { text: title }), kids);
  }
  const para = t => (t ? el('p', { text: t }) : null);
  const list = arr => ((arr || []).length ? el('ul', {}, arr.map(x => el('li', { text: x }))) : null);
  function renderDetail(l) {
    const imgs = l.imgs || [];
    const counter = el('span', { class: 'counter', text: imgs.length ? `1 / ${imgs.length}` : '' });
    const strip = el('div', { class: 'strip' }, imgs.length ? imgs.map(im => photo(im, 'ph', u => openLightbox(u))) : [photo(null)]);
    strip.addEventListener('scroll', () => { const i = Math.round(strip.scrollLeft / strip.clientWidth); if (imgs.length) counter.textContent = `${i + 1} / ${imgs.length}`; credit.textContent = (imgs[i] && imgs[i].credit) || ''; }, { passive: true });
    const credit = el('div', { class: 'credit', text: (imgs[0] && imgs[0].credit) || '' });
    const view = el('div', {},
      el('div', { class: 'hero' }, strip, el('button', { class: 'back', 'aria-label': 'Înapoi la hartă', text: '←', onclick: () => history.back() }), counter),
      el('div', { class: 'dbody fade-in' },
        el('h1', { text: l.nume }),
        el('div', { class: 'sub' }, el('span', { class: `stbadge ${st(l.status)}`, text: ST_LABEL[st(l.status)] }), [l.tip, l.zona, l.descoperit ? `găsit pe ${l.descoperit}` : ''].filter(Boolean).join(' · ')),
        credit,
        l.pe_scurt ? el('p', { class: 'lead', style: 'margin-top:12px;font-size:17px', text: l.pe_scurt }) : null,
        el('div', { class: 'tags', style: 'margin-top:10px' }, chips(l), (l.taguri || []).map(t => el('span', { class: 'tg', text: t }))),
        sec('Etichete', facetTags(l)),
        sec('De ce e epic', para(l.de_ce)),
        sec('Când', para(l.cand)),
        sec('Lumina', para(l.lumina)),
        sec('Idei de cadre', list(l.cadre)),
        sec('Acces & dronă', para(l.acces ? `🚗 ${l.acces}` : ''), para(l.drona ? `🚁 ${l.drona}` : '')),
        sec('Date tehnice', list(l.tehnic), para((l.vedere || []).length ? `Vedere deschisă spre: ${l.vedere.join(', ')}` : '')),
        sec('Ce a aflat Luna', para(l.cercetare)),
        sec('Notele tale', para(l.note)),
        el('section', { class: 'sec' }, el('h3', { text: 'Cum ajungi' }),
          el('div', { class: 'coords' }, el('span', { text: ll(l) }), el('button', { class: 'tg', text: 'Copiază', onclick: () => copy(ll(l)) })),
          el('div', { class: 'navs' },
            el('a', { href: navUrl('google', l), target: '_blank', rel: 'noopener noreferrer', text: 'Google Maps' }),
            el('a', { href: navUrl('apple', l), target: '_blank', rel: 'noopener noreferrer', text: 'Apple Maps' }),
            el('a', { href: navUrl('waze', l), target: '_blank', rel: 'noopener noreferrer', text: 'Waze' })))
      ));
    $('#detail').replaceChildren(view);
  }
  function copy(t) { (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast('Coordonate copiate'), () => toast(t)); }
  function openLightbox(u) {
    const lb = $('#lightbox'); lb.replaceChildren(el('img', { src: u, alt: '' })); lb.hidden = false;
    lb.onclick = () => { lb.hidden = true; lb.replaceChildren(); };
  }

  // ---------- lista ----------
  function buildList() {
    const all = (DATA.locations || []).filter(visible).slice().sort((a, b) => String(b.descoperit).localeCompare(String(a.descoperit)));
    $('#listBody').replaceChildren(...(all.length ? all.map(l => el('button', { class: 'item', onclick: () => { togglePanel(false); select(l.id); } },
      photo((l.imgs || [])[0], 'ph th'),
      el('div', {}, el('b', { text: l.nume }), el('small', {}, el('i', { class: `dot ${st(l.status)}` }), ' ', [l.zona, l.tip].filter(Boolean).join(' · '))))) : [el('p', { class: 'muted', text: 'Nicio locație cu filtrul ăsta.' })]));
  }
  function togglePanel(open) { const p = $('#list'); p.classList.toggle('open', open); p.setAttribute('aria-hidden', String(!open)); }

  // ---------- butoane ----------
  $('#filters').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; filter = b.dataset.f; document.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b)); closeSheet(); applyFilter(); });
  document.querySelector('.seg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setLayer(b.dataset.l); });
  $('#btnList').addEventListener('click', () => togglePanel(true));
  $('#btnFacets').addEventListener('click', () => toggleFacets(true));
  document.querySelector('[data-close="facets"]').addEventListener('click', () => toggleFacets(false));
  $('#facetApply').addEventListener('click', () => {
    toggleFacets(false); closeSheet();
    const vis = (DATA.locations || []).filter(visible);
    if (vis.length) map.flyToBounds(L.latLngBounds(vis.map(l => [+l.lat, +l.lon])).pad(0.3), { maxZoom: 12, duration: 0.8 });
  });
  $('#facetReset').addEventListener('click', () => { sel = {}; query = ''; $('#q').value = ''; saveFacets(); applyFilter(); buildFacets(); });
  $('#q').addEventListener('input', e => { query = e.target.value.trim(); saveFacets(); applyFilter(); buildFacets(); });
  document.querySelector('[data-close="list"]').addEventListener('click', () => togglePanel(false));
  $('#btnLocate').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Locația nu e disponibilă');
    navigator.geolocation.getCurrentPosition(p => {
      const ll = [p.coords.latitude, p.coords.longitude];
      if (!meMarker) meMarker = L.marker(ll, { icon: L.divIcon({ className: 'pin-wrap', html: '<div class="me-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false }).addTo(map);
      else meMarker.setLatLng(ll);
      map.flyTo(ll, Math.max(map.getZoom(), 12), { duration: 0.8 });
    }, () => toast('N-am primit permisiunea pentru locație'), { enableHighAccuracy: true, timeout: 10000 });
  });
  $('#btnLock').addEventListener('click', async () => { await savedDel(); location.hash = ''; location.reload(); });

  boot();
})();
