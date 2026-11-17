'use strict';
/* 布局：根据每个节点的尺寸算出位置。坐标以中心主题为原点附近。 */
const LAYOUTS = [
  { id: 'mindmap', name: '思维导图', desc: '左右平衡展开' },
  { id: 'right', name: '向右逻辑图', desc: '从左往右展开' },
  { id: 'left', name: '向左逻辑图', desc: '从右往左展开' },
  { id: 'down', name: '组织结构图', desc: '从上往下展开' },
];

function computeLayout(root, sizes, type) {
  const vertical = type === 'down';
  const pos = new Map();
  const ext = new Map();
  const kids = (n) => (n.collapsed ? [] : n.children);
  const hgap = (d) => (d === 0 ? 56 : 30); // 父子之间（横向布局）
  const vgap = (d) => (d === 0 ? 50 : 34); // 父子之间（纵向布局）
  const sgap = (d) => (vertical ? (d === 0 ? 28 : 14) : (d === 0 ? 20 : 8)); // 兄弟之间

  function measure(n, d) {
    const s = sizes.get(n.id);
    const own = vertical ? s.w : s.h;
    let t = 0;
    kids(n).forEach((k, i) => { t += measure(k, d + 1) + (i ? sgap(d) : 0); });
    const e = Math.max(own, t);
    ext.set(n.id, e);
    return e;
  }
  const blockSize = (list, d) => list.reduce((a, k, i) => a + ext.get(k.id) + (i ? sgap(d) : 0), 0);

  function placeH(n, d, xEdge, top, dir) {
    const s = sizes.get(n.id);
    const cy = top + ext.get(n.id) / 2;
    const x = dir > 0 ? xEdge : xEdge - s.w;
    pos.set(n.id, { x, y: cy - s.h / 2, w: s.w, h: s.h, dir, depth: d });
    const ks = kids(n);
    if (!ks.length) return;
    placeChildrenH(ks, d, dir > 0 ? x + s.w + hgap(d) : x - hgap(d), cy, dir);
  }
  function placeChildrenH(ks, d, cx, cy, dir) {
    let y = cy - blockSize(ks, d) / 2;
    ks.forEach((k) => { placeH(k, d + 1, cx, y, dir); y += ext.get(k.id) + sgap(d); });
  }
  function placeV(n, d, left, top) {
    const s = sizes.get(n.id);
    const cx = left + ext.get(n.id) / 2;
    pos.set(n.id, { x: cx - s.w / 2, y: top, w: s.w, h: s.h, dir: 1, depth: d });
    const ks = kids(n);
    if (!ks.length) return;
    let x = cx - blockSize(ks, d) / 2;
    const cyTop = top + s.h + vgap(d);
    ks.forEach((k) => { placeV(k, d + 1, x, cyTop); x += ext.get(k.id) + sgap(d); });
  }

  measure(root, 0);
  const rs = sizes.get(root.id);
  if (vertical) {
    placeV(root, 0, -ext.get(root.id) / 2, -rs.h / 2);
  } else if (type === 'mindmap') {
    pos.set(root.id, { x: -rs.w / 2, y: -rs.h / 2, w: rs.w, h: rs.h, dir: 1, depth: 0 });
    const ks = kids(root);
    // 按高度把一级分支分到左右两边，先右后左
    const total = blockSize(ks, 0);
    let acc = 0, split = ks.length;
    for (let i = 0; i < ks.length; i++) {
      acc += ext.get(ks[i].id) + (i ? sgap(0) : 0);
      if (acc >= total / 2) { split = i + 1; break; }
    }
    if (ks.length > 1) split = Math.min(split, ks.length - 1);
    const right = ks.slice(0, split), left = ks.slice(split);
    placeChildrenH(right, 0, rs.w / 2 + hgap(0), 0, 1);
    placeChildrenH(left, 0, -rs.w / 2 - hgap(0), 0, -1);
  } else {
    const dir = type === 'left' ? -1 : 1;
    placeH(root, 0, dir > 0 ? -rs.w / 2 : rs.w / 2, -ext.get(root.id) / 2, dir);
  }
  return { pos, vertical };
}

function layoutBounds(pos) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of pos.values()) {
    x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y);
    x2 = Math.max(x2, p.x + p.w); y2 = Math.max(y2, p.y + p.h);
  }
  if (x1 === Infinity) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/* 连线锚点 */
function outAnchor(p, s, dir, vertical) {
  if (vertical) return { x: p.x + p.w / 2, y: p.y + p.h };
  const y = s.underline ? p.y + p.h - s.uw / 2 : p.y + p.h / 2;
  return { x: dir > 0 ? p.x + p.w : p.x, y };
}
function inAnchor(p, s, vertical) {
  if (vertical) return { x: p.x + p.w / 2, y: p.y };
  const y = s.underline ? p.y + p.h - s.uw / 2 : p.y + p.h / 2;
  return { x: p.dir > 0 ? p.x : p.x + p.w, y };
}

function linkPath(a, b, style, vertical) {
  const f = (v) => Math.round(v * 10) / 10;
  if (style === 'straight') return `M${f(a.x)},${f(a.y)}L${f(b.x)},${f(b.y)}`;
  if (!vertical) {
    if (style === 'curve') {
      const mx = (a.x + b.x) / 2;
      return `M${f(a.x)},${f(a.y)}C${f(mx)},${f(a.y)} ${f(mx)},${f(b.y)} ${f(b.x)},${f(b.y)}`;
    }
    const mx = (a.x + b.x) / 2, sx = Math.sign(b.x - a.x) || 1, sy = Math.sign(b.y - a.y);
    if (!sy || Math.abs(b.y - a.y) < 1) return `M${f(a.x)},${f(a.y)}L${f(b.x)},${f(b.y)}`;
    const r = Math.min(10, Math.abs(b.y - a.y) / 2, Math.abs(mx - a.x));
    return `M${f(a.x)},${f(a.y)}H${f(mx - sx * r)}Q${f(mx)},${f(a.y)} ${f(mx)},${f(a.y + sy * r)}V${f(b.y - sy * r)}Q${f(mx)},${f(b.y)} ${f(mx + sx * r)},${f(b.y)}H${f(b.x)}`;
  }
  if (style === 'curve') {
    const my = (a.y + b.y) / 2;
    return `M${f(a.x)},${f(a.y)}C${f(a.x)},${f(my)} ${f(b.x)},${f(my)} ${f(b.x)},${f(b.y)}`;
  }
  const my = (a.y + b.y) / 2, sy = Math.sign(b.y - a.y) || 1, sx = Math.sign(b.x - a.x);
  if (!sx || Math.abs(b.x - a.x) < 1) return `M${f(a.x)},${f(a.y)}L${f(b.x)},${f(b.y)}`;
  const r = Math.min(10, Math.abs(b.x - a.x) / 2, Math.abs(my - a.y));
  return `M${f(a.x)},${f(a.y)}V${f(my - sy * r)}Q${f(a.x)},${f(my)} ${f(a.x + sx * r)},${f(my)}H${f(b.x - sx * r)}Q${f(b.x)},${f(my)} ${f(b.x)},${f(my + sy * r)}V${f(b.y)}`;
}
