// 控制面板的命令清单：单一事实来源。
//
// 结构刻意简单：四个功能卡 + 一个折叠的维护区。
// 页面渲染和 dev 接口都读这里，新增命令只改这个文件。

export const REPORT_PAGES = [
  {
    id: 'recommendation',
    label: '集合推荐',
    url: '/recommendation/',
    dir: 'recommendation',
    description: '推荐池维度分排序 + 筛选门禁状态（观察/等待/剔除）合并成一张表。',
  },
  {
    id: 'recommended-pool',
    label: '推荐池（可调权重）',
    url: '/recommended-pool/',
    dir: 'recommended-pool',
    description: '原始推荐池页面，可以在网页上调维度权重重新排序。',
  },
  {
    id: 'replay',
    label: 'Replay 报告',
    url: '/replay/',
    dir: 'replay',
    description: '历史回放：成交明细、样本外折、基准与执行现实审计。',
  },
  {
    id: 'market-regime',
    label: '大盘趋势',
    url: '/market-regime/',
    dir: 'market-regime',
    description: '指数成本锚 + 全市场宽度 + 量能 + 两融，四组加权总分。',
  },
  {
    id: 'stock-news',
    label: '消息面报告',
    url: '/stock-news/',
    dir: 'stock-news',
    description: '按需抓取的单只 A 股消息面。不参与评分。',
  },
]

const SCREEN = '.agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs'
const REPLAY = '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs'

// 四个功能卡。primary / secondary 指向 COMMANDS 里的 id。
export const FUNCTIONS = [
  {
    id: 'refresh',
    title: '更新实时股票仓库',
    description: '从 BaoStock / AkShare 拉全池行情 → 转 CSV → 重建索引。385 只，可能十几分钟。',
    primary: 'refresh-market-data',
    secondary: [],
    resultUrl: null,
  },
  {
    id: 'recommend',
    title: '推荐（SCREEN + POOL 合并）',
    description: '默认 5 只观察档 + 5 只等待档：推荐池 7 维排序，筛选门禁与筛选分 ≥50 负责过滤。',
    primary: 'recommendation',
    secondary: ['pool-advanced'],
    resultUrl: '/recommendation/',
  },
  {
    id: 'replay',
    title: 'Replay 回测验证',
    description: '默认收紧到约 17 笔；一次生成基准、样本外折和 10bps 滑点三块结果（约 90 秒）。',
    primary: 'replay-report',
    secondary: [],
    resultUrl: '/replay/',
  },
  {
    id: 'regime',
    title: '大盘信息',
    description: '指数成本锚 + 全市场宽度 + 量能 + 两融，四组加权总分与状态标签。',
    primary: 'market-regime',
    secondary: ['regime-page'],
    resultUrl: '/market-regime/',
  },
]

