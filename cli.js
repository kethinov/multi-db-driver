const process = require('process')
const path = require('path')
const fs = require('fs')
const yesno = require('yesno')
const Logger = require('roosevelt-logger')
const logger = new Logger()
const skipPrompts = process.argv.includes('--yes') || false
const { spawnSync } = require('child_process')
const configFinder = require('./lib/configFinder')
const resolvePath = require('./lib/resolvePath')

async function init () {
  const loggerConfig = {}
  if (process.argv.includes('--suppress-logs')) {
    loggerConfig.log = false
    loggerConfig.warn = false
  }
  if (process.argv.includes('--suppress-errors')) {
    loggerConfig.error = false
  }
  if (process.argv.includes('--enable-verbose')) {
    loggerConfig.verbose = true
  }
  logger.verbose('loggerConfig:', loggerConfig)

  const config = await configFinder(logger) // find config

  let db

  if (config.default !== 'pglite' && config.default !== 'sqlite') {
    db = Object.keys(loggerConfig).length > 0
      ? await require('./multi-db-driver')({
        admin: true,
        loggerConfig
      })
      : await require('./multi-db-driver')({
        admin: true
      })
    logger.verbose('db:', db)
  }

  const dbConfig = config[config.default].config
  logger.verbose('config:', config)
  let filename
  let schemaPath

  if (process.argv.includes('--file')) {
    filename = resolvePath(process.argv[process.argv.indexOf('--file') + 1])
    if (filename) {
      if (config.default !== 'pglite' && config.default !== 'sqlite') {
        const oldUser = dbConfig.user
        const oldDb = dbConfig.database
        logger.log('🦺', 'Attempting to connect with regular (non-admin) credentials instead...')
        db = Object.keys(loggerConfig).length > 0
          ? await require('./multi-db-driver')({
            admin: false, // execute the file against regular credentials, not admin credentials
            loggerConfig
          })
          : await require('./multi-db-driver')({
            admin: false // execute the file against regular credentials, not admin credentials
          })
        if (oldUser === config[config.default].config.user && oldDb === config[config.default].config.database) {
          logger.warn('⚠️', 'It appears the new connection is using the same credentials as the old connection. If you proceed, it may run the queries against the wrong database.')
        }
      } else {
        if (fs.existsSync(path.normalize(dbConfig.database))) {
          db = Object.keys(loggerConfig).length > 0
            ? await require('./multi-db-driver')({
              loggerConfig
            })
            : await require('./multi-db-driver')()
          logger.verbose('db:', db)
        }
      }
      const ok = skipPrompts || await yesno({
        question: `
This script will:
↳🏃 Run queries from ${filename} against database ${config[config.default].config.database}...
Proceed? 🤔`
      })
      if (ok) {
        await file(filename)
      }
    }
  } else if (process.argv.includes('--create')) {
    try {
      if (config[config.default].schema) {
        const schema = `\n↳🏃 Run queries from ${config[config.default].schema} against database ${dbConfig.database}`
        const ok = config.default === 'pglite' || config.default === 'sqlite'
          ? skipPrompts || await yesno({
            question: `
This script will:
↳🗑️  Drop database ${dbConfig.database}
↳🎂 Create database ${dbConfig.database}${schema}
Proceed? 🤔`
          })
          : skipPrompts || await yesno({
            question: `
This script will:
↳🗑️  Drop database ${dbConfig.database} and user ${dbConfig.user}
↳🎂 Create user ${dbConfig.user} and database ${dbConfig.database}${schema}
Proceed? 🤔`
          })
        if (ok) {
          await create()
        }
      } else {
        throw logger.error('No schema defined in config')
      }
    } catch (e) {
      process.exit(1)
    }
  } else if (process.argv.includes('--destroy')) {
    const ok = config.default === 'pglite' || config.default === 'sqlite'
      ? skipPrompts || await yesno({
        question: `
This script will:
↳🗑️  Drop database ${dbConfig.database}
Proceed? 🤔`
      })
      : skipPrompts || await yesno({
        question: `
This script will:
↳🗑️  Drop database ${dbConfig.database} and user ${dbConfig.user}
Proceed? 🤔`
      })
    if (ok) {
      await destroy()
    }
  } else if (process.argv.includes('--dump-schema')) {
    schemaPath = resolvePath(process.argv[process.argv.indexOf('--dump-schema') + 1])
    if (schemaPath) {
      const ok = skipPrompts || await yesno({
        question: `
This script will:
↳🥟 Dump ${dbConfig.database}'s schema to ${schemaPath}
Proceed? 🤔`
      })
      if (ok) {
        await dumpSchema(schemaPath)
      }
    }
  } else if (process.argv.includes('--dump-data')) {
    schemaPath = resolvePath(process.argv[process.argv.indexOf('--dump-data') + 1])
    if (schemaPath) {
      const ok = skipPrompts || await yesno({
        question: `
This script will:
↳🥟 Dump ${dbConfig.database}'s schema and data to ${schemaPath}
Proceed? 🤔`
      })
      if (ok) {
        await dumpData(schemaPath)
      }
    }
  }
  process.exit()

  async function destroy () {
    if (config.default === 'mariadb' || config.default === 'mysql') {
      logger.log('💀', 'Dropping ' + dbConfig.user + ' user and ' + dbConfig.database + ' database if they exist...')
      await db.query('drop database if exists ' + dbConfig.database)
      await db.query('drop user if exists \'' + dbConfig.user + '\'' + '@\'%\'')
    } else if (config.default === 'pglite' || config.default === 'sqlite') {
      logger.log('💀', 'Dropping ' + dbConfig.database + ' database if it exists...')
      if (fs.existsSync(resolvePath(dbConfig.database))) {
        fs.rmSync(resolvePath(dbConfig.database), { recursive: true, force: true, maxRetries: 10 })
        if (fs.existsSync(resolvePath(dbConfig.database) + '-shm')) fs.rmSync(resolvePath(dbConfig.database) + '-shm', { recursive: true, force: true, maxRetries: 10 })
        if (fs.existsSync(resolvePath(dbConfig.database) + '-wal')) fs.rmSync(resolvePath(dbConfig.database) + '-wal', { recursive: true, force: true, maxRetries: 10 })
      }
    } else if (config.default === 'postgres') {
      logger.log('💀', 'Dropping ' + dbConfig.user + ' user and ' + dbConfig.database + ' database if they exist...')
      await db.query('drop database if exists ' + dbConfig.database)
      // drop owned by only if user exists
      const users = await db.query('select usename from pg_user')
      for (let i = 0; i < users.rows.length; i++) {
        if (users.rows[i].usename === dbConfig.user) {
          await db.query('drop owned by ' + dbConfig.user)
        }
      }
      await db.query('drop role if exists ' + [dbConfig.user])
    }
  }

  async function create () {
    await destroy()
    if (config.default === 'mariadb' || config.default === 'mysql') {
      logger.log('🎂', 'Creating fresh ' + dbConfig.user + ' user and ' + dbConfig.database + ' database...')
      // the user is created for any origin host. dbConfig.host is the address this client dials, not the address it connects from, so using it here produced a user that could only log in when the application and the database happened to share a hostname
      await db.query('create user \'' + dbConfig.user + '\'' + '@\'%\'' + ' identified by \'' + dbConfig.password + '\'')
      await db.query('grant all privileges on *.* to \'' + dbConfig.user + '\'' + '@\'%\'')
      await db.query('create database ' + dbConfig.database)
    } else if (config.default === 'pglite' || config.default === 'sqlite') {
      logger.log('🎂', 'Creating fresh ' + dbConfig.database + ' database...')
    } else if (config.default === 'postgres') {
      logger.log('🎂', 'Creating fresh ' + dbConfig.user + ' user and ' + dbConfig.database + ' database...')
      await db.query('create user ' + dbConfig.user + ' password \'' + dbConfig.password + '\'')
      await db.query('create database ' + dbConfig.database + ' with owner ' + dbConfig.user)
    }
    db = Object.keys(loggerConfig).length > 0
      ? await require('./multi-db-driver')({
        admin: false, // reconnecting without admin credentials
        loggerConfig
      })
      : await require('./multi-db-driver')({
        admin: false // reconnecting without admin credentials
      })
    if (config.default === 'pglite' || config.default === 'sqlite') logger.verbose('db:', db)
    if (config[config.default].schema) {
      try {
        await db.query(fs.readFileSync(resolvePath(config[config.default].schema), 'utf8'))
        if (config.default === 'pglite' || config.default === 'sqlite') {
          logger.log('✅', `Database ${dbConfig.database}, and schema from ${config[config.default].schema} imported successfully.`)
        } else {
          logger.log('✅', `User ${dbConfig.user}, database ${dbConfig.database}, and schema from ${config[config.default].schema} imported successfully.`)
        }
      } catch (e) {
        logger.error('Schema import error...')
        logger.error('Schema attempted: ', config[config.default].schema)
        logger.error(e)
        process.exit(1)
      }
    }
  }

  async function file (file) {
    logger.log('🏃', 'Running queries from ' + file + '...')
    try {
      await db.query(fs.readFileSync(resolvePath(filename), 'utf8'))
      logger.log('✅', `File ${filename} imported successfully.`)
    } catch (e) {
      logger.error('Schema import error...')
      logger.error('Schema attempted: ', config[config.default].schema)
      logger.error(e)
      process.exit(1)
    }
  }

  async function dumpSchema (filePath) {
    let configDefault
    let schemaDump
    try {
      if (config.default === 'mariadb') {
        configDefault = 'MariaDB'
        // create temperary mysqlpassword.cnf file to source password from while running mysqldump command
        fs.writeFileSync(path.normalize(path.resolve(__dirname, 'multi-db-driver-mysql-dump-password.cnf')), `[mysqldump]
        # The following password will be sent to mysqldump 
        password="${dbConfig.password}"
        `)
        schemaDump = spawnSync('mysqldump', [`--defaults-extra-file=${path.normalize(path.join(__dirname, 'multi-db-driver-mysql-dump-password.cnf'))}`, '--no-data', '-h', `${dbConfig.host}`, '-P', `${dbConfig.port}`, '-u', `${dbConfig.user}`, `${dbConfig.database}`, '-r', `${filePath}`], { shell: false })
        if (fs.existsSync(path.normalize(path.join(__dirname, 'multi-db-driver-mysql-dump-password.cnf')))) fs.unlinkSync(path.normalize(path.join(__dirname, 'multi-db-driver-mysql-dump-password.cnf'))) // remove mysqlpassword.cnf file
      } else if (config.default === 'mysql') {
        configDefault = 'MySQL'
        // create temperary mysqlpassword.cnf file to source password from while running mysqldump command
        fs.writeFileSync(path.normalize(path.resolve(__dirname, 'multi-db-driver-mysql-dump-password.cnf')), `[mysqldump]
        # The following password will be sent to mysqldump 
        password="${dbConfig.password}"
        `)
        schemaDump = spawnSync('mysqldump', [`--defaults-extra-file=${path.normalize(path.join(__dirname, 'multi-db-driver-mysql-dump-password.cnf'))}`, '--no-data', '-h', `${dbConfig.host}`, '-P', `${dbConfig.port}`, '-u', `${dbConfig.user}`, `${dbConfig.database}`, '-r', `${filePath}`], { shell: false })
        if (fs.existsSync(path.normalize(path.join(__dirname, 'multi-db-driver-mysql-dump-password.cnf')))) fs.unlinkSync(path.normalize(path.join(__dirname, 'multi-db-driver-mysql-dump-password.cnf'))) // remove mysqlpassword.cnf file
      } else if (config.default === 'postgres') {
        configDefault = 'PostgreSQL'
        fs.writeFileSync(path.normalize(path.resolve(__dirname, '.multi-db-driver-pg-dump-config')), `${dbConfig.host}:${dbConfig.port}:${dbConfig.database}:${dbConfig.user}:${dbConfig.password}`) // create temperary .pgpass file to source password from while running pg_dump command
        fs.chmodSync(path.normalize(path.resolve(__dirname, '.multi-db-driver-pg-dump-config')), '0600') // give .pgpass file read + write permissions
        process.env.PGPASSFILE = path.normalize(path.resolve(__dirname, '.multi-db-driver-pg-dump-config')) // set PGPASSFILE env var to .pgpass file that was created
        schemaDump = spawnSync('pg_dump', ['--schema-only', '-U', `${dbConfig.user}`, '-h', `${dbConfig.host}`, '-p', `${dbConfig.port}`, '-d', `${dbConfig.database}`, '-f', `${filePath}`], { shell: false })
        if (fs.existsSync(path.normalize(path.join(__dirname, '.multi-db-driver-pg-dump-config')))) fs.unlinkSync(path.normalize(path.join(__dirname, '.multi-db-driver-pg-dump-config'))) // remove .pgpass file
      } else if (config.default === 'sqlite') {
        configDefault = 'SQLite'
        schemaDump = spawnSync('sqlite3', [`${dbConfig.database}`, '.schema'], { shell: false })
        fs.writeFileSync(resolvePath(filePath), schemaDump.stdout.toString())
      }
      if (schemaDump.error) throw schemaDump.error
      if (schemaDump.stderr && schemaDump.stderr.toString() !== '') throw schemaDump.stderr.toString()
      logger.log('✅', `${configDefault} schema dumped successfully to ${filePath}.`)
    } catch (e) {
      logger.error(e)
      dumpErrorMessages()
      process.exit(1)
    }
  }

  async function dumpData (filePath) {
    let configDefault
    let dataDump
    try {
      if (config.default === 'mariadb') {
        configDefault = 'MariaDB'
        // create temperary mysqlpassword.cnf file to source password from while running mysqldump command
        fs.writeFileSync(path.normalize(path.resolve(__dirname, 'multi-db-driver-mysql-dump-password.cnf')), `[mysqldump]
        # The following password will be sent to mysqldump 
        password="${dbConfig.password}"
        `)
        dataDump = spawnSync('mysqldump', [`--defaults-extra-file=${path.normalize(path.join(__dirname, 'multi-db-driver-mysql-dump-password.cnf'))}`, '-h', `${dbConfig.host}`, '-P', `${dbConfig.port}`, '-u', `${dbConfig.user}`, `${dbConfig.database}`, '-r', `${filePath}`], { shell: false })
        if (fs.existsSync(path.normalize(path.join(__dirname, 'multi-db-driver-mysql-dump-password.cnf')))) fs.unlinkSync(path.normalize(path.join(__dirname, 'multi-db-driver-mysql-dump-password.cnf'))) // remove mysqlpassword.cnf file
      } else if (config.default === 'mysql') {
        configDefault = 'MySQL'
        // create temperary mysqlpassword.cnf file to source password from while running mysqldump command
        fs.writeFileSync(path.normalize(path.resolve(__dirname, 'multi-db-driver-mysql-dump-password.cnf')), `[mysqldump]
        # The following password will be sent to mysqldump 
        password="${dbConfig.password}"
        `)
        dataDump = spawnSync('mysqldump', [`--defaults-extra-file=${path.normalize(path.join(__dirname, 'multi-db-driver-mysql-dump-password.cnf'))}`, '-h', `${dbConfig.host}`, '-P', `${dbConfig.port}`, '-u', `${dbConfig.user}`, `${dbConfig.database}`, '-r', `${filePath}`], { shell: false })
        if (fs.existsSync(path.normalize(path.join(__dirname, 'multi-db-driver-mysql-dump-password.cnf')))) fs.unlinkSync(path.normalize(path.join(__dirname, 'multi-db-driver-mysql-dump-password.cnf'))) // remove mysqlpassword.cnf file
      } else if (config.default === 'postgres') {
        configDefault = 'PostgreSQL'
        fs.writeFileSync(path.normalize(path.resolve(__dirname, '.multi-db-driver-pg-dump-config')), `${dbConfig.host}:${dbConfig.port}:${dbConfig.database}:${dbConfig.user}:${dbConfig.password}`) // create temperary .pgpass file to source password from while running pg_dump command
        fs.chmodSync(path.normalize(path.resolve(__dirname, '.multi-db-driver-pg-dump-config')), '0600') // give .pgpass file read + write permissions
        process.env.PGPASSFILE = path.normalize(path.resolve(__dirname, '.multi-db-driver-pg-dump-config')) // set PGPASSFILE env var to .pgpass file that was created
        dataDump = spawnSync('pg_dump', ['-U', `${dbConfig.user}`, '-h', `${dbConfig.host}`, '-p', `${dbConfig.port}`, '-d', `${dbConfig.database}`, '-f', `${filePath}`], { shell: false })
        if (fs.existsSync(path.normalize(path.join(__dirname, '.multi-db-driver-pg-dump-config')))) fs.unlinkSync(path.normalize(path.join(__dirname, '.multi-db-driver-pg-dump-config'))) // remove .pgpass file
      } else if (config.default === 'sqlite') {
        configDefault = 'SQLite'
        dataDump = spawnSync('sqlite3', [`${dbConfig.database}`, '.dump'], { shell: false })
        fs.writeFileSync(resolvePath(filePath), dataDump.stdout.toString())
      }
      if (dataDump.error) throw dataDump.error
      if (dataDump.stderr && dataDump.stderr.toString() !== '') throw dataDump.stderr.toString()
      logger.log('✅', `${configDefault} schema dumped successfully to ${filePath}.`)
    } catch (e) {
      logger.error(e)
      dumpErrorMessages()
      process.exit(1)
    }
  }

  async function dumpErrorMessages () {
    if (config.default === 'mariadb') {
      logger.error('🦭', 'Please make sure the mysqldump command is in your PATH.')
      if (fs.existsSync(path.normalize(path.join(__dirname, 'multi-db-driver-mysql-dump-password.cnf')))) fs.unlinkSync(path.normalize(path.join(__dirname, 'multi-db-driver-mysql-dump-password.cnf')))
    } else if (config.default === 'mysql') {
      logger.error('🐬', 'Please make sure the mysqldump command is in your PATH.')
      if (fs.existsSync(path.normalize(path.join(__dirname, 'multi-db-driver-mysql-dump-password.cnf')))) fs.unlinkSync(path.normalize(path.join(__dirname, 'multi-db-driver-mysql-dump-password.cnf')))
    } else if (config.default === 'postgres') {
      logger.error('🐘', 'Please make sure the pg_dump command is in your PATH.')
      if (fs.existsSync(path.normalize(path.join(__dirname, '.multi-db-driver-pg-dump-config')))) fs.unlinkSync(path.normalize(path.join(__dirname, '.multi-db-driver-pg-dump-config')))
    } else if (config.default === 'sqlite') {
      logger.error('🪶', 'Please make sure the sqlite3 command is in your PATH.')
    }
  }
}

init()
