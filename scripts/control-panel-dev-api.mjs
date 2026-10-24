// 控制面板的 dev 专用执行接口。
//
// 安全边界（重要）：
//   - 只在 vite serve（pnpm dev）下注册；生产构建里根本不存在这个中间件。
//   - 不接受客户端传来的任意命令：只能按 id 命中 scripts/control-commands.mjs 的白名单。
//   - 参数只允许按每条命令声明的正则逐 token 校验，且数量有上限。
//   - 同时只允许一个任务在跑，避免几条重命令互相抢资源。
//   - 每个任务有超时上限，超时强杀。

import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { COMMANDS, REPORT_PAGES, findCommand } from './control-commands.mjs'

const REPORT_DIRS = new Set([...REPORT_PAGES.map((page) => page.dir), 'control'])
const OUTPUT_LIMIT = 400 * 1024
const JOB_TIMEOUT_MS = 20 * 60 * 1000
const MAX_JOBS_KEPT = 20

export function labControlPanelPlugin() {
  const jobs = new Map()
  let runningJobId = null

  return {
    name: 'lab-control-panel',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root
      const logger = server.config.logger

      // 报告页在 public/ 下是目录形式，dev server 会把 /replay/ 这类路径
      // 交给 SPA 回退，导致打开的是主应用而不是报告页。这里做一次内部重写。
      server.middlewares.use((req, res, next) => {
        const [pathname, query] = String(req.url ?? '').split('?')
        const matched = pathname.match(/^\/([a-z0-9-]+)\/$/)
        if (matched && REPORT_DIRS.has(matched[1])) {
          req.url = `/${matched[1]}/index.html` + (query ? `?${query}` : '')
        }
        next()
      })

      server.middlewares.use('/api/lab/reports', (req, res) => {
        sendJson(res, 200, { ok: true, reports: reportStatus(root) })
      })

      server.middlewares.use('/api/lab/job', (req, res) => {
        const id = new URL(req.url ?? '/', 'http://localhost').searchParams.get('id')
        const job = id ? jobs.get(id) : null
        if (!job) {
          sendJson(res, 404, { ok: false, error: 'job-not-found' })
          return
        }
        sendJson(res, 200, { ok: true, job: publicJob(job), runningJobId })
      })

      server.middlewares.use('/api/lab/run', (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
          return
        }
        readBody(req)
          .then((body) => {
            const parsed = parseRequest(body)
            if (parsed.error) {
              sendJson(res, 400, { ok: false, error: parsed.error })
              return
            }
            if (runningJobId) {
              sendJson(res, 409, { ok: false, error: 'busy', runningJobId })
              return
            }
            const job = startJob({ root, logger, command: parsed.command, tokens: parsed.tokens, jobs })
            runningJobId = job.id
            job.onFinish = () => {
              runningJobId = null
              pruneJobs(jobs)
            }
            sendJson(res, 200, { ok: true, jobId: job.id, steps: job.steps })
          })
          .catch((error) => sendJson(res, 500, { ok: false, error: String(error?.message ?? error) }))
      })
    },
  }
}

function parseRequest(body) {
  let payload
  try {
    payload = JSON.parse(body || '{}')
  } catch {
    return { error: 'invalid-json' }
  }
  const command = findCommand(String(payload.id ?? ''))
  if (!command) return { error: 'unknown-command-id' }
  const raw = String(payload.args ?? '').trim()
  const tokens = raw ? raw.split(/\s+/) : []
  if (!command.acceptsArgs) {
    if (tokens.length) return { error: `${command.id} 不接受参数` }
    return { command, tokens }
  }
  if (tokens.length > command.acceptsArgs.max) {
    return { error: `参数最多 ${command.acceptsArgs.max} 个` }
  }
  const pattern = new RegExp(command.acceptsArgs.pattern)
  for (const token of tokens) {
    if (!pattern.test(token)) return { error: `参数 ${token} 不符合格式：${command.acceptsArgs.hint}` }
  }
  return { command, tokens }
}

function startJob({ root, logger, command, tokens, jobs }) {
  const steps = buildSteps(command, tokens)
  const job = {
    id: randomUUID(),
    commandId: command.id,
    label: command.label,
    display: command.display,
    steps: steps.map((step) => step.display),
    status: 'running',
    output: '',
    exitCode: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    stepIndex: 0,
    onFinish: null,
  }
  jobs.set(job.id, job)
  logger.info(`[control-panel] ▶ ${command.display}${tokens.length ? ' ' + tokens.join(' ') : ''}`)
  append(job, `$ ${command.display}${tokens.length ? ' ' + tokens.join(' ') : ''}\n`)

  runStep(root, job, steps, 0)
  return job
}

