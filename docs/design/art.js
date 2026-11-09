// OfficeProof Lab artwork. Everything here is drawn from scratch with a seeded generator, so the same seed gives the same picture.
/* global document */
const W = 1600, H = 2000;
const INK = '#0c0c0c', PAPER = '#e3e1dc', RED = '#e5252a', GREEN = '#a6ff6e', VIOLET = '#5b3fd6', ORANGE = '#ff8a3d', MAGENTA = '#e9408f', YELLOW = '#f5e663';

function mulberry(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let rnd = mulberry(20261109);
const between = (a, b) => a + (b - a) * rnd();
const canvas = (w = W, h = H) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// ---------- paper ----------
function paper(ctx, w = W, h = H) {
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h), data = image.data;
  for (let i = 0; i < data.length; i += 4) { const n = (rnd() - 0.5) * 16; data[i] += n; data[i + 1] += n; data[i + 2] += n; }
  ctx.putImageData(image, 0, 0);
  for (let i = 0; i < 5200; i++) { ctx.fillStyle = `rgba(20,20,20,${between(0.05, 0.3)})`; ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, between(0.5, 1.4), 0, 7); ctx.fill(); }
}

// ---------- stipple ----------
function inQuad(p, q) { let sign = 0; for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); if (cross !== 0) { if (sign === 0) sign = Math.sign(cross); else if (Math.sign(cross) !== sign) return false; } } return true; }
function segDist(p, a, b) { const vx = b[0] - a[0], vy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy))); return Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy); }
const quadDist = (p, q) => Math.min(...q.map((a, i) => segDist(p, a, q[(i + 1) % 4])));
function stipple(ctx, box, count, density, tone = '12,12,12') {
  for (let i = 0; i < count; i++) {
    const x = between(box[0], box[2]), y = between(box[1], box[3]);
    const d = density(x, y);
    if (rnd() < d) { ctx.fillStyle = `rgba(${tone},${between(0.55, 1)})`; ctx.beginPath(); ctx.arc(x, y, between(0.6, 1.7), 0, 7); ctx.fill(); }
  }
}

// The tipped laptop: the screen faces us and shows a sheet; the keyboard deck runs back behind it. No maker's mark.
const HA = [880, 350], HB = [1330, 180], SCREEN_V = [118, 268], DECK_V = [-66, -132];
const add = (p, v, k = 1) => [p[0] + v[0] * k, p[1] + v[1] * k];
const LID = [HA, HB, add(HB, SCREEN_V), add(HA, SCREEN_V)];
const DECK = [HA, HB, add(HB, DECK_V), add(HA, DECK_V)];
function uv(p, origin, e1, e2) { const x = p[0] - origin[0], y = p[1] - origin[1], det = e1[0] * e2[1] - e1[1] * e2[0]; return [(x * e2[1] - y * e2[0]) / det, (e1[0] * y - e1[1] * x) / det]; }
function laptop(ctx) {
  const hinge = [HB[0] - HA[0], HB[1] - HA[1]], frac = v => v - Math.floor(v);
  stipple(ctx, [640, 0, 1600, 800], 640000, (x, y) => {
    const p = [x, y];
    if (inQuad(p, DECK)) {
      const [u, v] = uv(p, HA, hinge, DECK_V);
      const key = v > 0.14 && v < 0.74 && frac(v * 6.6) > 0.22 && u > 0.05 && u < 0.95 && frac(u * 15) > 0.16;
      const pad = v > 0.78 && v < 0.95 && u > 0.36 && u < 0.64;
      return key ? 0.22 : pad ? 0.4 : 0.97;
    }
    if (inQuad(p, LID)) {
      const edge = quadDist(p, LID), [u, v] = uv(p, HA, hinge, SCREEN_V);
      if (edge < 15) return 0.98;
      const line = frac(u * 6) < 0.035 || frac(v * 9) < 0.05;
      const header = v < 1 / 9;
      return header ? 0.62 : line ? 0.7 : 0.1 + 0.16 * u;
    }
    const edge = Math.min(quadDist(p, LID), quadDist(p, DECK));
    const far = add(HB, SCREEN_V);
    const trail = Math.exp(-Math.hypot(x - far[0], y - far[1]) / 170) * 0.22 * (x > far[0] - 60 || y > far[1] - 30 ? 1 : 0.15);
    return 0.36 * Math.exp(-edge / 9) + trail;
  });
}

