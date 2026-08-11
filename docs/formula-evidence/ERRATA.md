# 公式勘误表

本表回答三个不同问题：**以前哪里说错或做错了、正确口径是什么、修复是否已经通过验证**。它不以“公式看起来合理”代替测试，也不以“代码已改”代替时点和单位校验。

## 状态定义

| 状态            | 含义                                                   |
| --------------- | ------------------------------------------------------ |
| `open`          | 问题已确认，尚未开始修复                               |
| `fixing`        | 正在修代码、文档或测试；不得当作已完成                 |
| `fixed`         | 修补已落盘，但本轮尚未完成全套回归验证                 |
| `verified`      | 修补、定向回归、公式审计和构建均已通过，并有防复发测试 |
| `accepted-risk` | 已知限制被明确保留，产品状态和禁止推论已锁定           |
| `superseded`    | 原条目被新语义或新实现取代，需指向替代条目             |
| `reopened`      | 曾关闭的问题再次出现或原验证不足                       |

只有同时满足“正确公式/语义已落盘、旧错误路径被移除、回归测试覆盖、审计通过”才能从 `fixed` 升为 `verified`。全套门禁完成前保持 `fixing` 或 `fixed`，不提前宣布成功。

## 关键结论判定

| 原结论                                  | 判定                                     | 保留下来的正确内容                                                                                                                                                           | 必须删除的错误推论                                                      |
| --------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| CK 对称区间 `±84.1299%`                 | **对，但有严格条件**                     | 在 CK 指定的对称算术区间和边际资本效率拐点目标下，它是解析解                                                                                                                 | 它不是概率覆盖率、收益/手续费最优，也不是所有标的默认范围               |
| `q=87.5%` 是 CK 常数                    | **归因和用法错；数值有另一条精确恒等式** | CK 偏斜方程在 `alpha=0` 时给 `x=0.8704`；若事先声明 `H=3*halfLifeSessions`，AR 半衰恒等式另有 `q=1-2^-3=0.875`；项目实际 `recoveryFraction` 仍按标的、起点、锚和目标逐次计算 | 87.5% 不能作 CK 偏斜通解、默认 recovery q、区间宽度或执行阈值           |
| 流动性可归一化成分布                    | **数学上对，概率解释错**                 | 非负可积模型权重可归一化为 model allocation mass                                                                                                                             | 未校准前不得称未来价格概率、回归概率或做市商意图概率                    |
| `fee ≈ theta`                           | **只能作条件类比**                       | 同币种、同名义、同符号、同周期后可比较时间价值流失与净费用 carry                                                                                                             | 二者不是恒等式；不能忽略路径成交量、in-range、Gamma、对冲、gas 和再平衡 |
| AR 半衰期可生成动态周期                 | **条件模型内对**                         | 当 `0<arCoefficient<1` 且目标严格位于起点和锚之间，可推条件修复会话数                                                                                                        | 它不是触达概率、保证持有期或全局 30/60/90 下限                          |
| 可从公开价格/成交量反推做市商成本与方向 | **只能作潜变量估计**                     | 可构造样本成本锚、库存压力代理和可证伪的方向假设                                                                                                                             | 不能宣称识别真实做市商、真实账本成本或确定未来交易方向                  |
| GetDelta 价格带就是完整期权模型         | **错**                                   | GetDelta 是给定斜率、波动与公式周期的局部价格带引擎                                                                                                                          | 它不能替代合约到期、IV 曲面、bid/ask、乘数、行权与结算规则              |
| 日线回放证明可成交路径                  | **错**                                   | 日线 OHLC 可在公开保守规则下做情景回放                                                                                                                                       | 它不能识别同一 K 线内先后顺序，也不能替代 T+0 分钟/逐笔执行引擎         |

## 总表

