// 控制面板的命令清单：单一事实来源。
// 页面渲染和 dev 接口都读这里，新增命令只改这个文件。

export const REPORT_PAGES = [
  {
    id: 'recommended-pool',
    label: '推荐池',
    url: '/recommended-pool/',
    dir: 'recommended-pool',
    description: '多维加权评分选出的今日研究观察池（focus / wait 分档 + 网页端可调权重）。',
  },
  {
    id: 'replay',
    label: 'Replay 报告',
    url: '/replay/',
    dir: 'replay',
    description: 'T+1 短线规则的历史回放：成交明细、P0 证据门（统计/基准/样本外折）、执行现实审计。',
  },
  {
    id: 'stock-news',
    label: '消息面报告',
    url: '/stock-news/',
    dir: 'stock-news',
    description: '按需抓取的单只 A 股消息面：新闻、研报、公告、北向、两融、股东户数。不参与评分。',
  },
  {
    id: 'market-regime',
    label: '大盘趋势',
    url: '/market-regime/',
    dir: 'market-regime',
    description: '大盘趋势判断：指数成本锚 + 全市场宽度 + 量能 + 资金，四组加权总分。',
  },
]

const SCREEN = '.agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs'
const REPLAY = '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs'

export const COMMANDS = [
  // ── 生成 / 刷新 ──────────────────────────────────────────────
  {
    id: 'replay-report',
    group: '生成与刷新',
    label: '重跑 Replay 报告',
    description: '重新回放全池并重渲染报告页，用当前最新的行情 CSV。约 30 秒。',
    display: 'pnpm run generate:replay-report',
    run: { kind: 'node', script: 'scripts/generate-replay-report.mjs', then: [{ kind: 'node', script: 'scripts/render-replay-page.mjs' }] },
    resultUrl: '/replay/',
  },
  {
    id: 'replay-page',
    group: '生成与刷新',
    label: '只重渲染 Replay 页',
    description: '不重跑回放，用已有快照重新出页面。改过列隐藏清单或字段注释后用这个。',
    display: 'pnpm run replay:page',
    run: { kind: 'node', script: 'scripts/render-replay-page.mjs' },
    resultUrl: '/replay/',
  },
  {
    id: 'news-fetch',
    group: '生成与刷新',
    label: '抓取消息面',
    description: '只抓你在输入框里点名的几只 A 股。单只约 15 秒。结果不参与量价评分。',
    display: 'pnpm run fetch:stock-news -- <6位代码...>',
    run: { kind: 'python', script: 'scripts/fetch-stock-news.py', args: ['--recent-rows', '20', '--sleep', '0.5'], then: [{ kind: 'node', script: 'scripts/render-stock-news-page.mjs' }] },
    acceptsArgs: { label: '股票代码', placeholder: '600519 000425', pattern: '^\\d{6}$', max: 12, hint: '6 位 A 股代码，空格分隔，最多 12 只' },
    resultUrl: '/stock-news/',
  },
  {
    id: 'news-page',
    group: '生成与刷新',
    label: '只重渲染消息面页',
    description: '用已有快照重新出页面，不重新抓取。',
    display: 'pnpm run news:page',
    run: { kind: 'node', script: 'scripts/render-stock-news-page.mjs' },
    resultUrl: '/stock-news/',
  },
  {
    id: 'market-regime',
    group: '生成与刷新',
    label: '刷新大盘趋势',
    description: '抓指数日线 / 全市场宽度 / 两融，算出四组加权总分与状态。约 90 秒。',
    display: 'pnpm run fetch:market-regime',
    run: { kind: 'node', script: 'scripts/run-market-regime.mjs' },
    resultUrl: '/market-regime/',
  },
  {
    id: 'regime-page',
    group: '生成与刷新',
    label: '只重渲染大盘页',
    description: '用已有快照重新出页面，不重新抓取。',
    display: 'pnpm run regime:page',
    run: { kind: 'node', script: 'scripts/render-market-regime-page.mjs' },
    resultUrl: '/market-regime/',
  },
  {
    id: 'pool',
    group: '生成与刷新',
    label: '重新生成推荐池',
    description: '按当前维度权重重算观察池并重渲染网页。',
    display: 'pnpm run generate:recommended-pool',
    run: { kind: 'pnpm', script: 'generate:recommended-pool' },
    resultUrl: '/recommended-pool/',
  },
  {
    id: 'refresh-market-data',
    group: '生成与刷新',
    label: '刷新行情数据（长任务）',
    description: '从 BaoStock / AkShare 重新拉全池行情 → 转 CSV → 重建索引。385 只，可能十几分钟。',
    display: 'pnpm run refresh:market-data',
    run: { kind: 'pnpm', script: 'refresh:market-data' },
    long: true,
  },

  // ── 选股 CLI ────────────────────────────────────────────────
  {
    id: 'screen-a',
    group: '选股 CLI',
    label: '筛选 A 股',
    description: '按成本锚 / 合成 CK 几何 / 偏离极端度给全池打分排序，输出观察/等待/剔除状态。',
    display: `node ${SCREEN} --market A股 --top 20`,
    run: { kind: 'node', script: SCREEN, args: ['--market', 'A股', '--top', '20'] },
    acceptsArgs: { label: 'top N', placeholder: '30', pattern: '^\\d{1,3}$', max: 1, hint: '只填一个数字，覆盖 --top' , replaceTail: 1 },
  },
  {
    id: 'screen-ah',
    group: '选股 CLI',
    label: '筛选 A 股 + 港股',
    description: '同上，但把港股一并纳入排序。',
    display: `node ${SCREEN} --market A股,港股 --top 20`,
    run: { kind: 'node', script: SCREEN, args: ['--market', 'A股,港股', '--top', '20'] },
  },
  {
    id: 'replay-latest',
    group: '选股 CLI',
    label: 'Replay 最新信号',
    description: '对最后一个交易日做观察扫描，不模拟收益。',
    display: `node ${REPLAY} --mode latest --fee 0`,
    run: { kind: 'node', script: REPLAY, args: ['--mode', 'latest', '--fee', '0'] },
  },
  {
    id: 'replay-strict',
    group: '选股 CLI',
    label: 'Replay 回放（strict）',
    description: '默认档的结构化回放，输出成交明细与证据门。',
    display: `node ${REPLAY} --mode replay --profile strict --fee 0.0011`,
    run: { kind: 'node', script: REPLAY, args: ['--mode', 'replay', '--profile', 'strict', '--fee', '0.0011'] },
  },
  {
    id: 'replay-walkforward',
    group: '选股 CLI',
    label: 'Replay + 样本外折',
    description: '把时间轴切成训练/测试折，看规则的样本外稳定性。',
    display: `node ${REPLAY} --profile strict --fee 0.0011 --validate walk-forward`,
    run: { kind: 'node', script: REPLAY, args: ['--mode', 'replay', '--profile', 'strict', '--fee', '0.0011', '--validate', 'walk-forward'] },
  },
  {
    id: 'replay-slippage',
    group: '选股 CLI',
    label: 'Replay + 10bps 滑点',
    description: '在成交价上再加 10 个基点的让价，看结论会不会翻面。',
    display: `node ${REPLAY} --profile strict --fee 0.0011 --slippage-bps 10`,
    run: { kind: 'node', script: REPLAY, args: ['--mode', 'replay', '--profile', 'strict', '--fee', '0.0011', '--slippage-bps', '10'] },
  },

  // ── 校验 ────────────────────────────────────────────────────
  {
    id: 'test',
    group: '校验',
    label: '跑全部测试',
    description: 'vitest 全量 + skill 运行时一致性检查。约 2 分钟。',
    display: 'pnpm test',
    run: { kind: 'pnpm', script: 'test' },
    long: true,
  },
  {
    id: 'lint',
    group: '校验',
    label: 'ESLint',
    description: '全仓静态检查。',
    display: 'pnpm run lint',
    run: { kind: 'pnpm', script: 'lint' },
  },
  {
    id: 'build',
    group: '校验',
    label: '生产构建',
    description: 'generate:data → 各项 check → vite build。约 1 分钟。',
    display: 'pnpm run build',
    run: { kind: 'pnpm', script: 'build' },
    long: true,
  },
  {
    id: 'check-data',
    group: '校验',
    label: '数据一致性',
    description: 'stock-index.json 与 public/data/*.csv 是否一一对应。',
    display: 'pnpm run check:data',
    run: { kind: 'pnpm', script: 'check:data' },
  },
  {
    id: 'check-generated-data',
    group: '校验',
    label: '生成数据完整性',
    description: 'src/data/generated 是否覆盖全部生产 CSV。',
    display: 'pnpm run check:generated-data',
    run: { kind: 'pnpm', script: 'check:generated-data' },
  },
  {
    id: 'check-size',
    group: '校验',
    label: '文件行数上限',
    description: 'src/ 下单文件不得超过 500 行。',
    display: 'pnpm run check:size',
    run: { kind: 'pnpm', script: 'check:size' },
  },
  {
    id: 'check-domain-boundary',
    group: '校验',
    label: '领域边界',
    description: 'src/domain 不得依赖 UI 或基础设施层。',
    display: 'pnpm run check:domain-boundary',
    run: { kind: 'pnpm', script: 'check:domain-boundary' },
  },
  {
    id: 'verify-domain',
    group: '校验',
    label: '领域公式验算',
    description: '用已知输入验算核心公式的数值不变量。',
    display: 'pnpm run verify:domain',
    run: { kind: 'pnpm', script: 'verify:domain' },
  },
  {
    id: 'check-skill-runtime',
    group: '校验',
    label: 'Skill 运行时一致性',
    description: 'canonical 实现与 .claude / skills 两个镜像是否同步，并跑 CLI 契约断言。',
    display: 'pnpm run check:skill-runtime',
    run: { kind: 'pnpm', script: 'check:skill-runtime' },
    long: true,
  },
]

export const GROUPS = ['生成与刷新', '选股 CLI', '校验']

export function findCommand(id) {
  return COMMANDS.find((item) => item.id === id) ?? null
}