// ---------- heat squares ----------
const RAMP = [[166, 255, 110], [214, 245, 100], [245, 230, 99], [255, 154, 61], [233, 64, 143], [150, 60, 190], [91, 63, 214]];
function ramp(v) { const t = Math.max(0, Math.min(0.9999, v)) * (RAMP.length - 1); const i = Math.floor(t), f = t - i; return RAMP[i].map((c, k) => Math.round(c + (RAMP[i + 1][k] - c) * f)); }
function heat(ctx, x, y, s, angle, reach, cell = 4) {
  const ox = x - s / 2, oy = y - s / 2, cx = Math.cos(angle), cy = Math.sin(angle);
  for (let j = 0; j < s; j += cell) for (let i = 0; i < s; i += cell) {
    const u = (i / s - 0.5) * cx + (j / s - 0.5) * cy;   // -0.7 … 0.7 across the square
    const v = (u + 0.5) * reach + (rnd() - 0.5) * 0.42 - (1 - reach) * 0.1;
    const [r, g, b] = ramp(v);
    ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fillRect(ox + i, oy + j, cell, cell);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2; ctx.strokeRect(ox + 1, oy + 1, s - 2, s - 2);
}

// ---------- sticker tiles (file kinds) ----------
function rounded(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function tile(ctx, x, y, s, rot, fill, glyph) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot * Math.PI / 180);
  ctx.shadowColor = 'rgba(0,0,0,0.28)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 12;
  ctx.fillStyle = '#fff'; rounded(ctx, -s / 2 - 12, -s / 2 - 12, s + 24, s + 24, s * 0.26); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = fill; ctx.strokeStyle = INK; ctx.lineWidth = 7; rounded(ctx, -s / 2, -s / 2, s, s, s * 0.2); ctx.fill(); ctx.stroke();
  // sticker gloss
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-s * 0.36, -s * 0.16); ctx.quadraticCurveTo(-s * 0.36, -s * 0.36, -s * 0.14, -s * 0.37); ctx.stroke();
  ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineWidth = 7; ctx.lineJoin = 'round';
  const g = s * 0.26;
  if (glyph === 'sheet') { ctx.strokeRect(-g, -g, 2 * g, 2 * g); ctx.beginPath(); ctx.moveTo(-g, -g / 3); ctx.lineTo(g, -g / 3); ctx.moveTo(-g, g / 3); ctx.lineTo(g, g / 3); ctx.moveTo(-g / 3, -g); ctx.lineTo(-g / 3, g); ctx.stroke(); }
  if (glyph === 'doc') { ctx.strokeStyle = '#fff'; ctx.beginPath(); for (let k = 0; k < 4; k++) { const yy = -g + k * (2 * g / 3); ctx.moveTo(-g, yy); ctx.lineTo(k === 3 ? g * 0.2 : g, yy); } ctx.stroke(); }
  if (glyph === 'slide') { ctx.strokeRect(-g * 1.1, -g * 0.8, g * 2.2, g * 1.6); ctx.fillRect(-g * 0.7, -g * 0.05, g * 0.35, g * 0.5); ctx.fillRect(-g * 0.15, -g * 0.4, g * 0.35, g * 0.85); ctx.fillRect(g * 0.4, -g * 0.2, g * 0.35, g * 0.65); }
  ctx.restore();
}
function sparkle(ctx, x, y, s) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x, y - s); ctx.quadraticCurveTo(x, y, x + s, y); ctx.quadraticCurveTo(x, y, x, y + s); ctx.quadraticCurveTo(x, y, x - s, y); ctx.quadraticCurveTo(x, y, x, y - s); ctx.fill(); }

