const path = require('path')
const { spawn } = require('child_process')
const findDockerCompose = require(path.join(__dirname, 'dockerCompose.js'))

// entry point for `npm run docker-test`. works out how compose is installed here and runs the suite in containers, so that a missing compose says what to install instead of failing with "unknown command: docker compose"
const compose = findDockerCompose()

if (!compose) {
  const lines = ['']
  if (!findDockerCompose.dockerInstalled()) {
    lines.push('❌ Docker is not installed, so the containerised test suite cannot run.')
    lines.push('')
    lines.push('   Install Docker: https://docs.docker.com/get-started/get-docker/')
  } else if (!findDockerCompose.dockerRunning()) {
    lines.push('❌ Docker is installed but the daemon is not running.')
    lines.push('')
    lines.push('   Start Docker and try again.')
  } else {
    lines.push('❌ Docker is installed, but Docker Compose is not.')
    lines.push('')
    lines.push('   Compose ships separately from the Docker engine. Install it with:')
    lines.push('')
    for (const [platform, command] of Object.entries(findDockerCompose.installHints)) {
      lines.push(`      ${platform.padEnd(14)} ${command}`)
    }
    lines.push('')
    lines.push(`   (${findDockerCompose.installNote})`)
  }
  lines.push('')
  lines.push('   In the meantime `npm test` still runs every suite that needs no server.')
  lines.push('')
  console.error(lines.join('\n'))
  process.exit(1)
}

// pass through anything extra, so `npm run docker-test -- --grep foo` works
const extra = process.argv.slice(2)
const args = [...compose.args, 'run', '--rm', 'test', ...extra]
// run the container as the current user so that files it writes into the mounted source tree belong to them rather than to root. windows has no uid, and docker desktop maps ownership itself, so it is left alone there
const identity = {}
if (typeof process.getuid === 'function') {
  identity.MULTI_DB_UID = String(process.getuid())
  identity.MULTI_DB_GID = String(process.getgid())
}

const child = spawn(compose.command, args, {
  shell: false,
  stdio: 'inherit',
  cwd: path.join(__dirname, '../..'),
  env: { ...process.env, ...identity }
})
child.on('close', code => process.exit(code))
