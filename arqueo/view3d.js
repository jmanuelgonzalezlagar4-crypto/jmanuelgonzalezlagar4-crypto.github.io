/* Vista 3D del terreno: vuelo alrededor del punto y paseo «a pie» a altura de persona */
var ARQ3D = (function () {
  'use strict';
  let st = null;
  const $ = s => document.querySelector(s);
  const R = 450; // metros alrededor del punto

  function loadThree() {
    return new Promise((res, rej) => {
      if (window.THREE) return res();
      const s = document.createElement('script'); s.src = 'lib/three.min.js?v=6'; s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }
  async function wmsImage(layer, url, bb, size) {
    const u = `${url}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${layer}&STYLES=&FORMAT=image/jpeg&CRS=EPSG:4326&WIDTH=${size}&HEIGHT=${size}&BBOX=${bb[1]},${bb[0]},${bb[3]},${bb[2]}`;
    const blob = await (await fetch(u)).blob();
    return await createImageBitmap(blob);
  }
  const LAYERS = {
    orto: { n: 'Ortofoto', l: 'OI.OrthoimageCoverage', u: 'https://www.ign.es/wms-inspire/pnoa-ma' },
    rel: { n: 'Relieve marcado' },
    lidar: { n: 'LiDAR', l: 'EL.GridCoverage', u: 'https://wms-mapa-lidar.idee.es/lidar' },
    v56: { n: 'Vuelo 1956', l: 'AMS_1956-1957', u: 'https://www.ign.es/wms/pnoa-historico' }
  };

  function ui(title) {
    const d = document.createElement('div'); d.id = 'v3d';
    d.innerHTML = `<canvas id="v3c"></canvas>
    <div class="v3top"><b>${title}</b><button id="v3x" aria-label="Cerrar">&times;</button></div>
    <div id="v3msg">Cargando terreno…</div>
    <div class="v3walk" id="v3walk" hidden><button id="v3fw" aria-label="Avanzar">▲</button><button id="v3bk" aria-label="Retroceder">▼</button></div>
    <div class="v3bar">
      <div class="seg" id="v3lay">${Object.entries(LAYERS).map(([k, v]) => `<button data-l="${k}" class="${k === 'orto' ? 'on' : ''}">${v.n}</button>`).join('')}</div>
      <div class="seg" id="v3mode"><button data-m="fly" class="on">Vuelo</button><button data-m="walk">A pie</button><button id="v3reset">Centrar</button></div>
      <label>Exagerar relieve <b id="v3ev">×3</b><input type="range" id="v3ex" min="1" max="8" step="0.5" value="3"></label>
      <label>Luz rasante (dirección del sol) <input type="range" id="v3sun" min="0" max="360" step="5" value="225"></label>
    </div>`;
    document.body.appendChild(d);
    return d;
  }

  async function open(p) {
    close();
    const root = ui(p.title || 'Vista 3D');
    $('#v3x').onclick = close;
    try { await loadThree(); } catch (e) { $('#v3msg').textContent = 'No se pudo cargar el motor 3D.'; return; }
    const [s, n, w, e] = ARQT.boxAround(p.a, p.o, R);
    let dem;
    try { dem = await ARQT.fetchDem(s, n, w, e); }
    catch (err) { $('#v3msg').textContent = 'Sin cobertura y sin copia guardada de esta zona.'; return; }
    const an = ARQT.analyze(dem, p.sg || 1, p.a, p.o);
    const T = window.THREE, cv = $('#v3c');
    const renderer = new T.WebGLRenderer({ canvas: cv, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const scene = new T.Scene();
    scene.background = new T.Color(0xbcd3e6);
    scene.fog = new T.Fog(0xbcd3e6, 700, 2200);
    const cam = new T.PerspectiveCamera(55, 1, 0.5, 6000);
    const hemi = new T.HemisphereLight(0xdfeaf5, 0x6b5a45, 0.75); scene.add(hemi);
    const sun = new T.DirectionalLight(0xfff2dd, 1.35); scene.add(sun);

    // malla del terreno (x = este, z = -norte, y = altura)
    const { W, H, z, bb } = dem;
    const widthM = (bb[2] - bb[0]) * 111200 * Math.cos(p.a * Math.PI / 180), heightM = (bb[3] - bb[1]) * 111200;
    let zmin = 1e9; for (let i = 0; i < z.length; i++) zmin = Math.min(zmin, z[i]);
    const k = 2, GW = (W - 1) * k + 1, GH = (H - 1) * k + 1;
    const geo = new T.PlaneGeometry(widthM, heightM, GW - 1, GH - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const base = new Float32Array(GW * GH);
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) base[j * GW + i] = ARQT.bil(z, W, H, i / k, j / k) - zmin;
    let exag = 3;
    function applyExag() { for (let i = 0; i < GW * GH; i++) pos.setY(i, base[i] * exag); pos.needsUpdate = true; geo.computeVertexNormals(); }
    applyExag();
    const mat = new T.MeshLambertMaterial({ color: 0xffffff });
    const mesh = new T.Mesh(geo, mat); scene.add(mesh);
    // marcador del candidato
    const px = (p.o - bb[0]) / (bb[2] - bb[0]) * widthM - widthM / 2, pz = -((p.a - bb[1]) / (bb[3] - bb[1]) * heightM - heightM / 2);
    const groundAt = (x, zz) => { const fx = (x + widthM / 2) / widthM * (W - 1), fy = (zz + heightM / 2) / heightM * (H - 1); return (ARQT.bil(z, W, H, fx, fy) - zmin) * exag; };
    const pin = new T.Group();
    const stick = new T.Mesh(new T.CylinderGeometry(0.6, 0.6, 30, 8), new T.MeshBasicMaterial({ color: 0xa4502a }));
    stick.position.y = 15; pin.add(stick);
    const ball = new T.Mesh(new T.SphereGeometry(4, 16, 12), new T.MeshBasicMaterial({ color: 0xff8a00 }));
    ball.position.y = 32; pin.add(ball);
    scene.add(pin);
    const placePin = () => pin.position.set(px, groundAt(px, pz), pz);
    placePin();

    // texturas
    const texCache = {};
    async function setLayer(key) {
      $('#v3msg').textContent = 'Cargando imagen…'; $('#v3msg').hidden = false;
      try {
        if (!texCache[key]) {
          let src;
          if (key === 'rel') src = ARQT.reliefCanvas(dem, an, 4, { alpha: 255 });
          else {
            const bmp = await wmsImage(LAYERS[key].l, LAYERS[key].u, bb, 2048);
            const c2 = document.createElement('canvas'); c2.width = 2048; c2.height = 2048;
            const x2 = c2.getContext('2d'); x2.drawImage(bmp, 0, 0, 2048, 2048);
            // forma detectada encima, en naranja semitransparente
            if (an.area) {
              const id = x2.getImageData(0, 0, 2048, 2048), dd = id.data, sx = W / 2048, sy = H / 2048;
              for (let Y = 0; Y < 2048; Y++) for (let X = 0; X < 2048; X++) if (an.mask[Math.floor(Y * sy) * W + Math.floor(X * sx)]) { const o = (Y * 2048 + X) * 4; dd[o] = dd[o] * .55 + 255 * .45; dd[o + 1] = dd[o + 1] * .55 + 140 * .45; dd[o + 2] = dd[o + 2] * .55; }
              x2.putImageData(id, 0, 0);
            }
            src = c2;
          }
          const tex = new T.CanvasTexture(src); tex.anisotropy = renderer.capabilities.getMaxAnisotropy(); tex.colorSpace = T.SRGBColorSpace;
          texCache[key] = tex;
        }
        mat.map = texCache[key]; mat.needsUpdate = true;
        $('#v3msg').hidden = true;
      } catch (err) { $('#v3msg').textContent = 'Esta capa no se pudo cargar (¿sin cobertura?).'; }
    }

    // cámara y controles
    let mode = 'fly', yaw = Math.PI * 0.15, pitch = 0.55, dist = 520, tgt = new T.Vector3(px, groundAt(px, pz), pz);
    let wx = px, wz = pz + 90, wyaw = 0, wpitch = -0.05, moving = 0;
    function updateCam() {
      if (mode === 'fly') {
        cam.position.set(tgt.x + dist * Math.cos(pitch) * Math.sin(yaw), tgt.y + dist * Math.sin(pitch), tgt.z + dist * Math.cos(pitch) * Math.cos(yaw));
        cam.lookAt(tgt);
      } else {
        const gy = groundAt(wx, wz) + 1.7;
        cam.position.set(wx, gy, wz);
        cam.lookAt(wx - Math.sin(wyaw) * Math.cos(wpitch) * 10, gy + Math.sin(wpitch) * 10, wz - Math.cos(wyaw) * Math.cos(wpitch) * 10);
      }
    }
    function setSun(deg) { const r = deg * Math.PI / 180; sun.position.set(Math.sin(r) * 600, 160, -Math.cos(r) * 600); }
    setSun(225);
    const ptrs = new Map(); let last = null;
    cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); last = null; });
    cv.addEventListener('pointerup', e => { ptrs.delete(e.pointerId); last = null; });
    cv.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); last = null; });
    cv.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) return;
      const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      const dx = e.clientX - prev[0], dy = e.clientY - prev[1];
      if (ptrs.size === 1) {
        if (mode === 'fly') { yaw -= dx * 0.006; pitch = Math.max(0.08, Math.min(1.45, pitch + dy * 0.005)); }
        else { wyaw += dx * 0.005; wpitch = Math.max(-1.2, Math.min(1.0, wpitch + dy * 0.004)); }
      } else if (ptrs.size === 2) {
        const pts = [...ptrs.values()], d2 = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
        if (last) {
          if (mode === 'fly') {
            dist = Math.max(25, Math.min(2000, dist * last / d2));
            if (e.pointerId === [...ptrs.keys()][0]) { const s2 = dist * 0.0015; tgt.x -= (dx * Math.cos(yaw) + dy * Math.sin(yaw)) * s2 * 0.5; tgt.z -= (-dx * Math.sin(yaw) + dy * Math.cos(yaw)) * s2 * 0.5; tgt.y = groundAt(tgt.x, tgt.z); }
          }
        }
        last = d2;
      }
    });
    cv.addEventListener('wheel', e => { e.preventDefault(); dist = Math.max(25, Math.min(2000, dist * (e.deltaY > 0 ? 1.12 : 0.89))); }, { passive: false });
    const hold = (btn, v) => { btn.addEventListener('pointerdown', () => moving = v); ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, () => moving = 0)); };
    hold($('#v3fw'), 1); hold($('#v3bk'), -1);

    $('#v3lay').onclick = e => { const b = e.target.closest('button'); if (!b) return; $('#v3lay').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); setLayer(b.dataset.l); };
    $('#v3mode').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'v3reset') { tgt.set(px, groundAt(px, pz), pz); dist = 520; pitch = 0.55; wx = px; wz = pz + 90; wyaw = 0; wpitch = -0.05; return; }
      mode = b.dataset.m; $('#v3mode').querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x === b));
      $('#v3walk').hidden = mode !== 'walk';
      pin.scale.setScalar(mode === 'walk' ? 0.12 : 1);
      if (mode === 'walk') { $('#v3msg').textContent = 'A pie: arrastra para mirar alrededor y mantén ▲ para andar. Empiezas a 90 m del punto, mirándolo.'; $('#v3msg').hidden = false; setTimeout(() => $('#v3msg').hidden = true, 5000); }
    };
    $('#v3ex').oninput = e => { exag = +e.target.value; $('#v3ev').textContent = '×' + exag; applyExag(); placePin(); tgt.y = groundAt(tgt.x, tgt.z); };
    $('#v3sun').oninput = e => setSun(+e.target.value);

    function resize() { const w = root.clientWidth, h = root.clientHeight; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
    window.addEventListener('resize', resize); resize();
    let t0 = performance.now(), raf = 0;
    function loop(t) {
      const dt = Math.min(0.1, (t - t0) / 1000); t0 = t;
      if (mode === 'walk' && moving) { const sp = 6 * moving * dt; wx -= Math.sin(wyaw) * sp; wz -= Math.cos(wyaw) * sp; wx = Math.max(-widthM / 2 + 2, Math.min(widthM / 2 - 2, wx)); wz = Math.max(-heightM / 2 + 2, Math.min(heightM / 2 - 2, wz)); }
      updateCam(); renderer.render(scene, cam); raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    st = { renderer, raf, resize, geo, mat, texCache };
    await setLayer('orto');
    if (an.area) { $('#v3msg').textContent = `En naranja, la forma detectada en el relieve (${an.area} m²). Prueba «Relieve marcado» y mueve la luz rasante.`; $('#v3msg').hidden = false; setTimeout(() => { const m = $('#v3msg'); if (m) m.hidden = true; }, 6000); }
  }

  function close() {
    if (st) {
      cancelAnimationFrame(st.raf); window.removeEventListener('resize', st.resize);
      Object.values(st.texCache).forEach(t => t.dispose()); st.geo.dispose(); st.mat.dispose(); st.renderer.dispose();
      st = null;
    }
    const d = $('#v3d'); if (d) d.remove();
  }
  return { open, close };
})();