// ---------- the ink crowd: sheets with folded corners ----------
function sheetPath(ctx, x, top, w, lean, bottom) {
  const l = x - w / 2, r = x + w / 2, ear = w * 0.3, sh = lean * 1;
  ctx.beginPath();
  ctx.moveTo(l - sh * 0.2, bottom); ctx.lineTo(l + sh, top + w * 0.2);
  ctx.quadraticCurveTo(l + sh, top, l + sh + w * 0.2, top);
  ctx.lineTo(r + sh - ear, top); ctx.lineTo(r + sh, top + ear);
  ctx.lineTo(r - sh * 0.2, bottom); ctx.closePath();
}
function creature(ctx, o) {
  const { x, top, w, lean = 0, tone = INK, white = false, kind = 'doc', look = [-0.4, 0.2], bottom = H + 60 } = o;
  const r = x + w / 2 + lean, ear = w * 0.3;
  ctx.save();
  sheetPath(ctx, x, top, w, lean, bottom); ctx.fillStyle = white ? '#f6f4ee' : tone; ctx.fill();
  // ragged edge: short strokes off the outline
  ctx.strokeStyle = white ? INK : tone; ctx.lineCap = 'round';
  const edge = (px, py, nx, ny) => { ctx.lineWidth = between(1.4, 3.4); ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + nx * between(6, 22) + between(-5, 5), py + ny * between(6, 22) + between(4, 16)); ctx.stroke(); };
  const lx = y => x - w / 2 + lean * (1 - (y - top) / (bottom - top)) , rx = y => x + w / 2 + lean * (1 - (y - top) / (bottom - top));
  if (!white) {
    for (let y = top + w * 0.15; y < bottom; y += between(4, 9)) { edge(lx(y), y, -0.5, 0.2); edge(rx(y) , y + ear, 0.5, 0.2); }
    for (let xx = x - w / 2 + lean + 10; xx < r - ear; xx += between(5, 10)) edge(xx, top + 2, 0, -0.6);
  }
  // dry brush inside
  ctx.save(); sheetPath(ctx, x, top, w, lean, bottom); ctx.clip();
  for (let i = 0; i < w * 0.55; i++) {
    const sx = between(x - w / 2, x + w / 2 + lean), sy = between(top, Math.min(bottom, top + 760));
    ctx.strokeStyle = white ? `rgba(0,0,0,${between(0.05, 0.16)})` : `rgba(255,255,255,${between(0.03, 0.13)})`;
    ctx.lineWidth = between(0.8, 2.2); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + between(-10, 10) - lean * 0.1, sy + between(40, 150)); ctx.stroke();
  }
  // what the file holds: a faint grid, lines of text or a slide frame
  ctx.strokeStyle = white ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.2)'; ctx.lineWidth = white ? 3 : 2.4;
  const cx0 = x - w * 0.3 + lean * 0.6, cw = w * 0.6, cy0 = top + w * 0.95;
  ctx.beginPath();
  if (kind === 'sheet') { for (let k = 0; k <= 5; k++) { ctx.moveTo(cx0, cy0 + k * 34); ctx.lineTo(cx0 + cw, cy0 + k * 34); } for (let k = 0; k <= 3; k++) { ctx.moveTo(cx0 + k * cw / 3, cy0); ctx.lineTo(cx0 + k * cw / 3, cy0 + 170); } }
  else if (kind === 'slide') { ctx.rect(cx0, cy0, cw, cw * 0.6); ctx.moveTo(cx0 + cw * 0.15, cy0 + cw * 0.2); ctx.lineTo(cx0 + cw * 0.7, cy0 + cw * 0.2); ctx.moveTo(cx0 + cw * 0.15, cy0 + cw * 0.38); ctx.lineTo(cx0 + cw * 0.5, cy0 + cw * 0.38); }
  else for (let k = 0; k < 7; k++) { ctx.moveTo(cx0, cy0 + k * 30); ctx.lineTo(cx0 + cw * (k % 3 === 2 ? 0.55 : 1), cy0 + k * 30); }
  ctx.stroke();
  ctx.restore();
  // the fold
  ctx.fillStyle = white ? '#d9d6cf' : 'rgba(255,255,255,0.16)'; ctx.strokeStyle = white ? INK : 'rgba(255,255,255,0.22)'; ctx.lineWidth = white ? 4 : 2;
  ctx.beginPath(); ctx.moveTo(r - ear, top); ctx.lineTo(r - ear, top + ear); ctx.lineTo(r, top + ear); ctx.closePath(); ctx.fill(); ctx.stroke();
  if (white) {
    // drawn outline, twice, like a pen gone over
    for (let pass = 0; pass < 2; pass++) { ctx.save(); ctx.translate(between(-2.5, 2.5), between(-2.5, 2.5)); sheetPath(ctx, x, top, w, lean, bottom); ctx.strokeStyle = INK; ctx.lineWidth = between(3.5, 5.5); ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore(); }
  }
  // eyes
  const ey = top + w * 0.52, e = w * 0.105, gap = w * 0.17, ecx = x + lean * 0.75 - w * 0.06;
  for (const side of [-1, 1]) {
    const ex = ecx + side * gap;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = INK; ctx.lineWidth = white ? 4 : 0;
    ctx.beginPath(); ctx.ellipse(ex, ey, e, e * 1.12, 0, 0, 7); ctx.fill(); if (white) ctx.stroke();
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(ex + look[0] * e * 0.5, ey + look[1] * e * 0.5, e * 0.48, 0, 7); ctx.fill();
  }
  ctx.restore();
}

