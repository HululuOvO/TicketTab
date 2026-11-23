'use strict';

const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const kbRoot = path.resolve(appRoot, '..', 'TicketTab-Knowledge-Pack');
fs.mkdirSync(kbRoot, { recursive: true });

const files = [
  'package.json',
  'README.md',
  '.github/workflows/release.yml',
  'assets/logo.svg',
  'src/shared/date-parser.js',
  'src/shared/store.js',
  'src/main/ai-bridge.js',
  'src/main/main.js',
  'src/preload/preload.js',
  'src/renderer/index.html',
  'src/renderer/styles.css',
  'src/renderer/sound.js',
  'src/renderer/renderer.js',
  'mcp/mcp-server.js',
  'scripts/generate-icons.js',
  'tests/store.test.js'
];

const extLang = { '.json': 'json', '.js': 'js', '.html': 'html', '.css': 'css', '.md': 'markdown', '.yml': 'yaml', '.svg': 'xml' };

let archive = '# TicketTab 分册 04 · 完整可运行源码归档（v2 零遗漏）\n\n';
archive += '> 收录 TicketTab 全部核心源码（含自然语言日期解析、多日存储、本地 HTTP 网关、标准 MCP Server、热敏火烤消字动效、图标生成与单元测试）。\n\n';

for (const rel of files) {
  const full = path.join(appRoot, rel);
  const content = fs.readFileSync(full, 'utf8').trimEnd();
  const lang = extLang[path.extname(rel)] || '';
  archive += `---\n\n## \`${rel}\`\n\n\`\`\`${lang}\n${content}\n\`\`\`\n\n`;
}

const archivePath = path.join(kbRoot, '04-完整可运行源码归档.md');
fs.writeFileSync(archivePath, archive, 'utf8');

const parts = [
  '00-TicketTab-AI知识库完整蒸馏总册.md',
  '01-架构蓝图与状态机.md',
  '02-UI规范与零冗余自检清单.md',
  '03-AI复用与二开提示词库.md',
  '04-完整可运行源码归档.md'
];

const mega = parts
  .map((name) => fs.readFileSync(path.join(kbRoot, name), 'utf8').trimEnd())
  .join('\n\n---\n\n');

const allInOnePath = path.join(kbRoot, 'TicketTab-AllInOne-知识库一键导入版.md');
fs.writeFileSync(allInOnePath, mega + '\n', 'utf8');

console.log('Exported v2 knowledge pack:', allInOnePath);
