/* Utilidades de terreno: descarga del MDT 5 m del IGN, relieve local, detección de la forma y dibujo suave */
var ARQT = (function () {
  'use strict';
  const M = 111200;
  function wcsUrl(s, n, w, e) {
    return `https://servicios.idee.es/wcs-inspire/mdt?service=WCS&version=2.0.1&request=GetCoverage&CoverageId=Elevacion4258_5&subset=Lat(${s.toFixed(5)},${n.toFixed(5)})&subset=Long(${w.toFixed(5)},${e.toFixed(5)})&format=image/tiff`;
  }
  function boxAround(a, o, R) {
    const dLat = R / M, dLon = R / (M * Math.cos(a * Math.PI / 180));
    return [a - dLat, a + dLat, o - dLon, o + dLon];
  }
  async function fetchDem(s, n, w, e) {
    const buf = await (await fetch(wcsUrl(s, n, w, e))).arrayBuffer();
    const im = await (await GeoTIFF.fromArrayBuffer(buf)).getImage();
    const W = im.getWidth(), H = im.getHeight(), bb = im.getBoundingBox();
    const r = (await im.readRasters())[0];
    const z = new Float32Array(W * H);
    let last = 0;
    for (let i = 0; i < W * H; i++) { const v = r[i]; if (v > -100 && v < 4000) { z[i] = v; last = v; } else z[i] = last; }
    const pyM = (bb[3] - bb[1]) / H * M, pxM = (bb[2] - bb[0]) / W * M * Math.cos((bb[1] + bb[3]) / 2 * Math.PI / 180);
    return { W, H, bb, z, px: pyM, pxM };
  }
  // relieve local: altura menos la media en ~100 m
  function analyze(d, sg, seedA, seedO) {
    const { W, H, z, px } = d;
    const r = Math.max(4, Math.round(100 / px));
    const S = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) { let rs = 0; for (let x = 0; x < W; x++) { rs += z[y * W + x]; S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + rs; } }
    const lrm = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
        const A = (i, j) => i * (W + 1) + j;
        lrm[y * W + x] = z[y * W + x] - (S[A(y1, x1)] - S[A(y0, x1)] - S[A(y1, x0)] + S[A(y0, x0)]) / ((y1 - y0) * (x1 - x0));
      }
    }
    const mask = new Uint8Array(W * H);
    let area = 0;
    if (seedA != null) {
      sg = sg || 1;
      const thr = 0.3, bb = d.bb;
      const cx = Math.floor((seedO - bb[0]) / (bb[2] - bb[0]) * W), cy = Math.floor((bb[3] - seedA) / (bb[3] - bb[1]) * H);
      let seed = -1, best = 1e9;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (lrm[y * W + x] * sg > thr) { const dd = (x - cx) ** 2 + (y - cy) ** 2; if (dd < best) { best = dd; seed = y * W + x; } }
      if (seed >= 0 && best < (60 / px) ** 2) {
        const st = [seed]; mask[seed] = 1;
        while (st.length) { const k = st.pop(), x = k % W, y = (k - x) / W; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (!mask[j] && lrm[j] * sg > thr) { mask[j] = 1; st.push(j); } } }
        for (let i = 0; i < mask.length; i++) area += mask[i];
        area = Math.round(area * px * d.pxM);
      }
    }
    return { lrm, mask, area };
  }
  // muestreo bilineal
  function bil(arr, W, H, fx, fy) {
    fx = Math.max(0, Math.min(W - 1.001, fx)); fy = Math.max(0, Math.min(H - 1.001, fy));
    const x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0, i = y0 * W + x0;
    return (arr[i] * (1 - tx) + arr[i + 1] * tx) * (1 - ty) + (arr[i + W] * (1 - tx) + arr[i + W + 1] * tx) * ty;
  }
  // dibujo suave: sombreado multidireccional + relieve local en color, a escala k (interpolado)
  function reliefCanvas(d, an, k, opts) {
    opts = opts || {};
    const { W, H, z, px } = d, lrm = an.lrm, mask = an.mask;
    k = k || 3;
    const CW = W * k, CH = H * k, cv = document.createElement('canvas'); cv.width = CW; cv.height = CH;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(CW, CH), dd = img.data;
    const ex = opts.exag || 3, step = 1 / k;
    const dirs = [[1, 1], [-1, 1], [1, -1], [-1, -1], [0, 1], [1, 0], [0, -1], [-1, 0]];
    const scale = opts.range || 2, alpha = opts.alpha == null ? 225 : opts.alpha;
    for (let Y = 0; Y < CH; Y++) {
      const fy = (Y + .5) / k - .5;
      for (let X = 0; X < CW; X++) {
        const fx = (X + .5) / k - .5;
        const gx = (bil(z, W, H, fx + step, fy) - bil(z, W, H, fx - step, fy)) / (2 * step * px) * ex;
        const gy = (bil(z, W, H, fx, fy + step) - bil(z, W, H, fx, fy - step)) / (2 * step * px) * ex;
        let sh = 0; for (const [lx, ly] of dirs) sh += Math.max(0, (1 + (-gx * lx - gy * ly) * 0.6) / Math.sqrt(1 + gx * gx + gy * gy));
        sh = Math.min(1, sh / dirs.length * 1.05);
        const v = Math.max(-scale, Math.min(scale, bil(lrm, W, H, fx, fy))) / scale * 0.55;
        let R = 228 * sh + 18, G = 222 * sh + 18, B = 212 * sh + 18;
        if (v > 0) { R = R * (1 - v) + 205 * v; G = G * (1 - v * .75); B = B * (1 - v * .85); }
        else { R = R * (1 + v * .85); G = G * (1 + v * .45); B = B * (1 + v) - 200 * v; }
        const m = mask[Math.min(H - 1, Math.round(fy)) * W + Math.min(W - 1, Math.round(fx))];
        if (m) { R = R * .5 + 255 * .5; G = G * .5 + 150 * .5; B = B * .5; }
        const o = (Y * CW + X) * 4; dd[o] = R; dd[o + 1] = G; dd[o + 2] = B; dd[o + 3] = alpha;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }
  return { wcsUrl, boxAround, fetchDem, analyze, bil, reliefCanvas };
})();
