/* Prospección Barros — app de campo
   Datos cifrados (data.enc.json) + mapas del IGN + relieve local LiDAR calculado en el móvil */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LS = {
    get(k, d) { try { const v = localStorage.getItem((window.ARQ_DEMO ? 'arqdemo_' : 'arq_') + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem((window.ARQ_DEMO ? 'arqdemo_' : 'arq_') + k, JSON.stringify(v)); } catch (e) { } }
  };
  const LEVEL = ['Visto en el relieve', 'Probable', 'Hipótesis'];
  const LCOL = ['#3b6d11', '#d98a1c', '#8a6a3a'];
  const SRC = ['Anomalía LiDAR', 'Topónimo', 'Ermita', 'Modelo predictivo'];
  const scoreCol = s => s >= 75 ? '#7a1a0a' : s >= 60 ? '#a4502a' : s >= 45 ? '#d98a1c' : '#b59a6a';
  const reS = /villar|castillej|castro\b|paredon|paredes|paredita|paredón|torrej|torrecilla|torre agui|tejar|tejares|\bteja\b|moro\b|\bmora\b|romanos|calzada|atalaya|palacio quemado|casas viejas|malcasar|\bcasar\b|cristianos|siete piedras|los hornos|tesoro|almenas|castillo de guadajira|cuarto del castillo|barreras del castillo|sierra castillo|cerro del castillo|el castillo|fuente castillo|villarreala|villagordo|\bcastro\b/i;

  let D = null, C = [], map, layers = {}, gps = null, gpsMarker = null, relief = null;
  let state = Object.assign({ base: 'lidar', cmp: 'none', op: 60, minS: 0, show: [1, 1, 1], known: 1, roads: 1, veto: 1, mine: 1, cat: 0, det: 0, detOp: 85 }, LS.get('state', {}));
  const marks = LS.get('marks', {});
  const mine = LS.get('mine', []);
  const saveState = () => LS.set('state', state);

  /* ---------------- descifrado ---------------- */
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function decrypt(pw) {
    const enc = await (await fetch('data.enc.json', { cache: 'no-cache' })).json();
    const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(enc.salt), iterations: enc.iter, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  $('#gf').addEventListener('submit', async e => {
    e.preventDefault(); $('#err').textContent = 'Abriendo…';
    try { D = await decrypt($('#pw').value.trim()); LS.set('pw', $('#pw').value.trim()); start(); }
    catch (x) { $('#err').textContent = 'Contraseña incorrecta.'; }
  });
  (async () => { if (window.ARQ_DEMO) { D = await window.ARQ_DEMO; start(); return; } const p = LS.get('pw', null); if (p) { try { D = await decrypt(p); start(); } catch (e) { } } })();

  /* ---------------- decodificar candidatos ---------------- */
  function decode() {
    const N = D.N, K = D.K, d10 = v => v >= 0 ? v * 10 : -1;
    C = D.c.map((r, i) => {
      const f = {
        dw: d10(r[5]), dv: d10(r[6]), dp: d10(r[7]), vd: d10(r[8]),
        tn: r[9] >= 0 ? N[r[9]] : '', td: r[9] >= 0 ? d10(r[10]) : -1,
        en: r[11] >= 0 ? N[r[11]] : '', ed: r[11] >= 0 ? d10(r[12]) : -1,
        kn: r[13] >= 0 && K[r[13]] ? K[r[13]][3] : '', kd: r[13] >= 0 ? d10(r[14]) : -1,
        sp: d10(r[15]), sl: r[16], tp: r[17], dt: d10(r[18]), an: null
      };
      f.ts = f.tn ? (reS.test(f.tn) ? 2 : 1) : 0;
      if (r.length >= 25) f.an = { sg: r[20], h: r[21] / 10, ar: r[22] * 10, el: r[23] / 10, sig: r[24] / 10 };
      const s = ARQ.score(f);
      const th = ARQ.theory(f);
      const par = r[19] >= 0 ? N[r[19]] : '';
      return { id: i + 1, a: D.LA + r[0] / 1e5, o: D.LO + r[1] / 1e5, s, l: r[3], src: r[4], f, th, par, t: th[0][0] };
    });
  }

  /* ---------------- capas ---------------- */
  const wms = (url, lay, nz, extra) => L.tileLayer.wms(url, Object.assign({ layers: lay, format: 'image/jpeg', transparent: false, version: '1.1.1', maxZoom: 21, maxNativeZoom: nz || 18, attribution: 'IGN · CNIG (CC BY 4.0)' }, extra || {}));
  const wmts = (svc, layer, nz) => L.tileLayer(`https://www.ign.es/wmts/${svc}?layer=${layer}&style=default&tilematrixset=GoogleMapsCompatible&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image/jpeg&TileMatrix={z}&TileCol={x}&TileRow={y}`, { maxZoom: 21, maxNativeZoom: nz, attribution: 'IGN · CNIG (CC BY 4.0)' });
  const BASES = {
    lidar: { n: 'Relieve LiDAR', mk: () => wms('https://wms-mapa-lidar.idee.es/lidar', 'EL.GridCoverage', 17) },
    orto: { n: 'Ortofoto actual', mk: () => wmts('pnoa-ma', 'OI.OrthoimageCoverage', 19) },
    v56: { n: 'Vuelo 1956', mk: () => wms('https://www.ign.es/wms/pnoa-historico', 'AMS_1956-1957', 17) },
    v80: { n: 'Vuelo 1973-86', mk: () => wms('https://www.ign.es/wms/pnoa-historico', 'Interministerial_1973-1986', 17) },
    mdt: { n: 'Altitudes', mk: () => wms('https://servicios.idee.es/wms-inspire/mdt', 'EL.ElevationGridCoverage', 16) },
    mapa: { n: 'Mapa IGN', mk: () => L.tileLayer('https://www.ign.es/wmts/mapa-raster?layer=MTN&style=default&tilematrixset=GoogleMapsCompatible&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image/jpeg&TileMatrix={z}&TileCol={x}&TileRow={y}', { maxZoom: 21, maxNativeZoom: 17, attribution: 'IGN' }) }
  };
  let baseL = null, cmpL = null, catL = null;
  function setBase() { if (baseL) map.removeLayer(baseL); baseL = BASES[state.base].mk().addTo(map); baseL.bringToBack(); setCmp(); }
  function setCmp() { if (cmpL) { map.removeLayer(cmpL); cmpL = null; } if (state.cmp !== 'none' && state.cmp !== state.base) { cmpL = BASES[state.cmp].mk().addTo(map); cmpL.setOpacity(state.op / 100); cmpL.setZIndex(5); } }
  function setCat() {
    if (catL) { map.removeLayer(catL); catL = null; }
    if (state.cat) catL = L.tileLayer.wms('https://ovc.catastro.meh.es/Cartografia/WMS/ServidorWMS.aspx', { layers: 'Catastro', format: 'image/png', transparent: true, version: '1.1.1', maxZoom: 20, minZoom: 15, attribution: 'Dirección General del Catastro' }).addTo(map).setZIndex(8);
  }

  /* ---------------- candidatos en el mapa ---------------- */
  function visible(c) { return c.s >= state.minS && state.show[c.l]; }
  function drawCands() {
    layers.cand.clearLayers();
    for (const c of C) {
      if (!visible(c)) continue;
      const m = marks[c.id];
      const r = c.l === 0 ? 8 : c.l === 1 ? 6.5 : 5;
      L.circleMarker([c.a, c.o], {
        radius: r, color: m === 'des' ? '#555' : LCOL[c.l], weight: c.l === 2 ? 1.6 : 2.2, dashArray: c.l === 2 ? '3 2' : null,
        fillColor: m === 'des' ? '#999' : m === 'vis' ? '#1a73e8' : m === 'int' ? '#7a1fa2' : scoreCol(c.s), fillOpacity: m === 'des' ? .3 : .85
      }).on('click', () => openCand(c)).addTo(layers.cand);
    }
    legend();
  }
  function legend() {
    const n = [0, 0, 0]; for (const c of C) if (c.s >= state.minS) n[c.l]++;
    $('#legend').innerHTML = `<span class="dot" style="background:${LCOL[0]}"></span>Visto ${n[0]} &nbsp;<span class="dot" style="background:${LCOL[1]}"></span>Probable ${n[1]} &nbsp;<span class="dot" style="background:#fff;border:2px dashed ${LCOL[2]}"></span>Hipótesis ${n[2]}`;
  }

  /* ---------------- ficha del candidato ---------------- */
  const fmt = (a, o) => `${a.toFixed(5)}, ${o.toFixed(5)}`;
  const dist = (a1, o1, a2, o2) => map.distance([a1, o1], [a2, o2]);
  function openCand(c) {
    const m = marks[c.id] || '', note = LS.get('n_' + c.id, '');
    const w = ARQ.contrib(c.f).sort((x, y) => y[1] - x[1]);
    const g = gps ? dist(gps[0], gps[1], c.a, c.o) : null;
    sheet(`<button class="x" data-close aria-label="Cerrar">&times;</button>
    <div class="chips"><span class="chip l${c.l}">${LEVEL[c.l]}</span><span class="chip" style="background:${scoreCol(c.s)};color:#fff">${c.s} / 100</span><span class="chip lm">${SRC[c.src]}</span></div>
    <h2>${esc(c.t)}</h2>
    <div class="mute">${c.par ? 'Paraje ' + esc(c.par) + ' · ' : ''}${fmt(c.a, c.o)} · nº ${c.id}${g != null ? ' · a ' + (g / 1000).toFixed(g < 10000 ? 1 : 0) + ' km de ti' : ''}</div>
    <div class="row"><button class="pri" data-relief="${c.id}">Relieve marcado</button><button class="pri" data-v3="${c.id}">Vista 3D y a pie</button></div>
    <div class="row"><button data-zoom="${c.a},${c.o}">Acercar</button><button data-gsat="${c.a},${c.o}">Google satélite</button><button data-gsv="${c.a},${c.o}">Street View</button></div>
    <div class="seg">${Object.entries(BASES).slice(0, 4).map(([id, b]) => `<button data-base="${id}" class="${state.base === id ? 'on' : ''}">${b.n}</button>`).join('')}</div>
    <h3>Por qué está marcado</h3>
    <ul class="why">${w.map(([t, p]) => `<li><span>${esc(t)}</span><b class="${p < 0 ? 'neg' : ''}">${p > 0 ? '+' : ''}${p}</b></li>`).join('')}</ul>
    <h3>Qué podría ser</h3>
    ${c.th.map(([t, d], i) => `<div class="theory${i ? '' : ' first'}"><b>${esc(t)}</b><p>${esc(d)}</p></div>`).join('')}
    <h3>Qué buscar en el terreno</h3>
    <p class="small">${fieldTip(c)}</p>
    <div class="row"><button data-nav="${c.a},${c.o}">Cómo llegar</button><button data-pat="${c.id}">Avisar a Patrimonio</button></div>
    <h3>Tu revisión</h3>
    <div class="seg">${[['', 'Sin revisar'], ['vis', 'Visitado'], ['int', 'Interesante'], ['des', 'Descartado']].map(([k, t]) => `<button class="${m === k ? 'on' : ''}" data-mark="${k}" data-id="${c.id}">${t}</button>`).join('')}</div>
    <textarea id="note" placeholder="Notas de campo: qué has visto, fotos hechas, cultivo…">${esc(note)}</textarea>
    <p class="mute small">La puntuación suma indicios del modelo; no es una probabilidad real. Antes de pisar el sitio, consulta a Patrimonio si ya está catalogado y pide permiso al dueño de la finca.</p>`);
    $('#note').addEventListener('input', e => LS.set('n_' + c.id, e.target.value));
  }
  function fieldTip(c) {
    const t = [];
    const a = c.f.an;
    if (a && a.sg > 0) t.push('Sube al abultamiento y mira la tierra arada: tejas curvas o planas (tégulas), ladrillo macizo, trozos de cerámica roja brillante (terra sigillata), piedras de muro sueltas o mortero de cal.');
    if (a && a.sg < 0) t.push('En el hoyo fíjate si el borde es regular o circular, si hay piedras colocadas o tierra más oscura: un foso o silo rellenado cambia el color de la tierra.');
    if (c.f.tp > 25) t.push('En la cima y las laderas busca líneas de piedras, escalones artificiales (terrazas) y cerámica a mano, gruesa y oscura, típica de la Prehistoria y la Edad del Hierro.');
    if (c.f.dv >= 0 && c.f.dv <= 1500) t.push('Cerca de la calzada, busca piedras planas grandes alineadas, miliarios (columnas de piedra con letras) reaprovechados en cercas y restos de tejas.');
    t.push('La mejor época es con el campo recién arado o en primavera con cereal: los restos enterrados hacen que el sembrado crezca distinto (marcas de cultivo). Haz fotos con el móvil y apunta las coordenadas; no cojas nada.');
    return esc(t.join(' '));
  }
  function patrimonioText(c) {
    return `Asunto: Comunicación de posible yacimiento arqueológico\n\nMe dirijo a la Dirección General de Patrimonio Cultural de la Junta de Extremadura para comunicar un posible yacimiento arqueológico, por si no estuviera ya catalogado.\n\nLocalización: paraje ${c.par || '(sin nombre)'}, coordenadas ${fmt(c.a, c.o)} (ETRS89, grados decimales).\nIndicios: ${ARQ.contrib(c.f).filter(x => x[1] > 0).map(x => x[0]).join('; ')}.\nInterpretación posible: ${c.th.map(x => x[0]).join(', ')}.\n\nNo he realizado ninguna remoción de tierras ni recogida de materiales. Quedo a su disposición para ampliar la información.\n\nAtentamente,\nJosé Manuel González Lagar`;
  }

  /* ---------------- relieve local LiDAR (MDT 5 m del IGN), calculado aquí ---------------- */
  async function showRelief(c) {
    if (!window.GeoTIFF) { toast('No se pudo cargar el lector del relieve.'); return; }
    toast('Calculando el relieve local…', 20000);
    try {
      const [s0, n0, w0, e0] = ARQT.boxAround(c.a, c.o, 350);
      const d = await ARQT.fetchDem(s0, n0, w0, e0);
      const an = ARQT.analyze(d, c.f.an ? c.f.an.sg : 1, c.a, c.o);
      const cv = ARQT.reliefCanvas(d, an, 4, { alpha: 230 });
      const bb = d.bb;
      if (relief) map.removeLayer(relief);
      relief = L.layerGroup().addTo(map);
      L.imageOverlay(cv.toDataURL(), [[bb[1], bb[0]], [bb[3], bb[2]]], { opacity: 0.92, interactive: false, pane: 'relief' }).addTo(relief);
      L.rectangle([[bb[1], bb[0]], [bb[3], bb[2]]], { color: '#fff', weight: 1, fill: false, dashArray: '4 4', interactive: false }).addTo(relief);
      map.setView([c.a, c.o], 17);
      $('#sheet').classList.remove('on');
      const msg = an.area ? `Relieve local: rojo = más alto que su entorno, azul = más bajo. En naranja, la forma detectada (${an.area} m²).` : 'Relieve local: rojo = más alto que su entorno, azul = más bajo. Aquí no hay una forma clara en el relieve; el punto viene del modelo predictivo.';
      toast(msg + ' Toca el mapa para quitarlo.', 9000);
      map.once('click', () => { if (relief) { map.removeLayer(relief); relief = null; } });
    } catch (err) {
      toast('No se pudo descargar el relieve (¿sin cobertura?). Si guardaste la zona antes, se usará la copia.');
    }
  }

  /* ---------------- relieve de detalle para lo que se ve en pantalla ---------------- */
  let detL = null, detBusy = false, detKey = '';
  async function detailRelief() {
    if (!state.det) { if (detL) { map.removeLayer(detL); detL = null; } return; }
    if (map.getZoom() < 15) { if (detL) { map.removeLayer(detL); detL = null; } return; }
    const b = map.getBounds().pad(0.15), key = b.toBBoxString();
    if (key === detKey || detBusy) return;
    const wM = map.distance(b.getSouthWest(), b.getSouthEast()), hM = map.distance(b.getSouthWest(), b.getNorthWest());
    if (wM * hM > 9e6) { toast('Acércate un poco más para el relieve de detalle.'); return; }
    detBusy = true; detKey = key;
    try {
      const d = await ARQT.fetchDem(b.getSouth(), b.getNorth(), b.getWest(), b.getEast());
      const an = ARQT.analyze(d);
      const k = Math.max(2, Math.min(5, Math.round(1400 / Math.max(d.W, d.H))));
      const cv = ARQT.reliefCanvas(d, an, k, { alpha: 255 });
      const bb = d.bb, nl = L.imageOverlay(cv.toDataURL(), [[bb[1], bb[0]], [bb[3], bb[2]]], { opacity: state.detOp / 100, interactive: false, pane: 'relief' }).addTo(map);
      if (detL) map.removeLayer(detL);
      detL = nl;
    } catch (e) { toast('No se pudo calcular el relieve de detalle (¿sin cobertura?).'); detKey = ''; }
    detBusy = false;
  }

  /* ---------------- hojas ---------------- */
  function sheet(html) { const s = $('#sheet'); s.innerHTML = html; s.classList.add('on'); s.scrollTop = 0; }
  let toastT = null;
  function toast(t, ms) { const el = $('#prog'); el.textContent = t; el.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => el.style.display = 'none', ms || 4000); }
  function copyText(t, btn) {
    const done = () => { if (btn) btn.textContent = 'Copiado'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, () => fallback());
    else fallback();
    function fallback() { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { } ta.remove(); }
  }

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-close],[data-mark],[data-zoom],[data-go],[data-base],[data-cmp],[data-delmine],[data-relief],[data-nav],[data-pat],[data-copy],[data-v3],[data-gsat],[data-gsv],[data-v3here]'); if (!t) return;
    const d = t.dataset;
    if (d.close !== undefined) $('#sheet').classList.remove('on');
    if (d.mark !== undefined) { const id = d.id; if (d.mark) marks[id] = d.mark; else delete marks[id]; LS.set('marks', marks); drawCands(); openCand(C[id - 1]); }
    if (d.zoom) { const [a, o] = d.zoom.split(',').map(Number); map.setView([a, o], 17); $('#sheet').classList.remove('on'); }
    if (d.go) { const c = C[+d.go - 1]; map.setView([c.a, c.o], 16); openCand(c); }
    if (d.base) { state.base = d.base; saveState(); setBase(); if ($('#lay')) layersSheet(); else t.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === t)); }
    if (d.cmp) { state.cmp = d.cmp; saveState(); setCmp(); layersSheet(); }
    if (d.delmine) { mine.splice(+d.delmine, 1); LS.set('mine', mine); drawMine(); $('#sheet').classList.remove('on'); }
    if (d.relief) showRelief(C[+d.relief - 1]);
    if (d.v3) { const c = C[+d.v3 - 1]; ARQ3D.open({ a: c.a, o: c.o, sg: c.f.an ? c.f.an.sg : 1, title: c.t }); }
    if (d.v3here !== undefined) { const m = map.getCenter(); $('#sheet').classList.remove('on'); ARQ3D.open({ a: m.lat, o: m.lng, title: 'Centro del mapa' }); }
    if (d.gsat) { const [a, o] = d.gsat.split(','); window.open(`https://www.google.com/maps/@?api=1&map_action=map&center=${a},${o}&zoom=19&basemap=satellite`, '_blank'); }
    if (d.gsv) { const [a, o] = d.gsv.split(','); window.open(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${a},${o}`, '_blank'); }
    if (d.nav) { const [a, o] = d.nav.split(','); window.open(`https://www.google.com/maps/dir/?api=1&destination=${a},${o}`, '_blank'); }
    if (d.pat) { const c = C[+d.pat - 1]; sheet(`<button class="x" data-close aria-label="Cerrar">&times;</button><h2>Avisar a Patrimonio</h2><p class="small">Si al visitarlo ves restos claros, comunícalo a la Junta. Así queda protegido y a tu nombre como descubridor. Tienes el texto listo para copiar y enviar por registro o correo al Servicio de Arqueología de la Dirección General de Patrimonio Cultural.</p><textarea id="pt" style="min-height:260px">${esc(patrimonioText(c))}</textarea><div class="row"><button class="pri" data-copy="pt">Copiar texto</button><button data-go="${c.id}">Volver a la ficha</button></div><p class="mute small">Antes de enviarlo revisa el texto y añade fotos. Información oficial: juntaex.es, apartado de consulta de documentación arqueológica.</p>`); }
    if (d.copy) copyText($('#' + d.copy).value, t);
  });

  /* ---------------- capas ---------------- */
  function layersSheet() {
    const seg = (k, attr, extra) => (extra || '') + Object.entries(BASES).map(([id, b]) => `<button data-${attr}="${id}" class="${state[k] === id ? 'on' : ''}">${b.n}</button>`).join('');
    sheet(`<button class="x" data-close aria-label="Cerrar">&times;</button><h2 id="lay">Capas</h2>
    <div class="mute">Fondo</div><div class="seg">${seg('base', 'base')}</div>
    <div class="mute">Comparar encima, con transparencia</div><div class="seg">${seg('cmp', 'cmp', `<button data-cmp="none" class="${state.cmp === 'none' ? 'on' : ''}">Nada</button>`)}</div>
    <input type="range" id="op" min="0" max="100" step="5" value="${state.op}" aria-label="Transparencia">
    <div class="mute" style="margin-top:12px">Encima del mapa</div>
    <label class="ck"><input type="checkbox" id="k_det" ${state.det ? 'checked' : ''}> Relieve de detalle al acercar (LiDAR 5 m calculado en el móvil, nítido de cerca)</label>
    <input type="range" id="detOp" min="20" max="100" step="5" value="${state.detOp}" aria-label="Transparencia del relieve de detalle">
    <button data-v3here style="width:100%;margin:6px 0">Ver en 3D el centro del mapa</button>
    <label class="ck"><input type="checkbox" id="k_veto" ${state.veto ? 'checked' : ''}> Zonas conocidas, vetadas (rojo)</label>
    <label class="ck"><input type="checkbox" id="k_known" ${state.known ? 'checked' : ''}> Yacimientos y monumentos conocidos</label>
    <label class="ck"><input type="checkbox" id="k_roads" ${state.roads ? 'checked' : ''}> Vía de la Plata, cañadas y caminos viejos</label>
    <label class="ck"><input type="checkbox" id="k_cat" ${state.cat ? 'checked' : ''}> Parcelas del Catastro (al acercar)</label>
    <label class="ck"><input type="checkbox" id="k_mine" ${state.mine ? 'checked' : ''}> Mis puntos</label>
    <div class="mute" style="margin-top:12px">Candidatos</div>
    ${LEVEL.map((t, i) => `<label class="ck"><input type="checkbox" data-lv="${i}" ${state.show[i] ? 'checked' : ''}> <span class="dot" style="background:${LCOL[i]}"></span>${t}</label>`).join('')}
    <div class="mute">Puntuación mínima: <b id="msv">${state.minS}</b></div>
    <input type="range" id="minS" min="0" max="90" step="5" value="${state.minS}" aria-label="Puntuación mínima">
    <p class="mute small">Datos del ${D.gen}. ${C.length} candidatos.</p>`);
    $('#op').oninput = e => { state.op = +e.target.value; saveState(); if (cmpL) cmpL.setOpacity(state.op / 100); };
    $('#minS').oninput = e => { state.minS = +e.target.value; $('#msv').textContent = state.minS; saveState(); drawCands(); };
    document.querySelectorAll('[data-lv]').forEach(b => b.onchange = e => { state.show[+e.target.dataset.lv] = e.target.checked ? 1 : 0; saveState(); drawCands(); });
    for (const k of ['veto', 'known', 'roads', 'mine', 'cat']) $('#k_' + k).onchange = e => { state[k] = e.target.checked ? 1 : 0; saveState(); toggles(); };
    $('#k_det').onchange = e => { state.det = e.target.checked ? 1 : 0; saveState(); detKey = ''; detailRelief(); if (state.det && map.getZoom() < 15) toast('Acércate (escala de 500 m o menos) y se dibuja solo.'); };
    $('#detOp').oninput = e => { state.detOp = +e.target.value; saveState(); if (detL) detL.setOpacity(state.detOp / 100); };
  }
  function toggles() {
    for (const k of ['veto', 'known', 'roads', 'mine']) { if (state[k]) layers[k].addTo(map); else map.removeLayer(layers[k]); }
    setCat();
  }

  /* ---------------- lista y búsqueda ---------------- */
  function listSheet() {
    let mode = LS.get('lmode', 'score'), q = '';
    const render = () => {
      const ctr = gps ? L.latLng(gps) : map.getCenter();
      const qq = q.toLowerCase();
      const arr = C.filter(c => visible(c) && (!qq || (c.par + ' ' + c.t + ' ' + c.f.tn + ' ' + c.id).toLowerCase().includes(qq))).map(c => ({ c, d: map.distance(ctr, [c.a, c.o]) }));
      arr.sort((x, y) => mode === 'score' ? y.c.s - x.c.s : x.d - y.d);
      $('#lres').innerHTML = arr.slice(0, 200).map(({ c, d }) => `<li data-go="${c.id}"><span class="sc" style="background:${scoreCol(c.s)}">${c.s}</span><span style="flex:1">${esc(c.t)}<br><span class="mute">${c.par ? esc(c.par) + ' · ' : ''}${LEVEL[c.l]} · ${(d / 1000).toFixed(1)} km${marks[c.id] ? ' · ' + ({ vis: 'visitado', int: 'interesante', des: 'descartado' })[marks[c.id]] : ''}</span></span></li>`).join('') || '<li class="mute">Nada con ese filtro.</li>';
      $('#lcount').textContent = arr.length > 200 ? `Se muestran 200 de ${arr.length}.` : `${arr.length} candidatos.`;
    };
    sheet(`<button class="x" data-close aria-label="Cerrar">&times;</button><h2>Candidatos</h2>
    <input type="text" id="q" placeholder="Buscar paraje, tipo o número" autocomplete="off">
    <div class="seg"><button id="ms">Mejor puntuación</button><button id="md">Más cerca ${gps ? 'de ti' : 'del centro del mapa'}</button></div>
    <ul class="list" id="lres"></ul><p class="mute small" id="lcount"></p>`);
    const btn = () => { $('#ms').classList.toggle('on', mode === 'score'); $('#md').classList.toggle('on', mode === 'dist'); };
    $('#ms').onclick = () => { mode = 'score'; LS.set('lmode', mode); btn(); render(); };
    $('#md').onclick = () => { mode = 'dist'; LS.set('lmode', mode); btn(); render(); };
    $('#q').oninput = e => { q = e.target.value; render(); };
    btn(); render();
  }

  /* ---------------- ruta del día ---------------- */
  function routeSheet() {
    sheet(`<button class="x" data-close aria-label="Cerrar">&times;</button><h2>Ruta del día</h2>
    <p class="small">Elige los mejores candidatos cerca ${gps ? 'de tu posición' : 'del centro del mapa'} y los ordena para no dar vueltas. Se abre en Google Maps con todas las paradas.</p>
    <div class="mute">Paradas</div><div class="seg" id="rn">${[4, 6, 8].map(n => `<button data-n="${n}" class="${n === 6 ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div class="mute">Radio</div><div class="seg" id="rr">${[3, 6, 10].map(n => `<button data-r="${n}" class="${n === 6 ? 'on' : ''}">${n} km</button>`).join('')}</div>
    <label class="ck"><input type="checkbox" id="rnv" checked> Saltar los ya visitados o descartados</label>
    <button class="pri" id="rgo" style="width:100%">Preparar ruta</button><div id="rout"></div>`);
    let N = 6, Rk = 6;
    $('#rn').onclick = e => { const b = e.target.closest('button'); if (!b) return; N = +b.dataset.n; $('#rn').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
    $('#rr').onclick = e => { const b = e.target.closest('button'); if (!b) return; Rk = +b.dataset.r; $('#rr').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
    $('#rgo').onclick = () => {
      const o = gps ? L.latLng(gps) : map.getCenter();
      let pool = C.filter(c => visible(c) && map.distance(o, [c.a, c.o]) <= Rk * 1000 && !($('#rnv').checked && (marks[c.id] === 'vis' || marks[c.id] === 'des'))).sort((a, b) => b.s - a.s).slice(0, N);
      if (!pool.length) { $('#rout').innerHTML = '<p class="mute">No hay candidatos en ese radio con los filtros actuales.</p>'; return; }
      const route = []; let cur = o;
      while (pool.length) { pool.sort((a, b) => map.distance(cur, [a.a, a.o]) - map.distance(cur, [b.a, b.o])); const n = pool.shift(); route.push(n); cur = L.latLng(n.a, n.o); }
      const last = route[route.length - 1], wps = route.slice(0, -1).map(c => `${c.a.toFixed(5)},${c.o.toFixed(5)}`).join('|');
      const url = `https://www.google.com/maps/dir/?api=1&origin=${o.lat.toFixed(5)},${o.lng.toFixed(5)}&destination=${last.a.toFixed(5)},${last.o.toFixed(5)}${wps ? '&waypoints=' + encodeURIComponent(wps) : ''}&travelmode=driving`;
      if (layers.route) map.removeLayer(layers.route);
      layers.route = L.polyline([[o.lat, o.lng]].concat(route.map(c => [c.a, c.o])), { color: '#1a73e8', weight: 3, dashArray: '8 6' }).addTo(map);
      $('#rout').innerHTML = `<ol class="rl">${route.map(c => `<li data-go="${c.id}"><b>${c.s}</b> ${esc(c.t)}${c.par ? ' · ' + esc(c.par) : ''}</li>`).join('')}</ol><button class="pri" style="width:100%" onclick="window.open('${url}','_blank')">Abrir en Google Maps</button><p class="mute small">Google Maps llega hasta el camino más cercano; el último tramo suele ser a pie por lindes. Pide permiso para entrar en fincas.</p>`;
    };
  }

  /* ---------------- guía ---------------- */
  function helpSheet() {
    sheet(`<button class="x" data-close aria-label="Cerrar">&times;</button><h2>Cómo funciona</h2>
    <h3>De dónde salen los puntos</h3>
    <p class="small"><b>Relieve LiDAR.</b> Se analizó el modelo del terreno del IGN a 5 m (vuelo LiDAR) de los ~2.800 km² del círculo. A cada punto se le restó la forma general del terreno para dejar solo los bultos y hoyos de pocos palmos. Se encontraron unas 54.000 anomalías; se quedaron las más nítidas y compactas fuera de pueblos, agua y sitios ya conocidos.</p>
    <p class="small"><b>Modelo predictivo.</b> Cada punto suma indicios: agua cerca, Vía de la Plata, cañadas y caminos viejos, vados, topónimos reveladores (Villar, Castillejo, Paredones, Torrejones, Los Romanos…), ermitas en el campo, terreno llano o ligeramente elevado. Así salen también sitios sin señal en el relieve: los de nivel «Hipótesis».</p>
    <h3>Cómo leer la puntuación</h3>
    <p class="small">Es una suma de indicios, no una probabilidad. Una prueba con sitios conocidos (villa de Torre Águila, Huerta Montero, castillos y dólmenes) mostró que el relieve LiDAR solo destaca bien castillos y túmulos grandes; las villas romanas aradas apenas levantan el terreno. Por eso pesan tanto el agua, los caminos y la toponimia. Espera muchos falsos positivos: eras, balsas, majanos, plataformas de naves y movimientos de tierra modernos.</p>
    <h3>Cómo usarla en el campo</h3>
    <p class="small">1. Mira el punto en el relieve local y compáralo con el vuelo de 1956: si la forma ya estaba antes de la maquinaria moderna, gana mucho. 2. Ve con el campo arado o con cereal en primavera. 3. Busca en superficie tejas, ladrillo, cerámica y piedras de muro, sin coger nada. 4. Apunta lo visto en la ficha (Visitado, Interesante, Descartado). 5. Si hay restos claros, usa «Avisar a Patrimonio».</p>
    <h3>Lo que está prohibido</h3>
    <p class="small">Mirar y pasear no daña nada. Excavar, remover tierra o usar detector de metales sin autorización de la Junta es ilegal (Ley 2/1999 de Patrimonio de Extremadura), esté el sitio catalogado o no. Entra en fincas solo con permiso del dueño.</p>
    <h3>Sin cobertura</h3>
    <p class="small">La app, los candidatos y tus notas funcionan siempre sin conexión. Los mapas que hayas visto con cobertura se quedan guardados. Para una salida, usa el botón de descarga con la zona en pantalla antes de salir de casa.</p>
    <h3>Fuentes</h3>
    <p class="small mute">IGN-CNIG: Mapa LiDAR, MDT05, PNOA, vuelos históricos (CC BY 4.0). OpenStreetMap (ODbL): ríos, caminos, topónimos y monumentos. Bibliografía publicada para Perceiana, Villargordo y Los Estiles. Catastro: parcelas. Los yacimientos de la Carta Arqueológica no son públicos: consulta siempre a la Junta.</p>`);
  }

  /* ---------------- mis puntos ---------------- */
  function drawMine() {
    layers.mine.clearLayers();
    mine.forEach((p, i) => L.circleMarker([p.a, p.o], { radius: 8, color: '#0c447c', weight: 2, fillColor: '#85b7eb', fillOpacity: .9 }).on('click', () => sheet(`<button class="x" data-close aria-label="Cerrar">&times;</button><span class="chip lm">Mi punto</span><h2>${esc(p.t || 'Sin título')}</h2><div class="mute">${fmt(p.a, p.o)} · ${new Date(p.d).toLocaleString('es-ES')}</div><p>${esc(p.n || '')}</p><div class="row"><button data-nav="${p.a},${p.o}">Cómo llegar</button><button data-delmine="${i}">Borrar</button></div>`)).addTo(layers.mine));
  }
  function addSheet() {
    sheet(`<button class="x" data-close aria-label="Cerrar">&times;</button><h2>Nuevo punto</h2><p class="small mute">Se guarda en la cruz del centro del mapa o en tu posición.</p>
    <input type="text" id="mt" placeholder="Qué has visto: tejas, cerámica, piedras alineadas…">
    <textarea id="mn" placeholder="Notas"></textarea>
    <div class="row"><button id="mg">Usar mi posición</button><button class="pri" id="ms2">Guardar en la cruz</button></div>
    <p class="mute small">Tienes ${mine.length} puntos guardados en este móvil.</p><button id="mx" style="width:100%">Copiar todos mis puntos y notas</button><textarea id="mxt" style="display:none"></textarea>`);
    const save = (a, o) => { mine.push({ a, o, t: $('#mt').value, n: $('#mn').value, d: Date.now() }); LS.set('mine', mine); drawMine(); $('#sheet').classList.remove('on'); toast('Punto guardado.'); };
    $('#ms2').onclick = () => { const c = map.getCenter(); save(c.lat, c.lng); };
    $('#mg').onclick = () => navigator.geolocation.getCurrentPosition(p => save(p.coords.latitude, p.coords.longitude), () => toast('No se pudo obtener tu posición. Activa la ubicación.'), { enableHighAccuracy: true, timeout: 15000 });
    $('#mx').onclick = e => {
      const notes = C.filter(c => marks[c.id] || LS.get('n_' + c.id, '')).map(c => `#${c.id} ${c.t} (${fmt(c.a, c.o)}) [${marks[c.id] || 'sin marcar'}] ${LS.get('n_' + c.id, '')}`);
      const txt = 'MIS PUNTOS\n' + mine.map(p => `${fmt(p.a, p.o)} · ${p.t} · ${p.n}`).join('\n') + '\n\nCANDIDATOS REVISADOS\n' + notes.join('\n');
      copyText(txt, e.target);
    };
  }

  /* ---------------- GPS ---------------- */
  function startGps(center) {
    if (!navigator.geolocation) { toast('Este navegador no da la posición.'); return; }
    navigator.geolocation.watchPosition(p => {
      gps = [p.coords.latitude, p.coords.longitude];
      if (!gpsMarker) { gpsMarker = L.marker(gps, { icon: L.divIcon({ className: '', html: '<div class="gps"></div>', iconSize: [18, 18] }), interactive: false }).addTo(map); if (center) map.setView(gps, Math.max(map.getZoom(), 16)); }
      else gpsMarker.setLatLng(gps);
    }, () => toast('No se pudo obtener tu posición. Activa la ubicación del móvil y da permiso.'), { enableHighAccuracy: true, maximumAge: 5000 });
  }

  /* ---------------- sin conexión ---------------- */
  function tilesFor(b, z0, z1) { const out = []; for (let z = z0; z <= z1; z++) { const a = map.project(b.getNorthWest(), z).divideBy(256).floor(), c = map.project(b.getSouthEast(), z).divideBy(256).floor(); for (let x = a.x; x <= c.x; x++) for (let y = a.y; y <= c.y; y++) out.push({ x, y, z }); } return out; }
  function offSheet() {
    const z = map.getZoom(), b = map.getBounds();
    const opts = [[z, Math.min(z + 2, 18)], [z, Math.min(z + 3, 19)]];
    const n = opts.map(([a, c]) => tilesFor(b, a, c).length);
    const nc = C.filter(c => b.contains([c.a, c.o]) && visible(c)).length;
    sheet(`<button class="x" data-close aria-label="Cerrar">&times;</button><h2>Guardar sin conexión</h2>
    <p class="small">Descarga los mapas de <b>lo que ves ahora en pantalla</b> y el relieve local de los ${nc} candidatos que hay en ella. Hazlo con wifi antes de salir.</p>
    ${Object.entries(BASES).filter(([id]) => id !== 'mdt').map(([id, bb]) => `<label class="ck"><input type="checkbox" data-ol="${id}" ${['lidar', 'orto', 'v56'].includes(id) ? 'checked' : ''}> ${bb.n}</label>`).join('')}
    <label class="ck"><input type="checkbox" id="orel" checked> Relieve local de los candidatos</label>
    <div class="row"><button data-lvl="0">Detalle normal (${n[0]} imágenes por capa)</button><button data-lvl="1">Máximo detalle (${n[1]})</button></div>
    <p class="mute small">Consejo: acércate hasta ver 2–4 km en pantalla. Ver toda la comarca con máximo detalle serían cientos de megas.</p>
    <button id="clr" style="width:100%">Borrar mapas guardados</button>`);
    document.querySelectorAll('[data-lvl]').forEach(btn => btn.onclick = () => { const [a, c] = opts[+btn.dataset.lvl]; const ids = [...document.querySelectorAll('[data-ol]:checked')].map(i => i.dataset.ol); download(b, a, c, ids, $('#orel').checked); });
    $('#clr').onclick = async () => { await caches.delete('arq-tiles'); toast('Mapas guardados borrados.'); };
  }
  async function download(bounds, z0, z1, ids, rel) {
    $('#sheet').classList.remove('on');
    if (!('caches' in window)) { toast('Este navegador no permite guardar mapas.'); return; }
    const tiles = tilesFor(bounds, z0, z1), urls = [];
    for (const id of ids) {
      const l = BASES[id].mk(), crs = map.options.crs;
      for (const t of tiles) {
        try {
          if (l.wmsParams && t.z <= (l.options.maxNativeZoom || 20)) {
            const wp = Object.assign({}, l.wmsParams, { srs: crs.code });
            const nw = map.unproject(L.point(t.x * 256, t.y * 256), t.z), se = map.unproject(L.point(t.x * 256 + 256, t.y * 256 + 256), t.z);
            const b = L.bounds(crs.project(nw), crs.project(se));
            urls.push(l._url + L.Util.getParamString(wp, l._url, l.options.uppercase) + '&bbox=' + [b.min.x, b.min.y, b.max.x, b.max.y].join(','));
          } else if (!l.wmsParams && t.z <= (l.options.maxNativeZoom || 20)) {
            urls.push(L.Util.template(l._url, { z: t.z, x: t.x, y: t.y, s: 'a', r: '' }));
          }
        } catch (e) { }
      }
    }
    if (rel) for (const c of C) if (bounds.contains([c.a, c.o]) && visible(c)) { const R = 350, dLat = R / 111200, dLon = R / (111200 * Math.cos(c.a * Math.PI / 180)); urls.push(`https://servicios.idee.es/wcs-inspire/mdt?service=WCS&version=2.0.1&request=GetCoverage&CoverageId=Elevacion4258_5&subset=Lat(${(c.a - dLat).toFixed(5)},${(c.a + dLat).toFixed(5)})&subset=Long(${(c.o - dLon).toFixed(5)},${(c.o + dLon).toFixed(5)})&format=image/tiff`); }
    const cache = await caches.open('arq-tiles'); let done = 0, fail = 0; const q = urls.slice();
    const work = async () => { while (q.length) { const u = q.shift(); try { if (!(await cache.match(u))) { const r = await fetch(u, { mode: u.includes('wcs') ? 'cors' : 'no-cors' }); await cache.put(u, r); } } catch (e) { fail++; } done++; toast(`Guardando ${done} / ${urls.length}${fail ? ' · fallos ' + fail : ''}`, 60000); } };
    await Promise.all(Array.from({ length: 6 }, work));
    toast(`Listo: ${done - fail} archivos guardados${fail ? ', ' + fail + ' fallaron (repite con mejor cobertura)' : ''}.`, 6000);
  }

  /* ---------------- arranque ---------------- */
  function start() {
    decode();
    $('#gate').remove();
    map = L.map('map', { zoomControl: false, maxZoom: 21, tap: true }).setView(D.center, 11);
    map.createPane('relief').style.zIndex = 350;
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);
    setBase();
    layers.veto = L.layerGroup(); layers.known = L.layerGroup(); layers.roads = L.layerGroup(); layers.mine = L.layerGroup(); layers.cand = L.layerGroup().addTo(map);
    L.circle(D.center, { radius: D.radius, color: '#fff', weight: 1.5, dashArray: '6 6', fill: false, interactive: false }).addTo(map);
    for (const k of D.K) {
      const a = D.LA + k[0] / 1e5, o = D.LO + k[1] / 1e5;
      L.circle([a, o], { radius: k[2], color: '#b3261e', weight: 1, fillColor: '#e24b4a', fillOpacity: .18, interactive: false }).addTo(layers.veto);
      L.circleMarker([a, o], { radius: 4, color: '#7a1712', weight: 1, fillColor: '#b3261e', fillOpacity: 1 }).on('click', () => sheet(`<button class="x" data-close aria-label="Cerrar">&times;</button><span class="chip lk">Ya conocido</span><h2>${esc(k[3])}</h2><div class="mute">${esc(k[4])}</div><p class="small">Sitio ya registrado. No se proponen candidatos a menos de ${k[2]} m. Respétalo.</p>`)).addTo(layers.known);
    }
    for (const [k, ni, pts] of D.R) {
      const ll = pts.map(p => [D.LA + p[0] / 1e5, D.LO + p[1] / 1e5]);
      L.polyline(ll, { color: k === 0 ? '#6a2fb0' : '#8a5a2b', weight: k === 0 ? 4 : 2.5, opacity: .85, dashArray: k === 0 ? null : '6 4' }).bindTooltip(D.RN[ni], { sticky: true }).addTo(layers.roads);
    }
    drawCands(); drawMine(); toggles();
    map.on('moveend', detailRelief); detailRelief();
    $('#bLayers').onclick = layersSheet; $('#bList').onclick = listSheet; $('#bOff').onclick = offSheet; $('#bRoute').onclick = routeSheet; $('#bHelp').onclick = helpSheet;
    $('#bGps').onclick = () => { if (gps) map.setView(gps, Math.max(map.getZoom(), 16)); else startGps(true); };
    $('#add').onclick = addSheet;
    const cross = L.divIcon({ className: 'cross', html: '', iconSize: [22, 22] });
    const cm = L.marker(map.getCenter(), { icon: cross, interactive: false }).addTo(map); map.on('move', () => cm.setLatLng(map.getCenter()));
    if (!LS.get('seenHelp', 0)) { LS.set('seenHelp', 1); helpSheet(); }
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
