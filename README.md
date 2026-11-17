# 思维导图

一个在浏览器里运行的思维导图工具。纯 HTML / CSS / JavaScript，不需要安装依赖，也不需要构建。

## 使用

- **直接打开**：双击 `index.html` 即可使用。
- **本地服务器（推荐）**：在项目目录运行 `python -m http.server 5173`，然后访问 <http://localhost:5173>。这样“保存”可以直接写回原文件（Chrome / Edge）。

## 功能

- **新建**：空白导图，或从模板开始（项目规划、读书笔记、SWOT 分析、周计划）。
- **打开已有文件**：`.mindmap`（本工具格式）、XMind（`.xmind`）、百度脑图（`.km`）、FreeMind（`.mm`）、OPML、Markdown / 缩进文本。也可以把文件直接拖进窗口。
- **保存**：在 Chrome / Edge 中按 `Ctrl+S` 会直接写回原文件，其他浏览器会下载 `.mindmap` 文件。编辑过程中会自动保存草稿到浏览器，关掉页面也不会丢；主页的“最近”列表里可以找回。
- **主题**：11 套导图主题（简约、经典彩虹、海洋、森林、暖阳、纸张、商务、糖果、黑白、暗夜、霓虹），界面本身也支持浅色和深色。
- **结构**：思维导图（左右平衡）、向右 / 向左逻辑图、组织结构图；连线可选曲线、直角、直线。
- **节点**：加粗、分支颜色、备注、折叠 / 展开、拖动调整位置、复制粘贴（可粘贴多行缩进文本）。
- **导出**：PNG 图片、SVG 矢量图、Markdown。

## 快捷键

| 操作 | 按键 |
| --- | --- |
| 添加子主题 / 同级主题 | `Tab` / `Enter` |
| 编辑文字 | `F2`、双击，或者直接打字（支持中文输入法） |
| 换行 | 编辑时 `Shift+Enter` |
| 删除 | `Delete` |
| 折叠 / 展开 | `Space` |
| 在主题之间移动 | 方向键 |
| 调整顺序 | `Ctrl+↑ / ↓` |
| 撤销 / 重做 | `Ctrl+Z` / `Ctrl+Y` |
| 保存 / 另存为 / 打开 | `Ctrl+S` / `Ctrl+Shift+S` / `Ctrl+O` |
| 缩放 / 适应窗口 | `Ctrl+滚轮`、`Ctrl+= / -` / `Ctrl+0` |

## 文件格式

`.mindmap` 是 UTF-8 编码的 JSON：

```json
{
  "format": "mindmap",
  "version": 1,
  "title": "示例",
  "theme": "classic",
  "layout": "mindmap",
  "root": { "id": "a1", "text": "中心主题", "children": [ { "id": "b2", "text": "分支", "children": [] } ] }
}
```

节点可选字段：`collapsed`（折叠）、`bold`（加粗）、`color`（分支颜色，如 `#1c7ed6`）、`note`（备注）。

## 代码结构

```
index.html        页面骨架
css/tokens.css    设计变量与基础组件
css/app.css       界面样式
js/icons.js       图标
js/themes.js      导图主题与节点样式
js/model.js       数据模型与模板
js/layout.js      布局算法与连线
js/io.js          打开 / 保存 / 导入导出 / 最近文件
js/app.js         渲染与交互
```
