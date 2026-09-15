const { spawnSync } = require('child_process')

const probe = (command, args) => spawnSync(command, args, { shell: false, stdio: 'ignore' }).status === 0

// find how compose is available here, if at all. it ships two ways: as a docker cli plugin invoked as `docker compose`, and as the older standalone `docker-compose` binary
//
// returns { command, args, label } for whichever is present, or null
module.exports = function findDockerCompose () {
  if (!probe('docker', ['--version'])) return null // no docker at all
  if (probe('docker', ['compose', 'version'])) return { command: 'docker', args: ['compose'], label: 'docker compose' }
  if (probe('docker-compose', ['version'])) return { command: 'docker-compose', args: [], label: 'docker-compose' }
  return null
}

module.exports.dockerInstalled = () => probe('docker', ['--version'])

// docker is running rather than merely installed
module.exports.dockerRunning = () => probe('docker', ['info'])

// compose is packaged differently depending on where docker itself came from. distributions ship it as docker-compose-v2; docker's own apt repo calls the same thing docker-compose-plugin, and only that repo carries that name
module.exports.installHints = {
  'Debian/Ubuntu': 'sudo apt install docker-compose-v2',
  'Fedora/RHEL': 'sudo dnf install docker-compose',
  Arch: 'sudo pacman -S docker-compose',
  macOS: 'included with Docker Desktop, or brew install docker-compose',
  Windows: 'included with Docker Desktop'
}

module.exports.installNote = 'if you installed Docker from Docker\'s own apt repo rather than your distribution\'s, the package is called docker-compose-plugin instead'
