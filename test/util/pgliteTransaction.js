// runs db.transaction against pglite, which the pglite tests do in a process of their own, and prints what happened as json
const path = require('path')
const createDatabase = require(path.join(__dirname, './createDatabase.js'))

async function pgliteTransaction () {
  await createDatabase('pglite') // create database
  const connect = extra => require('../../multi-db-driver')({
    default: 'pglite',
    pglite: { config: { database: './test/pglite-db' } },
    loggerConfig: { log: false, error: false, verbose: false },
    ...extra
  })

  const db = await connect({ throwOnError: false }) // the rolled back transaction below resolving to its error, rather than throwing it
  const committed = await db.transaction(async tx => {
    await tx.query('insert into test_table (name, description) values (?, ?)', ['magnus', 'chess master'])
    await tx.query('update test_table set description = ? where name = ?', ['grandmaster', 'magnus'])
    return (await tx.query('select * from test_table')).rows.length
  })
  const rolledBack = await db.transaction(async tx => {
    await tx.query('insert into test_table (name, description) values (?, ?)', ['nick', 'software engineer'])
    throw new Error('stop')
  })
  const { rows } = await db.query('select * from test_table')
  await db.endConnection()

  const throwing = await connect() // which throws, by default
  let thrown
  try {
    await throwing.transaction(async () => { throw new Error('stop') })
  } catch (e) {
    thrown = e.message
  }
  await throwing.endConnection()

  console.log(JSON.stringify({ committed, rolledBack: rolledBack.error?.message, thrown, rows }))
}
pgliteTransaction()
