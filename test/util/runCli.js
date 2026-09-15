const path = require('path')
const { spawn } = require('child_process')

// lines the cli prints to stderr during a healthy run: driver notices and warnings rather than the cli reporting that it failed
const benignStderr = [/🪶/, /initialize/, /\[Warning\]/, /⚠️/, /wrong database/]

// run cli.js as a child process and collect everything a test might assert on
//
// --yes answers the confirmation prompt, so nothing is written to the child's stdin and nothing has to watch stdout for the prompt to appear. the result is decided once the process has exited rather than from whichever chunk of output happened to arrive first
module.exports = async function runCli (args, options = {}) {
  const child = spawn('node', ['cli.js', ...args, '--yes'], {
    shell: false,
    cwd: path.join(__dirname, '../..'),
    env: { ...process.env, ...options.env }
  })

  let stdout = ''
  let stderr = ''
  child.stdout.on('data', data => { stdout += data.toString() })
  child.stderr.on('data', data => { stderr += data.toString() })
  const code = await new Promise(resolve => child.on('close', resolve))

  // some failures are reported only in the output: a config the cli could not load falls back to whichever config it can find instead of exiting nonzero
  const printedError = stderr.split('\n').some(line => line.trim() !== '' && !benignStderr.some(pattern => pattern.test(line)))

  return { code, stdout, stderr, failed: code !== 0 || printedError }
}