function runStep(root, job, steps, index) {
  const step = steps[index]
  job.stepIndex = index
  if (steps.length > 1) append(job, `\n── 步骤 ${index + 1}/${steps.length}：${step.display} ──\n`)

  const child = spawn(step.command, step.argv, { cwd: root, env: process.env, shell: step.shell === true })
  let killed = false
  const timer = setTimeout(() => {
    killed = true
    append(job, `\n[control-panel] 超时 ${JOB_TIMEOUT_MS / 60000} 分钟，已终止。\n`)
    child.kill('SIGKILL')
  }, JOB_TIMEOUT_MS)

  child.stdout?.on('data', (chunk) => append(job, String(chunk)))
  child.stderr?.on('data', (chunk) => append(job, String(chunk)))

  child.on('error', (error) => {
    clearTimeout(timer)
    append(job, `\n[control-panel] 启动失败：${error.message}\n`)
    finish(job, null)
  })

  child.on('close', (code) => {
    clearTimeout(timer)
    if (code === 0 && index + 1 < steps.length) {
      runStep(root, job, steps, index + 1)
      return
    }
    if (killed) {
      finish(job, 'timeout')
      return
    }
    finish(job, code)
  })
}

function finish(job, code) {
  job.status = code === 0 ? 'done' : 'failed'
  job.exitCode = typeof code === 'number' ? code : null
  job.endedAt = new Date().toISOString()
  append(job, `\n[control-panel] ${job.status === 'done' ? '✓ 完成' : '✗ 失败'}（退出码 ${job.exitCode ?? 'n/a'}）\n`)
  job.onFinish?.()
}

function buildSteps(command, tokens) {
  const steps = [resolveStep(command.run, tokens, command.acceptsArgs)]
  for (const extra of command.run.then ?? []) steps.push(resolveStep(extra, [], null))
  return steps
}

function resolveStep(spec, tokens, accepts) {
  const script = spec.script
  let base = [...(spec.args ?? [])]
  if (tokens.length) {
    base = accepts?.replaceTail
      ? [...base.slice(0, Math.max(0, base.length - accepts.replaceTail)), ...tokens]
      : [...base, ...tokens]
  }
  if (spec.kind === 'node') {
    return { command: process.execPath, argv: [script, ...base], display: `node ${script} ${base.join(' ')}`.trim() }
  }
  if (spec.kind === 'python') {
    return { command: resolvePython(), argv: [script, ...base], display: `python ${script} ${base.join(' ')}`.trim() }
  }
  if (spec.kind === 'pnpm') {
    const display = `pnpm run ${script} ${base.join(' ')}`.trim()
    if (process.platform === 'win32') {
      // 不要用 spawn(..., {shell:true, args})：Node 会报 DEP0190，且参数拼接不安全。
      // 显式走 cmd.exe，但把整条命令作为单个参数传入，并做转义。
      const commandLine = ['pnpm', 'run', script, ...base].map(quoteCmdArg).join(' ')
      return { command: process.env.ComSpec || 'cmd.exe', argv: ['/d', '/s', '/c', commandLine], display }
    }
    return { command: 'pnpm', argv: ['run', script, ...base], display }
  }
  throw new Error(`unknown run kind: ${spec.kind}`)
}

function quoteCmdArg(value) {
  const text = String(value)
  if (/^[A-Za-z0-9_./:=@+,-]+$/.test(text)) return text
  return `"${text.replaceAll('"', '""')}"`
}

function reportStatus(root) {
  return REPORT_PAGES.map((page) => {
    const file = join(root, 'public', page.dir, 'index.html')
    if (!existsSync(file)) return { id: page.id, label: page.label, url: page.url, exists: false }
    const stat = statSync(file)
    return {
      id: page.id,
      label: page.label,
      url: page.url,
      exists: true,
      sizeBytes: stat.size,
      updatedAt: stat.mtime.toISOString(),
    }
  })
}

function resolvePython() {
  for (const candidate of ['Scripts/python.exe', 'bin/python']) {
    const full = join(process.cwd(), '.venv', candidate)
    if (existsSync(full)) return full
  }
  return 'python3'
}

function publicJob(job) {
  return {
    id: job.id,
    commandId: job.commandId,
    label: job.label,
    status: job.status,
    exitCode: job.exitCode,
    output: job.output,
    steps: job.steps,
    stepIndex: job.stepIndex,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
  }
}

function append(job, text) {
  job.output += text
  if (job.output.length > OUTPUT_LIMIT) job.output = job.output.slice(-OUTPUT_LIMIT)
}

function pruneJobs(jobs) {
  const list = [...jobs.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  while (list.length > MAX_JOBS_KEPT) {
    const oldest = list.shift()
    if (oldest?.status === 'running') continue
    jobs.delete(oldest.id)
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 64 * 1024) req.destroy()
    })
    req.on('end', () => resolve(body))
  })
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

export const __testing = { parseRequest, buildSteps, COMMANDS, REPORT_DIRS }