const process = require('process')
const fs = require('fs')
const isCli = process.argv[1]?.slice(-6) === 'cli.js' // argv[1] is undefined in the repl and under node -e, where there is no script path
const Logger = require('roosevelt-logger')
const configFinder = require('./lib/configFinder')
const resolvePath = require('./lib/resolvePath')
const queryParser = require('./lib/queryParser')

async function multiDb (params) {
  const logger = new Logger()

  const config = await configFinder(logger, params) // find config

  if (config.loggerConfig) {
    if (config.loggerConfig.log === false) logger.log = function () {}
    if (config.loggerConfig.error === false) logger.error = function () {}
    if (config.loggerConfig.verbose === false) logger.verbose = function () {}
  }

  // attempt to load all the db drivers
  //
  // a driver that is still a string here has not been loaded yet, so a failure means its package is genuinely absent. on a later call the entry already holds the loaded module, and the load is skipped rather than counted as missing
  const missingDrivers = {}
  for (const key in multiDb.drivers) {
    const packageName = typeof multiDb.drivers[key] === 'string' ? multiDb.drivers[key] : null
    try {
      if (multiDb.drivers[key] === '@electric-sql/pglite') {
        multiDb.drivers[key] = await import(multiDb.drivers[key])
      } else if (Object.getPrototypeOf(multiDb.drivers[key]) === null) {
        // do  nothing
      } else {
        multiDb.drivers[key] = require(multiDb.drivers[key])
      }
    } catch (e) {
      if (packageName) missingDrivers[key] = packageName
      // the module isn't in node_modules. this is only worth logging here in a verbose mode: whether it matters depends on whether the config actually asks for that database, which is reported per engine below
      logger.verbose(`${key} driver ${multiDb.drivers[key]} could not be loaded.`)
    }
  }

  // a query against an engine that never initialized would otherwise fail deep inside the driver with something like "cannot read properties of undefined", which tells the caller nothing about the real cause
  //
  // returns the error result to hand back, or null when the engine is fine
  function notInitialized (engine, emoji, label, handle) {
    if (handle) return null
    const missing = missingDrivers[engine]
    const reason = missing
      ? `its driver is not installed. Run: npm i ${installNameFor(missing)}`
      : 'it is not connected. Check the errors above for why the connection could not be established.'
    const error = new Error(`Cannot query ${label}: ${reason}`)
    logger.error(emoji, error.message)
    return { error }
  }

  // explain why an engine could not start. a driver package that is not installed needs completely different advice from a connection that was refused, and telling someone to check their config when the config is fine sends them to debug the wrong thing
  function reportInitFailure (engine, emoji, label) {
    const missing = missingDrivers[engine]
    if (missing) logger.error(emoji, `Cannot use ${label}: its driver is not installed. Run: npm i ${installNameFor(missing)}`)
    else logger.error(emoji, `Could not initialize ${label} module. Please make sure it is configured properly.`)
  }

  // normalize all db drivers to one api and initialize the db drivers
  const db = {
    config,
    drivers: multiDb.drivers,
    modifiedQueryCache: {}
  }
  let connected

  // the shared identity of each engine: how it is named in logs, and where its live handle lives once connected
  const engines = {
    mariadb: { engine: 'mariadb', emoji: '🦭', label: 'MariaDB', handle: () => db.mariadb.conn },
    mysql: { engine: 'mysql', emoji: '🐬', label: 'MySQL', handle: () => db.mysql.conn },
    pglite: { engine: 'pglite', emoji: '⚡️', label: 'PGlite', handle: () => db.pglite.db },
    postgres: { engine: 'postgres', emoji: '🐘', label: 'PostgreSQL', handle: () => db.postgres.client },
    sqlite: { engine: 'sqlite', emoji: '🪶', label: 'SQLite', handle: () => db.sqlite.db }
  }

  // an array of objects or an array of arrays as the params means the caller wants each set run as one transaction. selects are excluded because there is nothing to commit
  function isTransaction (query, params) {
    return !query.trim().toLowerCase().startsWith('select') && params && typeof params[0] === 'object'
  }

  // a transaction's params arrive as either objects or arrays, and most drivers want positional values either way
  function positional (param) {
    return Array.isArray(param) ? param : Object.values(param)
  }

  // try the configured credentials, then the common defaults, then whichever of the admin or regular credentials was not tried first. the first set that connects wins and the rest are never attempted
  async function connectWithLadder (spec, open) {
    const name = spec.engine
    const credentialsToTry = config[name]
      ? [
          config.admin ? config[name].adminConfig : config[name].config, // default to admin config if the admin flag is passed
          ...multiDb.defaultCredentials[name], // try some default credentials if the above doesn't work
          config.admin ? config[name].config : config[name].adminConfig // if none of those worked, try either the admin credentials or the user credentials, whichever wasn't used above
        ]
      : []
    for (const credentials of credentialsToTry) {
      try {
        await open(credentials)
        logger.log(spec.emoji, `${spec.label} database connected with user ${credentials.user} to database ${credentials.database}`)
        db[name].username = credentials.user
        db[name].database = credentials.database
        return true
      } catch (e) {
        // do nothing, try the next set of credentials
      }
    }
    return false
  }

  // postgres and pglite want $1 style placeholders, so a query written with ? is rewritten for them and the result cached. a query that cannot be parsed is run as written
  async function rewriteForPostgres (query, skipAST) {
    if (config.questionMarkParamsForPostgres === false) skipAST = true
    if (skipAST) return query
    if (db.modifiedQueryCache[query]) return db.modifiedQueryCache[query]
    try {
      const modifiedQuery = await queryParser(query)
      if (modifiedQuery) {
        db.modifiedQueryCache[query] = modifiedQuery
        return modifiedQuery
      }
    } catch (e) {
      // the query could not be parsed, so use it unchanged
    }
    return query
  }

  // every engine reports a query failure the same way, and none of them may let a driver level exception escape to the caller
  async function runQuery (spec, query, params, run) {
    const uninitialized = notInitialized(spec.engine, spec.emoji, spec.label, spec.handle())
    if (uninitialized) return uninitialized
    try {
      return await run()
    } catch (e) {
      logger.error(spec.emoji, `${spec.label} query error...`)
      logger.error('Query attempted: ', query)
      logger.error('Params supplied: ', params)
      logger.error(e)
      return { error: e }
    }
  }

  db.mariadb = {}
  connected = await connectWithLadder(engines.mariadb, async credentials => {
    if (isCli) {
      credentials.multipleStatements = true
      credentials.allowPublicKeyRetrieval = true
    }
    const { createPool } = multiDb.drivers.mariadb
    db.mariadb.pool = await createPool(credentials)
    db.mariadb.conn = await db.mariadb.pool.getConnection()
  })
  if (!connected && config.mariadb) reportInitFailure('mariadb', engines.mariadb.emoji, 'MariaDB')
  db.mariadb.query = async (query, params) => runQuery(engines.mariadb, query, params, async () => {
    let result
    if (isTransaction(query, params)) {
      try {
        await db.mariadb.conn.beginTransaction()
        for (const param of params) await db.mariadb.conn.query(query, positional(param))
        await db.mariadb.conn.commit()
      } catch (e) {
        await db.mariadb.conn.rollback()
        throw e
      }
    } else {
      result = await db.mariadb.conn.query(query, params)
    }
    return { rows: result }
  })

  db.mysql = {}
  connected = await connectWithLadder(engines.mysql, async credentials => {
    if (isCli) credentials.multipleStatements = true
    const { createPool } = multiDb.drivers.mysql
    db.mysql.pool = await createPool(credentials)
    db.mysql.conn = await db.mysql.pool.getConnection()
  })
  if (!connected && config.mysql) reportInitFailure('mysql', engines.mysql.emoji, 'MySQL')
  db.mysql.query = async (query, params) => runQuery(engines.mysql, query, params, async () => {
    let result
    if (isTransaction(query, params)) {
      try {
        await db.mysql.conn.beginTransaction()
        for (const param of params) await db.mysql.conn.query(query, positional(param))
        await db.mysql.conn.commit()
      } catch (e) {
        await db.mysql.conn.rollback()
        throw e
      }
    } else {
      result = await db.mysql.conn.query(query, params)
    }
    // mysql2 hands back [rows, fields], so the rows are surfaced alongside the whole response rather than in place of it
    const wrapped = { full: result }
    wrapped.rows = wrapped.full?.[0]
    return wrapped
  })

  db.pglite = {}
  if (config.default === 'pglite' || config.pglite) {
    connected = false
    if ((isCli && config.default === 'pglite') || fs.existsSync(resolvePath(config.pglite.config.database))) {
      const { PGlite } = multiDb.drivers.pglite
      db.pglite.db = new PGlite(resolvePath(config.pglite.config.database))
      logger.log(engines.pglite.emoji, 'PGlite database connected to database ' + config.pglite.config.database)
      db.pglite.database = config.pglite.config.database
      connected = true
    }
    if (!connected && config.pglite) reportInitFailure('pglite', engines.pglite.emoji, 'PGlite')
  }
  db.pglite.query = async (query, params, skipAST) => runQuery(engines.pglite, query, params, async () => {
    if (isCli) return await db.pglite.db.exec(query)
    const queryToUse = await rewriteForPostgres(query, skipAST)
    if (isTransaction(query, params)) {
      await db.pglite.db.transaction(async (tx) => {
        try {
          for (const param of params) await tx.query(queryToUse, positional(param))
        } catch (e) {
          await tx.rollback()
          throw e
        }
      })
    } else {
      return await db.pglite.db.query(queryToUse, params)
    }
  })

  db.postgres = {}
  connected = await connectWithLadder(engines.postgres, async credentials => {
    const { Pool } = multiDb.drivers.postgres
    db.postgres.pool = new Pool(credentials)
    db.postgres.client = await db.postgres.pool.connect()
    db.postgres.client.on('error', (e) => {
      logger.error(engines.postgres.emoji, 'PostgreSQL error...')
      logger.error(e)
    })
  })
  if (!connected && config.postgres) reportInitFailure('postgres', engines.postgres.emoji, 'PostgreSQL')
  db.postgres.query = async (query, params, skipAST) => runQuery(engines.postgres, query, params, async () => {
    const queryToUse = await rewriteForPostgres(query, skipAST)
    if (isTransaction(query, params)) {
      try {
        await db.postgres.client.query('BEGIN')
        for (const param of params) await db.postgres.client.query(queryToUse, positional(param))
        await db.postgres.client.query('COMMIT')
      } catch (e) {
        await db.postgres.client.query('ROLLBACK')
        throw e
      }
    } else {
      return await db.postgres.client.query(queryToUse, params)
    }
  })

  db.sqlite = {}
  if (config.default === 'sqlite' || config.sqlite) {
    connected = false
    try {
      const Database = multiDb.drivers.sqlite
      if (config.default === 'sqlite' && isCli) {
        db.sqlite.db = new Database(resolvePath(config.sqlite.config.database))
        db.sqlite.db.pragma('journal_mode = WAL') // enable WAL
      } else {
        db.sqlite.db = new Database(resolvePath(config.sqlite.config.database), { fileMustExist: true })
      }
      logger.log(engines.sqlite.emoji, 'SQLite database connected to database ' + config.sqlite.config.database)
      db.sqlite.database = config.sqlite.config.database
      connected = true
    } catch (e) {
      // do nothing
    }
    if (!connected && config.sqlite) reportInitFailure('sqlite', engines.sqlite.emoji, 'SQLite')
  }
  db.sqlite.query = async (query, params) => runQuery(engines.sqlite, query, params, async () => {
    if (isCli) return await db.sqlite.db.exec(query)
    let result
    if (!query.trim().toLowerCase().startsWith('select')) {
      if (params && typeof params[0] === 'object') {
        // it's an array of objects or an array of arrays, so perform a transaction. the params are passed through untouched because sqlite binds named parameters such as @name from the object itself
        const transaction = await db.sqlite.db.prepare(query)
        const transactionRunner = await db.sqlite.db.transaction((paramsArray) => {
          for (const param of paramsArray) transaction.run(param)
        })
        result = transactionRunner(params)
      } else {
        result = await db.sqlite.db.prepare(query).run(params || [])
      }
    } else {
      result = await db.sqlite.db.prepare(query).all(params || [])
    }
    return { rows: result }
  })

  // expose each loaded driver module, as documented, so callers can reach the underlying library directly. an entry that is still a string never loaded, so it is left undefined rather than handing back a package name
  for (const name of Object.keys(engines)) {
    if (typeof multiDb.drivers[name] !== 'string') db[name].driver = multiDb.drivers[name]
  }

  const defaultDb = config.default
  db.driver = db[defaultDb].driver

  // universal query method
  db.query = async (query, params, postprocess) => {
    if (!params || !Array.isArray(params)) {
      if (typeof params === 'function' && !postprocess) {
        // params argument was skipped but the postprocess argument was not. that means argument 2 is our postprocess function and params needs to be set to an empty array
        postprocess = params
      }
      params = [] // regardless of if the above if statement returns true or false, params being set to something other than an array is bad so we need to make sure it's an array
    }
    if (!postprocess || typeof postprocess !== 'function') {
      // postprocess argument was not provided, supply a passthrough function instead
      postprocess = (db, result) => {
        return result
      }
    }
    if (typeof query === 'string') {
      // query string passed, execute it against default db
      const result = await db[defaultDb].query(query, params)
      return postprocess(defaultDb, result)
    } else if (typeof query === 'object') {
      // query object passed
      if (typeof query[defaultDb] === 'string') {
        // execute the query string for the default db if it is specified
        const result = await db[defaultDb].query(query[defaultDb], params, query.disableQuestionMarkParamsForPostgres)
        return postprocess(defaultDb, result)
      } else if (typeof query.default === 'string') {
        // no query string specified for the default db, check the "default" member of the query object instead
        const result = await db[defaultDb].query(query.default, params, query.disableQuestionMarkParamsForPostgres)
        return postprocess(defaultDb, result)
      } else if (!query[defaultDb]) {
        // neither the default db query string nor a default query string is specified
        logger.error('db.query called with argument that was falsey.')
      } else {
        logger.error('db.query called with argument malformed argument.')
      }
    } else {
      logger.error('db.query called with argument malformed argument.')
    }
  }

  // universal test conenction method
  db.testConnection = async () => {
    logger.log('🔌', `Testing ${defaultDb} connection...`)
    const result = await db[defaultDb].query('select 1')
    if (result && !result.error) { // a query that failed resolves to { error }, which is truthy
      logger.log('✅', (`Successfully connected to ${db[defaultDb].database}.`))
      return result
    } else {
      logger.error('Connection failed.')
    }
  }

  // universal end connection method
  db.endConnection = async () => {
    const closers = {
      mariadb: async () => {
        await db.mariadb.conn.release()
        await db.mariadb.pool.end()
      },
      mysql: async () => {
        await db.mysql.conn.release()
        await db.mysql.pool.end()
      },
      pglite: async () => await db.pglite.db.close(),
      postgres: async () => {
        await db.postgres.client.release()
        await db.postgres.pool.end()
      },
      sqlite: async () => await db.sqlite.db.close()
    }
    for (const name of Object.keys(closers)) {
      if (!engines[name].handle()) continue // never connected, so there is nothing to close
      await closers[name]()
      logger.log('🔚', `${engines[name].label} connection ended.`)
    }
  }

  return db
}

