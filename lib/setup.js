// setting up and tearing down an app's database: its user, its database, loading sql into it, and dumping it out, for scripts to do what cli.js does without running cli.js
//
// the steps that need an admin, creating and dropping users and databases, connect with the admin credentials, adminConfig, guessing others when those cannot connect, the same as cli.js does, the first time one is taken. dumping and loading use the app's own credentials, and need no admin, so a script that only does those, such as one backing up a database during a deploy, never connects as one. it works on the default database's engine. every step is safe to run again: creating a user or a database that is there already leaves it be, apart from setting the user's password to the one given, and dropping one that is not there does nothing
//
// dumping and loading postgresql, mysql, and mariadb databases runs their own tools, pg_dump and psql, or mysqldump and mysql, since a dump holds statements only those tools can run, such as postgresql's copy ... from stdin. they have to be on the path. a password goes to them in their environment, rather than on their command line, where other users of the machine could see it
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { spawn } = require('child_process')
const Logger = require('roosevelt-logger')
const configFinder = require('./configFinder')
const resolvePath = require('./resolvePath')

// quoting a name or a value written into a statement, for the statements whose parts cannot be parameters, such as create user
const quote = {
  postgres: {
    name: name => `"${String(name).replace(/"/g, '""')}"`,
    value: value => `'${String(value).replace(/'/g, "''")}'`
  },
  mysql: {
    name: name => `\`${String(name).replace(/`/g, '``')}\``,
    value: value => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  }
}
quote.mariadb = quote.mysql

// runs a command, feeding it nothing, and resolves once it has finished, or rejects with what it wrote to stderr. what it writes to stdout goes to the file named, for a command that writes nowhere else
function run (command, args, env, { stdoutTo } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    if (stdoutTo) child.stdout.pipe(fs.createWriteStream(stdoutTo))
    child.stderr.on('data', data => { stderr += data })
    child.on('error', e => reject(e.code === 'ENOENT' ? Object.assign(new Error(`${command} was not found on the path, and is needed for this`), { notFound: true }) : e))
    child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr.trim() || `${command} exited with code ${code}`)))
  })
}

// pg_dump 17.6 and newer wrap their output in \restrict and \unrestrict meta-commands, which older versions of psql refuse, along with the rest of the file. a dump kept with an app is loaded by whoever works on it, with whatever version they have, so those two lines are left out, which changes nothing else about it
async function portable (from, to) {
  const output = fs.createWriteStream(to)
  for await (const line of readline.createInterface({ input: fs.createReadStream(from), crlfDelay: Infinity })) {
    if (/^\\(un)?restrict\s/.test(line)) continue
    if (!output.write(line + '\n')) await new Promise(resolve => output.once('drain', resolve))
  }
  await new Promise((resolve, reject) => output.on('error', reject).end(resolve))
}

