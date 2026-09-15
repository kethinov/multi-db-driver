const net = require('net')

// probe each server-backed engine and report whether it is absent, running but rejecting the suite's credentials, or usable
//
// this runs as a child process so that the fixture can get an answer synchronously: the test runner decides which suites exist while it is still loading the test files, long before any hook has had a chance to await anything
//
// usage: node probeServers.js '<json map of engine to { config, adminConfig }>'

const drivers = {
  mariadb: async creds => {
    const mariadb = require('mariadb')
    const pool = await mariadb.createPool({ ...creds, connectionLimit: 1, connectTimeout: 2000, initializationTimeout: 2000, acquireTimeout: 2000 })
    const conn = await pool.getConnection()
    await conn.release()
    await pool.end()
  },
  mysql: async creds => {
    const mysql = require('mysql2/promise')
    const conn = await mysql.createConnection({ ...creds, connectTimeout: 2000 })
    await conn.end()
  },
  postgres: async creds => {
    const { Client } = require('pg')
    const client = new Client({ ...creds, connectionTimeoutMillis: 2000 })
    await client.connect()
    await client.end()
  }
}

// is anything accepting connections at all? distinguishes "no server here" from "server here but it will not let us in", which need very different advice
function listening (host, port, timeout = 2000) {
  return new Promise(resolve => {
    const socket = new net.Socket()
    let settled = false
    const done = ok => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeout)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
    socket.connect(port, host)
  })
}

async function probe (engine, pair) {
  const { host, port } = pair.adminConfig
  if (!await listening(host, port)) return { status: 'no-server', host, port }
  try {
    await drivers[engine](pair.adminConfig)
    return { status: 'ok', host, port }
  } catch (e) {
    return { status: 'auth-failed', host, port, reason: e.code || (e.message || '').split('\n')[0].slice(0, 80) }
  }
}

async function main () {
  const requested = JSON.parse(process.argv[2] || '{}')
  const entries = await Promise.all(
    Object.keys(requested).map(async engine => [engine, await probe(engine, requested[engine])])
  )
  process.stdout.write(JSON.stringify(Object.fromEntries(entries)))
}

main().then(() => process.exit(0), e => {
  process.stdout.write(JSON.stringify({ error: e.message }))
  process.exit(1)
})
