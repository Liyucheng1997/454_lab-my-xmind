'use strict';
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const stage = $('#stage'), world = $('#world'), linksSvg = $('#links'), nodesLayer = $('#nodes'), foldsLayer = $('#folds'), ime = $('#ime');

  const state = {
    doc: null, sel: null, editing: false,
    dirty: false, handle: null, fileName: null,
    view: { x: 0, y: 0, k: 1 },
    undo: [], redo: [],
    pos: new Map(), info: new Map(), vertical: false,
    clip: null, sideTab: 'theme', hover: null,
  };
  const nodeEls = new Map();

  /* ================= 界面主题（浅色 / 深色） ================= */
  const darkMQ = matchMedia('(prefers-color-scheme: dark)');
  function uiDark() {
    const pref = localStorage.getItem('mm-ui-theme');
    return pref ? pref === 'dark' : darkMQ.matches;
  }
  function applyUITheme() {
    const dark = uiDark();
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    $('#btnDark').innerHTML = icon(dark ? 'sun' : 'moon');
    $('#btnDark').title = dark ? '切换到浅色界面' : '切换到深色界面';
  }
  darkMQ.addEventListener('change', applyUITheme);

  /* ================= 提示、对话框、菜单 ================= */
  function toast(msg, type = '') {
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' toast-' + type : '');
    el.textContent = msg;
    $('#toastHost').appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, type === 'error' ? 4200 : 2400);
  }

  let modalEl = null;
  function openModal({ title, body, width = 420, footer = [], onClose }) {
    closeModal();
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.innerHTML = `<div class="modal" style="width:${width}px" role="dialog" aria-modal="true">
      ${title ? `<div class="modal-header"><span>${esc(title)}</span><button class="modal-x" data-close title="关闭">${icon('x', 16)}</button></div>` : ''}
      <div class="modal-body"></div>
      ${footer.length ? '<div class="modal-footer"></div>' : ''}</div>`;
    const bodyEl = $('.modal-body', ov);
    if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
    const foot = $('.modal-footer', ov);
    footer.forEach((b) => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.cls || '');
      btn.textContent = b.label;
      btn.onclick = () => b.onClick && b.onClick();
      foot.appendChild(btn);
      if (b.autofocus) setTimeout(() => btn.focus(), 30);
    });
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
    ov.querySelector('[data-close]')?.addEventListener('click', () => close());
    function close() { if (modalEl === ov) { modalEl = null; ov.remove(); onClose && onClose(); focusIme(); } }
    ov._close = close;
    document.body.appendChild(ov);
    modalEl = ov;
    return { el: ov, close };
  }
  function closeModal() { if (modalEl) modalEl._close(); }

  function confirmDialog({ title, message, okText = '确定', danger = false, iconName = 'help' }) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; m.close(); resolve(v); } };
      const m = openModal({
        width: 380,
        body: `<div style="text-align:center;padding:14px 0 2px"><div class="confirm-ico${danger ? ' danger' : ''}">${icon(iconName, 22)}</div>
          <div style="font-size:17px;font-weight:600;letter-spacing:-.02em;margin-bottom:8px">${esc(title)}</div>
          <div class="modal-msg">${esc(message)}</div></div>`,
        footer: [
          { label: '取消', onClick: () => finish(false) },
          { label: okText, cls: danger ? 'btn-danger-solid' : 'btn-primary', autofocus: true, onClick: () => finish(true) },
        ],
        onClose: () => { if (!done) { done = true; resolve(false); } },
      });
      $$('.modal-footer .btn', m.el).forEach((b) => (b.style.flex = '1'));
    });
  }

  let menuEl = null;
  function showMenu(x, y, items) {
    closeMenu();
    const m = document.createElement('div');
    m.className = 'popover menu';
    items.forEach((it) => {
      if (it === 'sep') { m.insertAdjacentHTML('beforeend', '<div class="menu-sep"></div>'); return; }
      const row = document.createElement('div');
      row.className = 'menu-item' + (it.disabled ? ' disabled' : '');
      row.innerHTML = `<span class="menu-icon">${it.icon ? icon(it.icon, 16) : ''}</span><span class="menu-label">${esc(it.label)}</span>${it.shortcut ? `<span class="menu-shortcut">${esc(it.shortcut)}</span>` : ''}`;
      row.addEventListener('click', () => { if (it.disabled) return; closeMenu(); it.action(); });
      m.appendChild(row);
    });
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
    m.style.top = (y + r.height > innerHeight - 8 ? Math.max(8, y - r.height) : y) + 'px';
    menuEl = m;
  }
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  document.addEventListener('pointerdown', (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);
  window.addEventListener('blur', closeMenu);

  /* ================= 历史记录 ================= */
  const snapshot = () => JSON.stringify({ root: state.doc.root, theme: state.doc.theme, layout: state.doc.layout, lineStyle: state.doc.lineStyle });
  function pushUndo() {
    state.undo.push(snapshot());
    if (state.undo.length > 200) state.undo.shift();
    state.redo = [];
  }
  function restore(snap) {
    const s = JSON.parse(snap);
    Object.assign(state.doc, s);
    if (!state.sel || !findNode(state.doc.root, state.sel)) state.sel = state.doc.root.id;
    markDirty();
    render();
    renderSide();
  }
  function undo() {
    if (state.editing) { cancelEdit(); return; }
    if (!state.undo.length) return;
    state.redo.push(snapshot());
    restore(state.undo.pop());
  }
  function redo() {
    if (!state.redo.length) return;
    state.undo.push(snapshot());
    restore(state.redo.pop());
  }

  /* ================= 保存状态 / 草稿 ================= */
  let saveTimer = null;
  function markDirty() {
    state.dirty = true;
    updateSaveState();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistRecent, 500);
  }
  function updateSaveState() {
    const el = $('#saveState');
    el.className = 'save-state';
    if (state.dirty) { el.classList.add('dirty'); el.textContent = state.fileName ? '有改动未保存' : '未保存为文件'; el.title = '改动已作为草稿自动保存在浏览器里，按 Ctrl+S 保存到文件'; }
    else if (state.fileName) { el.classList.add('saved'); el.textContent = '已保存'; el.title = state.fileName; }
    else { el.textContent = '新导图'; el.title = ''; }
    $('#btnUndo').disabled = !state.undo.length;
    $('#btnRedo').disabled = !state.redo.length;
    document.title = `${state.doc.title || '未命名导图'}${state.dirty ? ' •' : ''} - 思维导图`;
  }
  async function persistRecent() {
    clearTimeout(saveTimer);
    if (!state.doc) return;
    try {
      await IO.recents.put({
        id: state.doc.id, title: state.doc.title, time: Date.now(),
        handle: state.handle, fileName: state.fileName, dirty: state.dirty,
        count: countDesc(state.doc.root) + 1,
        data: JSON.parse(IO.serialize(state.doc)),
      });
      localStorage.setItem('mm-last-id', state.doc.id);
    } catch (e) { console.warn('草稿保存失败', e); }
  }
  addEventListener('pagehide', () => { if (saveTimer) persistRecent(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) persistRecent(); });

  /* ================= 渲染 ================= */
  function render() {
    const doc = state.doc, t = getTheme(doc.theme);
    const lineStyle = doc.lineStyle || t.line;
    stage.style.background = t.bg;
    stage.classList.toggle('dark-map', !!t.dark);

    const vis = [];
    const rec = (n, parent, depth, color) => {
      vis.push({ n, parent, depth, color });
      if (n.collapsed) return;
      n.children.forEach((c, i) => rec(c, n, depth + 1, c.color || (depth === 0 ? t.colors[i % t.colors.length] : color)));
    };
    rec(doc.root, null, 0, t.colors[0]);

    const info = new Map(), seen = new Set();
    for (const v of vis) {
      const n = v.n;
      seen.add(n.id);
      let el = nodeEls.get(n.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'node';
        el.dataset.id = n.id;
        nodesLayer.appendChild(el);
        nodeEls.set(n.id, el);
      }
      const st = nodeStyle(t, v.depth, v.color, n);
      v.style = st;
      info.set(n.id, v);
      const css = el.style;
      css.background = st.fill || 'transparent';
      css.color = st.text;
      css.fontSize = st.fs + 'px';
      css.fontWeight = st.fw;
      css.lineHeight = st.lh + 'px';
      css.padding = `${st.py}px ${st.px}px`;
      css.borderRadius = st.r + 'px';
      css.fontFamily = st.font;
      css.boxShadow = st.underline ? `inset 0 -${st.uw}px 0 ${st.uc}` : st.stroke ? `inset 0 0 0 ${st.sw}px ${st.stroke}` : 'none';
      const editingThis = state.editing && state.sel === n.id;
      setText(el, editingThis ? ime.value : n.text);
      el.classList.toggle('selected', state.sel === n.id);
      el.classList.toggle('editing', editingThis);
      el.classList.toggle('has-note', !!n.note);
      el.title = n.note || '';
    }
    for (const [id, el] of nodeEls) if (!seen.has(id)) { el.remove(); nodeEls.delete(id); }

    const sizes = new Map();
    for (const v of vis) { const el = nodeEls.get(v.n.id); sizes.set(v.n.id, { w: el.offsetWidth, h: el.offsetHeight }); }
    const { pos, vertical } = computeLayout(doc.root, sizes, doc.layout);
    state.pos = pos; state.info = info; state.vertical = vertical;
    stage.classList.toggle('vertical', vertical);
    for (const v of vis) {
      const p = pos.get(v.n.id);
      nodeEls.get(v.n.id).style.transform = `translate(${p.x}px,${p.y}px)`;
    }

    let paths = '';
    for (const v of vis) {
      if (!v.parent) continue;
      const pp = pos.get(v.parent.id), cp = pos.get(v.n.id);
      const a = outAnchor(pp, info.get(v.parent.id).style, cp.dir, vertical), b = inAnchor(cp, v.style, vertical);
      paths += `<path d="${linkPath(a, b, lineStyle, vertical)}" stroke="${t.lineColor || v.color}" stroke-width="${lineWidth(v.depth)}" fill="none" stroke-linecap="round"/>`;
    }
    linksSvg.innerHTML = paths;

    let folds = '';
    for (const v of vis) {
      const n = v.n;
      if (!v.parent || !n.children.length) continue;
      const p = pos.get(n.id), a = outAnchor(p, v.style, p.dir, vertical);
      const where = vertical ? `left:${a.x}px;top:${a.y + 4}px;transform:translate(-50%,0)`
        : p.dir > 0 ? `left:${a.x + 4}px;top:${a.y}px;transform:translate(0,-50%)` : `left:${a.x - 4}px;top:${a.y}px;transform:translate(-100%,-50%)`;
      const show = n.id === state.sel || n.id === state.hover ? ' show' : '';
      folds += `<div class="fold ${n.collapsed ? 'count' : 'open'}${show}" data-fold="${n.id}" title="${n.collapsed ? '展开' : '折叠'}" style="${where};color:${t.lineColor || v.color};background:${t.bg}">${n.collapsed ? countDesc(n) : '−'}</div>`;
    }
    foldsLayer.innerHTML = folds;

    placeEditor();
    updateInfo();
    updateSaveState();
  }

  function setText(el, text) {
    const s = String(text || '');
    el.textContent = !s ? ' ' : s.endsWith('\n') ? s + ' ' : s;
  }

  function placeEditor() {
    const p = state.sel && state.pos.get(state.sel);
    if (!p) { ime.style.transform = 'translate(-99999px,0)'; return; }
    const s = state.info.get(state.sel).style;
    ime.style.transform = `translate(${p.x + s.px - 3}px,${p.y + s.py}px)`;
    ime.style.width = Math.max(20, p.w - 2 * s.px + 6) + 'px';
    ime.style.height = Math.max(s.lh, p.h - 2 * s.py) + 'px';
    ime.style.font = `${s.fw} ${s.fs}px/${s.lh}px ${s.font}`;
    ime.style.color = s.text;
    ime.style.caretColor = s.text;
  }

  function updateInfo() {
    const total = countDesc(state.doc.root) + 1;
    $('#stageInfo').textContent = `${total} 个主题`;
    const isRoot = state.sel === state.doc.root.id;
    $('#fbDelete').disabled = !state.sel || isRoot;
    $('#fbSibling').disabled = !state.sel;
  }

  function refreshSelection() {
    for (const [id, el] of nodeEls) el.classList.toggle('selected', id === state.sel);
    $$('.fold', foldsLayer).forEach((f) => f.classList.toggle('show', f.dataset.fold === state.sel || f.dataset.fold === state.hover));
    placeEditor();
    updateInfo();
    if (state.sideTab === 'node') renderSide();
  }

  /* ================= 视图（平移 / 缩放） ================= */
  function applyView(animate) {
    const v = state.view;
    world.classList.toggle('animate', !!animate);
    world.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.k})`;
    $('#zoomLabel').textContent = Math.round(v.k * 100) + '%';
    if (animate) setTimeout(() => world.classList.remove('animate'), 300);
  }
  function zoomAt(cx, cy, k, animate) {
    const v = state.view;
    k = clamp(k, 0.15, 4);
    v.x = cx - ((cx - v.x) * k) / v.k;
    v.y = cy - ((cy - v.y) * k) / v.k;
    v.k = k;
    applyView(animate);
  }
  function zoomBy(f) { const r = stage.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, state.view.k * f, true); }
  function fitView(animate) {
    const b = layoutBounds(state.pos), r = stage.getBoundingClientRect();
    if (!r.width) return;
    const pad = 70;
    const k = clamp(Math.min((r.width - pad * 2) / b.w, (r.height - pad * 2 - 40) / b.h, 1), 0.2, 1);
    state.view = { k, x: r.width / 2 - (b.x + b.w / 2) * k, y: (r.height - 40) / 2 - (b.y + b.h / 2) * k };
    applyView(animate);
  }
  function resetZoom() {
    const r = stage.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, 1, true);
  }
  function ensureVisible(id) {
    const p = state.pos.get(id);
    if (!p) return;
    const v = state.view, r = stage.getBoundingClientRect(), m = 40;
    const x1 = v.x + p.x * v.k, y1 = v.y + p.y * v.k, x2 = x1 + p.w * v.k, y2 = y1 + p.h * v.k;
    let dx = 0, dy = 0;
    if (x1 < m) dx = m - x1; else if (x2 > r.width - m) dx = Math.max(r.width - m - x2, m - x1);
    if (y1 < m) dy = m - y1; else if (y2 > r.height - 70) dy = Math.max(r.height - 70 - y2, m - y1);
    if (dx || dy) { v.x += dx; v.y += dy; applyView(true); }
  }
  stage.addEventListener('scroll', () => { stage.scrollTop = 0; stage.scrollLeft = 0; });

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(e.clientX - r.left, e.clientY - r.top, state.view.k * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025)));
    } else {
      const f = e.deltaMode === 1 ? 16 : 1;
      state.view.x -= (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * f;
      state.view.y -= (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * f;
      applyView();
    }
  }, { passive: false });

  // 空白处拖动 = 平移；单击空白 = 取消选择
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.node, .fold, .ime')) return;
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    focusIme(true);
    if (state.editing) commitEdit();
    const sx = e.clientX, sy = e.clientY, ox = state.view.x, oy = state.view.y;
    let moved = false;
    stage.setPointerCapture(e.pointerId);
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
      moved = true;
      stage.classList.add('panning');
      state.view.x = ox + ev.clientX - sx;
      state.view.y = oy + ev.clientY - sy;
      applyView();
    };
    const up = () => {
      stage.removeEventListener('pointermove', move);
      stage.classList.remove('panning');
      if (!moved && e.button === 0) { state.sel = null; refreshSelection(); }
      focusIme();
    };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up, { once: true });
    stage.addEventListener('pointercancel', up, { once: true });
  });

  /* ================= 节点交互 ================= */
  function focusIme(force) {
    if (modalEl || !$('#home').hidden) return;
    const a = document.activeElement;
    if (a && a !== ime && a !== document.body && a.matches('input, textarea, select')) {
      if (!force) return;
      a.blur();
    }
    ime.focus({ preventScroll: true });
  }

  function select(id, opts = {}) {
    if (state.editing) commitEdit();
    state.sel = id;
    refreshSelection();
    if (id && opts.scroll !== false) ensureVisible(id);
    focusIme();
  }

  nodesLayer.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.node');
    if (!el || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const id = el.dataset.id;
    focusIme(true);
    if (state.sel !== id) select(id, { scroll: false });
    startDrag(e, id);
  });
  nodesLayer.addEventListener('dblclick', (e) => {
    const el = e.target.closest('.node');
    if (!el) return;
    select(el.dataset.id, { scroll: false });
    startEdit(false);
  });
  nodesLayer.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.node');
    if (!el) return;
    e.preventDefault();
    select(el.dataset.id, { scroll: false });
    nodeMenu(e.clientX, e.clientY);
  });
  stage.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.node')) return;
    e.preventDefault();
    showMenu(e.clientX, e.clientY, [
      { label: '适应窗口', icon: 'fit', shortcut: 'Ctrl+0', action: () => fitView(true) },
      { label: '缩放到 100%', icon: 'target', action: resetZoom },
      'sep',
      { label: '全部展开', icon: 'fold', action: () => setAllCollapsed(false) },
      { label: '只显示一级主题', icon: 'fold', action: () => setAllCollapsed(true) },
    ]);
  });
  nodesLayer.addEventListener('pointerover', (e) => {
    const el = e.target.closest('.node');
    const id = el ? el.dataset.id : null;
    if (id === state.hover) return;
    state.hover = id;
    $$('.fold', foldsLayer).forEach((f) => f.classList.toggle('show', f.dataset.fold === state.sel || f.dataset.fold === id));
  });
  nodesLayer.addEventListener('pointerleave', () => { state.hover = null; });
  foldsLayer.addEventListener('pointerdown', (e) => {
    const f = e.target.closest('.fold');
    if (!f) return;
    e.stopPropagation();
    e.preventDefault();
    toggleFold(f.dataset.fold);
  });
  ime.addEventListener('pointerdown', (e) => e.stopPropagation());
  stage.addEventListener('mousedown', (e) => { if (!e.target.closest('.ime')) e.preventDefault(); });

  function nodeMenu(x, y) {
    const n = selNode();
    if (!n) return;
    const isRoot = n === state.doc.root;
    showMenu(x, y, [
      { label: '添加子主题', icon: 'child', shortcut: 'Tab', action: addChild },
      { label: '添加同级主题', icon: 'sibling', shortcut: 'Enter', action: () => addSibling(false), disabled: isRoot },
      { label: '编辑文字', icon: 'edit', shortcut: 'F2', action: () => startEdit(false) },
      'sep',
      { label: n.collapsed ? '展开' : '折叠', icon: 'fold', shortcut: 'Space', action: () => toggleFold(n.id), disabled: !n.children.length || isRoot },
      { label: n.bold ? '取消加粗' : '加粗', icon: 'bold', shortcut: 'Ctrl+B', action: toggleBold },
      { label: '备注…', icon: 'note', action: () => { openSide('node'); setTimeout(() => $('#noteInput')?.focus(), 50); } },
      'sep',
      { label: '复制', icon: 'copy', shortcut: 'Ctrl+C', action: () => copySel(false) },
      { label: '剪切', icon: 'scissors', shortcut: 'Ctrl+X', action: () => copySel(true), disabled: isRoot },
      { label: '粘贴为子主题', icon: 'clipboard', shortcut: 'Ctrl+V', action: pasteFromMenu },
      'sep',
      { label: '删除', icon: 'trash', shortcut: 'Delete', action: deleteSel, disabled: isRoot },
    ]);
  }

  // 拖动节点：放在主题中间 = 成为它的子主题；放在边缘 = 插到它前面或后面
  function startDrag(e, id) {
    if (id === state.doc.root.id) return;
    const sx = e.clientX, sy = e.clientY;
    let dragging = false, ghost = null, drop = null, markEl = null;
    const clearMark = () => { if (markEl) markEl.classList.remove('drop-child', 'drop-before', 'drop-after'); markEl = null; };
    const move = (ev) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        if (state.editing) return;
        dragging = true;
        ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.textContent = findNode(state.doc.root, id).text || '主题';
        document.body.appendChild(ghost);
        nodeEls.get(id)?.classList.add('dragging');
      }
      ghost.style.left = ev.clientX + 'px';
      ghost.style.top = ev.clientY + 'px';
      clearMark();
      drop = null;
      const tEl = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.node');
      if (!tEl) return;
      const tid = tEl.dataset.id;
      const dragged = findNode(state.doc.root, id);
      if (tid === id || contains(dragged, tid)) return;
      let mode = 'child';
      if (tid !== state.doc.root.id) {
        const r = tEl.getBoundingClientRect();
        const f = state.vertical ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
        if (f < 0.25) mode = 'before'; else if (f > 0.75) mode = 'after';
      }
      drop = { tid, mode };
      markEl = tEl;
      tEl.classList.add('drop-' + mode);
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      if (ghost) ghost.remove();
      nodeEls.get(id)?.classList.remove('dragging');
      clearMark();
      if (dragging && drop) moveNode(id, drop);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  function moveNode(id, { tid, mode }) {
    const root = state.doc.root;
    const node = findNode(root, id), target = findNode(root, tid);
    if (!node || !target || contains(node, tid)) return;
    pushUndo();
    const from = findParent(root, id);
    from.children.splice(from.children.indexOf(node), 1);
    if (mode === 'child') {
      target.children.push(node);
      target.collapsed = false;
    } else {
      const tp = findParent(root, tid);
      tp.children.splice(tp.children.indexOf(target) + (mode === 'after' ? 1 : 0), 0, node);
    }
    markDirty();
    render();
    select(id);
  }

  /* ================= 编辑文字 ================= */
  function selNode() { return state.sel ? findNode(state.doc.root, state.sel) : null; }

  function startEdit(replace) {
    const n = selNode();
    if (!n) return;
    if (state.editing) return;
    state.editing = true;
    ime.value = replace ? '' : n.text;
    ime.classList.add('active');
    render();
    focusIme();
    if (!replace) ime.select();
  }
  function commitEdit() {
    if (!state.editing) return;
    const n = selNode();
    const text = ime.value.replace(/\s+$/, '').replace(/^\n+/, '');
    state.editing = false;
    ime.classList.remove('active');
    ime.value = '';
    if (n && text !== n.text) { pushUndo(); n.text = text; markDirty(); }
    render();
    if (state.sideTab === 'node') renderSide();
  }
  function cancelEdit() {
    if (!state.editing) return;
    state.editing = false;
    ime.classList.remove('active');
    ime.value = '';
    render();
  }

  ime.addEventListener('compositionstart', () => { if (!state.editing && state.sel) startEdit(true); });
  ime.addEventListener('input', () => {
    if (!state.editing) {
      if (!state.sel) { ime.value = ''; return; }
      const typed = ime.value;
      startEdit(true);
      ime.value = typed;
    }
    render();
  });
  ime.addEventListener('blur', () => {
    setTimeout(() => { if (state.editing && document.activeElement !== ime) commitEdit(); }, 0);
  });

  /* ================= 结构操作 ================= */
  function defaultText(depth) { return depth <= 1 ? '分支主题' : '子主题'; }
  function depthOf(id) { return state.info.get(id)?.depth ?? 0; }

  function addChild() {
    if (state.editing) commitEdit();
    const parent = selNode() || state.doc.root;
    pushUndo();
    const n = makeNode(defaultText(depthOf(parent.id) + 1));
    parent.collapsed = false;
    parent.children.push(n);
    afterInsert(n);
  }
  function addSibling(before) {
    if (state.editing) commitEdit();
    const cur = selNode();
    if (!cur) return;
    if (cur === state.doc.root) { addChild(); return; }
    const parent = findParent(state.doc.root, cur.id);
    pushUndo();
    const n = makeNode(defaultText(depthOf(cur.id)));
    parent.children.splice(parent.children.indexOf(cur) + (before ? 0 : 1), 0, n);
    afterInsert(n);
  }
  function afterInsert(n) {
    state.sel = n.id;
    markDirty();
    render();
    ensureVisible(n.id);
    startEdit(false);
  }
  function deleteSel() {
    if (state.editing) return;
    const n = selNode();
    if (!n) return;
    if (n === state.doc.root) { toast('中心主题不能删除'); return; }
    const parent = findParent(state.doc.root, n.id);
    const i = parent.children.indexOf(n);
    pushUndo();
    parent.children.splice(i, 1);
    const next = parent.children[i] || parent.children[i - 1] || parent;
    state.sel = next.id;
    markDirty();
    render();
    if (state.sideTab === 'node') renderSide();
  }
  function toggleFold(id) {
    const n = findNode(state.doc.root, id);
    if (!n || !n.children.length || n === state.doc.root) return;
    if (state.editing) commitEdit();
    pushUndo();
    n.collapsed = !n.collapsed;
    if (n.collapsed && state.sel && state.sel !== id && contains(n, state.sel)) state.sel = id;
    markDirty();
    render();
  }
  function setAllCollapsed(collapsed) {
    pushUndo();
    walk(state.doc.root, (n, p, d) => { if (d >= 1 && n.children.length) n.collapsed = collapsed; else delete n.collapsed; });
    if (collapsed && state.sel && depthOf(state.sel) > 1) state.sel = state.doc.root.id;
    markDirty();
    render();
    fitView(true);
  }
  function moveSibling(delta) {
    const n = selNode();
    if (!n || n === state.doc.root) return;
    const p = findParent(state.doc.root, n.id);
    const i = p.children.indexOf(n), j = i + delta;
    if (j < 0 || j >= p.children.length) return;
    pushUndo();
    p.children.splice(i, 1);
    p.children.splice(j, 0, n);
    markDirty();
    render();
    ensureVisible(n.id);
  }
  function toggleBold() {
    const n = selNode();
    if (!n) return;
    pushUndo();
    if (n.bold) delete n.bold; else n.bold = true;
    markDirty();
    render();
    renderSide();
  }
  function setColor(color) {
    const n = selNode();
    if (!n) return;
    pushUndo();
    if (color) n.color = color; else delete n.color;
    markDirty();
    render();
    renderSide();
  }

  /* ================= 剪贴板 ================= */
  function copySel(cut) {
    const n = selNode();
    if (!n) return null;
    state.clip = JSON.parse(JSON.stringify(n));
    const text = IO.toOutlineText(n);
    state.clipText = text;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(() => {});
    if (cut && n !== state.doc.root) deleteSel();
    toast(cut ? '已剪切' : '已复制');
    return text;
  }
  function pasteNodes(nodes) {
    if (!nodes.length) return;
    if (state.editing) commitEdit();
    const parent = selNode() || state.doc.root;
    pushUndo();
    parent.collapsed = false;
    nodes.forEach((n) => parent.children.push(n));
    state.sel = nodes[nodes.length - 1].id;
    markDirty();
    render();
    ensureVisible(state.sel);
  }
  function pasteText(text) {
    if (state.clip && text != null && text.replace(/\r/g, '') === state.clipText) { pasteNodes([cloneFresh(state.clip)]); return; }
    if (!text || !text.trim()) { if (state.clip && text == null) pasteNodes([cloneFresh(state.clip)]); return; }
    pasteNodes(IO.parseOutline(text));
  }
  async function pasteFromMenu() {
    let text = null;
    try { text = await navigator.clipboard.readText(); } catch { /* 无权限时用内部剪贴板 */ }
    pasteText(text);
  }
  document.addEventListener('copy', (e) => {
    if (!isMapFocus(e.target) || state.editing || !state.sel) return;
    e.preventDefault();
    const n = selNode();
    state.clip = JSON.parse(JSON.stringify(n));
    state.clipText = IO.toOutlineText(n);
    e.clipboardData.setData('text/plain', state.clipText);
  });
  document.addEventListener('cut', (e) => {
    if (!isMapFocus(e.target) || state.editing || !state.sel || state.sel === state.doc.root.id) return;
    e.preventDefault();
    const n = selNode();
    state.clip = JSON.parse(JSON.stringify(n));
    state.clipText = IO.toOutlineText(n);
    e.clipboardData.setData('text/plain', state.clipText);
    deleteSel();
  });
  document.addEventListener('paste', (e) => {
    if (!isMapFocus(e.target) || state.editing) return;
    e.preventDefault();
    pasteText(e.clipboardData.getData('text/plain'));
  });
  function isMapFocus(target) { return target === ime || target === document.body || target === stage; }

  /* ================= 键盘 ================= */
  function navigate(key) {
    if (!state.sel) { select(state.doc.root.id); return; }
    const cur = state.sel, v = state.info.get(cur), p = state.pos.get(cur);
    if (!v || !p) return;
    const [dx, dy] = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
    const vertical = state.vertical;
    const kids = v.n.collapsed ? [] : v.n.children.filter((c) => state.pos.has(c.id));
    const cc = (q) => (vertical ? q.x + q.w / 2 : q.y + q.h / 2);
    const nearest = (list) => list.reduce((best, c) => {
      const d = Math.abs(cc(state.pos.get(c.id)) - cc(p));
      return !best || d < best.d ? { id: c.id, d } : best;
    }, null)?.id;
    let target = null;
    const toward = vertical ? dy : dx; // 沿主轴方向
    if (toward) {
      const childSide = kids.filter((c) => (vertical ? toward > 0 : state.pos.get(c.id).dir === toward));
      if (childSide.length) target = nearest(childSide);
      else if (v.parent && (vertical ? toward < 0 : p.dir === -toward)) target = v.parent.id;
      else if (v.n.collapsed && v.n.children.length && (vertical ? toward > 0 : p.dir === toward)) { toggleFold(v.n.id); return; }
    }
    if (!target) target = spatial(cur, dx, dy);
    if (target) select(target);
  }
  function spatial(id, dx, dy) {
    const p = state.pos.get(id);
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    let best = null, bestScore = Infinity;
    for (const [oid, q] of state.pos) {
      if (oid === id) continue;
      const ox = q.x + q.w / 2 - cx, oy = q.y + q.h / 2 - cy;
      const along = ox * dx + oy * dy;
      if (along <= 4) continue;
      const cross = Math.abs(ox * dy) + Math.abs(oy * dx);
      const score = along + cross * 2.5;
      if (score < bestScore) { bestScore = score; best = oid; }
    }
    return best;
  }

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    const lower = key.length === 1 ? key.toLowerCase() : key;
    if (mod && lower === 's') { e.preventDefault(); save(e.shiftKey); return; }
    if (mod && lower === 'o') { e.preventDefault(); openFileFlow(); return; }
    if (key === 'Escape' && menuEl) { closeMenu(); return; }
    if (modalEl) { if (key === 'Escape') closeModal(); return; }
    if (!$('#home').hidden) { if (key === 'Escape') hideHome(); return; }
    const t = e.target;
    if (t !== ime && t.matches && t.matches('input, textarea, select, [contenteditable]')) {
      if (key === 'Escape') { t.blur(); focusIme(); }
      return;
    }

    if (state.editing) {
      if (e.isComposing || e.keyCode === 229) return;
      if (key === 'Enter' && !e.shiftKey && !e.altKey) { e.preventDefault(); commitEdit(); return; }
      if (key === 'Escape') { e.preventDefault(); cancelEdit(); return; }
      if (key === 'Tab') { e.preventDefault(); commitEdit(); addChild(); return; }
      return;
    }

    if (mod) {
      if (lower === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (lower === 'y') { e.preventDefault(); redo(); return; }
      if (lower === 'b') { e.preventDefault(); toggleBold(); return; }
      if (key === '=' || key === '+') { e.preventDefault(); zoomBy(1.2); return; }
      if (key === '-') { e.preventDefault(); zoomBy(1 / 1.2); return; }
      if (key === '0') { e.preventDefault(); fitView(true); return; }
      if (key === 'ArrowUp' || key === 'ArrowLeft') { e.preventDefault(); moveSibling(-1); return; }
      if (key === 'ArrowDown' || key === 'ArrowRight') { e.preventDefault(); moveSibling(1); return; }
      return; // Ctrl+C / V / X 交给 copy/paste 事件
    }
    if (e.altKey) return;

    switch (key) {
      case 'Tab': case 'Insert': e.preventDefault(); addChild(); return;
      case 'Enter': e.preventDefault(); if (!state.sel) select(state.doc.root.id); else addSibling(e.shiftKey); return;
      case 'Delete': case 'Backspace': e.preventDefault(); deleteSel(); return;
      case 'F2': e.preventDefault(); if (!state.sel) state.sel = state.doc.root.id; startEdit(false); return;
      case ' ': e.preventDefault(); if (state.sel) toggleFold(state.sel); return;
      case 'Home': e.preventDefault(); select(state.doc.root.id); return;
      case 'Escape': if (state.sel) { state.sel = null; refreshSelection(); } return;
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': e.preventDefault(); navigate(key); return;
    }
    // 直接打字 = 替换当前主题文字（含中文输入法）
    if ((key.length === 1 || key === 'Process') && state.sel) {
      if (t !== ime) focusIme();
      startEdit(true);
    }
  });

  /* ================= 文件 ================= */
  function loadDoc(doc, { handle = null, fileName = null, dirty = false } = {}) {
    if (state.editing) cancelEdit();
    state.doc = doc;
    state.handle = handle;
    state.fileName = fileName;
    state.dirty = dirty;
    state.undo = [];
    state.redo = [];
    state.sel = doc.root.id;
    nodeEls.forEach((el) => el.remove());
    nodeEls.clear();
    $('#docTitle').value = doc.title;
    sizeTitle();
    render();
    fitView();
    renderSide();
    localStorage.setItem('mm-last-id', doc.id);
    focusIme();
  }

  function newFromTemplate(tpl) {
    const doc = createDoc({ title: tpl.id === 'blank' ? '未命名导图' : tpl.name, theme: tpl.id === 'blank' ? (state.doc?.theme || 'classic') : tpl.theme, layout: tpl.layout, root: tpl.build() });
    if (saveTimer) persistRecent();
    loadDoc(doc);
    hideHome();
    if (tpl.id === 'blank') startEdit(false);
  }

  async function openFileFlow() {
    try {
      const r = await IO.pickOpen();
      if (r) await openFromFile(r.file, r.handle);
    } catch (e) {
      if (e.name !== 'AbortError') toast('打开失败：' + e.message, 'error');
    }
  }
  async function openFromFile(file, handle) {
    const ext = IO.ext(file.name);
    if (!IO.OPEN_EXT.includes(ext)) throw new Error(`不支持 ${ext || '这种'} 文件`);
    const { doc, native } = await IO.parseFile(file);
    if (saveTimer) await persistRecent();
    loadDoc(doc, { handle: native ? handle : null, fileName: native ? file.name : null, dirty: !native });
    hideHome();
    await persistRecent();
    if (native) toast(`已打开 ${file.name}`, 'success');
    else toast(`已导入 ${file.name}${doc._sheets > 1 ? `（共 ${doc._sheets} 张画布，已打开第 1 张）` : ''}，保存时会存成 .mindmap 文件`);
  }

  const fileNameFor = (ext) => (state.doc.title || '未命名导图').replace(/[\\/:*?"<>|]+/g, '_').trim() + ext;

  async function save(saveAs) {
    if (state.editing) commitEdit();
    const data = IO.serialize(state.doc);
    try {
      if (!saveAs && state.handle) {
        await IO.writeHandle(state.handle, data);
      } else if (IO.hasSavePicker) {
        const h = await IO.pickSave(fileNameFor('.mindmap'), data, '思维导图', 'application/json', '.mindmap');
        state.handle = h;
        state.fileName = h.name;
      } else {
        IO.download(new Blob([data], { type: 'application/json' }), fileNameFor('.mindmap'));
        state.fileName = fileNameFor('.mindmap');
      }
      state.dirty = false;
      updateSaveState();
      await persistRecent();
      toast(state.handle ? `已保存到 ${state.fileName}` : '已下载 .mindmap 文件', 'success');
    } catch (e) {
      if (e.name !== 'AbortError') toast('保存失败：' + e.message, 'error');
    }
  }

  /* 导出 */
  function buildSVG() {
    const t = getTheme(state.doc.theme);
    const b = layoutBounds(state.pos), pad = 40;
    const W = Math.ceil(b.w + pad * 2), H = Math.ceil(b.h + pad * 2);
    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${b.x - pad} ${b.y - pad} ${W} ${H}">`;
    s += `<rect x="${b.x - pad}" y="${b.y - pad}" width="${W}" height="${H}" fill="${t.bg}"/>`;
    s += linksSvg.innerHTML;
    for (const [id, v] of state.info) {
      const p = state.pos.get(id), st = v.style;
      if (st.fill || st.stroke) {
        const inset = st.stroke ? st.sw / 2 : 0;
        s += `<rect x="${p.x + inset}" y="${p.y + inset}" width="${p.w - inset * 2}" height="${p.h - inset * 2}" rx="${Math.min(st.r, p.h / 2 - inset)}" fill="${st.fill || 'none'}"${st.stroke ? ` stroke="${st.stroke}" stroke-width="${st.sw}"` : ''}/>`;
      }
      if (st.underline) s += `<line x1="${p.x}" x2="${p.x + p.w}" y1="${p.y + p.h - st.uw / 2}" y2="${p.y + p.h - st.uw / 2}" stroke="${st.uc}" stroke-width="${st.uw}"/>`;
      const lines = String(v.n.text).split('\n');
      lines.forEach((line, i) => {
        if (!line) return;
        s += `<text x="${p.x + p.w / 2}" y="${p.y + st.py + st.lh * (i + 0.5)}" text-anchor="middle" dominant-baseline="central" xml:space="preserve" font-family="${esc(st.font)}" font-size="${st.fs}" font-weight="${st.fw}" fill="${st.text}">${esc(line)}</text>`;
      });
    }
    $$('.fold.count', foldsLayer).forEach((f) => {
      const n = findNode(state.doc.root, f.dataset.fold), v = state.info.get(n.id), p = state.pos.get(n.id);
      const a = outAnchor(p, v.style, p.dir, state.vertical);
      const label = String(countDesc(n)), w = Math.max(18, label.length * 7 + 10);
      const cx = state.vertical ? a.x : a.x + p.dir * (4 + w / 2), cy = state.vertical ? a.y + 13 : a.y;
      const color = t.lineColor || v.color;
      s += `<rect x="${cx - w / 2}" y="${cy - 9}" width="${w}" height="18" rx="9" fill="${t.bg}" stroke="${color}" stroke-width="1.5"/>`;
      s += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="${esc(UI_FONT)}" font-size="10.5" font-weight="600" fill="${color}">${label}</text>`;
    });
    return { svg: s + '</svg>', W, H };
  }
  async function exportPNG() {
    if (state.editing) commitEdit();
    const { svg, W, H } = buildSVG();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('图片生成失败')); img.src = url; });
      const scale = Math.min(2, 16000 / Math.max(W, H));
      const c = document.createElement('canvas');
      c.width = Math.round(W * scale); c.height = Math.round(H * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      IO.download(blob, fileNameFor('.png'));
      toast('已导出 PNG 图片', 'success');
    } catch (e) { toast('导出失败：' + e.message, 'error'); }
    finally { URL.revokeObjectURL(url); }
  }
  function exportSVG() {
    if (state.editing) commitEdit();
    IO.download(new Blob([buildSVG().svg], { type: 'image/svg+xml' }), fileNameFor('.svg'));
    toast('已导出 SVG 矢量图', 'success');
  }
  function exportMarkdown() {
    if (state.editing) commitEdit();
    IO.download(new Blob([IO.toMarkdown(state.doc)], { type: 'text/markdown' }), fileNameFor('.md'));
    toast('已导出 Markdown', 'success');
  }

  /* 拖入文件 */
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('#dropOverlay').hidden = false; });
  addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').hidden = true; } });
  addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    $('#dropOverlay').hidden = true;
    const item = e.dataTransfer.items && e.dataTransfer.items[0];
    const handleP = item && item.getAsFileSystemHandle ? item.getAsFileSystemHandle().catch(() => null) : Promise.resolve(null);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    try {
      const handle = await handleP;
      await openFromFile(file, handle && handle.kind === 'file' ? handle : null);
    } catch (err) { toast('打开失败：' + err.message, 'error'); }
  });

  /* ================= 主页 ================= */
  function showHome() {
    if (state.editing) commitEdit();
    closeMenu();
    const grid = $('#tplGrid');
    grid.innerHTML = '';
    TEMPLATES.forEach((tpl, i) => {
      const b = document.createElement('button');
      b.className = 'tpl-card';
      b.style.animationDelay = i * 40 + 'ms';
      const thumb = tpl.id === 'blank' ? `<div class="tpl-thumb blank">${icon('plus', 34)}</div>` : `<div class="tpl-thumb">${themePreview(getTheme(tpl.theme), 160, 100)}</div>`;
      b.innerHTML = `${thumb}<div class="tpl-name">${esc(tpl.name)}</div><div class="tpl-desc">${esc(tpl.desc)}</div>`;
      b.onclick = () => newFromTemplate(tpl);
      grid.appendChild(b);
    });
    $('#home').hidden = false;
    renderRecents();
  }
  function hideHome() { $('#home').hidden = true; focusIme(); }

  const fmtTime = (ts) => {
    const d = new Date(ts), now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (d.toDateString() === now.toDateString()) return '今天 ' + hm;
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return '昨天 ' + hm;
    return `${d.getFullYear() === now.getFullYear() ? '' : d.getFullYear() + '/'}${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  };

  async function renderRecents() {
    const box = $('#recentList');
    let list = [];
    try { list = await IO.recents.all(); } catch { /* 无痕模式等情况下不可用 */ }
    list.sort((a, b) => b.time - a.time);
    if (!list.length) {
      box.innerHTML = `<div class="empty">${icon('clipboard', 34)}还没有最近的导图</div>`;
      return;
    }
    box.innerHTML = '';
    list.forEach((e) => {
      const row = document.createElement('div');
      row.className = 'row';
      const status = e.dirty ? `<span class="status warn">${e.fileName ? '有未保存的改动' : '仅浏览器草稿'}</span>` : e.fileName ? `<span class="status ok">${esc(e.fileName)}</span>` : '';
      row.innerHTML = `<div class="app-ico">${icon('map', 18)}</div>
        <div class="row-main"><div class="row-title">${esc(e.title || '未命名导图')}</div>
        <div class="row-sub"><span>${fmtTime(e.time)}</span><span>${e.count || ''}${e.count ? ' 个主题' : ''}</span>${status}</div></div>
        <div class="actions"><button class="icon-btn" title="从列表中移除">${icon('x', 16)}</button></div>`;
      row.onclick = () => openRecent(e);
      $('.actions button', row).onclick = async (ev) => {
        ev.stopPropagation();
        if (e.dirty) {
          const ok = await confirmDialog({ title: '移除这张导图？', message: `“${e.title}”有改动还没有保存到文件，移除后这些草稿无法找回。`, okText: '移除', danger: true, iconName: 'trash' });
          if (!ok) return;
        }
        await IO.recents.del(e.id);
        if (state.doc && state.doc.id === e.id) { state.dirty = true; updateSaveState(); }
        renderRecents();
      };
      box.appendChild(row);
    });
  }

  async function openRecent(entry) {
    if (state.doc && entry.id === state.doc.id) { hideHome(); return; }
    let doc;
    try { doc = normalizeDoc(entry.data); } catch (e) { toast('这条记录已损坏：' + e.message, 'error'); return; }
    if (entry.handle && !entry.dirty) {
      try {
        let perm = await entry.handle.queryPermission({ mode: 'read' });
        if (perm !== 'granted') perm = await entry.handle.requestPermission({ mode: 'read' });
        if (perm === 'granted') {
          const r = await IO.parseFile(await entry.handle.getFile());
          doc = r.doc;
          doc.id = entry.id;
        }
      } catch { /* 文件被移动或删除时，使用缓存的内容 */ }
    }
    if (saveTimer) await persistRecent();
    loadDoc(doc, { handle: entry.handle || null, fileName: entry.fileName || null, dirty: !!entry.dirty });
    hideHome();
    persistRecent();
  }

  /* ================= 侧边面板 ================= */
  const LAYOUT_ICONS = {
    mindmap: '<rect x="25" y="16" width="14" height="8" rx="2" fill="currentColor"/><path d="M25 20C18 20 18 8 11 8M25 20C18 20 18 32 11 32M39 20c7 0 7-12 14-12M39 20c7 0 7 12 14 12" stroke="currentColor" stroke-width="1.6" fill="none"/><rect x="3" y="5" width="8" height="6" rx="1.5" fill="currentColor" opacity=".45"/><rect x="3" y="29" width="8" height="6" rx="1.5" fill="currentColor" opacity=".45"/><rect x="53" y="5" width="8" height="6" rx="1.5" fill="currentColor" opacity=".45"/><rect x="53" y="29" width="8" height="6" rx="1.5" fill="currentColor" opacity=".45"/>',
    right: '<rect x="4" y="16" width="14" height="8" rx="2" fill="currentColor"/><path d="M18 20c8 0 8-13 16-13M18 20h16M18 20c8 0 8 13 16 13" stroke="currentColor" stroke-width="1.6" fill="none"/><rect x="34" y="4" width="16" height="6" rx="1.5" fill="currentColor" opacity=".45"/><rect x="34" y="17" width="20" height="6" rx="1.5" fill="currentColor" opacity=".45"/><rect x="34" y="30" width="14" height="6" rx="1.5" fill="currentColor" opacity=".45"/>',
    left: '<rect x="46" y="16" width="14" height="8" rx="2" fill="currentColor"/><path d="M46 20c-8 0-8-13-16-13M46 20H30M46 20c-8 0-8 13-16 13" stroke="currentColor" stroke-width="1.6" fill="none"/><rect x="14" y="4" width="16" height="6" rx="1.5" fill="currentColor" opacity=".45"/><rect x="10" y="17" width="20" height="6" rx="1.5" fill="currentColor" opacity=".45"/><rect x="16" y="30" width="14" height="6" rx="1.5" fill="currentColor" opacity=".45"/>',
    down: '<rect x="24" y="3" width="16" height="8" rx="2" fill="currentColor"/><path d="M32 11v7M10 18h44M10 18v8M32 18v8M54 18v8" stroke="currentColor" stroke-width="1.6" fill="none"/><rect x="3" y="26" width="14" height="7" rx="1.5" fill="currentColor" opacity=".45"/><rect x="25" y="26" width="14" height="7" rx="1.5" fill="currentColor" opacity=".45"/><rect x="47" y="26" width="14" height="7" rx="1.5" fill="currentColor" opacity=".45"/>',
  };

  function renderSide() {
    if (!state.doc) return;
    const body = $('#sideBody');
    $$('#sideTabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.sideTab));
    const doc = state.doc;
    if (state.sideTab === 'theme') {
      const light = THEMES.filter((t) => !t.dark), dark = THEMES.filter((t) => t.dark);
      const card = (t) => `<button class="theme-card${t.id === doc.theme ? ' active' : ''}" data-theme="${t.id}"><div class="theme-thumb">${themePreview(t)}</div><span class="theme-name">${esc(t.name)}</span></button>`;
      body.innerHTML = `<div class="side-label">浅色</div><div class="theme-grid">${light.map(card).join('')}</div>
        <div class="side-label">深色</div><div class="theme-grid">${dark.map(card).join('')}</div>`;
    } else if (state.sideTab === 'structure') {
      const ls = doc.lineStyle;
      body.innerHTML = `<div class="side-label">布局</div><div class="layout-grid">${LAYOUTS.map((l) => `<button class="layout-card${l.id === doc.layout ? ' active' : ''}" data-layout="${l.id}" title="${esc(l.desc)}"><svg viewBox="0 0 64 40">${LAYOUT_ICONS[l.id]}</svg><span>${esc(l.name)}</span></button>`).join('')}</div>
        <div class="side-label">连线</div>
        <div class="seg full">${[[null, '跟随主题'], ['curve', '曲线'], ['elbow', '直角'], ['straight', '直线']].map(([v, n]) => `<button data-line="${v || ''}" class="${(ls || null) === v ? 'active' : ''}">${n}</button>`).join('')}</div>
        <div class="side-label">展开</div>
        <div class="chip-row"><button class="chip" data-expand="1">全部展开</button><button class="chip" data-expand="0">只显示一级主题</button></div>`;
    } else {
      const n = selNode();
      if (!n) { body.innerHTML = `<div class="side-empty">${icon('target', 34)}先在画布上选中一个主题，<br>再来设置它的样式。</div>`; return; }
      const t = getTheme(doc.theme);
      const palette = [...new Set([...t.colors, ...EXTRA_COLORS])];
      const isRoot = n === doc.root;
      body.innerHTML = `<div class="side-label">文字</div>
        <div class="chip-row"><button class="chip${n.bold ? ' active' : ''}" data-act="bold">${icon('bold', 14)}加粗</button>
        <button class="chip" data-act="edit">${icon('edit', 14)}编辑文字</button></div>
        <div class="side-label">${isRoot ? '中心主题颜色' : '分支颜色'}</div>
        <div class="swatches"><button class="swatch-btn auto${n.color ? '' : ' active'}" data-color="">跟随主题</button>
        ${palette.map((c) => `<button class="swatch-btn${n.color === c ? ' active' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>
        ${isRoot ? '' : '<p class="side-tip">颜色会作用到这个主题和它下面所有的子主题。</p>'}
        <div class="side-label">备注</div>
        <textarea class="input note-input" id="noteInput" placeholder="给这个主题写点备注，鼠标悬停时会显示">${esc(n.note || '')}</textarea>`;
      const note = $('#noteInput'), nid = n.id;
      let pushed = false;
      note.addEventListener('input', () => {
        const cur = findNode(state.doc.root, nid);
        if (!cur) return;
        if (!pushed) { pushUndo(); pushed = true; }
        const v = note.value.trim();
        if (v) cur.note = v; else delete cur.note;
        markDirty();
        render();
      });
    }
  }

  $('#sideBody').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const doc = state.doc;
    if (b.dataset.theme) {
      if (doc.theme === b.dataset.theme) return;
      pushUndo(); doc.theme = b.dataset.theme; markDirty(); render(); renderSide();
    } else if (b.dataset.layout) {
      if (doc.layout === b.dataset.layout) return;
      pushUndo(); doc.layout = b.dataset.layout; markDirty(); render(); renderSide(); fitView(true);
    } else if (b.dataset.line !== undefined) {
      const v = b.dataset.line || null;
      if ((doc.lineStyle || null) === v) return;
      pushUndo(); doc.lineStyle = v; markDirty(); render(); renderSide();
    } else if (b.dataset.expand !== undefined) {
      setAllCollapsed(b.dataset.expand === '0');
    } else if (b.dataset.color !== undefined) {
      setColor(b.dataset.color || null);
    } else if (b.dataset.act === 'bold') {
      toggleBold();
    } else if (b.dataset.act === 'edit') {
      startEdit(false);
    }
  });
  $('#sideTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    state.sideTab = b.dataset.tab;
    renderSide();
  });
  function openSide(tab) {
    if (tab) state.sideTab = tab;
    $('#side').hidden = false;
    $('#btnPanel').classList.add('active');
    localStorage.setItem('mm-side', '1');
    renderSide();
  }
  function toggleSide() {
    const side = $('#side');
    if (side.hidden) openSide();
    else { side.hidden = true; $('#btnPanel').classList.remove('active'); localStorage.setItem('mm-side', '0'); }
  }

  /* ================= 帮助 ================= */
  function showHelp() {
    const k = (...keys) => `<span class="k">${keys.map((x) => `<kbd>${esc(x)}</kbd>`).join('')}</span>`;
    const rows = (list) => list.map(([keys, label]) => `${k(...keys)}<span>${esc(label)}</span>`).join('');
    openModal({
      title: '快捷键', width: 640,
      body: `<div class="keys-wrap"><div><div class="keys-title">编辑</div><div class="keys">${rows([
        [['Tab'], '添加子主题'], [['Enter'], '添加同级主题'], [['Shift', 'Enter'], '在上方添加同级主题'],
        [['F2'], '编辑文字（也可以双击，或直接打字）'], [['Delete'], '删除主题'], [['Space'], '折叠 / 展开'],
        [['Ctrl', 'B'], '加粗'], [['Ctrl', '↑ ↓'], '调整顺序'], [['Ctrl', 'C / X / V'], '复制 / 剪切 / 粘贴'],
        [['Ctrl', 'Z'], '撤销'], [['Ctrl', 'Y'], '重做'],
      ])}</div></div><div><div class="keys-title">浏览与文件</div><div class="keys">${rows([
        [['← ↑ → ↓'], '在主题之间移动'], [['Home'], '回到中心主题'], [['滚轮'], '平移画布'], [['Ctrl', '滚轮'], '缩放'],
        [['Ctrl', '0'], '适应窗口'], [['Ctrl', 'S'], '保存'], [['Ctrl', 'Shift', 'S'], '另存为'], [['Ctrl', 'O'], '打开文件'],
      ])}</div><p class="side-tip" style="margin-top:16px">编辑文字时按 Shift+Enter 换行。拖动主题可以改变它的位置：放在别的主题中间成为子主题，放在上下边缘则插到前后。</p></div></div>`,
    });
  }

  /* ================= 顶栏与按钮 ================= */
  function sizeTitle() {
    const inp = $('#docTitle');
    const c = sizeTitle.c || (sizeTitle.c = document.createElement('canvas').getContext('2d'));
    c.font = `600 15px ${UI_FONT}`;
    inp.style.width = Math.ceil(c.measureText(inp.value || '未命名导图').width + 22) + 'px';
  }
  $('#docTitle').addEventListener('input', sizeTitle);
  $('#docTitle').addEventListener('change', () => {
    const v = $('#docTitle').value.trim() || '未命名导图';
    $('#docTitle').value = v;
    sizeTitle();
    if (v !== state.doc.title) { state.doc.title = v; markDirty(); }
  });
  $('#docTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); focusIme(); } });

  $('#btnHome').onclick = showHome;
  $('#btnNew').onclick = showHome;
  $('#btnOpen').onclick = openFileFlow;
  $('#btnSave').onclick = () => save(false);
  $('#btnUndo').onclick = undo;
  $('#btnRedo').onclick = redo;
  $('#btnPanel').onclick = toggleSide;
  $('#sideClose').onclick = toggleSide;
  $('#btnHelp').onclick = showHelp;
  $('#btnDark').onclick = () => { localStorage.setItem('mm-ui-theme', uiDark() ? 'light' : 'dark'); applyUITheme(); };
  $('#btnExport').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.left, r.bottom + 6, [
      { label: '导出为 PNG 图片', icon: 'image', action: exportPNG },
      { label: '导出为 SVG 矢量图', icon: 'vector', action: exportSVG },
      { label: '导出为 Markdown', icon: 'fileText', action: exportMarkdown },
      'sep',
      { label: '另存为 .mindmap…', icon: 'save', shortcut: 'Ctrl+Shift+S', action: () => save(true) },
    ]);
  };
  $('#homeOpen').onclick = openFileFlow;
  $('#homeClose').onclick = hideHome;
  $('#fbChild').onclick = addChild;
  $('#fbSibling').onclick = () => addSibling(false);
  $('#fbDelete').onclick = deleteSel;
  $('#zoomIn').onclick = () => zoomBy(1.2);
  $('#zoomOut').onclick = () => zoomBy(1 / 1.2);
  $('#zoomFit').onclick = () => fitView(true);
  $('#zoomLabel').onclick = resetZoom;
  $$('.float-bar button, .tb-actions button').forEach((b) => b.addEventListener('pointerup', () => setTimeout(focusIme, 0)));

  /* ================= 启动 ================= */
  (async () => {
    hydrateIcons();
    applyUITheme();
    const sidePref = localStorage.getItem('mm-side');
    if (sidePref === '0' || (sidePref === null && innerWidth < 760)) $('#side').hidden = true;
    else $('#btnPanel').classList.add('active');

    let entry = null;
    const last = localStorage.getItem('mm-last-id');
    try { if (last) entry = await IO.recents.get(last); } catch { /* ignore */ }
    if (entry) {
      try {
        loadDoc(normalizeDoc(entry.data), { handle: entry.handle || null, fileName: entry.fileName || null, dirty: !!entry.dirty });
        return;
      } catch { /* 记录损坏时新建 */ }
    }
    loadDoc(createDoc({ root: TEMPLATES[0].build() }));
    showHome();
  })();
  addEventListener('resize', () => placeEditor());
})();
