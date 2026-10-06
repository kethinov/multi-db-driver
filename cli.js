// the command line scripts for setting up and tearing down an app's database, which do what lib/setup.js does, after asking first
//
//   cli.js --create               create the user and the database in the config, dropping them first, and run the config's schema against it, if it has one
//   cli.js --destroy              drop the user and the database in the config
//   cli.js --file file.sql        run the statements in a file against the database
//   cli.js --dump-schema file     write the database's schema to a file
//   cli.js --dump-data file       write the database's schema and data to a file
//
// --yes skips the question, --suppress-logs and --suppress-errors quieten it, and --enable-verbose says more
const process = require('process')
const yesno = require('yesno')
const Logger = require('roosevelt-logger')
const configFinder = require('./lib/configFinder')
const multiDb = require('./multi-db-driver')

const logger = new Logger()
const flag = name => process.argv.includes(name)
const argumentOf = name => flag(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined
const skipPrompts = flag('--yes')

const loggerConfig = {}
if (flag('--suppress-logs')) Object.assign(loggerConfig, { log: false, warn: false })
if (flag('--suppress-errors')) loggerConfig.error = false
if (flag('--enable-verbose')) loggerConfig.verbose = true
if (loggerConfig.log === false) logger.log = () => {}
if (loggerConfig.error === false) logger.error = () => {}

const emoji = { mariadb: '🦭', mysql: '🐬', postgres: '🐘', pglite: '🐘', sqlite: '🪶' }
const tools = { mariadb: 'mysqldump', mysql: 'mysqldump', postgres: 'pg_dump', sqlite: 'sqlite3' }

async function init () {
  const config = await configFinder(logger)
  const engine = config.default
  const { user, database } = config[engine].config
  const serverless = engine === 'pglite' || engine === 'sqlite'
  const ask = async question => skipPrompts || yesno({ question: `\nThis script will:\n${question}\nProceed? 🤔` })

  let setup
  try {
    setup = await multiDb.setup(Object.keys(loggerConfig).length ? { loggerConfig } : undefined)
    if (flag('--create')) {
      const schema = config[engine].schema
      if (!await ask(`↳🗑️  Drop database ${database}${serverless ? '' : ` and user ${user}`}\n↳🎂 Create ${serverless ? '' : `user ${user} and `}database ${database}${schema ? `\n↳🏃 Run queries from ${schema} against database ${database}` : ''}`)) return
      await setup.dropDatabase()
      await setup.dropUser()
      logger.log('🎂', `Creating fresh ${serverless ? '' : `${user} user and `}${database} database...`)
      await setup.createUser()
      await setup.createDatabase()
      if (schema) await setup.load(schema)
      logger.log('✅', `${serverless ? '' : `User ${user}, `}database ${database}${schema ? `, and schema from ${schema}` : ''} created successfully.`)
    } else if (flag('--destroy')) {
      if (!await ask(`↳🗑️  Drop database ${database}${serverless ? '' : ` and user ${user}`}`)) return
      logger.log('💀', `Dropping ${serverless ? '' : `${user} user and `}${database} database if they exist...`)
      await setup.dropDatabase()
      await setup.dropUser()
    } else if (flag('--file')) {
      const file = argumentOf('--file')
      if (!await ask(`↳🏃 Run queries from ${file} against database ${database}...`)) return
      logger.log('🏃', `Running queries from ${file}...`)
      await setup.load(file)
      logger.log('✅', `File ${file} imported successfully.`)
    } else if (flag('--dump-schema') || flag('--dump-data')) {
      const schemaOnly = flag('--dump-schema')
      const file = argumentOf(schemaOnly ? '--dump-schema' : '--dump-data')
      if (!await ask(`↳🥟 Dump ${database}'s schema${schemaOnly ? '' : ' and data'} to ${file}`)) return
      try {
        await setup.dump(file, { schemaOnly })
      } catch (e) {
        if (tools[engine]) logger.error(emoji[engine], `Please make sure the ${tools[engine]} command is in your PATH.`)
        throw e
      }
      logger.log('✅', `${database}'s schema${schemaOnly ? '' : ' and data'} dumped successfully to ${file}.`)
    }
  } catch (e) {
    logger.error(e)
    process.exitCode = 1
  } finally {
    if (setup) await setup.close()
  }
}

init().then(() => process.exit())
