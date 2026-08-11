import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { buildWorkbenchSummary } from '../../domain/workbench/workbenchSummary.js'
import WorkbenchSummary from '../WorkbenchSummary.vue'

describe('WorkbenchSummary', () => {
  it('五问视图把执行状态、声明类型和公式输入翻译为用户语言', () => {
    const model = buildWorkbenchSummary({
      source: { source: 'BaoStock / AkShare', interval: '1日' },
      rows: [{ date: '2026-08-07', close: 90.04 }],
      graph: {
        decision: {
          state: '周期门禁未通过',
          executionStatus: 'blocked',
          timing: {
            side: null,
            reason: '当前结构尚未形成可用的公式周期。',
            missingInputs: ['formula-derived-horizon'],
          },
          blockedReasons: ['当前结构尚未形成可用的公式周期'],
          invalidations: [],
          reviewConditions: ['成本锚、结构目标或 AR 门禁发生变化'],
        },
      },
    })
    const wrapper = mount(WorkbenchSummary, { props: { model, defaultOpen: true } })
    const rendered = wrapper.html()

    expect(wrapper.text()).toContain('候选等待 · 执行不可执行')
    expect(wrapper.text()).toContain('市场结构：周期门禁未通过')
    expect(wrapper.text()).toContain('样本估计')
    expect(wrapper.text()).toContain('等待方向、前向结构目标与 AR 单调衰减门禁同时成立')
    expect(rendered).not.toContain('blocked')
    expect(rendered).not.toContain('sample-estimate')
    expect(rendered).not.toContain('formula-derived-horizon')
  })
})