| ID    | 严重度 | 主题                               | 状态            | 以前的错误                                                                                                                   | 正确口径                                                                                                                                                                    |
| ----- | ------ | ---------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-001 | P0     | 历史前缀未来泄漏                   | `verified`      | 用完整 `rows.length` 为所有历史点推窗口，追加未来数据可改变旧值                                                              | 每个时点仅由 `rows[0..t]` 推窗口；追加未来行不改变既有前缀                                                                                                                  |
| E-002 | P0     | TDPY 252/242 漂移                  | `verified`      | 推荐池生成脚本及研究模块存在本地 252 默认，A/H 与 domain 242 口径漂移                                                        | 统一消费或显式传入 `inferTdpy`：A股/港股 242、美股 252、加密 365                                                                                                            |
| E-003 | P0     | LP `fees` 单位冲突                 | `verified`      | 同一个 `fees` 有时当 quote 金额，有时又乘 `strikePrice`                                                                      | 统一为 `feeIncomeQuote`；费率另叫 `feeTierFraction`，路径归属后才形成金额                                                                                                   |
| E-004 | P0     | `0.875` 默认修复比例               | `verified`      | 把 87.5% 当作结构目标或锚点的通用默认                                                                                        | `recoveryFraction=(target-start)/(anchor-start)`，每个标的、时点、目标独立推导                                                                                              |
| E-005 | P0     | `targetReturn -> deltaSlope`       | `verified`      | `targetReturn` 被兼容回退为 GetDelta 的局部斜率                                                                              | `deltaSlope` 和 `exitTargetReturn` 完全分开；不再接受模糊 `targetReturn`                                                                                                    |
| E-006 | P1     | CK 偏斜推导来源/精确性             | `verified`      | 把 `alpha!=1` 写成“项目扩展”，并把数值求根误写成非精确经验结果                                                               | 偏斜方程来自 CK Part 2；方程是 exact identity，数值求根是其数值解；历史 alpha 估计才是项目扩展                                                                              |
| E-007 | P1     | Funding 字段混义                   | `verified`      | `fundingProxy` 同时指 basis、累计代理和资金现金流，容易被再次年化、重复乘期限或冒充结算                                      | 分为 `basisFraction`、`cumulativeFundingProxy`、`fundingCashflowQuote` 与 `fundingCashflowSource`；代理不再二次乘期限，也不自动转换成现金流                                 |
| E-008 | P1     | v2/v3 IL 混名                      | `verified`      | 通用 `impermanentLoss` 实际是全范围 v2，却邻接 v3 区间字段                                                                   | 明名 `fullRangeV2IlProxy`；v3 必须用同范围、同资本、同 entry inventory 的 `rangeV3Il`                                                                                       |
| E-009 | P1     | `conformalRank` 过度声称           | `verified`      | 普通经验半径排名被命名为 conformal，暗示覆盖保证                                                                             | 改为 `empiricalRadiusRank`；未证明 exchangeability 时不得称 conformal p-value                                                                                               |
| E-010 | P1     | 复现 KM 观察量错误                 | `verified`      | start-to-start 间隔混入 episode 内停留；当前 episode age 被错误考虑为删失候选                                                | 等待量是上一 episode `end` 到下一 episode `start`；当前仍在命中区间的 age 不是离开后右删失                                                                                  |
| E-011 | P0     | 固定 30/60/90/5/10 周期            | `verified`      | 公式路径、UI、回放或 profile 用固定数字作隐藏默认/上限                                                                       | 默认周期由前缀样本、结构目标和公式推导；固定期限只允许显式 `explicit-scenario`                                                                                              |
| E-012 | P1     | `fee ≈ theta`                      | `verified`      | 将手续费收入近似等同于期权 Theta，忽略单位、名义、符号、路径和 Gamma                                                         | 只允许同币种、同名义、同符号、同周期的经济类比；不是恒等式                                                                                                                  |
| E-013 | P1     | “流动性即概率分布”                 | `accepted-risk` | 把归一化流动性模型质量直接当未来价格概率                                                                                     | 只叫 model allocation mass；没有统计校准、结果标签和持出检验就不是概率                                                                                                      |
| E-014 | P1     | CK `±84.13%` 的意义                | `verified`      | 写成覆盖率、收益最优、默认股票区间或手续费最优                                                                               | 它是对称算术区间、指定边际资本效率目标下的精确几何拐点                                                                                                                      |
| E-015 | P1     | `87.5%` 与 CK 特例                 | `verified`      | 把 87.5% 记作 CK 的精确普适值或 recovery q                                                                                   | CK 偏斜方程 `alpha=0` 给出 `x=0.8704`；87.5% 不是该推导的精确常数                                                                                                           |
| E-016 | P0     | T+1 开盘时点                       | `verified`      | 在 T 收盘就把历史 T+1 实际开盘当作已知入场参数                                                                               | T 收盘只能冻结结构；完整周期若依赖起点开盘，要等 T+1 open；历史值仅是回放填充                                                                                               |
| E-017 | P2     | 波动率标准误                       | `accepted-risk` | 容易把 `sigma/sqrt(2n)` 区间当稳健统计置信区间                                                                               | 保留为正态独立收益近似，必须标 assumptions；非独立厚尾数据需 bootstrap/稳健方法                                                                                             |
| E-018 | P1     | 裸 `q/theta/rho/delta` 语义污染    | `verified`      | 不同公式族复用同一裸符号，跨模块后无法判断含义和单位                                                                         | 对外字段必须用全名；短符号只允许在局部公式中，并绑定 canonical field                                                                                                        |
| E-019 | P0     | 方向、目标与周期错配               | `verified`      | 只用 long 侧 `cycleStart -> costLower` 推出一个周期，却可被上侧 sell 信号或以 `costAnchor/exitTargetReturn` 为终点的计划复用 | 周期必须绑定 `side + cycleStartPrice + targetPrice + targetSource + anchor + availableAt`；方向或终点不同必须独立重算或返回 `missing-input`                                 |
| E-020 | P0     | 实际成交价后未重算 q/H             | `verified`      | `dailyReplay` 在 T 收盘用 signal close 推周期，T+1 成交后直接复用 `order.holdDays`                                           | T 只冻结锚、目标和 AR 估计；T+1 实际 fill 后以 fill price 重算 `recoveryFraction` 和周期，无有效解则关闭到期逻辑                                                            |
| E-021 | P1     | IL 模型/对照基准丢失               | `verified`      | attribution 层仍接收裸 `impermanentLoss`，可把 v2 全范围与 v3 指定区间静默交换                                               | 归因输入必须显式携带 `ilModel/range/capitalBasis/start/mark/horizon`；净 LP 主路径只接收 `rangeV3Il`，旧裸字段只能作 deprecated adapter                                     |
| E-022 | P1     | `targetReturn` 仍混合多种角色      | `verified`      | 虽已不再污染 `deltaSlope`，但 OrderPlan 输出、回放函数和 skill profile 仍用它表示退出目标、最低毛收益门槛或固定情景目标      | 退出用 `exitTargetReturn`，profile 门槛用 `minimumGrossReturn`，固定情景用 `fixedTargetReturn`；旧字段仅在边界层显式迁移                                                    |
| E-023 | P0     | Replay warmup 未满足前缀不变性     | `verified`      | `warmupSessions(rows.length)` 用最终数据长度选择回放起点，追加未来行可改变历史回放区间                                       | warmup/样本充足门槛必须是逐点可见样本的函数，或是事前冻结并明示的 calibration split                                                                                         |
| E-024 | P1     | Canonical AR/Funding 别名迁移      | `accepted-risk` | 研究消费者仍读写 `rho/theta/halfLifeDays`，Funding 仍公开 `fundingRate/fundingProxy/fundingCost` 等多义名                    | 主路径只使用 `arCoefficient/arDecayRatePerStep/halfLifeSessions` 与 `basisFraction/cumulativeFundingProxy/fundingCashflowQuote`；旧名只在带 `legacyAliasOf` 的 adapter 存活 |
| E-025 | P1     | 自适应窗口/回撤特征缺语义契约      | `verified`      | 代码已从固定 5/20 滞后转为前缀自适应 fast/slow，但公式表未写窗口函数、时点和旧别名边界                                       | 登记 `windowSpec`、`drawdownSpeedFast/Slow`、样本充足规则与前缀不变性；`drawdownSpeed5/20`、`momentum5/20`、`costSlope5` 只是弃用别名                                       |
| E-026 | P0     | 多批次仓位被合并退出               | `verified`      | 加仓后合并成一个均价目标/最大到期日，后来的订单可覆盖旧批次 target、stop 和 H                                                | 每笔买入形成独立 lot，冻结自己的 target、stop、horizonBinding、expiry 和成本；组合只聚合数量与成本                                                                          |
| E-027 | P0     | 日线内目标、止损和跳空处理         | `verified`      | 只看 close，或同一 K 线同时触及时乐观选择目标价；跳空仍按阈值成交                                                            | low/high 判触达；开盘跳空优先；开盘位于阈值间且盘中双触发才 stop-first；输出 policy/source                                                                                  |
| E-028 | P1     | `usedNotional` 分母误用累计成交额  | `verified`      | `totalNotional` 或成交累计额被当作投入本金，换手越多分母越大                                                                 | `usedNotional=max_t(openCostBasis_t)`，`returnOnUsedNotional=totalPnl/usedNotional`；成交额单列                                                                             |
| E-029 | P0     | 期权期限复用修复周期               | `verified`      | BSM/Asian/Bachelier 的 tau 从标的 `formulaHorizonSessions` 或默认持有期取得                                                  | `timeToExpirySessions` 是合约独立输入，再除以 `tradingDaysPerYear`；缺失则期权结果为 `missing-input`                                                                        |
| E-030 | P0     | 缺失 fee 被当作零                  | `verified`      | 主回放、LP 归因或 skill 在没有费用来源时静默使用 0/0.11%                                                                     | 缺失表示未知并关闭收益归因；只有显式 `0` 才表示零，观测/情景金额必须带来源和周期                                                                                            |
| E-031 | P1     | 成交量价格分布隐藏 180 窗口        | `verified`      | 未指定 viewport 时静默截取 180 根，形成无来源固定周期                                                                        | 默认使用截至 activeIndex 的完整可见前缀；只有显式 viewport 才截取，并输出完整 `windowSpec`                                                                                  |
| E-032 | P0     | Skill 历史状态元数据读取未来       | `verified`      | 历史信号的 freshness、rows、dataThrough 或 candidateStatus 使用最终文件元数据                                                | 所有历史状态和来源字段只由该信号时点前缀计算，追加未来行不得改写旧元数据                                                                                                    |
| E-033 | P0     | 外部 marketStates 可伪造因果状态   | `verified`      | 第三参数只校验数组长度，却无条件写 `futureRowsUsed=false`                                                                    | 只复用 canonical 前缀构建器生成且 fingerprint 未变的路径；其余外部状态全部内部重算并标来源                                                                                  |
| E-034 | P1     | 新 fill 的同日 high/low 被隐式忽略 | `verified`      | 引擎先退出旧仓再成交新仓，但未声明新 lot 为何同日不能退出，跨市场语义不明                                                    | 新 lot 明示 `eligibleExitIndex=fillIndex+1` 与 `defer-to-next-complete-bar-after-fill`；T+0 需分钟路径，不能拿完整日线倒推                                                  |
| E-035 | P0     | 已知开盘跳空仍被 stop-first 覆盖   | `verified`      | `open>=target` 且当日 low 又到 stop 时仍按止损价，丢掉开盘最早已知事件                                                       | 先处理 open gap：上跳目标按 open、下跳止损按 open；仅盘中先后未知时 stop-first                                                                                              |
| E-036 | P2     | 显式小数期限取整不一致             | `verified`      | 初始 lot 用 `round`，新 lot 用 `ceil`，可能让初始仓提前一个会话到期                                                          | 所有正小数会话期限统一向上取整，绝不早于情景期限                                                                                                                            |
| E-037 | P1     | UI 公式注册表仍展示旧口径          | `verified`      | 公式抽屉继续显示 `sqrt(365)`、`high120`、裸 `rho/theta` 和“质数 179/e/pi”伪周期，导致已修 domain 被旧说明重新污染            | 注册表只展示真实生产公式：显式 `tradingDaysPerYear`、前缀自适应窗口、规范 AR 字段和可审计路径变换                                                                           |
| E-038 | P0     | 缺失 Greek 被组合层改写为零        | `verified`      | Bachelier 未实现的 Theta/Rho 经 `?? 0` 汇总成“风险恰为零”                                                                    | 只有数学上已计算且有限的 Greek 才可求和；任一有效腿缺该 Greek 时，组合对应 Greek 为 `null/missing-input`                                                                    |
| E-039 | P1     | 期权 Theta 的“日/会话”单位混写     | `verified`      | 用 `tradingDaysPerYear` 除年 Theta，却输出 `thetaDaily`/“Theta/日”，把交易会话误称自然日                                     | 输出 `optionThetaPerSession` 与 `optionThetaAnnual`；只有真实 calendar-day 基准才能称 daily                                                                                 |
| E-040 | P1     | LP 裸 `delta` 与期权 Delta 冲突    | `verified`      | LP 库存同时输出 `inventoryDelta` 和无迁移元数据的裸 `delta`                                                                  | v3 用 `inventoryDeltaToken0`；带线性对冲的 v2 用 `netInventoryDeltaToken0`，并单列 `lpInventoryDeltaToken0`；旧字段只能是显式 deprecated alias                              |
| E-041 | P0     | 流动性指纹隐藏波动和 365 时间基    | `verified`      | 波动缺失时静默代入 `0.35`，并固定用 `sqrt(365)` 构造 bump 宽度                                                               | `volatility` 与 `tradingDaysPerYear` 都是显式输入；任一缺失则该研究查询返回 `missing-input/null`，不得制造模型形状                                                          |
| E-042 | P0     | E-002 修后仍残留生产 `365` 回退    | `verified`      | `inferTdpy` 对未知市场返回 365，且下游曾用逻辑回退继续计算                                                                   | 已识别市场才由 `inferTdpy` 给值；未知返回 `missing-input`。下游只接可追溯覆盖或显式输入，缺失传播 `null/blocked`                                                            |
| E-043 | P1     | deprecated Pine 仍能发旧信号       | `verified`      | 三个根目录旧变体虽有 deprecated 注释，仍保留固定 20/30/60/120 周期、可视信号和告警；旧校验器还可能给出假绿                   | 完整源码隔离到 `research/archive/pine/`；旧路径只保留无输入、无信号、无告警占位脚本；唯一 canonical Pine 由动态周期门禁校验                                                 |
| E-044 | P0     | Funding 净 carry 分母与方向错误    | `verified`      | 用 `abs((mark-anchor)/anchor)` 当回到目标的毛收益，既用错分母又抹掉方向；`breakEven` 还回显当前拖累并另加任意 1%             | 从 cycle start/fill 到 target 按 long/short 求收益；funding 按持仓方向转成带符号现金流，并强制同名义、同周期后再求净 carry 与 break-even                                    |
| E-045 | P0     | Funding proxy 冒充真实结算现金流   | `verified`      | 把 `abs(cumulativeFundingProxy)*capital` 命名为 settlement，从总资本扣除，丢掉对冲腿名义和收付方向                           | 代理只留在 carry 情景；组合只接带来源的 `fundingCashflowQuote`，正数表示收到、负数表示支付；未观测 settlement 保持缺失                                                      |
| E-046 | P1     | fee-theta 时间轴仍可错配           | `verified`      | 只比较 sessions 数量，crypto 24h session 与股票交易会话、不同起止区间或过时 Theta 仍可能被判可比                             | 另需相同 session calendar、合法 accrual start/end，且 `optionThetaAsOf` 等于区间起点；任一不齐则 `calibration-required`                                                     |
| E-047 | P1     | 旧字段无审计适配且假装 canonical   | `verified`      | Skill 直接回退 `rho/halfLifeDays`；alias 指向不存在的说明字符串，fee tier 还被假装成 fee-income 别名                         | 主查询只读 canonical；别名必须指向真实字段；非等价旧输入进入 `deprecatedInputs` 并拒绝，带符号变换公开 `transform`                                                          |
| E-048 | P1     | 证据审计可假绿                     | `verified`      | 不检查 tests、`.agents`、ERRATA 全覆盖、状态一致性和 Markdown 锚点，路径陈旧、坏链接或漏项仍能通过                           | 机器表逐条登记 `errataCoverage`；审计校验连续 ID、状态、公式映射、本地路径、标题锚点与公式聚合状态                                                                          |
| E-049 | P2     | 流动性网格参数不可追溯             | `verified`      | `priceGrid` 缺失时会使用离散网格，但输出未记录最终网格数，复现实验无法确认数值积分分辨率                                     | 结果显式输出 `params.priceGrid`；它是离散精度参数，不是 60 日持有期，也不是统计窗口                                                                                         |
| E-050 | P2     | 数据新鲜度评分存在无效分支         | `verified`      | `stale>10` 已扣完基础分，后续 `stale>30` 再扣分经 clamp 后无任何效果，却像第二个有效阈值                                     | 删除不可达的重复扣分；若未来增加分段目标函数，每段必须确实改变输出                                                                                                          |

