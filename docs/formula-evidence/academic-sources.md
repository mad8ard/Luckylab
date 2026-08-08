# Academic and Protocol Sources

外部论文和白皮书只进入 evidence/source 层，用来补充对照和约束，不直接改写默认执行策略。

## Option Models

| Source | Evidence use |
| --- | --- |
| [Black and Scholes, 1973, The Pricing of Options and Corporate Liabilities](https://www.cs.princeton.edu/courses/archive/fall08/cos323/papers/black_scholes73.pdf) | vanilla option benchmark, Greeks sanity checks |
| [Bachelier, 1900, Theory of Speculation](https://www.worldscientific.com/doi/abs/10.1142/9789812770698_0001) | normal-vol / Bachelier research model |
| [How close are Bachelier and Black-Merton-Scholes?](https://arxiv.org/abs/0711.1272) | short maturity Bachelier vs BSM comparison |

## AMM / LP

| Source | Evidence use |
| --- | --- |
| [Uniswap v3 Whitepaper](https://blog.uniswap.org/whitepaper-v3.pdf) | protocol math for concentrated liquidity and virtual reserves |
| [Atis Elsts, Liquidity Math in Uniswap v3](https://atiselsts.github.io/pdfs/uniswap-v3-liquidity-math.pdf) | engineering formula reference for token amounts and liquidity |
| [Uniswap concentrated liquidity docs](https://developers.uniswap.org/docs/get-started/concepts/liquidity-providers/concentrated-liquidity) | protocol-facing explanation of ranges and capital concentration |
| Mathematics of Constant Product AMMs | LP value, Delta/Gamma, option replication framing |
| Delta Hedging Liquidity Positions on AMMs | arbitrary LP position hedge framing |
| [Concentrated Liquidity in Automated Market Makers](https://arxiv.org/abs/2110.01368) | empirical concentrated-liquidity strategy comparison |
| [Strategic Liquidity Provision in Uniswap v3](https://arxiv.org/abs/2106.12033) | LP strategy and fee/price-range behavior |
| Generalizing Impermanent Loss on DEXs with CFMMs | IL beyond one AMM family |

## Funding / Perpetuals

| Source | Evidence use |
| --- | --- |
| [Fundamentals of Perpetual Futures](https://arxiv.org/abs/2212.06888) | funding as convergence mechanism, not simple price diff |
| [Perpetual Futures Pricing](https://arxiv.org/abs/2310.11771) | no-arbitrage pricing and funding specifications |
| [Designing funding rates for perpetual futures in cryptocurrency markets](https://arxiv.org/abs/2506.08573) | funding schedule design and clamp/cap constraints |
| [Perpetual Futures Contracts and Cryptocurrency Market Quality](https://papers.ssrn.com/sol3/Delivery.cfm/4218907.pdf?abstractid=4218907) | funding settlement hour and market quality effects |

## 使用规则

- `paper` source 可以提升公式解释质量，但不能绕过 domain 测试进入执行结论。
- `protocol-whitepaper` source 可以支撑协议数学，但真实仓位仍需要真实 LP position 输入。
- 没有真实交易所 schedule 的 funding 只能是 `proxy-only`。
- probability-of-touch、net carry、mean reversion 等近似必须标为 `heuristic`。
