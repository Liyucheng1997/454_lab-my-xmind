'use strict';
/* 数据模型：doc = { format, version, id, title, theme, layout, lineStyle, root }
 * node = { id, text, children[], collapsed?, bold?, color?, note? } */

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

function makeNode(text = '') { return { id: uid(), text, children: [] }; }

function createDoc(opts = {}) {
  return {
    format: 'mindmap', version: 1, id: uid() + uid(),
    title: opts.title || '未命名导图',
    theme: opts.theme || 'classic',
    layout: opts.layout || 'mindmap',
    lineStyle: opts.lineStyle || null,
    root: opts.root || makeNode('中心主题'),
  };
}

function walk(n, fn, parent = null, depth = 0) {
  fn(n, parent, depth);
  n.children.forEach((c) => walk(c, fn, n, depth + 1));
}
function findNode(root, id) {
  if (root.id === id) return root;
  for (const c of root.children) { const r = findNode(c, id); if (r) return r; }
  return null;
}
function findParent(root, id) {
  for (const c of root.children) {
    if (c.id === id) return root;
    const r = findParent(c, id);
    if (r) return r;
  }
  return null;
}
function contains(n, id) { return !!findNode(n, id); }
function countDesc(n) { let c = 0; walk(n, () => c++); return c - 1; }
function cloneFresh(n) { return { ...n, id: uid(), children: n.children.map(cloneFresh) }; }

function normalizeNode(raw, ids) {
  if (!raw || typeof raw !== 'object') raw = {};
  let id = typeof raw.id === 'string' && raw.id ? raw.id : uid();
  if (ids.has(id)) id = uid();
  ids.add(id);
  const n = { id, text: String(raw.text ?? ''), children: [] };
  if (Array.isArray(raw.children)) n.children = raw.children.map((c) => normalizeNode(c, ids));
  if (raw.collapsed && n.children.length) n.collapsed = true;
  if (raw.bold) n.bold = true;
  if (typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color)) n.color = raw.color;
  if (raw.note) n.note = String(raw.note);
  return n;
}

function normalizeDoc(raw) {
  if (!raw || typeof raw !== 'object' || !raw.root) throw new Error('文件里没有找到导图数据');
  const layouts = ['mindmap', 'right', 'left', 'down'];
  return {
    format: 'mindmap', version: 1,
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid() + uid(),
    title: String(raw.title || raw.root.text || '未命名导图').slice(0, 80),
    theme: THEMES.some((t) => t.id === raw.theme) ? raw.theme : 'classic',
    layout: layouts.includes(raw.layout) ? raw.layout : 'mindmap',
    lineStyle: ['curve', 'elbow', 'straight'].includes(raw.lineStyle) ? raw.lineStyle : null,
    root: normalizeNode(raw.root, new Set()),
  };
}

/* 模板 */
function T(text, ...kids) { const n = makeNode(text); n.children = kids.map((k) => (typeof k === 'string' ? makeNode(k) : k)); return n; }

const TEMPLATES = [
  { id: 'blank', name: '空白导图', desc: '只有一个中心主题', theme: 'classic', layout: 'mindmap',
    build: () => T('中心主题') },
  { id: 'project', name: '项目规划', desc: '目标、范围、时间线、分工', theme: 'ocean', layout: 'right',
    build: () => T('项目规划',
      T('目标', '业务目标', '关键指标'),
      T('范围', '必做功能', '暂不考虑'),
      T('时间线', '需求评审', '设计与开发', '测试上线'),
      T('团队分工', '产品', '设计', '研发', '测试'),
      T('风险', '进度风险', '技术风险')) },
  { id: 'reading', name: '读书笔记', desc: '记录观点、摘录与思考', theme: 'paper', layout: 'mindmap',
    build: () => T('《书名》读书笔记',
      T('基本信息', '作者', '出版时间'),
      T('核心观点', '观点一', '观点二', '观点三'),
      T('精彩摘录', '摘录一'),
      T('我的思考', '启发', '疑问'),
      T('行动清单', '马上可以做的事')) },
  { id: 'swot', name: 'SWOT 分析', desc: '优势、劣势、机会、威胁', theme: 'candy', layout: 'mindmap',
    build: () => T('SWOT 分析',
      T('优势 Strengths', '核心能力', '资源'),
      T('劣势 Weaknesses', '短板', '限制'),
      T('机会 Opportunities', '市场趋势', '新需求'),
      T('威胁 Threats', '竞争对手', '外部风险')) },
  { id: 'week', name: '周计划', desc: '按天安排本周要做的事', theme: 'forest', layout: 'down',
    build: () => T('本周计划',
      T('周一', '整理待办'), T('周二', '推进重点'), T('周三', '沟通同步'), T('周四', '专注产出'), T('周五', '复盘总结')) },
];
