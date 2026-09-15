const os = require('os')
const path = require('path')

// normalize a filesystem path that came from a user, expanding a leading ~ to their home directory
//
// the shell expands ~ before a program ever sees it, so a path typed into a config file or passed as a command line argument arrives unexpanded. without this it would be treated as a directory literally named "~", relative to wherever the process happens to be running
//
// only ~ and ~/ are expanded. the ~otheruser form is left alone, since resolving it means looking up another account's home directory
module.exports = function resolvePath (filePath) {
  if (typeof filePath !== 'string') return filePath
  let expanded = filePath
  if (filePath === '~') expanded = os.homedir()
  else if (filePath.startsWith('~/') || filePath.startsWith('~\\')) expanded = path.join(os.homedir(), filePath.slice(2))
  return path.normalize(expanded)
}