## 逐项验收条件

### E-001 — 历史前缀未来泄漏

- 错：`deriveWindows(rows.length)` 一次求出全样本窗口，再用于所有历史索引。
- 对：在索引 `t` 用 `deriveWindows(t+1)`，或让 query 自己基于可见前缀推导。
- 条件：显式用户情景窗口可以固定，但必须带 `windowMode=explicit-scenario`，不能伪装为自适应。
- 防复发：对同一前缀分别计算 `path(prefix)` 与 `path(prefix+future).slice(0,prefix.length)`，字段逐点相等。
- 涉及：`src/domain/market-data/cost.js`、`src/domain/market-data/formulaPath.js`。

### E-002 — 年化交易日基准漂移

- 错：脚本内自建 `crypto ? 365 : 252`，或研究模块用无市场来源的 252 默认。
- 对：调用 `src/domain/market-data/tdpy.js::inferTdpy()`，或由带 `market/symbol` 来源的上游显式传入并记录 basis。
- 条件：242/252 是模型年化口径；精确到期和结算仍需真实交易所日历。
- 防复发：A股、港股、美股、加密、未知市场逐类契约测试；生成器和研究模块不得定义第二份无来源映射。

### E-003 — LP 费用单位

- 错：`uniswapV3HedgedInventory` 把传入 `fees` 再乘 `strikePrice`，其他路径直接相加。
- 对：金额统一叫 `feeIncomeQuote` 并直接进入 quote-currency 台账；费率只叫 `feeTierFraction`。
- 条件：从费率得到金额必须具备 `volumeQuote × liquidityShare × inRangeFraction × horizon` 和成本路径。
- 防复发：向所有 LP 组合函数增加同一 `feeIncomeQuote=10`，总值都应严格增加 10，而不是 `10*price`。

