## 1.2.1

- Fixed a bug that prevented Multi-DB Driver from being loaded at all in contexts where `process.argv[1]` is undefined, such as the Node REPL or `node -e`.
- Reduced the size of the published npm package by excluding the test suite and development tooling from it.

## 1.2.0

- Fixed a bug that caused the `--create` CLI command to create MySQL and MariaDB users that could only connect from the database server's own host, which prevented the created user from logging in from anywhere else.
- Fixed a bug that caused the `--dump-schema` and `--dump-data` CLI commands to ignore the configured host and port, always attempting to dump from the default port on localhost.
- Fixed a bug that caused `testConnection` to report a successful connection when the connection test query had failed.
- Fixed a bug that prevented `~` from working in file paths. Paths beginning with `~` are now expanded to the current user's home directory in SQLite and PGlite database paths, schema paths, the `--file`, `--dump-schema`, and `--dump-data` CLI arguments, and the `MULTI_DB_DRIVER_CONFIG_LOCATION` environment variable.
- Improved the error reported when a configured database's driver is not installed: Multi-DB Driver now names the missing package and the command to install it, instead of reporting that the database is configured improperly. Queries against such a database report the same thing, rather than failing with an error about an undefined property.
- Updated dependencies.

## 1.1.3

- Fixed a bug that prevented errors from surfacing at times.
- Updated dependencies.

## 1.1.2

- Fixed a bug that prevented the most recent versions of MariaDB from working.
- Updated dependencies.

## 1.1.1

- Altered `configFinder.js` to look for both `.multi-db-config.json` and `.multi-db-driver-config.json` when searching for user defined config file.
- Updated dependencies.

## 1.1.0

- Changed all instances of `multi-db`, `MULTI_DB`, etc to `multi-db-driver`, `MULTI_DB_DRIVER`, etc for clarity.
- Updated various dependencies.

## 1.0.2

- Altered the logic of the `query` method to perform a transaction if `params` is supplied an array of objects or an array of arrays.
- Fixed a CLI text alignment issue.
- Updated dependencies.

## 1.0.1

- Fixed README typo regarding the npm package name.

## 1.0.0

- Initial commit.
