'use strict';
/* 文件读写、格式导入、最近文件（IndexedDB） */
const IO = (() => {
  const hasOpenPicker = typeof window.showOpenFilePicker === 'function';
  const hasSavePicker = typeof window.showSaveFilePicker === 'function';
  const OPEN_EXT = ['.mindmap', '.json', '.xmind', '.km', '.mm', '.opml', '.md', '.markdown', '.txt'];

  /* ---------- 最近文件 ---------- */
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open('mindmap-studio', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('recents', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction('recents', mode);
      const req = fn(t.objectStore('recents'));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  const recents = {
    async put(e) {
      try { return await tx('readwrite', (s) => s.put(e)); }
      catch (err) { // 某些浏览器不能存文件句柄，退而只存内容
        if (e.handle) return tx('readwrite', (s) => s.put({ ...e, handle: null }));
        throw err;
      }
    },
    get: (id) => tx('readonly', (s) => s.get(id)),
    del: (id) => tx('readwrite', (s) => s.delete(id)),
    all: () => tx('readonly', (s) => s.getAll()),
  };

  /* ---------- 打开 ---------- */
  function pickViaInput() {
    return new Promise((resolve) => {
      const input = document.getElementById('fileInput');
      input.value = '';
      input.onchange = () => resolve(input.files[0] ? { file: input.files[0], handle: null } : null);
      input.click();
    });
  }
  async function pickOpen() {
    if (!hasOpenPicker) return pickViaInput();
    const [handle] = await window.showOpenFilePicker({
      types: [{
        description: '思维导图文件',
        accept: {
          'application/json': ['.mindmap', '.json', '.km'],
          'application/zip': ['.xmind'],
          'text/xml': ['.mm', '.opml'],
          'text/markdown': ['.md', '.markdown'],
          'text/plain': ['.txt'],
        },
      }],
    });
    return { file: await handle.getFile(), handle };
  }

  const ext = (name) => { const m = /\.[^.]+$/.exec(name || ''); return m ? m[0].toLowerCase() : ''; };
  const baseName = (name) => String(name || '未命名导图').replace(/\.[^.]+$/, '');

  /* 返回 { doc, native }，native 表示是本工具自己的格式，可以直接保存回原文件 */
  async function parseFile(file) {
    const e = ext(file.name), title = baseName(file.name);
    if (e === '.xmind') return { doc: await parseXMind(await file.arrayBuffer(), title), native: false };
    const text = await file.text();
    if (e === '.mm') return { doc: parseFreeMind(text, title), native: false };
    if (e === '.opml') return { doc: parseOPML(text, title), native: false };
    if (e === '.md' || e === '.markdown' || e === '.txt') return { doc: outlineDoc(text, title), native: false };
    let obj;
    try { obj = JSON.parse(text); }
    catch { throw new Error('文件内容不是有效的 JSON'); }
    if (obj && obj.format === 'mindmap' && obj.root) return { doc: normalizeDoc(obj), native: true };
    if (obj && obj.root && typeof obj.root.text === 'string' && !obj.root.data) {
      return { doc: normalizeDoc({ ...obj, title: obj.title || title }), native: e === '.mindmap' };
    }
    const tree = genericTree(obj);
    if (!tree) throw new Error('无法识别这个文件里的导图结构');
    return { doc: createDoc({ title, root: tree }), native: false };
  }

  /* 识别常见 JSON 导图格式：百度脑图 .km、jsMind、Mind Elixir、XMind content.json */
  function genericTree(obj) {
    if (Array.isArray(obj) && obj[0] && obj[0].rootTopic) return xmindTopic(obj[0].rootTopic);
    const start = obj && (obj.root || obj.nodeData || (obj.data && (obj.data.topic || obj.data.children) ? obj.data : null) || obj);
    if (!start || typeof start !== 'object') return null;
    const conv = (o, depth) => {
      if (!o || typeof o !== 'object' || depth > 200) return makeNode('');
      const d = o.data && typeof o.data === 'object' ? o.data : {};
      const text = o.text ?? o.topic ?? o.title ?? o.name ?? d.text ?? d.topic ?? '';
      const n = makeNode(String(text));
      const kids = Array.isArray(o.children) ? o.children : (o.children && Array.isArray(o.children.attached) ? o.children.attached : []);
      n.children = kids.map((k) => conv(k, depth + 1));
      if (n.children.length && (o.expanded === false || d.expandState === 'collapse')) n.collapsed = true;
      const note = d.note || o.note;
      if (note && typeof note === 'string') n.note = note;
      return n;
    };
    const root = conv(start, 0);
    if (!root.text && !root.children.length) return null;
    return root;
  }

  function xmindTopic(t) {
    const n = makeNode(String(t.title ?? ''));
    const kids = (t.children && t.children.attached) || [];
    n.children = kids.map(xmindTopic);
    if (t.branch === 'folded' && n.children.length) n.collapsed = true;
    const note = t.notes && t.notes.plain && t.notes.plain.content;
    if (note) n.note = String(note);
    return n;
  }

  async function parseXMind(buf, title) {
    const zip = await unzip(buf);
    const json = await zip.read('content.json');
    if (json) {
      const sheets = JSON.parse(json);
      if (!Array.isArray(sheets) || !sheets[0]) throw new Error('XMind 文件里没有画布');
      const doc = createDoc({ title: sheets[0].title && sheets.length > 1 ? `${title} - ${sheets[0].title}` : title, root: xmindTopic(sheets[0].rootTopic) });
      doc._sheets = sheets.length;
      return doc;
    }
    const xml = await zip.read('content.xml');
    if (!xml) throw new Error('不是可识别的 XMind 文件');
    const dom = new DOMParser().parseFromString(xml, 'text/xml');
    const kids = (el, name) => Array.from(el.children).filter((c) => c.localName === name);
    const conv = (topic) => {
      const titleEl = kids(topic, 'title')[0];
      const n = makeNode(titleEl ? titleEl.textContent : '');
      const ch = kids(topic, 'children')[0];
      if (ch) kids(ch, 'topics').filter((ts) => (ts.getAttribute('type') || 'attached') === 'attached')
        .forEach((ts) => kids(ts, 'topic').forEach((c) => n.children.push(conv(c))));
      if (topic.getAttribute('branch') === 'folded' && n.children.length) n.collapsed = true;
      const notes = kids(topic, 'notes')[0];
      const plain = notes && kids(notes, 'plain')[0];
      if (plain && plain.textContent.trim()) n.note = plain.textContent.trim();
      return n;
    };
    const sheet = dom.getElementsByTagNameNS('*', 'sheet')[0];
    const topic = sheet && kids(sheet, 'topic')[0];
    if (!topic) throw new Error('XMind 文件里没有主题');
    return createDoc({ title, root: conv(topic) });
  }

  /* 极简 zip 读取（只读中央目录 + deflate） */
  async function unzip(buf) {
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 XMind（zip）文件');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    const dec = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      files[dec.decode(new Uint8Array(buf, p + 46, nlen))] = { method, csize, off };
      p += 46 + nlen + xlen + clen;
    }
    return {
      async read(name) {
        const f = files[name];
        if (!f) return null;
        const start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true);
        const data = new Uint8Array(buf, start, f.csize);
        if (f.method === 0) return dec.decode(data);
        if (f.method !== 8) throw new Error('不支持的压缩方式');
        if (typeof DecompressionStream !== 'function') throw new Error('当前浏览器不支持解压 XMind 文件，请换用新版 Chrome / Edge');
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Response(stream).text();
      },
    };
  }

  function parseFreeMind(text, title) {
    const dom = new DOMParser().parseFromString(text, 'text/xml');
    const conv = (el) => {
      let t = el.getAttribute('TEXT');
      if (t == null) { const rc = el.querySelector(':scope > richcontent'); t = rc ? rc.textContent.trim() : ''; }
      const n = makeNode(t);
      n.children = Array.from(el.children).filter((c) => c.nodeName === 'node').map(conv);
      if (el.getAttribute('FOLDED') === 'true' && n.children.length) n.collapsed = true;
      return n;
    };
    const first = dom.querySelector('map > node');
    if (!first) throw new Error('不是有效的 FreeMind 文件');
    return createDoc({ title, root: conv(first) });
  }

  function parseOPML(text, title) {
    const dom = new DOMParser().parseFromString(text, 'text/xml');
    const body = dom.querySelector('body');
    if (!body) throw new Error('不是有效的 OPML 文件');
    const conv = (el) => {
      const n = makeNode(el.getAttribute('text') || el.getAttribute('title') || '');
      n.children = Array.from(el.children).filter((c) => c.nodeName === 'outline').map(conv);
      const note = el.getAttribute('_note');
      if (note) n.note = note;
      return n;
    };
    const tops = Array.from(body.children).filter((c) => c.nodeName === 'outline').map(conv);
    const head = dom.querySelector('head > title');
    const docTitle = (head && head.textContent.trim()) || title;
    if (tops.length === 1) return createDoc({ title: docTitle, root: tops[0] });
    const root = makeNode(docTitle); root.children = tops;
    return createDoc({ title: docTitle, root });
  }

  /* Markdown / 缩进文本 → 节点数组（顶层） */
  function parseOutline(text) {
    const clean = (s) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/`([^`]+)`/g, '$1')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^\[[ xX]\]\s+/, '').trim();
    const items = [];
    let heading = -1, indents = [], inCode = false;
    for (const raw of String(text).replace(/\r/g, '').split('\n')) {
      if (/^\s*```/.test(raw)) { inCode = !inCode; continue; }
      if (inCode || !raw.trim() || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) continue;
      const ind = raw.match(/^[\t ]*/)[0].replace(/\t/g, '    ').length;
      const s = raw.trim();
      let m;
      if ((m = s.match(/^(#{1,6})\s+(.*)$/))) { heading = m[1].length - 1; indents = []; items.push({ lv: heading, text: clean(m[2]) }); continue; }
      const body = (m = s.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/)) ? m[1] : s.replace(/^>\s?/, '');
      while (indents.length && ind < indents[indents.length - 1]) indents.pop();
      if (!indents.length || ind > indents[indents.length - 1]) indents.push(ind);
      items.push({ lv: heading + indents.length, text: clean(body) });
    }
    const tops = [], stack = [];
    for (const it of items) {
      const n = makeNode(it.text);
      while (stack.length && stack[stack.length - 1].lv >= it.lv) stack.pop();
      if (stack.length) stack[stack.length - 1].n.children.push(n); else tops.push(n);
      stack.push({ lv: it.lv, n });
    }
    return tops;
  }
  function outlineDoc(text, title) {
    const tops = parseOutline(text);
    if (!tops.length) throw new Error('文件里没有内容');
    if (tops.length === 1) return createDoc({ title: tops[0].text || title, root: tops[0] });
    const root = makeNode(title); root.children = tops;
    return createDoc({ title, root });
  }

  /* ---------- 保存 / 导出 ---------- */
  function serialize(doc) {
    const { _sheets, ...rest } = doc;
    return JSON.stringify(rest, null, 2);
  }
  async function writeHandle(handle, data) {
    if (handle.queryPermission && (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
      if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('没有写入文件的权限');
    }
    const w = await handle.createWritable();
    await w.write(data);
    await w.close();
  }
  async function pickSave(name, data, desc, mime, extName) {
    const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: desc, accept: { [mime]: [extName] } }] });
    await writeHandle(handle, data);
    return handle;
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  function toMarkdown(doc) {
    const out = [];
    const one = (s) => String(s).replace(/\n+/g, ' ');
    walk(doc.root, (n, p, d) => {
      if (d === 0) out.push(`# ${one(n.text)}`, '');
      else if (d === 1) out.push('', `## ${one(n.text)}`, '');
      else out.push(`${'  '.repeat(d - 2)}- ${one(n.text)}`);
      if (n.note) out.push(d >= 2 ? `${'  '.repeat(d - 1)}> ${one(n.note)}` : `> ${one(n.note)}`);
    });
    return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
  }
  function toOutlineText(node) {
    const out = [];
    walk(node, (n, p, d) => out.push('\t'.repeat(d) + String(n.text).replace(/\n+/g, ' ')));
    return out.join('\n');
  }

  return { hasOpenPicker, hasSavePicker, OPEN_EXT, recents, pickOpen, parseFile, parseOutline, serialize, writeHandle, pickSave, download, toMarkdown, toOutlineText, ext };
})();