// the package to install is not always the path that gets required: mysql2/promise lives inside the mysql2 package
function installNameFor (requirePath) {
  const parts = requirePath.split('/')
  return requirePath.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

// declare supported db modules. each entry is replaced with the loaded module on first use, and left as the package name if that package is not installed
multiDb.drivers = {
  mariadb: 'mariadb',
  mysql: 'mysql2/promise',
  pglite: '@electric-sql/pglite',
  postgres: 'pg',
  sqlite: 'better-sqlite3'
  // TODO: add support for more databases?
}

multiDb.defaultCredentials = {
  mariadb: [
    {
      host: 'localhost',
      port: 3306,
      user: 'mariadb',
      password: '',
      database: 'mariadb'
    },
    {
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: 'password',
      database: 'mariadb'
    },
    {
      host: 'localhost',
      port: 3306,
      user: 'admin',
      password: 'admin',
      database: 'mariadb'
    },
    {
      host: 'localhost',
      port: 3306,
      user: 'admin',
      password: '',
      database: 'mariadb'
    },
    {
      host: 'localhost',
      port: 3306,
      user: 'mariadb',
      password: 'mariadb',
      database: 'mariadb'
    }
  ],
  mysql: [
    {
      host: 'localhost',
      port: 3306,
      user: 'mysql',
      password: '',
      database: 'mysql'
    },
    {
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: 'password',
      database: 'mysql'
    },
    {
      host: 'localhost',
      port: 3306,
      user: 'admin',
      password: 'admin',
      database: 'mysql'
    },
    {
      host: 'localhost',
      port: 3306,
      user: 'admin',
      password: '',
      database: 'mysql'
    },
    {
      host: 'localhost',
      port: 3306,
      user: 'mysql',
      password: 'mysql',
      database: 'mysql'
    }
  ],
  postgres: [
    {
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: ' ',
      database: 'postgres'
    },
    {
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'admin',
      database: 'postgres'
    },
    {
      host: 'localhost',
      port: 5432,
      user: 'admin',
      password: 'admin',
      database: 'postgres'
    },
    {
      host: 'localhost',
      port: 5432,
      user: 'admin',
      password: 'postgres',
      database: 'postgres'
    },
    {
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'postgres',
      database: 'postgres'
    }
  ]
}
// constructor; returns a db object
module.exports = multiDb
