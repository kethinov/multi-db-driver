const fs = require('fs')
const path = require('path')
const runCli = require(path.join(__dirname, 'runCli.js'))

// function that destroys database using CLI script
module.exports = async (db, suppressLogs, enableVerbose) => {
  const data = JSON.parse(fs.readFileSync(path.normalize('.multi-db-driver-config.json')))

  if (db) data.default = db

  // override default in config
  if (db) fs.writeFileSync(path.normalize('.multi-db-driver-config.json'), JSON.stringify(data, null, 2))

  const flags = []
  if (suppressLogs) flags.push('--suppress-logs', '--suppress-errors')
  else if (enableVerbose) flags.push('--enable-verbose')

  const result = await runCli(['--destroy', ...flags]) // run node cli.js --destroy as a child process
  if (result.failed) return 'error'

  // report which database the cli said it dropped. the file backed engines name only a database; the server backed ones name a user first
  const dropped = db === 'pglite' || db === 'sqlite'
    ? result.stdout.match(/Dropping (\S+) database/)
    : result.stdout.match(/Dropping \S+ user and (\S+) database/)
  return dropped ? dropped[1] : undefined
}
