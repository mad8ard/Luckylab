// A 股四步漏斗的统一数量配置。总池从 303 收缩到 224 后，各层同步收缩约 30%。

export const A_SHARE_FUNNEL = Object.freeze({
  firstStage: Object.freeze({
    total: 35,
    focus: 18,
    wait: 17,
  }),
  secondStage: 21,
  finalStage: 10,
})
