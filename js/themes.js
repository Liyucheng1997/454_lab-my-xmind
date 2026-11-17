'use strict';
/* 导图主题：只影响画布内的内容（背景、节点、连线），界面本身保持统一风格。
 * main：一级分支样式 fill(实色) / soft(浅色底) / outline(描边)
 * sub ：二级及以下 underline(下划线) / plain(浅色块) / outline(描边)
 * line：连线 curve(曲线) / elbow(直角) / straight(直线)
 */
const THEMES = [
  { id: 'minimal', name: '简约', bg: '#ffffff', text: '#1d1d1f', root: { fill: '#1d1d1f', text: '#ffffff' },
    colors: ['#0071e3'], lineColor: '#c7c7cc', main: 'soft', sub: 'underline', line: 'curve', radius: { root: 12, main: 10, sub: 6 } },
  { id: 'classic', name: '经典彩虹', bg: '#ffffff', text: '#1d1d1f', root: { fill: '#22262e', text: '#ffffff' },
    colors: ['#e8590c', '#f59f00', '#2f9e44', '#1c7ed6', '#7048e8', '#d6336c'], main: 'fill', sub: 'underline', line: 'curve', radius: { root: 14, main: 10, sub: 6 } },
  { id: 'ocean', name: '海洋', bg: '#f1f7fb', text: '#0b2a44', root: { fill: '#0b3d66', text: '#ffffff' },
    colors: ['#1971c2', '#0c8599', '#3b5bdb', '#1098ad', '#4263eb'], main: 'fill', sub: 'plain', line: 'elbow', radius: { root: 10, main: 8, sub: 6 } },
  { id: 'forest', name: '森林', bg: '#f3f7f0', text: '#1f3324', root: { fill: '#2b4a2f', text: '#f3f7f0' },
    colors: ['#2f9e44', '#5c940d', '#087f5b', '#66a80f', '#2b8a3e'], main: 'soft', sub: 'underline', line: 'curve', radius: { root: 16, main: 12, sub: 6 } },
  { id: 'sunset', name: '暖阳', bg: '#fff8f0', text: '#3d2314', root: { fill: '#d9480f', text: '#ffffff' },
    colors: ['#e8590c', '#f08c00', '#e03131', '#c2255c', '#d9480f'], main: 'outline', sub: 'underline', line: 'curve', radius: { root: 99, main: 99, sub: 6 } },
  { id: 'paper', name: '纸张', bg: '#f6efe1', text: '#4a3728', root: { fill: '#5c4033', text: '#fbf5e9' },
    colors: ['#8d5b3f', '#a0703c', '#6d4c41', '#7c6a46'], main: 'outline', sub: 'underline', line: 'curve', radius: { root: 6, main: 4, sub: 4 },
    font: "'Songti SC', 'STSong', 'SimSun', 'Noto Serif SC', serif" },
  { id: 'business', name: '商务', bg: '#f4f6f9', text: '#1f2a44', root: { fill: '#1f2a44', text: '#ffffff' },
    colors: ['#2c3e66', '#3d5a80', '#293241', '#4a6fa5'], main: 'fill', sub: 'plain', line: 'elbow', radius: { root: 4, main: 4, sub: 3 } },
  { id: 'candy', name: '糖果', bg: '#fff7fb', text: '#3b2a3f', root: { fill: '#e64980', text: '#ffffff' },
    colors: ['#f783ac', '#9775fa', '#4dabf7', '#38d9a9', '#fcc419', '#ff922b'], main: 'soft', sub: 'plain', line: 'curve', radius: { root: 99, main: 99, sub: 99 } },
  { id: 'mono', name: '黑白', bg: '#ffffff', text: '#111111', root: { fill: '#111111', text: '#ffffff' },
    colors: ['#111111'], main: 'outline', sub: 'underline', line: 'straight', radius: { root: 0, main: 0, sub: 0 } },
  { id: 'midnight', name: '暗夜', dark: true, bg: '#15171c', text: '#e9ecef', root: { fill: '#f1f3f5', text: '#15171c' },
    colors: ['#4dabf7', '#69db7c', '#ffd43b', '#ff8787', '#da77f2', '#3bc9db'], main: 'outline', sub: 'underline', line: 'curve', radius: { root: 14, main: 10, sub: 6 } },
  { id: 'neon', name: '霓虹', dark: true, bg: '#0b0f1a', text: '#e6edf7', root: { fill: '#7c3aed', text: '#ffffff' },
    colors: ['#22d3ee', '#a3e635', '#f472b6', '#facc15', '#60a5fa'], main: 'fill', sub: 'plain', line: 'elbow', radius: { root: 12, main: 8, sub: 6 } },
];

