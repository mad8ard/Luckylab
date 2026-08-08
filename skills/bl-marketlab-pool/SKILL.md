---
name: bl-marketlab-pool
description: "拉取 Market Lab 部署站点上的『今日推荐股票池』并生成企业微信推送文案。Use when user asks to '拉取推荐股票池', '推送股票池', '推送企业微信', '推荐股票推送', 'fetch recommended pool', 'push stock pool to wechat work', '抓股票池', '推送 marketlab'。"
version: 2.0.0
---

# bl-marketlab-pool — Market Lab 推荐股票池拉取 & 企业微信文案（v3 多维评分）

## 用途

Market Lab（部署站 `https://www.0xff.tools/`）每次价格刷新都会同步生成一份当日推荐股票池：

- 隐藏页面（不在主导航暴露）：`https://www.0xff.tools/recommended-pool/`
- 同日历史快照：`https://www.0xff.tools/recommended-pool/<YYYY-MM-DD>/`
- 机器可读 JSON：`https://www.0xff.tools/recommended-pool/data.json`

本 skill 负责：**抓取页面或 JSON → 转换为企业微信推送文案 → （可选）调用企业微信 webhook 推送**。

## 评分模型（v3 做市商多维对齐）

回答"策略特点是什么"时要按当前推荐池真实维度解释：这是做市商/成本回归模型，不是纯传统技术面，但默认确实使用 KDJ J 作为超卖辅助维度，RSI 是可选关闭维度。不要说"完全不用 RSI/KDJ"。

| 维度 | 权重 | 满分条件 |
|------|------|---------|
| `lpValuePercentile` | 30 | 近 1 年 lpValue 历史百分位 ≤ 5%（做市商角度处在历史最便宜区间） |
| `zScore` | 25 | (price - costAnchor) / 半带宽 ≤ -3σ，统计学回归概率高 |
| `lpZone` | 20 | `token0`（折价囤货）满分 / `range` 中位 / `token1`（已清仓）零分 |
| `costSlope5` | 15 | 5 日成本锚斜率 ≥ +0.5% 满分；≤ -2.5% 归零（"底没焊死"扣分项） |
| `j` | 10 | KDJ J ≤ 0 满分；J ≥ 20 归零 |
| `rsi` | 10 | 默认关闭；RSI 超卖维度 |
| `lpRatio3y` | 15 | LP 3 年 max/min ≥ 2.5 满分 |
| `halfLife` | 10 | 默认关闭；均值回归半衰期越短越高 |
| `volConfidence` | 5 | 默认关闭；半衰期可信度 |
| `socialSecurityWhitelist` | 5 | 默认关闭；optional 加分项 |

**分级阈值**：
- **focus（重点关注）**：buyScore ≥ 当前启用满分上限的 65%
- **wait（等待）**：当前启用满分上限的 40% ~ 65%
- 不入选：< 当前启用满分上限的 40%（不出现在 items 里）

## 时间成本与持仓损耗

推荐池不是"分数最高就一定最好"。生成推送时必须把资金占用和机会成本写进去，尤其是 `focus` 档。

核心字段：

- `metrics.halfLifeDays`：均值回归半衰期，来自 costDistance 序列
- `metrics.holdingDays`：第一窗口，通常是 halfLife × 2
- `metrics.recoveryDays`：完整回归窗口，通常是 halfLife × 3
- `metrics.entryTargetPrice`：公式买点或 Delta 上沿
- `metrics.takeProfitPrice`：第一卖点，通常是成本带下沿
- `metrics.costSlope5` / `anchorDirection`：决定能否等完整回归

推送解释规则：

- 先写资金占用：`HL {x}天，第一窗口 {holdingDays}天，完整回归 {recoveryDays}天`
- 再写时间效率：`第一目标空间 = (takeProfitPrice - price) / price`；`月化效率 = 第一目标空间 / holdingDays * 21`
- HL ≤ 30 天：周转友好；30-60 天：可接受但要复核；>60 天：时间成本高；>90 天默认只写等待或长周期观察
- 锚 ↓ 时，目标只写到成本带下沿，不要默认等成本锚；锚 →/↑ 时才讨论完整回归
- `zScore` 和 `regressionProbability` 代表回归置信，不代表半衰期自动变短；禁止写"z 极端会加速 HL"
- "接飞刀豁免"只说明锚下降不再一票否决，不代表可以忽略持仓时间和资金周转
- 多只标的排序说明中，优先比较月化效率和持仓窗口，再比较绝对涨幅