export const COMMANDS = [
  // ── ① 更新实时股票仓库 ──────────────────────────────────────
  {
    id: 'refresh-market-data',
    section: 'refresh',
    label: '刷新行情仓库',
    description: '拉取全池行情并重建 CSV、索引与生成数据。长任务。',
    display: 'pnpm refresh',
    run: { kind: 'pnpm', script: 'refresh:market-data' },
    long: true,
  },

  // ── ② 推荐（SCREEN + POOL） ────────────────────────────────
  {
    id: 'recommendation',
    section: 'recommend',
    label: '生成集合推荐',
    description: '跑推荐池 + 筛选，输出 10 只（5 观察档 / 5 等待档）并渲染页面。约 20 秒。',
    display: 'pnpm recommend',
    run: { kind: 'node', script: 'scripts/generate-recommendation.mjs' },
    resultUrl: '/recommendation/',
  },
  {
    id: 'pool-advanced',
    section: 'recommend',
    label: '推荐池（调权重）',
    description: '只跑推荐池，生成可调权重的详细页面。',
    display: 'pnpm run generate:recommended-pool',
    run: { kind: 'pnpm', script: 'generate:recommended-pool' },
    resultUrl: '/recommended-pool/',
  },

  // ── ③ Replay 回测验证 ──────────────────────────────────────
  {
    id: 'replay-report',
    section: 'replay',
    label: '重跑回测并出报告',
    description: '全池回放 + 样本外折 + 10bps 滑点，渲染报告页。约 90 秒。',
    display: 'pnpm replay',
    run: { kind: 'node', script: 'scripts/generate-replay-report.mjs', then: [{ kind: 'node', script: 'scripts/render-replay-page.mjs' }] },
    resultUrl: '/replay/',
  },
  {
    id: 'replay-walkforward',
    section: 'maintenance',
    label: '样本外折验证',
    description: '把时间轴切成训练/测试折，只看控制台输出。',
    display: `node ${REPLAY} --profile strict --fee 0.0011 --min-z 2.13 --target 0.032 --validate walk-forward`,
    run: { kind: 'node', script: REPLAY, args: ['--mode', 'replay', '--profile', 'strict', '--fee', '0.0011', '--min-z', '2.13', '--target', '0.032', '--validate', 'walk-forward'] },
  },
  {
    id: 'replay-slippage',
    section: 'maintenance',
    label: '加 10bps 滑点',
    description: '在成交价上再加 10 个基点，看结论会不会翻面。',
    display: `node ${REPLAY} --profile strict --fee 0.0011 --min-z 2.13 --target 0.032 --slippage-bps 10`,
    run: { kind: 'node', script: REPLAY, args: ['--mode', 'replay', '--profile', 'strict', '--fee', '0.0011', '--min-z', '2.13', '--target', '0.032', '--slippage-bps', '10'] },
  },

  // ── ④ 大盘信息 ──────────────────────────────────────────────
  {
    id: 'market-regime',
    section: 'regime',
    label: '刷新大盘信息',
    description: '抓指数日线 / 全市场宽度 / 两融，重算四组总分并出页面。约 90 秒。',
    display: 'pnpm market',
    run: { kind: 'node', script: 'scripts/run-market-regime.mjs' },
    resultUrl: '/market-regime/',
  },
  {
    id: 'regime-page',
    section: 'regime',
    label: '只重渲染大盘页',
    description: '用已有快照重新出页面，不重新抓取。',
    display: 'pnpm run regime:page',
    run: { kind: 'node', script: 'scripts/render-market-regime-page.mjs' },
    resultUrl: '/market-regime/',
  },

  // ── 维护（默认折叠，平时不用） ──────────────────────────────
  {
    id: 'replay-page',
    section: 'maintenance',
    label: '只重渲染 Replay 页',
    description: '用已有快照重出页面。',
    display: 'pnpm run replay:page',
    run: { kind: 'node', script: 'scripts/render-replay-page.mjs' },
    resultUrl: '/replay/',
  },
  {
    id: 'news-fetch',
    section: 'maintenance',
    label: '抓取消息面（按代码）',
    description: '只抓点名的几只 A 股。',
    display: 'pnpm run fetch:stock-news -- <6位代码...>',
    run: { kind: 'python', script: 'scripts/fetch-stock-news.py', args: ['--recent-rows', '20', '--sleep', '0.5'], then: [{ kind: 'node', script: 'scripts/render-stock-news-page.mjs' }] },
    acceptsArgs: { label: '股票代码', placeholder: '600519 000425', pattern: '^\\d{6}$', max: 12, hint: '6 位 A 股代码，空格分隔，最多 12 只' },
    resultUrl: '/stock-news/',
  },
  {
    id: 'news-page',
    section: 'maintenance',
    label: '只重渲染消息面页',
    description: '用已有快照重出页面。',
    display: 'pnpm run news:page',
    run: { kind: 'node', script: 'scripts/render-stock-news-page.mjs' },
    resultUrl: '/stock-news/',
  },
  {
    id: 'screen-a',
    section: 'maintenance',
    label: '筛选（命令行）',
    description: '只跑筛选，看控制台 Top N。',
    display: `node ${SCREEN} --market A股 --top 10`,
    run: { kind: 'node', script: SCREEN, args: ['--market', 'A股', '--top', '10'] },
    acceptsArgs: { label: 'top N', placeholder: '30', pattern: '^\\d{1,3}$', max: 1, hint: '只填一个数字，覆盖 --top', replaceTail: 1 },
  },
  {
    id: 'test',
    section: 'maintenance',
    label: '跑全部测试',
    description: 'vitest 全量 + skill 运行时一致性。约 2 分钟。',
    display: 'pnpm test',
    run: { kind: 'pnpm', script: 'test' },
    long: true,
  },
  {
    id: 'lint',
    section: 'maintenance',
    label: 'ESLint',
    description: '全仓静态检查。',
    display: 'pnpm run lint',
    run: { kind: 'pnpm', script: 'lint' },
  },
  {
    id: 'build',
    section: 'maintenance',
    label: '生产构建',
    description: '各项 check + vite build。',
    display: 'pnpm run build',
    run: { kind: 'pnpm', script: 'build' },
    long: true,
  },
  {
    id: 'check-data',
    section: 'maintenance',
    label: '数据一致性',
    description: 'stock-index.json 与 CSV 是否一一对应。',
    display: 'pnpm run check:data',
    run: { kind: 'pnpm', script: 'check:data' },
  },
  {
    id: 'check-generated-data',
    section: 'maintenance',
    label: '生成数据完整性',
    description: 'generated 是否覆盖全部生产 CSV。',
    display: 'pnpm run check:generated-data',
    run: { kind: 'pnpm', script: 'check:generated-data' },
  },
  {
    id: 'check-size',
    section: 'maintenance',
    label: '文件行数上限',
    description: 'src/ 下单文件不得超过 500 行。',
    display: 'pnpm run check:size',
    run: { kind: 'pnpm', script: 'check:size' },
  },
  {
    id: 'check-domain-boundary',
    section: 'maintenance',
    label: '领域边界',
    description: 'src/domain 不得依赖 UI 或基础设施。',
    display: 'pnpm run check:domain-boundary',
    run: { kind: 'pnpm', script: 'check:domain-boundary' },
  },
  {
    id: 'verify-domain',
    section: 'maintenance',
    label: '领域公式验算',
    description: '核心公式数值不变量。',
    display: 'pnpm run verify:domain',
    run: { kind: 'pnpm', script: 'verify:domain' },
  },
  {
    id: 'check-skill-runtime',
    section: 'maintenance',
    label: 'Skill 运行时一致性',
    description: 'canonical 与两个镜像是否同步。',
    display: 'pnpm run check:skill-runtime',
    run: { kind: 'pnpm', script: 'check:skill-runtime' },
    long: true,
  },
]

export function findCommand(id) {
  return COMMANDS.find((item) => item.id === id) ?? null
}