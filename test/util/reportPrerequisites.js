const path = require('path')
const fixture = require(path.join(__dirname, 'fixture.js'))
const findDockerCompose = require(path.join(__dirname, 'dockerCompose.js'))

const RULE = '─'.repeat(78)

// say plainly what this machine cannot test and what to install to fix it, so that a skipped suite or a wall of connection errors is never a mystery
//
// returns the number of problems found, so the caller can decide whether anything needs saying
module.exports = async function reportPrerequisites () {
  const missingServers = fixture.unavailable().filter(engine => fixture.serverEngines.includes(engine))
  const missingBinaries = fixture.missingDumpBinaries()
  const unreachable = await fixture.unreachableServers()
  const problems = missingServers.length + Object.keys(missingBinaries).length + unreachable.length
  if (!problems) return 0

  const out = []
  out.push('')
  out.push(RULE)
  out.push('⚠️  MISSING PREREQUISITES — some tests will not run on this machine')
  out.push(RULE)

  if (missingServers.length) {
    // a server that is running but refusing these credentials needs completely different advice from one that is not there at all
    const rejected = missingServers.filter(engine => (fixture.serverStatus[engine] || {}).status === 'auth-failed')
    const absent = missingServers.filter(engine => !rejected.includes(engine))

    if (absent.length) {
      out.push('')
      out.push(`  No database server for: ${absent.join(', ')}`)
      out.push('  Nothing is listening where those engines were expected.')
    }

    for (const engine of rejected) {
      const { host, port, reason } = fixture.serverStatus[engine]
      const admin = fixture.resolve(engine).adminConfig
      out.push('')
      out.push(`  ${engine}: a server IS running on ${host}:${port}, but it rejected the`)
      out.push(`  credentials the suite uses (user "${admin.user}") with ${reason}.`)
      out.push('  If that server uses different admin credentials, point the suite at them:')
      out.push('')
      out.push(`      export MULTI_DB_TEST_${engine.toUpperCase()}_ADMIN_USER=<user>`)
      out.push(`      export MULTI_DB_TEST_${engine.toUpperCase()}_ADMIN_PASSWORD=<password>`)
    }

    out.push('')
    out.push('  Either way, running the suite in containers needs no local database and')
    out.push('  changes nothing about the ones you already have:')
    out.push('')
    out.push('      npm run docker-test')

    // say which piece is missing rather than pointing at a command that will not work
    if (!findDockerCompose()) { // eslint-disable-line
      out.push('')
      if (!findDockerCompose.dockerInstalled()) {
        out.push('  That needs Docker, which is not installed:')
        out.push('')
        out.push('      https://docs.docker.com/get-started/get-docker/')
      } else if (!findDockerCompose.dockerRunning()) {
        out.push('  Docker is installed but its daemon is not running. Start Docker first.')
      } else {
        out.push('  Docker is installed here, but Docker Compose is not. Compose ships')
        out.push('  separately from the engine. Install it with:')
        out.push('')
        for (const [platform, command] of Object.entries(findDockerCompose.installHints)) {
          out.push(`      ${platform.padEnd(14)} ${command}`)
        }
        out.push('')
        out.push(`  (${findDockerCompose.installNote})`)
      }
    }
  }

  if (unreachable.length) {
    out.push('')
    out.push(`  Configured but not answering: ${unreachable.map(s => `${s.engine} (${s.host}:${s.port})`).join(', ')}`)
    out.push(`  MULTI_DB_TEST_MODE is "${fixture.mode}", so these were expected to be up.`)
    out.push('  Running the suite through its own script starts the containers first:')
    out.push('')
    out.push('      npm run docker-test')
  }

  for (const [binary, engines] of Object.entries(missingBinaries)) {
    out.push('')
    out.push(`  Command not found: ${binary}`)
    out.push(`  The ${engines.join(' and ')} dump tests shell out to it, so they will be skipped.`)
    out.push('  Install it with:')
    out.push('')
    for (const [platform, command] of Object.entries(fixture.installHints[binary])) {
      out.push(`      ${platform.padEnd(14)} ${command}`)
    }
  }

  out.push('')
  out.push(RULE)
  out.push('')
  console.warn(out.join('\n'))
  return problems
}