建议在每只展开文案后追加：

```text
时间成本：HL {halfLifeDays}天，第一窗口约 {holdingDays}天，完整回归约 {recoveryDays}天；第一目标空间 {returnPct}%，月化效率约 {monthlyPct}%。结论：周转友好 / 可接受 / 时间成本高。
```

如果字段缺失，明确写"时间成本字段缺失，不能判断资金占用效率"，不要脑补。

## 输入参数

- `siteUrl`（可选）：部署站根，默认 `https://www.0xff.tools`
- `date`（可选）：`YYYY-MM-DD`；不传则取 `latest`
- `tier`（可选）：`focus` | `wait` | `both`，默认 `focus`（推送时只推重点关注那一档）
- `webhookUrl`（可选）：企业微信群机器人 webhook；传了就直接推送
- `mode`（可选）：`text` | `markdown`，默认 `markdown`
- `format`（可选）：`narrative`（人话长解读）/ `digest`（数字摘要），默认 `narrative`

## 数据结构（`data.json`）

```jsonc
{
  "generatedAt": "2026-05-19T08:30:00.000Z",
  "generatedDate": "2026-05-19",
  "totalCandidates": 176,
  "scoredCount": 176,
  "topN": 10,
  "tiers": { "focus": 0.65, "wait": 0.40 },
  "focusItems": [ /* tier === 'focus' 的标的 */ ],
  "waitItems":  [ /* tier === 'wait' 的标的 */ ],
  "items":      [ /* focusItems + waitItems 拼接后的列表 */ ],
  "logic": "本次推荐采用做市商五维对齐模型…",
  "riskNote": "左侧买入不代表立即反转…",
  "dimensions": [ /* 当前维度、权重、启用状态 */ ]
}
```

每个 item 形如：

```jsonc
{
  "symbol": "000625",
  "label": "长安汽车",
  "market": "A股",
  "tier": "focus",
  "buyScore": 83.4,
  "metrics": {
    "price": 8.87,
    "costAnchor": 10.16,
    "costLow": 9.74,
    "costHigh": 10.58,
    "costDistance": -0.1267,
    "costSlope5": -0.0209,
    "anchorDirection": "down",            // up / flat / down
    "j": 7.42,
    "lpZone": "token0",                   // token0 / range / token1
    "lpValue": 0.052,
    "lpValuePercentile": 0.004,
    "lpValueMin1y": 0.0419,
    "lpValueMax1y": 0.135,
    "zScore": -3.10,
    "regressionProbability": 0.998,
    "halfLifeDays": 69,
    "holdingDays": 138,
    "recoveryDays": 207,
    "entryTargetPrice": 8.87,
    "takeProfitPrice": 9.74,
    "observationDate": "2026-05-18"
  },
  "dimensions": {
    "lpValuePercentile": { "ratio": 1.0, "score": 30, "weight": 30 },
    "zScore":            { "ratio": 1.0, "score": 25, "weight": 25, "value": -3.10 },
    "lpZone":            { "ratio": 1.0, "score": 20, "weight": 20, "value": "token0" },
    "costSlope":         { "ratio": 0.13, "score": 2.0, "weight": 15, "value": -0.0209 },
    "jValue":            { "ratio": 0.63, "score": 6.3, "weight": 10, "value": 7.42 }
  },
  "hits": [ "lpValue P0.4%", "z=-3.10σ", "token0 折价囤货" ],
  "narrative": "长安汽车 综合 83.4 分。做市商模型告诉你：你在历史最低价囤满了货。 lpValue 近一年 P0.4%，99.6% 的时间都比现在贵——做市商角度处在历史最便宜区间。 z=-3.10σ，回归概率 99.8%——纯随机偏离这么深的概率极低，价格大概率往回拉。 LP 仓位是 100% 长安汽车 + 0% 现金（zone=token0），意味着你手里的货是打折买的。 唯一没亮绿灯的：成本锚 5 日斜率 -2.09%（↓），意思是\"底\"可能还没焊死。等锚走平再加码。 价格距成本锚 -12.67%。"
}
```

