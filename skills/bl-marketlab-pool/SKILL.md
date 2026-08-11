---
name: bl-marketlab-pool
description: '拉取 Market Lab 的研究观察池，生成可审计的企业微信文案；仅在用户明确要求时发送。'
---

# Market Lab 研究观察池拉取与推送

## 边界

这个 skill 只做：读取已生成 JSON、校验时效与字段、压缩为研究观察文案；用户明确要求时才调用 webhook 发送。

它不重新评分，也不把研究代理升级为交易结论。以下语义是硬约束：

- `zScore`、`deviationPercentile` 和 `twoSidedTailProbability` 只描述偏离极端度，不是未来回归概率。
- `lpValuePercentile`、`lpValueRatio3y`、`lpZone` 来自每日重建区间的 `dynamic-range-synthetic-price-geometry`，不是固定 LP 头寸、链上做市商仓位或手续费收入。
- `annualVolSource=historical-realized-scenario-sigma` 表示历史实现波动的情景输入，不是市场期权 IV。
- `meanReversionMonotonicGate=true` 只表示样本内 `0<rho<1` 的单调 AR 门禁，不等于统计校准。只有 `meanReversionCalibrationStatus=holdout-validated` 且存在 `meanReversionCalibrationId` 时才可称为经过独立留出校准。
- `deltaReferencePrice`、`costBandReferencePrice` 是研究参考坐标，不得写成买点、卖点或指令。
- 社保名单用于历史回放时必须是 point-in-time 快照；当前名单不得回填历史。
- 保留 `riskNote`，不得输出“建议买入、确定反转、做市商囤满、赚手续费、机构托底”等结论。

## 数据入口

- 当前：`${siteUrl:-https://www.0xff.tools}/recommended-pool/data.json`
- 历史：`${siteUrl}/recommended-pool/<YYYY-MM-DD>/data.json`
- 页面只用于人工核对：`${siteUrl}/recommended-pool/`

输入：

- `siteUrl`：默认 `https://www.0xff.tools`
- `date`：可选 `YYYY-MM-DD`
- `tier`：`focus | wait | both`，默认 `focus`
- `format`：`narrative | digest`，默认 `narrative`
- `mode`：`markdown | text`，默认 `markdown`
- `webhookUrl`：可选；只有用户明确要求发送时使用

## 当前数据契约

```jsonc
{
  "generatedAt": "2026-08-07T08:30:00.000Z",
  "tiers": { "focus": 0.65, "wait": 0.4 },
  "focusItems": [],
  "waitItems": [],
  "logic": "多维研究排序...",
  "riskNote": "研究观察，不构成执行建议...",
  "items": [
    {
      "symbol": "000625",
      "label": "长安汽车",
      "market": "A股",
      "buyScore": 72.1,
      "maxScore": 110,
      "metrics": {
        "price": 8.87,
        "costDistance": -0.1267,
        "zScore": -3.1,
        "deviationPercentile": 0.998,
        "twoSidedTailProbability": 0.002,
        "deviationSemantics": "normal-reference-extremeness-not-reversion-probability",
        "lpValuePercentile": 0.004,
        "lpValueRatio3y": 2.1,
        "lpZone": "token0",
        "lpProxySemantics": "dynamic-range-synthetic-price-geometry-not-fixed-position",
        "annualVolSource": "historical-realized-scenario-sigma",
        "halfLifeDays": 69,
        "halfLifeRho": 0.99,
        "meanReversionMonotonicGate": true,
        "meanReversionCalibrationStatus": "sample-only",
        "meanReversionCalibrationId": null,
        "holdingProjectionDays": 138,
        "deltaReferencePrice": 8.87,
        "costBandReferencePrice": 9.74,
      },
      "hits": ["合成几何 P0.4%", "z=-3.10σ"],
      "narrative": "...",
    },
  ],
}
```

若仍读到旧字段 `regressionProbability`、`meanReversionCalibrated`、`volConfidenceScore`、`entryTargetPrice`、`takeProfitPrice`，或把 `holdingDays` 当 AR 预测，标记 `legacy-contract` 并停止推送；不要兼容展示。

## 工作流

1. 读取 JSON，HTTP 非 2xx 或解析失败时报告确切 URL。
2. 校验 `generatedAt`；距当前超过 24 小时，首行加入“数据已过期”警告。
3. 校验每个 item：
   - 不得包含 `metrics.regressionProbability` 或 `metrics.meanReversionCalibrated`；
   - 必须有 `metrics.deviationSemantics` 和 `metrics.lpProxySemantics`；
   - `narrative` 不得出现“回归概率、做市商囤货、买点、卖点、赚手续费”。
4. 只消费服务端 `buyScore/tier`，不在 skill 内重新评分。
5. 生成文案并保留 `logic`、`riskNote` 与数据来源/日期。
6. 只有用户明确要求推送且提供/已有 webhook 时才发送；否则只返回预览。

## narrative 模板

```text
【Market Lab 研究观察池】
观察日期：{generatedDate}  数据：{siteUrl}/recommended-pool/data.json
状态：research-only / 非执行建议

1. {label} / {symbol}（{market}）
研究排序：{buyScore}/{maxScore}
偏离：z={zScore}σ；正态参考百分位 {deviationPercentilePct}%，双尾 {tailPct}%
合成几何：P{lpValuePercentilePct}% / zone={lpZone}
AR：HL {halfLifeDays}天；{样本内单调门禁/未通过门禁}；校准 {meanReversionCalibrationStatus}
参考坐标：Delta {deltaReferencePrice} / 成本带 {costBandReferencePrice}（非买卖指令）
缺口：真实 LP、路径手续费、期权报价与点时名单未由该快照证明

{narrative}

模型说明：{logic}
风险：{riskNote}
```

时间字段缺失时写“AR 时间字段缺失”，不能补算；`holdingProjectionDays` 只能称为零冲击条件投影，不得称为建议持仓期或预期实现周期。

## digest 模板

```text
【研究观察池 {generatedDate}】{focusItems.length} 个高分观察
1. {label}({symbol}) {buyScore}/{maxScore} · z {zScore}σ · 几何代理 P{lpPct}% · HL {halfLifeDays}天/{gate}
...
数据：{siteUrl}/recommended-pool/ · research-only
风险：{riskNote}
```

## 发送

仅在用户明确要求后：

```bash
curl -fsSL -X POST "$webhookUrl" \
  -H 'Content-Type: application/json' \
  -d '{ "msgtype": "markdown", "markdown": { "content": "<已校验文案>" } }'
```

企业微信 markdown 超过 4096 字节时按 item 拆分，并在每条保留 `research-only` 与风险短句。

## 错误处理

- 空结果：写“本期无标的进入观察档”，不是“没有买入机会”。
- 旧契约、语义字段缺失或违禁文案：停止推送并报告字段路径。
- 日期不符：尝试历史 URL；仍不符则停止。

## 本地验证

```bash
pnpm run generate:recommended-pool
pnpm run preview
```

访问 `http://localhost:4173/recommended-pool/`，再用 `siteUrl=http://localhost:4173` 预演；预演不发送。
