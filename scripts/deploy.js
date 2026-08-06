import { NodeSSH } from 'node-ssh'
import { execSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { readFileSync, existsSync } from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// ──── 加载 .env ────
function loadEnv(filePath) {
  if (!existsSync(filePath)) {
    console.error(`\x1b[31m[deploy] ✗ 未找到 .env 文件: ${filePath}\x1b[0m`)
    console.error(`\x1b[33m[deploy]   请复制 .env.example 为 .env 并填入真实信息\x1b[0m`)
    process.exit(1)
  }

  const lines = readFileSync(filePath, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    // 跳过空行和注释
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim()
    // 只在未设置时覆盖（process.env 优先级更高）
    if (!process.env[key]) {
      process.env[key] = value
    }
  }
}

loadEnv(path.join(ROOT, '.env'))

// ──── 读取配置（全部从环境变量来，不设硬编码默认值）────
function required(key) {
  const value = process.env[key]
  if (!value) {
    console.error(`\x1b[31m[deploy] ✗ 缺少必要配置: ${key}\x1b[0m`)
    console.error(`\x1b[33m[deploy]   请在 .env 文件中设置 ${key}\x1b[0m`)
    process.exit(1)
  }
  return value
}

const config = {
  host: required('DEPLOY_HOST'),
  port: parseInt(required('DEPLOY_PORT')),
  username: required('DEPLOY_USER'),
  password: process.env.DEPLOY_PASSWORD, // 允许用 SSH key 代替密码
}

const REMOTE_DIR = process.env.DEPLOY_REMOTE_DIR || '/opt/blog'
const LOCAL_DIST = path.join(ROOT, 'dist')

// Console colors
const c = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
}
const log = (msg) => console.log(`${c.cyan}[deploy]${c.reset} ${msg}`)
const success = (msg) => console.log(`${c.green}[deploy] ✓${c.reset} ${msg}`)
const warn = (msg) => console.log(`${c.yellow}[deploy] ⚠${c.reset} ${msg}`)
const fail = (msg) => {
  console.error(`${c.red}[deploy] ✗${c.reset} ${msg}`)
  process.exit(1)
}

async function run(cmd, opts = {}) {
  const result = await ssh.execCommand(cmd, { cwd: REMOTE_DIR, ...opts })
  if (result.stderr && result.code !== 0) {
    console.error(result.stderr.trim())
  }
  return result
}

async function deploy() {
  // ──── 1. Build ────
  log('Building project...')
  try {
    execSync('pnpm build', { stdio: 'inherit', cwd: ROOT })
  } catch {
    fail('Build failed')
  }
  success('Build complete')

  // ──── 2. Connect ────
  log(`Connecting to ${config.host}:${config.port} ...`)
  try {
    await ssh.connect(config)
  } catch (err) {
    fail(`SSH connection failed: ${err.message}`)
  }
  success('SSH connected')

  // ──── 3. Check remote environment ────
  log('Checking remote environment...')
  const { stdout: dockerVer } = await run('docker --version 2>/dev/null || echo "no-docker"')
  if (dockerVer.includes('no-docker')) fail('Docker not found on server')
  success(`Remote Docker: ${dockerVer.trim()}`)

  // ──── 4. Prepare remote dir ────
  log(`Preparing ${REMOTE_DIR}...`)
  await run(`mkdir -p ${REMOTE_DIR}`)
  success('Remote directory ready')

  // ──── 5. Upload config files ────
  log('Uploading config files...')
  await ssh.putFile(path.join(ROOT, 'docker-compose.yml'), `${REMOTE_DIR}/docker-compose.yml`)
  await ssh.putFile(path.join(ROOT, 'nginx.conf'), `${REMOTE_DIR}/nginx.conf`)
  success('Config files uploaded')

  // ──── 6. Upload dist ────
  log('Uploading dist... (this may take a moment)')
  // 先删除旧文件，确保没有残留
  await run(`rm -rf ${REMOTE_DIR}/dist`)
  await ssh.putDirectory(LOCAL_DIST, `${REMOTE_DIR}/dist`, {
    concurrency: 5, // 并发上传加速
  })
  success('Dist uploaded')

  // ──── 7. Reload Docker ────
  log('Redeploying Nginx container...')
  await run('docker compose -f /opt/blog/docker-compose.yml down')
  await run('docker compose -f /opt/blog/docker-compose.yml up -d')
  success('Deploy complete!')
  console.log(`\n${c.green}  Blog is live at http://${config.host}${c.reset}\n`)
}

const ssh = new NodeSSH()

deploy()
  .catch((err) => fail(err.message))
  .finally(() => ssh.dispose())
