// database connection details for the test suite
//
// every test reads its connection details from here so that no test needs to know how the databases it talks to got there. MULTI_DB_TEST_MODE selects which provisioner supplies the servers:
//
//   auto     - use whatever is already running on this machine (the default)
//   docker   - servers supplied by docker compose; see docker-compose.yml
//   embedded - real servers started from npm packages; no docker required
//   none     - only the engines that need no server at all
//
// hosts and ports can be overridden per engine with MULTI_DB_TEST_<ENGINE>_HOST and MULTI_DB_TEST_<ENGINE>_PORT, which is how compose points the suite at its service hostnames

const net = require('net')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const mode = process.env.MULTI_DB_TEST_MODE || 'auto'
const serverEngines = ['mariadb', 'mysql', 'postgres'] // the engines that need a server process
const serverlessEngines = ['pglite', 'sqlite'] // the engines that run with no server at all

// credentials the suite expects on each server. the admin credentials must be valid on arrival; the regular user and database are what the cli.js --create tests create for themselves
const credentials = {
  mariadb: {
    port: 3306,
    user: 'mariadb_multi_db_tests_user',
    password: 'mariadb_multi_db_tests_password',
    database: 'mariadb_multi_db_tests_database',
    adminUser: 'root',
    adminPassword: 'password',
    adminDatabase: 'mysql'
  },
  mysql: {
    port: 3306,
    user: 'mysql_multi_db_tests_user',
    password: 'mysql_multi_db_tests_password',
    database: 'mysql_multi_db_tests_database',
    adminUser: 'root',
    adminPassword: 'password',
    adminDatabase: 'mysql'
  },
  postgres: {
    port: 5432,
    user: 'postgres_multi_db_tests_user',
    password: 'postgres_multi_db_tests_password',
    database: 'postgres_multi_db_tests_database',
    adminUser: 'postgres',
    adminPassword: 'postgres',
    adminDatabase: 'postgres'
  }
}

// connection details for every engine. the serverless engines are always available; the server-backed ones stay null until they are provisioned
const provisioned = {
  mariadb: null,
  mysql: null,
  postgres: null,
  pglite: {
    config: {
      database: './test/pglite-db'
    }
  },
  sqlite: {
    config: {
      database: './test/sqlite-db/sqlite_multi_db_tests_database.sqlite'
    }
  }
}

// reading a config hands back a fresh copy every time. the driver writes flags such as multipleStatements onto whatever config object it is given, so a shared object would leak one test's mutations into the next
const configs = {}
for (const engine of Object.keys(provisioned)) {
  Object.defineProperty(configs, engine, {
    enumerable: true,
    get: () => provisioned[engine] && structuredClone(provisioned[engine])
  })
}

// the command each engine's --dump-schema and --dump-data shell out to. pglite has no dump support in cli.js, so it has no entry
const dumpBinaries = {
  mariadb: 'mysqldump',
  mysql: 'mysqldump',
  postgres: 'pg_dump',
  sqlite: 'sqlite3'
}

// how to get each of those, for telling someone what to install rather than just failing
const installHints = {
  mysqldump: {
    'Debian/Ubuntu': 'sudo apt install default-mysql-client',
    macOS: 'brew install mysql-client',
    Windows: 'choco install mysql'
  },
  pg_dump: {
    'Debian/Ubuntu': 'sudo apt install postgresql-client',
    macOS: 'brew install libpq',
    Windows: 'choco install postgresql'
  },
  sqlite3: {
    'Debian/Ubuntu': 'sudo apt install sqlite3',
    macOS: 'preinstalled on macOS, otherwise brew install sqlite',
    Windows: 'choco install sqlite'
  }
}

const binaryCache = {}

// is a command on PATH? looked up once per command, since the answer cannot change mid run
function hasBinary (command) {
  if (!(command in binaryCache)) {
    const lookup = os.platform() === 'win32' ? 'where' : 'which'
    binaryCache[command] = spawnSync(lookup, [command], { shell: false }).status === 0
  }
  return binaryCache[command]
}

const embedded = {} // handles for servers this fixture started itself

// in auto mode, look at what is already running here rather than assuming nothing is. the probe runs in a child process because this has to be settled synchronously: the test runner registers suites while loading the test files, before any hook can await anything
const serverStatus = {}
if (mode === 'auto') {
  const requested = {}
  for (const engine of serverEngines) requested[engine] = serverConfig(engine)
  const probe = spawnSync('node', [path.join(__dirname, 'probeServers.js'), JSON.stringify(requested)], { shell: false, encoding: 'utf8' })
  try {
    Object.assign(serverStatus, JSON.parse(probe.stdout))
  } catch (e) {
    // a probe that cannot even report back is treated as nothing being available
  }
  for (const engine of serverEngines) {
    if (serverStatus[engine] && serverStatus[engine].status === 'ok') provisioned[engine] = serverConfig(engine)
  }
}

// which engines this run will have a server for
const provides = new Set(serverlessEngines)
if (mode === 'docker' || mode === 'embedded') for (const engine of serverEngines) provides.add(engine)
else if (mode === 'auto') for (const engine of serverEngines) if (provisioned[engine]) provides.add(engine)

function envFor (engine, key) {
  return process.env[`MULTI_DB_TEST_${engine.toUpperCase()}_${key.toUpperCase()}`]
}

