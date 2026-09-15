const fs = require('fs')
const path = require('path')
const runCli = require(path.join(__dirname, 'runCli.js'))

module.exports = async (db, schemaPath) => {
  const data = JSON.parse(fs.readFileSync(path.normalize('.multi-db-driver-config.json')))

  if (db) data.default = db

  // override default in config
  fs.writeFileSync(path.normalize('.multi-db-driver-config.json'), JSON.stringify(data, null, 2))

  const result = await runCli(['--dump-data', schemaPath]) // run node cli.js --dump-data schemaPath as a child process
  return result.failed ? 'error' : 'executed'
}