### E-004 / E-015 — `.875`、87.5% 与三个不同量

必须分开：

1. `recoveryFraction`：结构目标相对周期起点至成本锚的距离比例，随标的和时点变化。
2. `ckDownWidthFraction`：CK 算术价格区间的下行宽度。
3. `endpointFourthRoot`：CK 端点比的四次方根。

锚点本身对应 `recoveryFraction=1`，在渐近 AR 路径下时间趋于无穷，不能把它静默裁成 0.875。CK Part 2 在 `alpha=0` 时：

```text
-5u + 3 = 0
u = 3/5
x = 1 - u^4 = 0.8704
```

所以 87.5% 既不是所有标的的 recovery fraction，也不是这个 CK 特例的精确结果。但它并非毫无数学来源：对同一条指数半衰路径，若**先声明**观察点就是三次半衰期，则

```text
q(H)=1-2^(-H/halfLifeSessions)
q(3*halfLifeSessions)=1-2^-3=7/8=0.875
```

这是“给定三次半衰期后的条件修复比例”恒等式，不是从标的数据估出来的 q，也不能证明 CK 在当前已核验的 Part 2 中把它当偏斜最优值。没有直接来源前，不把该归因写成已确认事实。

### E-005 — Delta 与退出目标

- 错：`resolveDeltaSlope({ targetReturn })`。
- 对：`resolveDeltaSlope({ deltaSlope })`；退出计划只读 `exitTargetReturn`。
- 条件：迁移期如必须读旧数据，应在边界层显式报 deprecated/missing，而不是静默回退。
- 防复发：只传 `targetReturn` 时 GetDelta 应返回缺失或使用明确的 `deltaSlope` 默认策略对象，绝不能改变公式带。