// build a config/adminConfig pair for a server-backed engine
//
// every field can be overridden per engine from the environment, so someone whose local server uses different admin credentials can point the suite at them without editing anything: MULTI_DB_TEST_MYSQL_ADMIN_USER, MULTI_DB_TEST_POSTGRES_ADMIN_PASSWORD and so on
function serverConfig (engine, overrides = {}) {
  const creds = credentials[engine]
  const host = overrides.host || envFor(engine, 'host') || 'localhost'
  const port = parseInt(overrides.port || envFor(engine, 'port') || creds.port, 10)
  const pick = (override, envKey, fallback) => {
    if (override !== undefined) return override
    const fromEnv = envFor(engine, envKey)
    return fromEnv !== undefined ? fromEnv : fallback
  }
  return {
    config: {
      host,
      port,
      user: pick(overrides.user, 'user', creds.user),
      password: pick(overrides.password, 'password', creds.password),
      database: pick(overrides.database, 'database', creds.database)
    },
    adminConfig: {
      host,
      port,
      user: pick(overrides.adminUser, 'admin_user', creds.adminUser),
      password: pick(overrides.adminPassword, 'admin_password', creds.adminPassword),
      database: pick(overrides.adminDatabase, 'admin_database', creds.adminDatabase)
    }
  }
}

// ask the os for a port nothing is listening on. the standard ports cannot be assumed free: a developer may already run a real server on them
function freePort () {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

// can a tcp connection be opened? used to tell someone their compose stack is not running, rather than letting every test fail separately with its own confusing error
function reachable (host, port, timeout = 3000) {
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

// start real servers from npm packages. used where docker is unavailable, such as the macOS and Windows CI runners
async function startEmbedded () {
  let EmbeddedPostgres
  let createDB
  try {
    EmbeddedPostgres = require('embedded-postgres').default
    createDB = require('mysql-memory-server').createDB
  } catch (e) {
    throw new Error('embedded mode requires the embedded-postgres and mysql-memory-server packages: npm i -D embedded-postgres mysql-memory-server')
  }

  // real postgres, initialised into a scratch data directory
  const postgresPort = await freePort()
  embedded.postgres = new EmbeddedPostgres({
    databaseDir: './test/embedded-postgres-db',
    user: credentials.postgres.adminUser,
    password: credentials.postgres.adminPassword,
    port: postgresPort,
    persistent: false
  })
  await embedded.postgres.initialise()
  try {
    await embedded.postgres.start()
  } catch (e) {
    // embedded-postgres can reject with no reason attached, so say something useful
    throw new Error(`could not start the embedded postgres server on port ${postgresPort}` + (e && e.message ? `: ${e.message}` : ''))
  }
  provisioned.postgres = serverConfig('postgres', { host: '127.0.0.1', port: postgresPort })

  // real mysql on an ephemeral port. the version is pinned so that a developer with mysql already installed still tests the same server CI does
  embedded.mysql = await createDB({
    version: '8.0.x',
    username: 'multi_db_tests_admin',
    dbName: 'multi_db_tests_bootstrap' // not the admin database: mysql owns that name
  })
  const mysqlOverrides = {
    host: '127.0.0.1',
    port: embedded.mysql.port,
    adminUser: embedded.mysql.username,
    adminPassword: ''
  }
  provisioned.mysql = serverConfig('mysql', mysqlOverrides)

  // the mariadb driver speaks the same wire protocol, so it runs against the same server. this covers the driver but not mariadb engine behaviour, which is why docker mode remains the full suite
  provisioned.mariadb = serverConfig('mariadb', mysqlOverrides)
}

if (mode === 'docker') for (const engine of serverEngines) provisioned[engine] = serverConfig(engine)

module.exports = {
  mode,
  configs,
  serverEngines,
  serverlessEngines,

  // whether an engine has somewhere to connect in this run
  available (engine) {
    return provides.has(engine)
  },

  // engines that this run cannot test, for reporting skips
  unavailable () {
    return Object.keys(configs).filter(engine => !provides.has(engine))
  },

  hasBinary,
  dumpBinaries,
  installHints,
  serverStatus, // what the auto probe found for each server-backed engine

  // whether an engine's dump tests can run: the engine has to be reachable and the command its dump shells out to has to be installed
  canDump (engine) {
    const binary = dumpBinaries[engine]
    return Boolean(binary) && provides.has(engine) && hasBinary(binary)
  },

  // the dump commands this run cannot exercise, as a map of command name to the engines that needed it
  missingDumpBinaries () {
    const missing = {}
    for (const engine of Object.keys(dumpBinaries)) {
      if (!provides.has(engine)) continue // its tests are skipped for want of a server anyway
      const binary = dumpBinaries[engine]
      if (!hasBinary(binary)) (missing[binary] = missing[binary] || []).push(engine)
    }
    return missing
  },

  // true only where a real server of that engine is running, as opposed to a protocol-compatible stand-in
  isNativeEngine (engine) {
    if (!provides.has(engine)) return false
    if (mode === 'embedded' && engine === 'mariadb') return false
    return true
  },

  // connection details for an engine whether or not it was provisioned, for writing config files that may belong to a suite this run will skip
  resolve (engine, overrides) {
    return configs[engine] || serverConfig(engine, overrides)
  },

  async start () {
    if (mode === 'embedded') await startEmbedded()
    return configs
  },

  // servers this run expects to be able to reach but cannot
  async unreachableServers () {
    const unreachable = []
    for (const engine of serverEngines) {
      if (!provides.has(engine) || !provisioned[engine]) continue
      const { host, port } = provisioned[engine].config
      if (!await reachable(host, port)) unreachable.push({ engine, host, port })
    }
    return unreachable
  },

  async stop () {
    if (embedded.mysql) await embedded.mysql.stop()
    if (embedded.postgres) await embedded.postgres.stop()
  }
}
