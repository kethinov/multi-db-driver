# How to contribute

## Writing code for Multi-DB Driver

Here's how to set up a development environment to hack on `multi-db-driver`'s code and run the tests:

### Run the tests with Docker

- Install Node.js / npm.
- Fork/clone this repo.
- `npm ci`
- Install Docker.
- `npm run docker-test` to run the tests or `npm run docker-coverage` to see test coverage.

### Run the tests natively

- Install Node.js / npm.
- Fork/clone this repo.
- `npm ci`
- Install MySQL (this is used to test both MySQL and MariaDB drivers):
  - Windows:
    - Install from: https://dev.mysql.com/downloads/mysql/
    - Use `password` for the root password.
  - Mac
    - Install from: https://dev.mysql.com/downloads/mysql/
    - Use `password` for the root password.
    - Add `/usr/local/mysql/bin` to your PATH.
  - Ubuntu:
    - `sudo apt install mysql-server`
    - `sudo mysqld --initialize`
    - `sudo mysql -u root`
    - `ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'password';`
- Install PostgreSQL:
  - Windows:
    - Install from: https://www.enterprisedb.com/downloads/postgres-postgresql-downloads
    - Use `postgres` for the superuser password.
  - Mac:
    - Install from: https://postgresapp.com/
    - Open Postgres.app and initialize.
  - Ubuntu:
    - `sudo apt install postgresql`
    - `sudo -u postgres psql postgres`
      - Note: default database password is `postgres`.
    - `ALTER USER postgres WITH PASSWORD 'postgres';`
    - `quit`
    - Change line in pg_hba.conf file under `# "local" is for Unix domain socket connections only` to `local all all trust`.
- Install SQLite:
  - Windows:
    - Download `sqlite-tools-....zip` listed under `Precompiled Binaries for Windows` from: https://www.sqlite.org/download.html
    - Create a new folder named `sqlite` anywhere on your machine.
    - Extract contents of `sqlite-tools-....zip` into your created `sqlite` folder.
  - Mac:
    - Comes pre-installed.
  - Ubuntu:
    - `sudo apt install sqlite3`
- `npm t` to run the tests or `npm run coverage` to see test coverage.

## Before opening a pull request

- Be sure all tests pass: `npm t`.
- Ensure good test coverage and write new tests if necessary: `npm run coverage`.
- Add your changes to `CHANGELOG.md`.

## Release process

If you are a maintainer, please follow the following release procedure:

- Merge all desired pull requests into main.
- Bump `package.json` to a new version and run `npm i` to generate a new `package-lock.json`.
- Add new version to CHANGELOG.
- Paste contents of CHANGELOG into new version commit.
- Open and merge a pull request with those changes.
- Tag the merge commit as the a new release version number.
- Publish commit to npm.
- Submit a pull request to the Roosevelt website [following the instructions here](https://github.com/rooseveltframework/roosevelt-website/blob/main/CONTRIBUTING.md).
