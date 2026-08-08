// ESLint flat config（eslint 10 默认要求）。
// 规则定位：先建立基线，不大改现有代码风格；与 prettier 协作，
// 由 eslint-config-prettier 关掉所有格式相关规则。
import js from '@eslint/js'
import vue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default [
  // 全局忽略（构建产物、依赖、生成数据）
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src/data/generated/**',
      'src/data/.generated-*/**',
      'src/data/recommended-pools/**',
      'src/data/recommended-pool-latest.json',
      'public/recommended-pool/**',
      'coverage/**',
      '.agents/**',
      '.claude/**',
      '.venv/**',
      'scripts/_*.mjs',
    ],
  },

  // 通用 JS / MJS
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // Vue 单文件组件
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // 工作台组件命名（LeftPanel/TopBar 等）与项目风格一致，关闭 multi-word
      'vue/multi-word-component-names': 'off',
      // 让 prettier 管 HTML 自闭合与缩进，这些规则会重复打架
      'vue/html-self-closing': 'off',
      'vue/html-indent': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-closing-bracket-newline': 'off',
      // 历史债务：80+ 处直接 mutate props。当前降级为 warn，列入渐进式修复
      // 计划。新代码遵循 props down / emit up，旧代码逐步迁移
      'vue/no-mutating-props': 'warn',
    },
  },

  // 关键守门员：src/domain/ 禁止 import 框架/UI 库（与 check-domain-boundaries.mjs 双保险）
  {
    files: ['src/domain/**/*.{js,mjs,vue}'],
    ignores: ['src/domain/**/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'vue', message: 'src/domain/ 不允许 import vue（DDD 边界，见 AGENTS.md）' },
            { name: 'pinia', message: 'src/domain/ 不允许 import pinia（DDD 边界）' },
            { name: 'lightweight-charts', message: 'src/domain/ 不允许 import 图表库（DDD 边界）' },
          ],
          patterns: [{ group: ['vue/*', '@vue/*'], message: 'src/domain/ 不允许 import vue/* 子路径' }],
        },
      ],
    },
  },

  // 测试文件：放宽 console 与 unused-vars
  {
    files: ['**/__tests__/**/*.{js,mjs,vue}', '**/*.{test,spec}.{js,mjs}'],
    rules: {
      'no-console': 'off',
      'no-unused-vars': 'off',
    },
  },

  // scripts/ 是 Node 脚本，允许 console 与 process
  {
    files: ['scripts/**/*.{js,mjs}'],
    rules: {
      'no-console': 'off',
    },
  },

  // 必须放最后：关闭与 prettier 冲突的格式规则
  prettier,
]