// ---------- the inspector: a pixel Labrador, because it is a lab ----------
const PAL = { K: '#0c0c0c', Y: '#f5b455', S: '#d98f2f', C: '#ffe3b3', E: '#a8601b', N: '#0c0c0c', W: '#ffffff', R: '#e5252a', D: '#a8141a', G: '#ffd23f', H: '#3b3b40', M: '#2b2b30', L: '#d7ecf2', T: '#f28aa5' };
function dogGrid(headOnly = false) {
  const GW = 52, GH = 42, g = Array.from({ length: GH }, () => Array(GW).fill(null));
  const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < GW && y < GH) g[y][x] = c; };
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c); };
  const ell = (cx, cy, rx, ry, c, test = () => true) => { for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 && test(x, y)) set(x, y, c); };
  if (!headOnly) {
    // tail
    [[6, 31], [5, 30], [4, 29], [4, 28], [3, 27], [3, 26], [4, 25]].forEach(([x, y]) => rect(x, y, x + 1, y, 'Y'));
    // body, chest, legs
    ell(15, 30, 9, 9.5, 'Y'); rect(8, 35, 22, 39, 'Y'); ell(9, 33, 3, 5, 'S');
    ell(19.5, 31, 3.5, 6, 'C');
    rect(8, 38, 17, 40, 'Y'); rect(8, 37, 9, 37, 'S');
    rect(19, 31, 23, 40, 'Y'); rect(19, 39, 25, 40, 'Y'); rect(18, 31, 18, 38, 'K'); rect(24, 31, 24, 38, 'K');
    // arm and the glass
    rect(22, 26, 31, 28, 'Y'); rect(22, 25, 30, 25, 'K'); rect(22, 29, 31, 29, 'K');
    [[32, 27], [33, 26], [34, 25], [35, 24], [36, 23], [37, 22], [38, 21]].forEach(([x, y]) => rect(x, y, x + 1, y + 1, 'H'));
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { const d = Math.hypot(x - 43.5, y - 15); if (d <= 6.4) set(x, y, d > 4.7 ? 'M' : 'L'); }
    rect(40, 12, 41, 13, 'W'); set(42, 11, 'W'); set(46, 18, 'W');
    // collar
    rect(16, 22, 26, 23, 'R'); rect(21, 24, 22, 25, 'G');
  }
  // head, muzzle, nose, eye
  ell(22, 15, 8.5, 8, 'Y', (x, y) => headOnly ? y <= 22 : y <= 21);
  rect(27, 15, 35, 20, 'Y'); rect(29, 18, 35, 20, 'C'); set(35, 20, null); set(27, 20, 'Y');
  rect(34, 14, 36, 16, 'N'); set(36, 14, null);
  rect(30, 21, 34, 21, 'K'); rect(31, 22, 32, 23, 'T');
  rect(25, 12, 26, 13, 'K'); set(25, 12, 'W');
  // ear
  rect(14, 11, 19, 13, 'E'); rect(14, 14, 18, 20, 'E'); rect(15, 21, 17, 22, 'E'); rect(15, 13, 15, 19, 'S');
  rect(20, 11, 20, 13, 'K'); rect(19, 14, 19, 20, 'K'); rect(18, 21, 18, 22, 'K'); rect(15, 23, 17, 23, 'K'); rect(13, 11, 13, 20, 'K'); rect(14, 21, 14, 22, 'K');
  // cap
  ell(21, 8.5, 9.5, 5, 'R', (x, y) => y <= 9); rect(12, 9, 30, 10, 'D'); rect(27, 10, 35, 11, 'D'); rect(20, 3, 22, 3, 'D'); rect(14, 6, 16, 6, 'W');
  if (!headOnly) { rect(16, 22, 26, 23, 'R'); rect(21, 24, 22, 25, 'G'); }
  // outline
  const out = g.map(row => row.slice());
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (!g[y][x]) { if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy]?.[x + dx])) out[y][x] = 'K'; }
  return out;
}
function drawGrid(ctx, grid, cell, ox = 0, oy = 0) { grid.forEach((row, y) => row.forEach((c, x) => { if (c) { ctx.fillStyle = PAL[c]; ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell); } })); }
/** Wraps whatever is on `src` in a die-cut border: white edge, thin ink line, soft shadow. */
function dieCut(src, pad, white = 16, line = 5) {
  const out = canvas(src.width + pad * 2, src.height + pad * 2), ctx = out.getContext('2d');
  const tint = (colour) => { const c = canvas(src.width, src.height), k = c.getContext('2d'); k.drawImage(src, 0, 0); k.globalCompositeOperation = 'source-in'; k.fillStyle = colour; k.fillRect(0, 0, c.width, c.height); return c; };
  const ring = (colour, radius) => { const t = tint(colour); for (let a = 0; a < 48; a++) ctx.drawImage(t, pad + Math.cos(a / 48 * 6.2832) * radius, pad + Math.sin(a / 48 * 6.2832) * radius); };
  ctx.shadowColor = 'rgba(0,0,0,0.32)'; ctx.shadowBlur = 26; ctx.shadowOffsetY = 14; ctx.drawImage(tint('#000'), pad, pad); ctx.shadowColor = 'transparent';
  ring(INK, white + line); ring('#fff', white); ring('#fff', white / 2);
  ctx.drawImage(src, pad, pad);
  return out;
}
function inspector(cell = 12, disc = true) {
  const grid = dogGrid(), w = 52 * cell, h = 42 * cell, src = canvas(w + 40, h + 40), ctx = src.getContext('2d');
  if (disc) { ctx.fillStyle = RED; ctx.strokeStyle = INK; ctx.lineWidth = cell * 0.75; ctx.beginPath(); ctx.arc(20 + 19 * cell, 20 + 23 * cell, 17.5 * cell, 0, 7); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = cell * 0.6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(20 + 19 * cell, 20 + 23 * cell, 14.6 * cell, Math.PI * 1.08, Math.PI * 1.3); ctx.stroke(); }
  drawGrid(ctx, grid, cell, 20, 20);
  return dieCut(src, 60, cell * 1.3, cell * 0.45);
}
function mark(cell = 16) {
  const grid = dogGrid(true), src = canvas(30 * cell, 26 * cell), ctx = src.getContext('2d');
  drawGrid(ctx, grid, cell, -10 * cell, -1 * cell);
  return dieCut(src, 44, cell * 1.1, cell * 0.4);
}