## 推荐执行流程

1. **优先抓 JSON**（更稳定）：
   ```bash
   curl -fsSL "${siteUrl:-https://www.0xff.tools}/recommended-pool/data.json"
   ```
   失败时回退 HTML：`curl -fsSL "${siteUrl}/recommended-pool/"`

2. **校验日期**：用户传 `date` 时校验 `generatedDate`；不符就改用 `/<date>/data.json`

3. **生成文案**（默认 `tier=focus` + `format=narrative`）：

   ```
   【今日推荐股票池】
   更新时间：{generatedDate} {HH:mm}
   重点关注：{focusItems.length} 只 / 候选池 {totalCandidates} 只

   推荐逻辑：
   {logic}

   ▎重点关注（≥ 当前启用满分上限的 65%）

   1. {label} / {symbol}（{market}）
   综合评分：{buyScore}
   维度对齐：{hits.join('、')}

   {narrative}

   时间成本：HL {halfLifeDays}天，第一窗口约 {holdingDays}天，完整回归约 {recoveryDays}天；
   第一目标空间 {returnPct}%，月化效率约 {monthlyPct}%。
   资金占用判断：{周转友好/可接受/时间成本高}。

   ---

   2. {下一只}
   …

   风险提示：
   {riskNote}
   ```

   要点：
   - **必须保留 `narrative` 全文**（人话解读是这个模型的核心产物）
   - **必须补充时间成本段**：使用 `halfLifeDays / holdingDays / recoveryDays / takeProfitPrice / price`，不要只推分数和故事
   - 数字保留 2 位小数；价格在 [1, 10) 区间保留 3 位
   - `tier=both` 时在 focus 之后再加一段 `▎等待（40%~65%）` 列表，但只列 `label / symbol / buyScore / 简短一句话`，不必把 narrative 全部展开

4. **（可选）推送企业微信**：
   ```bash
   curl -fsSL -X POST "$webhookUrl" \
     -H 'Content-Type: application/json' \
     -d '{ "msgtype": "markdown", "markdown": { "content": "<上一步生成的文案>" } }'
   ```

   - 企业微信 markdown 单条上限 4096 字节；超过时按 `focusItems` 拆分多条
   - `text` 模式时把 `msgtype` 改成 `text`、`content` 字段不带 markdown 语法

## digest 简短格式（备选）

适合发送到「日报」类消息，单条不超过 1000 字：

```
【今日推荐股票池 {generatedDate}】重点关注 {focusItems.length} 只

1. {label}({symbol}) {buyScore}分 — {hits[0]}, {hits[1]}, HL {halfLifeDays}天 / 月效 {monthlyPct}%, 锚{anchorDirection==='up'?'↑':anchorDirection==='down'?'↓':'→'}
2. ...
3. ...

完整解读：{siteUrl}/recommended-pool/

风险提示：{riskNote}
```

## 错误处理

- HTTP 非 2xx 或 JSON 解析失败 → 直接报错并打印 URL
- `focusItems` + `waitItems` 全空 → 通知用户："今日无标的进入推荐档位（全部 < 40 分）"
- `generatedAt` 距当前超过 24 小时 → 文案前插警告："⚠️ 数据距今 {hours}h，可能未及时刷新"

## 风险声明（必须保留）

推送内容必须保留 `riskNote` 全文，不要主动给"建议买入 / 建议止损"等结论，仅按页面已写好的"左侧关注价值"措辞引用。

## 不要做的事

- 不要尝试调用 Market Lab 的 SPA 入口（`https://www.0xff.tools/`）抓内容
- 不要解析公式重新评分；buyScore 已是最终结论
- 不要把 `config` / `dimensions` 的 ratio/score 原样推给企业微信用户，那是开发者参考字段
- 不要把 `tier=skip` 的标的（已被剔除）拉回来推送
- 不要把 z-score 或回归概率说成会直接缩短半衰期；时间模型只来自半衰期和成本锚路径

## 测试与本地预览

- 本地预览：`pnpm run preview` 启动后访问 `http://localhost:4173/recommended-pool/`
- 重新生成快照：`pnpm run generate:recommended-pool`
- 手动调用 skill：传 `siteUrl=http://localhost:4173` 可在不发布的情况下预演推送