### E-006 / E-014 — CK 推导

对称边界：

```text
CE(x) = 1 / (1 - ((1-x)/(1+x))^(1/4))
CE''(x)=0
x* = sqrt(5+2sqrt(10))/4 = 0.8412994160945599
```

这是 CK 声明目标下的精确几何结论，不是经验公式。偏斜边界同样是 CK Part 2 的几何方程：

```text
3 alpha u^5 - 5 alpha u^4 - 5u + 3 = 0
x = (1-u^4)/(1+alpha u^4)
```

需要修正的不是方程，而是两层混写：

- `lawClaimClass=exact-identity`：给定 alpha 的 CK 几何。
- `alphaClaimClass=sample-estimate`：从历史涨跌幅尺度估 alpha。
- `applicationClaimClass=scenario-proxy`：把样本 alpha 代入 CK 几何。

数值求根不等于“经验公式”。它只是精确方程的近似数值表示。来源：[CK Part 1](https://medium.com/@med456789d/uniswap-v3-math-insights-part-1-of-6-f85e1597b411)、[CK Part 2](https://medium.com/@med456789d/uniswap-insights-part-2-of-6-568632aa4d8)、[对称 Desmos](https://www.desmos.com/calculator/ysv2j74j6k)、[偏斜 Desmos](https://www.desmos.com/calculator/0l7i8kmukx)。

### E-007 — Funding 三层字段

| 层           | 正确字段                 | 含义                                            |
| ------------ | ------------------------ | ----------------------------------------------- |
| 同期基差     | `basisFraction`          | `perpTwap/spotTwap - 1`                         |
| 简化累计     | `cumulativeFundingProxy` | 当前线性规则在声明 hours 上的代理               |
| 带符号现金流 | `fundingCashflowQuote`   | quote 金额；正数收到、负数支付；没有就为 `null` |
| 现金流来源   | `fundingCashflowSource`  | `observed-settlement` 或 `explicit-scenario`    |

旧字段 `fundingProxy` 必须退役或只作显式 deprecated alias。累计代理已经包含 horizon，不能再次乘 `holdingDays/tdpy`。

### E-008 — IL 家族

- `fullRangeV2IlProxy`：全范围常数乘积 v2、无费用、相对 HODL 的静态比率。
- `rangeV3Il`：指定 `lowerPrice/upperPrice`，用同一入场库存和资本做 HODL 对照。
- `lpPnl`：绝对币种损益；与 IL fraction 不同。
- `netLpReturn`：还需同周期费用、对冲、funding、gas/rebalance 等现金流。

任何一层都不能用另一个字段名代替。

### E-009 / E-010 — 复现统计

- kNN 半径排名只是 `empiricalRadiusRank`。没有 exchangeability、校准集和覆盖验证，不能叫 conformal。
- 一个命中 episode 是连续命中索引 `[start,end]`。
- leave-then-reentry 等待为 `next.start - previous.end`；start-to-start 会额外混入前一 episode 的内部停留。
- `currentEpisodeAge=index-currentEpisode.start` 是正在命中邻域内的年龄，不是“离开后尚未再进入”的右删失时长。
- 完整等待样本可做 KM/Greenwood；若没有合法右删失，必须输出 `censoredCount=0` 和限制说明。

### E-011 / E-016 — 周期与可知时点

正确事件顺序：

```text
T close: 冻结成本锚、结构目标、AR 样本估计
T+1 open: 周期起点价格首次可知，计算 recoveryFraction 和公式周期
以后路径: 才能观察是否触达、实际等待和费用
```

因此：

- 不存在全局“至少持有 30 天”的规则。
- 30/60/90 只能是用户明确选择的压力测试期限，且 `horizonMode=explicit-scenario`。
- 历史回放使用实际 next open 可以评价旧规则，但不能把该开盘价伪装成 T 收盘已知参数。

### E-012 / E-013 — 两个常见比喻的边界

`fee ≈ theta` 只有在 currency、notional、sign 和 horizon 对齐后才是风险经济学类比。LP 路径费用受成交量、流动性份额、是否在区间、再平衡与 gas 影响；期权 Theta 是模型局部时间敏感度，两者机制不同。

“流动性即概率分布”只能作为建模语言：把非负流动性权重归一化可以得到 model mass，但只有经过明确结果标签、统计校准、持出/前向覆盖检验，才可能升级为 `calibrated-estimate`。当前不得写成价格概率、回归概率或做市商意图概率。

### E-017 — 波动率区间是 IID 正态近似，不是稳健置信区间

当前 `volConfidence` 使用：

```text
SE(sigma) ≈ sigma/sqrt(2n)
interval = sigma ± z*SE(sigma)
```

它只在独立、同分布、近似正态收益和局部常波动假设下作样本不确定性近似。输出必须包含 `claimClass=sample-estimate`、假设、样本量、名义置信水平和 `isRobustConfidenceInterval=false`；厚尾、自相关、波动聚类环境需要 bootstrap、HAC 或专门波动模型。防复发测试位于 `src/domain/__tests__/secondOrderFormulas.test.js`。

### E-018 — 裸短名只允许留在局部代数

- 对外 canonical 字段使用 `recoveryFraction`、`arCoefficient`、`arDecayRatePerStep`、`optionThetaPerSession`、`optionRhoPerPct`、`inventoryDeltaToken0` 等全名。
- 旧输出必须由 `src/domain/formulas/legacyAliases.js` 生成唯一映射，并带 `deprecated=true`、真实 `legacyAliasOf`；若数值还需变换，必须再带 `transform`。
- 不能等价迁移的旧输入（例如 pool `feeRate` 当已实现费用、anchor 分母的 `costDistance` 当目标收益）只能进入 `deprecatedInputs` 并拒绝计算，不能伪造 alias。
- 主 Skill 查询不再静默消费 `rho/halfLifeDays`。防复发覆盖见 `src/domain/__tests__/legacyAliasContract.test.js` 与 Skill runtime 检查。

### E-019 / E-020 — 周期必须与方向、终点和实际起点同一

`H` 不是可以在不同信号间共享的“标的周期”，而是一个有方向的 target-specific quantity：

```text
horizonKey = (side, cycleStartPrice, anchorPrice, targetPrice, targetSource, frozenAt, availableAt)
```

- long 侧 `cycleStartPrice < costLower < costAnchor` 的 `H(costLower)` 只能用于该 long 修复 milestone。
- 若买入计划的真实目标改为 `costAnchor` 或更高的 `exitTargetReturn`，必须用新终点重算；不能沿用 `H(costLower)` 当到期时间。
- 上侧 sell 信号不能复用 long/costLower 周期。只有定义并验证了 short 侧锚、目标和方向后才能独立求 `H_short`；否则保持 `missing-input`。
- T 收盘只能冻结当时可知的 anchor、target 和 AR 估计。如果建仓发生在 T+1，则必须用真实 fill price 重算 q/H；在成交前只能显示 signal-context 研究值。

防复发测试至少包括：上侧 sell 不能消费 long/costLower H；gap-open 改变起点时 q/H 必须变化；计划目标与 horizon target 不同时必须被门禁拒绝。

### E-021 — IL 归因必须保留模型和对照基准

`impermanentLoss=-4%` 单独不是可审计输入。归因边界至少要求：

```text
ilModel, startPrice, markPrice, lowerPrice, upperPrice,
entryInventory/capitalBasis, feeTreatment, horizon
```

v2 全范围几何可以保留为 `fullRangeV2IlProxy`，但不能进入声称 v3 range 的净 LP 归因。零流动性/零入场资本时比率未定义，应返回 `null`/`missing-input`，不能写成 IL=0。

### E-022 — 退出收益字段的唯一语义

- `exitTargetReturn`：仓位退出目标的情景收益率。
- `minimumGrossReturn`：策略 profile 接受一个结构 milestone 的最低毛收益门槛。
- `fixedTargetReturn`：仅在明示 `explicit-scenario` 中决定固定目标价。

三者不能共用 `targetReturn`。迁移层可读取旧字段，但必须输出 deprecated 状态且不得再把旧名写入新 graph/order 契约。

### E-023 — Replay 起点也必须因果不变

不只指标值需要前缀不变，回放的 eligible set 和起点也必须满足：

```text
replay(prefix).events == replay(prefix + future).events filtered to prefix boundary
```

以最终 `rows.length` 计算 warmup 会使追加未来数据改变历史起点。合法方式是逐点判断公式所需的有效样本，或在回放开始前冻结一个可追溯的 calibration split。

### E-024 / E-025 — 规范名称与自适应特征契约

AR 主路径对外使用 `arCoefficient`、`arDecayRatePerStep`、`halfLifeSessions`；Funding 使用 `basisFraction`、`cumulativeFundingProxy`、`fundingCashflowQuote` 和 `fundingCashflowSource`。`rho/theta/halfLifeDays/fundingProxy/fundingCost` 可暂时作迁移别名，但必须存在一个可审计的 adapter，并带 `deprecated` 和 `legacyAliasOf`；研究结果不得继续产生新的裸名字段。

自适应市场/回撤窗口必须输出 `windowSpec`，至少包括样本数、fast/slow 滞后、最低样本数、模式与可知时点。`drawdownSpeed5/20`、`momentum5/20`、`costSlope5` 的数字后缀不再表示真实固定周期，所以必须从主契约退役，不能出现在新策略逻辑中。

### E-026 — 多批次仓位必须各自退出

- 错：把所有加仓批次合成一个平均 target/stop，或用最大 `expiresAt` 延长旧批次。
- 对：每个 fill 创建唯一 `lotId`，冻结 `baseAmount`、`investedCost`、`targetPrice`、`stopPrice`、`formulaHorizonSessions`、`horizonBinding`、`expiresAt` 与 `eligibleExitIndex`。
- 条件：组合数量和成本可以求和；退出判断必须逐 lot。主动减仓若跨批次，必须明确成本分摊规则，当前采用按 base 比例分摊。
- 防复发：两个不同 target/expiry 的 lot 在先后触发时只关闭对应批次，剩余批次绑定对象保持不变。

### E-027 — OHLC 日线内退出必须披露不可识别性

仅有 OHLC 时无法知道开盘之后同一根 K 线内是目标先到还是止损先到，因此正确做法不是“猜得更准”，而是先保留已知开盘信息，再固定可审计规则：

```text
open >= target => target gap-through fill at open
open <= stop   => stop gap-through fill at open
otherwise:
  stopHit = low <= stop
  targetHit = high >= target
  bothHit => stop-first-conservative
  singleHit => threshold-touch fill at stop/target
```

该结果只是日线执行代理；有分钟或逐笔数据时应替换，而不是与其混合。

### E-028 — 资本分母与成交额分开

```text
usedNotional = max_t(openCostBasis_t)
returnOnUsedNotional = totalPnl / usedNotional
totalNotional = sum(abs(tradeNotional_i))
```

`totalNotional` 衡量换手，不能衡量资金占用。初始底仓必须进入峰值占用；融资、保证金和衍生品资本另建独立账本。

### E-029 — 期权到期不是修复周期

```text
timeToExpiryYears = timeToExpirySessions / tradingDaysPerYear
```

`formulaHorizonSessions` 回答“在冻结 AR 情景下修复到某结构目标需要多少会话”；`timeToExpirySessions` 回答“期权合约还剩多少交易会话”。二者偶然相等也不能互相回退。没有真实合约到期或明确期权情景时，Greeks/组合期权腿保持 `missing-input`。

### E-030 — Missing fee 不等于 zero fee

- `feeIncomeQuote=null`：费用现金流未知，净 LP/组合归因不能完成。
- `feeIncomeQuote=0`：明确观测或显式情景为零，可进入台账。
- `feeTierFraction`：协议费率，不是头寸收入；必须再结合路径成交额、流动性份额、in-range 比例和成本。
- 回放交易费 `replayFeeRate` 同样必须显式传入；skill CLI 不再提供隐藏 0.11% 回退。

### E-031 — 成交量价格分布窗口

未给 viewport 时，`rowsUsed=rows[0..activeIndex]`；给出 viewport 时，才从可见前缀末端截取 `requestedWindowSessions`。输出必须含 `mode`、`visiblePrefixRows`、`requestedWindowSessions`、`appliedRows` 和 `futureRowsUsed=false`。该图仍是 OHLCV volume-by-price proxy，不是真实持仓分布。

### E-032 — 历史信号与来源元数据必须同一前缀

历史信号在 t 的数值、状态和 provenance 必须共享 `rows[0..t]`：

```text
dataThrough_t = rows[t].date
rows_t = t + 1
freshness_t = freshness(rows[0..t])
candidateStatus_t = candidateStatus(rows[0..t])
```

用最终 CSV 的最后日期或总行数回填旧信号，会让未来数据改变过去的可执行状态，属于未来泄漏。

### E-033 — 外部 marketStates 必须可验证

外部缓存路径只满足 `length===rows.length` 不能证明它是因果的。canonical 构建器现在给整条路径写入不可枚举 provenance fingerprint，并给每点写 `rows/asOfDate/windowSpec.visiblePrefixRows/futureRowsUsed`。回放只在 fingerprint、点位日期、收盘价和前缀计数全部匹配时复用；克隆、篡改或来源不明的路径一律内部重算，`marketStateSource` 记录回退原因。

### E-034 — 新成交日的完整 OHLC 不能当作成交后路径

日线限价可能在盘中才成交；整根 K 线的 high/low 同时包含成交前和成交后信息。当前日线引擎统一给新 lot 写：

```text
eligibleExitIndex = fillIndex + 1
sameBarExitPolicy = defer-to-next-complete-bar-after-fill
```

这是一条分辨率保守规则，恰好兼容 A 股 T+1，但不能冒充所有市场的 settlement rule。港股、美股或加密的 T+0 日内退出必须接入分钟/逐笔路径和市场交易规则后另算。

### E-035 — 开盘跳空先于盘中歧义

若 `open>=target`，开盘目标成交发生在任何日内 low 之前；若 `open<=stop`，开盘止损同理。因此 stop-first 只能处理“open 位于 stop 与 target 之间、后来 high/low 双触发”的未知顺序，不能覆盖已经知道的开盘事件。

### E-036 — 会话期限统一向上取整

会话是离散计数。对正小数情景期限 `h`，到期索引使用 `ceil(h)`，这样不会比用户声明的期限更早；`round(h)` 可能少持有一个完整会话，已从初始 lot 路径移除。

### E-037 — UI 公式表必须与可执行 domain 同源

`formulaStages` 会直接进入公式抽屉，不是无害注释。它必须和生产 query 使用同一词汇与时间基：波动年化写 `sqrt(tradingDaysPerYear)`，GetDelta 写 `formulaHorizonSessions/(tradingDaysPerYear*2*pi)`，AR 输出 `arCoefficient/arDecayRatePerStep/halfLifeSessions`，回撤峰值使用截至当前时点的前缀峰值或显式情景窗口。没有生产实现和证据链的“质数 179/e/pi 周期”不得作为公式展示。

### E-038 / E-039 — Greek 缺失传播与单位

- 对 BSM，规范字段为 `optionDelta`、`optionGamma`、`optionThetaPerSession`、`optionThetaAnnual`、`optionVegaPerPct`、`optionRhoPerPct`。
- `optionThetaPerSession=optionThetaAnnual/tradingDaysPerYear`，这里的一步是交易会话，不是自然日。
- 对当前 Bachelier 实现，未计算的 Theta/Rho 必须为 `null`；组合聚合时只要有一条有效腿缺该 Greek，组合对应值也为 `null`，不能通过 `?? 0` 伪装成零风险。
- 兼容字段只能由带 `deprecated/legacyAliasOf` 的边界生成；新 domain、store 和 UI 不再消费裸 `delta/gamma/theta/rho`。

### E-040 — LP 库存敏感度必须命名其资产单位

按 token1 计价时，v3 头寸价值对 token0 价格的一阶敏感度等于当前 `token0` 库存，因此规范名是 `inventoryDeltaToken0`。v2 简化式若叠加线性 hedge，则要分开 `lpInventoryDeltaToken0=L/sqrt(markPrice)` 与 `netInventoryDeltaToken0=lpInventoryDeltaToken0-hedgeSize`。它们都不等于期权 Delta，也不应以裸 `delta` 穿过模块边界。任何旧别名都要公开 `deprecated=true` 和唯一 `legacyAliasOf`。

### E-041 — 流动性指纹的波动宽度需要完整时间基

模型 bump 的宽度若由年化波动构造，至少需要：

```text
sessionVolatility = annualVolatility / sqrt(tradingDaysPerYear)
logSigma = declaredScale * sessionVolatility
```

`declaredScale` 是可见模型设定，不是统计估计。`annualVolatility` 或 `tradingDaysPerYear` 缺失时，不允许回退到 35% 或 365；查询应返回 `null/missing-input`。即使输入完整，归一化结果仍只是 model allocation mass，不是未来价格概率。

### E-042 — TDPY 不能在下游重新猜测

E-002 修正了已识别市场映射，但最终扫描发现 `inferTdpy` 对未知市场仍返回 365，多个下游也仍写 `Number(tradingDaysPerYear) || 365` 或函数参数 `=365`。这会把“市场未识别/输入缺失”伪装成有效加密口径。正确数据流只有：

```text
source market/symbol -> inferTdpy -> explicit query input -> formula output
```

用户覆盖必须按 symbol 保存并带来源；未知市场若采用情景值，必须显式标 `explicit-scenario`。任何 domain query 缺 TDPY 时都应返回 `null/missing-input`，默认挂单和回放保持关闭。测试中的 `365` 只可作为明确写出的加密/审计夹具。

### E-043 — 历史源码不能只靠注释隔离

- 错：根目录旧 Pine 仍可直接复制运行、生成旧固定周期信号和告警，而常规 `verify:pine` 只验证 canonical 文件。
- 对：旧路径是 inert compatibility stub；完整旧源码只在 `research/archive/pine/` 保存，清单声明 `formulaAuthority=none`、`signalAuthority=none`、`executable=false`。
- 防复发：`verify-pine.mjs` 检查三个兼容文件必须保留 archive 指针和 `plot(na)`，并禁止 `input.*`、`alertcondition()` 与 `strategy.*`。
- 历史推荐池：`src/data/recommended-pools/` 是被忽略的写入型快照目录，runtime 不读取；其中旧字段只作历史证据，不能作为当前公式或筛选输入。

### E-044 — Funding 净 carry 必须先统一方向、分母与周期

`costDistance=(mark-anchor)/anchor` 不是从成交起点回到目标的收益。以 `start=80,target=100` 为例，anchor 分母给 20%，但实际 long 毛收益为 25%。正确关系是：

```text
long:  grossRecoveryReturn = targetPrice/cycleStartPrice - 1
short: grossRecoveryReturn = (cycleStartPrice-targetPrice)/cycleStartPrice

positive funding proxy convention: long pays, short receives
fundingCashflowReturn = fundingPositionSide == long ? -proxy : proxy
fundingNetCostReturn = -fundingCashflowReturn
netCarry = grossRecoveryReturn + fundingCashflowReturn
breakEvenFundingNetCostReturn = grossRecoveryReturn
```

- `recoveryNotionalBasis` 必须和 `fundingNotionalBasis` 完全一致。
- `comparisonHorizon` 必须声明 sessions、每 session 小时数、calendar id、来源和非空 `availableAt`；累计 proxy 的 hours 必须与该映射一致。
- `breakEvenFundingNetCostReturn` 是同名义 funding **净成本**阈值，不是 raw proxy 常数，也不是当前已发生拖累。
- 不再输出无来源的 `requiredReturn=breakEven+1%`；旧 `costDistance/fundingRate/fundingCost` 入口因缺方向、分母和周期而拒绝产出数值。

### E-045 — Funding proxy 与真实现金流分账

`cumulativeFundingProxy` 只来自简化的 perp/spot 基差线性外推，不能乘总资本后改名为 settlement。组合使用带符号的 `fundingCashflowQuote`：正数是收到，负数是支付，并要求 `fundingCashflowSource=observed-settlement|explicit-scenario`。只有 `observed-settlement` 可满足正式结算门禁；`explicit-scenario` 仍只进入情景总额。

### E-046 — fee-theta 需要同一交易日历和估值时点

除 currency、notional、sign、session count 与 option tenor 外，还必须满足：

```text
feeSessionCalendarId == optionSessionCalendarId
feeAccrualStart < feeAccrualEnd
optionThetaAsOf == feeAccrualStart
```

这样才能把局部 Theta 在明确区间内作“常数近似积分”。仍不能由此推出 LP 等价短期权或费用稳定覆盖 Gamma/跳跃损失。

### E-047 — 兼容输入分成 alias 与 rejected input

真正同值同义的旧字段可以映射到一个存在的 canonical 字段。需要换符号的 `fundingCost -> fundingCashflowQuote` 必须披露 `transform=negate-cost-positive-to-cashflow-positive`。并非同一量的 `feeRate`、旧 `costDistance/fundingRate` 不再出现在 `legacyAliases`，而是进入带原因和替代输入清单的 `deprecatedInputs`。

### E-048 — 勘误和证据链本身也要机器校验

`source_coverage_audit.py` 必须同时检查：E-ID 连续且全覆盖、ERRATA 与机器表状态相同、formulaId 映射存在、公式 `correctionStatus` 等于所关联勘误的聚合状态、implementation/tests/本地 sources 文件存在，以及 `ERRATA.md#...` 精确指向真实三级标题。否则“审计通过”本身没有证据价值。

### E-049 / E-050 — 数值精度参数与评分分支必须可观察

`priceGrid` 是流动性密度数值离散的点数，必须回显在结果参数中；它不是持仓周期。数据新鲜度评分中，任何阈值分支都必须能改变最终分数；已经被前一分支扣到零后再扣分的死分支应删除，避免让读者误以为存在第二个有效目标函数断点。

## 升级为 `verified` 的统一检查

1. `pnpm test` 通过。
2. `pnpm run audit:formulas` 通过，机器主表 JSON 可解析。
3. `pnpm run verify:pine` 通过。
4. `pnpm run build` 通过。
5. E-001 的追加未来不变性测试通过。
6. E-001 至 E-050 每项都有最小防复发断言，或对 `accepted-risk` 条目有禁止推论/边界测试。
7. 全仓搜索不再出现未豁免的隐藏固定周期、`.875`、模糊 `targetReturn`、裸 `impermanentLoss`、`conformalRank` 和混义 `fundingProxy`。兼容别名必须被定位在带 `deprecated/legacyAliasOf` 的审计白名单。
8. 测试夹具或显式情景中的固定数字必须在审计白名单中带原因，不得靠字符串全禁造成误报。