// ---------- red proof ring and the pen that drew it ----------
function ring(ctx, cx, cy, rx, ry) {
  ctx.strokeStyle = RED; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 11;
  ctx.beginPath();
  for (let a = -1.4; a < 7.2; a += 0.08) { const wob = 1 + 0.035 * Math.sin(a * 3.1) + (a > 6.2 ? (a - 6.2) * 0.09 : 0); const px = cx + Math.cos(a) * rx * wob, py = cy + Math.sin(a) * ry * wob; if (a === -1.4) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
  ctx.stroke();
  const a = 7.2, wob = 1 + 0.035 * Math.sin(a * 3.1) + (a - 6.2) * 0.09;
  return [cx + Math.cos(a) * rx * wob, cy + Math.sin(a) * ry * wob];
}
function pen(tipX, tipY, angle, length = 330) {
  const src = canvas(length + 60, 110), ctx = src.getContext('2d');
  ctx.translate(30, 55); ctx.lineJoin = 'round'; ctx.strokeStyle = INK; ctx.lineWidth = 7;
  ctx.fillStyle = '#2b2b30'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(58, -17); ctx.lineTo(58, 17); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = RED; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(20, -6); ctx.lineTo(20, 6); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#6d6d73'; ctx.beginPath(); ctx.roundRect(58, -19, length - 58, 38, [0, 14, 14, 0]); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#8f8f96'; ctx.fillRect(64, -13, length - 80, 9);
  ctx.fillStyle = '#2b2b30'; ctx.fillRect(110, -19, 16, 38); ctx.strokeRect(110, -19, 16, 38);
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(150, -10); ctx.lineTo(length - 40, -10); ctx.stroke();
  const cut = dieCut(src, 40, 11, 4);
  return { cut, place(target) { target.save(); target.translate(tipX, tipY); target.rotate(angle); target.drawImage(cut, -70, -95); target.restore(); } };
}

// ---------- the scene ----------
const TILES = [[900, 668, 150, -14, GREEN, 'sheet'], [1032, 842, 138, 13, VIOLET, 'doc'], [884, 1010, 146, -9, ORANGE, 'slide'], [1004, 1196, 132, 20, GREEN, 'sheet'], [760, 1216, 118, -24, VIOLET, 'doc']];
const HEATS = [[1236, 372, 112, 0.6, 0.55], [1052, 520, 66, 2.4, 0.95], [742, 742, 92, 0.9, 0.5], [1250, 930, 128, 0.5, 0.8], [408, 352, 62, 1.2, 0.35], [300, 1270, 104, 0.7, 0.45], [896, 1790, 84, 2.2, 1.15], [1440, 1650, 112, 0.4, 0.6], [1466, 770, 70, 2.9, 0.8], [1210, 1880, 78, 1.0, 0.4]];
const DOG = { x: 330, y: 1700, rot: -0.07, cell: 12 };
const LENS = (() => { const w = 52 * 12 + 40 + 120, h = 42 * 12 + 40 + 120; const lx = 80 + 44 * 12 - w / 2, ly = 80 + 15.5 * 12 - h / 2; return [DOG.x + lx * Math.cos(DOG.rot) - ly * Math.sin(DOG.rot), DOG.y + lx * Math.sin(DOG.rot) + ly * Math.cos(DOG.rot)]; })();
const BACK = [[250, 1430, 170, 14, 'doc'], [468, 1372, 180, -10, 'sheet'], [694, 1340, 168, 8, 'slide'], [1140, 1356, 184, -14, 'doc'], [1376, 1420, 170, 10, 'sheet']];
const MID = [[150, 1568, 200, 16, 'sheet'], [396, 1508, 206, -8, 'doc'], [1096, 1496, 214, 12, 'slide'], [1338, 1566, 206, -12, 'doc'], [1528, 1630, 190, 6, 'sheet']];
const FRONT = [[660, 1772, 232, -10, 'doc'], [1100, 1748, 240, 10, 'sheet'], [1280, 1800, 240, -8, 'slide'], [1500, 1840, 220, 12, 'doc']];
const ODD = { x: 872, top: 1480, w: 226, lean: -6, white: true, kind: 'sheet', look: [-0.7, 0.5] };

function scene({ withInspector = true, withCaptions = true } = {}) {
  rnd = mulberry(20261109);
  const c = canvas(), ctx = c.getContext('2d');
  paper(ctx);
  laptop(ctx);
  // hairlines from the glass to everything it has flagged
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.6;
  for (const [x, y] of HEATS) { ctx.beginPath(); ctx.moveTo(LENS[0], LENS[1]); ctx.lineTo(x, y); ctx.stroke(); }
  for (let i = 0; i < 70; i++) { const t = rnd(); sparkle(ctx, 960 + Math.sin(t * 5) * 150 + between(-90, 90), 600 + t * 640, between(3, 9)); }
  for (const [x, top, w, lean, kind] of BACK) creature(ctx, { x, top, w, lean, kind, tone: '#4a4a4c', look: [0.2, -0.6] });
  TILES.slice(3).forEach(t => tile(ctx, ...t));
  for (const [x, top, w, lean, kind] of MID) creature(ctx, { x, top, w, lean, kind, tone: '#242426', look: [x < 872 ? 0.7 : -0.7, 0.1] });
  creature(ctx, ODD);
  const ringEnd = ring(ctx, ODD.x - 4, ODD.top + 122, 176, 150);
  for (const [x, top, w, lean, kind] of FRONT) creature(ctx, { x, top, w, lean, kind, tone: INK, look: [x < 872 ? 0.6 : -0.7, -0.5] });
  TILES.slice(0, 3).forEach(t => tile(ctx, ...t));
  HEATS.forEach(([x, y, s, angle, reach]) => heat(ctx, x, y, s, angle, reach));
  pen(ringEnd[0] + 6, ringEnd[1] - 4, -0.72).place(ctx);
  if (withInspector) { const dog = inspector(12); ctx.save(); ctx.translate(DOG.x, DOG.y); ctx.rotate(DOG.rot); ctx.drawImage(dog, -dog.width / 2, -dog.height / 2); ctx.restore(); }
  if (withCaptions) {
    ctx.fillStyle = INK; ctx.font = '500 38px "JetBrains Mono"'; ctx.textBaseline = 'top'; if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    ctx.fillText('CHECKED,', 110, 560); ctx.fillText('NOT GUESSED.', 110, 612);
    ctx.textAlign = 'right'; ctx.fillText('XLSX × DOCX × PPTX', W - 90, 1040);
    ctx.textAlign = 'left'; ctx.font = '500 24px "JetBrains Mono"'; ctx.fillText('OFFICEPROOF LAB', 110, 120);
  }
  return c;
}

function crowdStrip() {
  rnd = mulberry(77);
  const c = canvas(1600, 520), ctx = c.getContext('2d');
  const row = [[110, 250, 170, 12, 'doc', '#4a4a4c'], [300, 190, 190, -8, 'sheet', '#242426'], [520, 240, 180, 10, 'slide', INK], [1090, 230, 190, -12, 'doc', '#242426'], [1300, 180, 200, 8, 'sheet', INK], [1500, 260, 170, -6, 'slide', '#4a4a4c']];
  for (const [x, top, w, lean, kind, tone] of row) creature(ctx, { x, top, w, lean, kind, tone, look: [x < 800 ? 0.7 : -0.7, 0.2], bottom: 600 });
  creature(ctx, { x: 800, top: 150, w: 220, lean: -5, white: true, kind: 'sheet', look: [0, 0.6], bottom: 600 });
  return c;
}
function oddOne() {
  rnd = mulberry(5);
  const c = canvas(420, 520), ctx = c.getContext('2d');
  creature(ctx, { x: 200, top: 40, w: 250, lean: -6, white: true, kind: 'sheet', look: [0.5, 0.4], bottom: 600 });
  return c;
}
function heatTile(angle, reach) { rnd = mulberry(Math.round(angle * 1000 + reach * 77)); const c = canvas(240, 240), ctx = c.getContext('2d'); heat(ctx, 120, 120, 240, angle, reach, 6); return c; }

window.renderAll = async () => {
  await document.fonts.load('500 38px "JetBrains Mono"');
  const out = {};
  out['poster.jpg'] = scene().toDataURL('image/jpeg', 0.9);
  out['hero-base.jpg'] = scene({ withInspector: false, withCaptions: false }).toDataURL('image/jpeg', 0.88);
  out['inspector.png'] = inspector(12).toDataURL('image/png');
  out['inspector-plain.png'] = inspector(12, false).toDataURL('image/png');
  out['mark.png'] = mark(14).toDataURL('image/png');
  out['crowd.png'] = crowdStrip().toDataURL('image/png');
  out['odd.png'] = oddOne().toDataURL('image/png');
  out['heat-a.png'] = heatTile(0.6, 0.55).toDataURL('image/png');
  out['heat-b.png'] = heatTile(2.2, 1.15).toDataURL('image/png');
  return out;
};