module.exports = multiDb => async function setup (params = {}) {
  const logger = new Logger()
  if (params.loggerConfig?.log === false) logger.log = () => {}
  if (params.loggerConfig?.warn === false) logger.warn = () => {}
  const found = await configFinder(logger, params)
  const engine = found.default
  const serverless = engine === 'pglite' || engine === 'sqlite' // files, with no users and no server to connect to as an admin, so they are set up without connecting
  const regular = found[engine].config // the app's own credentials, which its database is set up for, and which dumps and loads use unless told otherwise
  const q = quote[engine]

  // the admin connection, made the first time a step needs it, guessing, as the cli does, since this is what runs during setup
  let db = null
  const connect = async () => (db ??= await multiDb({ guessCredentials: true, ...params, admin: true, throwOnError: true }))
  const adminCredentials = async () => (await connect())[engine].credentials // whichever admin credentials connected
  const query = async (sql, params) => {
    const result = await (await connect()).query(sql, params)
    return result?.rows ?? (Array.isArray(result) ? result : [])
  }
  const file = database => resolvePath(database) // pglite and sqlite databases are files, or for pglite, a folder

  // a postgresql statement that has to run in a database other than the one the admin connection is to, such as granting on its schema
  async function inDatabase (database, sql) {
    const client = new (await connect()).drivers.postgres.Client({ ...await adminCredentials(), database })
    await client.connect()
    try {
      await client.query(sql)
    } finally {
      await client.end()
    }
  }

  const steps = {
    engine,

    // who the admin connection is, such as { user: 'postgres', host: '/var/run/postgresql', port: 5432 }, connecting as one if it has not yet, for saying how it connected. null for pglite and sqlite, which have none
    async connectedAs () {
      if (serverless) return null
      const admin = await adminCredentials()
      return { user: admin.user, host: admin.host || 'localhost', port: admin.port }
    },

    async userExists (user = regular.user) {
      if (serverless) return true // pglite and sqlite have no users
      if (engine === 'postgres') return (await query('select 1 from pg_roles where rolname = $1', [user])).length > 0
      return (await query('select 1 from mysql.user where user = ?', [user])).length > 0
    },

    // the owner of a database, or null when it is not there. a database of mysql or mariadb has no owner, so it is true when it is there
    async databaseOwner (database = regular.database) {
      if (engine === 'postgres') return (await query('select pg_get_userbyid(datdba) as owner from pg_database where datname = $1', [database]))[0]?.owner ?? null
      if (engine === 'mysql' || engine === 'mariadb') return (await query('select 1 from information_schema.schemata where schema_name = ?', [database])).length > 0 || null
      return fs.existsSync(file(database)) || null
    },

    // the user, with the password given, which is set again on a user that is there, so that it matches the app's config
    async createUser ({ user = regular.user, password = regular.password } = {}) {
      if (engine === 'postgres') {
        const verb = await steps.userExists(user) ? 'alter' : 'create'
        await query(`${verb} role ${q.name(user)} with login password ${q.value(password)}`)
      } else if (engine === 'mysql' || engine === 'mariadb') {
        await query(`create user if not exists ${q.value(user)}@'%' identified by ${q.value(password)}`) // for any host the app connects from, since the host it dials is not the one it connects from
        await query(`alter user ${q.value(user)}@'%' identified by ${q.value(password)}`)
      }
    },

    // the database, owned by the user given, who can then create what the app needs in it
    async createDatabase ({ database = regular.database, owner = regular.user } = {}) {
      if (engine === 'postgres') {
        const current = await steps.databaseOwner(database)
        if (!current) await query(`create database ${q.name(database)} with owner ${q.name(owner)}`)
        else if (current !== owner) await query(`alter database ${q.name(database)} owner to ${q.name(owner)}`)
        // postgresql 15 stopped letting anyone but the database's owner create things in its public schema, so it is granted outright, which also covers a database made some other way
        await query(`grant all on database ${q.name(database)} to ${q.name(owner)}`)
        await inDatabase(database, `grant all on schema public to ${q.name(owner)}`)
      } else if (engine === 'mysql' || engine === 'mariadb') {
        await query(`create database if not exists ${q.name(database)}`)
        await query(`grant all privileges on ${q.name(database)}.* to ${q.value(owner)}@'%'`)
      } else if (engine === 'sqlite') {
        fs.mkdirSync(path.dirname(file(database)), { recursive: true })
        fs.closeSync(fs.openSync(file(database), 'a')) // an empty file, which sqlite takes as an empty database, since an app only opens one that is there
      }
    },

    // the database, after closing any connections to it, which would otherwise stop it being dropped
    async dropDatabase (database = regular.database) {
      if (engine === 'postgres') {
        await query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()', [database])
        await query(`drop database if exists ${q.name(database)}`)
      } else if (engine === 'mysql' || engine === 'mariadb') {
        await query(`drop database if exists ${q.name(database)}`)
      } else {
        for (const suffix of ['', '-shm', '-wal']) fs.rmSync(file(database) + suffix, { recursive: true, force: true, maxRetries: 10 })
      }
    },

    // the user, which postgresql refuses while it still owns something, such as a database this did not drop
    async dropUser (user = regular.user) {
      if (engine === 'postgres') await query(`drop role if exists ${q.name(user)}`)
      else if (engine === 'mysql' || engine === 'mariadb') await query(`drop user if exists ${q.value(user)}@'%'`)
    },

    // writes a database out to a file, its schema alone, or its schema and data. credentials are the app's own unless others are given, such as to dump a database the app's user cannot read. a postgresql dump is made loadable by older versions of psql too
    async dump (to, { database = regular.database, credentials = regular, schemaOnly = false } = {}) {
      const out = resolvePath(to) // in a folder that is there already, so that a mistyped path is an error rather than a new folder
      if (engine === 'postgres') {
        const temporary = `${out}.${process.pid}.tmp` // written in full, then put in place, so that a dump that fails leaves the one before it as it was
        try {
          await run('pg_dump', ['-h', credentials.host || 'localhost', '-p', String(credentials.port || 5432), '-U', credentials.user, '-d', database, '-f', temporary, ...(schemaOnly ? ['--schema-only'] : [])], { PGPASSWORD: credentials.password || '' })
          await portable(temporary, out)
        } finally {
          fs.rmSync(temporary, { force: true })
        }
      } else if (engine === 'mysql' || engine === 'mariadb') {
        await run('mysqldump', ['-h', credentials.host || 'localhost', '-P', String(credentials.port || 3306), '-u', credentials.user, database, '-r', out, ...(schemaOnly ? ['--no-data'] : [])], { MYSQL_PWD: credentials.password || '' })
      } else if (engine === 'sqlite') {
        await run('sqlite3', [file(database), schemaOnly ? '.schema' : '.dump'], {}, { stdoutTo: out })
      } else {
        throw new Error('PGlite databases cannot be dumped')
      }
    },

    // runs the statements in a file against a database, such as a dump, or a schema. credentials are the app's own unless others are given, so that what it creates belongs to the app's user
    async load (from, { database = regular.database, credentials = regular } = {}) {
      const input = resolvePath(from)
      if (!fs.existsSync(input)) throw new Error(`there is no file at ${input}`)
      try {
        if (engine === 'postgres') return await run('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', credentials.host || 'localhost', '-p', String(credentials.port || 5432), '-U', credentials.user, '-d', database, '-f', input], { PGPASSWORD: credentials.password || '' })
        if (engine === 'mysql' || engine === 'mariadb') return await run('mysql', ['-h', credentials.host || 'localhost', '-P', String(credentials.port || 3306), '-u', credentials.user, database, '-e', `source ${input}`], { MYSQL_PWD: credentials.password || '' })
      } catch (e) {
        if (!e.notFound) throw e
      }
      // pglite and sqlite have no tools to load with, and nor does a server whose tool is not installed, so the statements go through the driver, which runs anything but what only the tools can, such as copy ... from stdin
      const app = await multiDb({ ...params, admin: false, guessCredentials: false, throwOnError: true, loggerConfig: { log: false, ...params.loggerConfig } })
      try {
        const statements = fs.readFileSync(input, 'utf8')
        if (engine === 'sqlite') app.sqlite.db.exec(statements) // more than one statement at a time, which a query does not take
        else if (engine === 'pglite') await app.pglite.db.exec(statements)
        else await app.query(statements)
      } finally {
        await app.endConnection()
      }
    },

    async close () {
      if (db) await db.endConnection()
    }
  }
  return steps
}
