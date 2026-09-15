const fs = require('fs')
const path = require('path')
const runCli = require(path.join(__dirname, 'runCli.js'))

module.exports = async (db, file, suppressLogs, enableVerbose) => {
  const data = JSON.parse(fs.readFileSync(path.normalize('.multi-db-driver-config.json')))

  if (db) data.default = db

  // override default in config
  fs.writeFileSync(path.normalize('.multi-db-driver-config.json'), JSON.stringify(data, null, 2))

  const flags = []
  if (suppressLogs) flags.push('--suppress-logs', '--suppress-errors')
  else if (enableVerbose) flags.push('--enable-verbose')

  const result = await runCli(['--file', file, ...flags]) // run node cli.js --file ./test/db/file.sql as a child process
  return result.failed ? 'error' : 'executed'
}