const EXTRA_COLORS = ['#e03131', '#f76707', '#f59f00', '#2f9e44', '#0c8599', '#1c7ed6', '#7048e8', '#c2255c', '#495057'];

const UI_FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Helvetica Neue', 'Microsoft YaHei', 'Noto Sans SC', sans-serif";

function getTheme(id) { return THEMES.find((t) => t.id === id) || THEMES[1]; }

function hexToRgb(h) {
  h = String(h).replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return '#' + A.map((v, i) => Math.round(v * (1 - t) + B[i] * t).toString(16).padStart(2, '0')).join('');
}
function luminance(h) {
  const [r, g, b] = hexToRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function readable(bg) { return luminance(bg) > 0.36 ? '#1d1d1f' : '#ffffff'; }

/* 计算一个节点的视觉样式。HTML 渲染和 SVG/PNG 导出共用这一份。 */
function nodeStyle(t, depth, color, node) {
  let s;
  if (depth === 0) {
    const fill = node.color || t.root.fill;
    s = { fill, stroke: null, sw: 0, text: node.color ? readable(fill) : t.root.text, fs: 20, fw: 600, px: 24, py: 12, r: t.radius.root };
  } else if (depth === 1) {
    s = { fs: 15, fw: 500, px: 16, py: 8, r: t.radius.main, stroke: null, sw: 0 };
    if (t.main === 'fill') { s.fill = color; s.text = readable(color); }
    else if (t.main === 'soft') { s.fill = mix(color, t.bg, t.dark ? 0.72 : 0.84); s.text = t.text; }
    else { s.fill = t.bg; s.stroke = color; s.sw = 2; s.text = t.text; }
  } else {
    s = { fs: 13.5, fw: 400, px: 10, py: 5, r: t.radius.sub, stroke: null, sw: 0, text: t.text };
    if (t.sub === 'underline') { s.fill = null; s.underline = true; s.uw = 2; s.uc = color; s.px = 4; s.r = 0; }
    else if (t.sub === 'plain') { s.fill = mix(color, t.bg, t.dark ? 0.8 : 0.88); }
    else { s.fill = t.bg; s.stroke = color; s.sw = 1.5; }
  }
  if (node.bold) s.fw = 700;
  s.lh = Math.round(s.fs * 1.45);
  s.font = t.font || UI_FONT;
  return s;
}

function lineWidth(depth) { return depth === 1 ? 3 : depth === 2 ? 2 : 1.5; }

/* 主题缩略图 */
function themePreview(t, w = 120, h = 72) {
  const col = (i) => t.colors[i % t.colors.length];
  const lc = (i) => t.lineColor || col(i);
  const cy = h / 2;
  const nodes = [[w - 26, cy - 18, 0], [w - 26, cy + 18, 1], [26, cy - 18, 2], [26, cy + 18, 3]];
  let s = `<svg viewBox="0 0 ${w} ${h}" width="100%" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="${t.bg}"/>`;
  nodes.forEach(([x, y, i]) => {
    const right = x > w / 2;
    const ax = right ? w / 2 + 14 : w / 2 - 14, bx = right ? x - 13 : x + 13, mx = (ax + bx) / 2;
    let d;
    if (t.line === 'elbow') d = `M${ax},${cy}H${mx}V${y}H${bx}`;
    else if (t.line === 'straight') d = `M${ax},${cy}L${bx},${y}`;
    else d = `M${ax},${cy}C${mx},${cy} ${mx},${y} ${bx},${y}`;
    s += `<path d="${d}" stroke="${lc(i)}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    const st = nodeStyle(t, 1, col(i), {});
    s += `<rect x="${x - 13}" y="${y - 6}" width="26" height="12" rx="${Math.min(6, st.r)}" fill="${st.fill || 'none'}" stroke="${st.stroke || 'none'}" stroke-width="1.5"/>`;
  });
  s += `<rect x="${w / 2 - 17}" y="${cy - 9}" width="34" height="18" rx="${Math.min(9, t.radius.root)}" fill="${t.root.fill}"/>`;
  return s + '</svg>';
}
