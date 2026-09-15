const fs = require('fs')
const path = require('path')
const fixture = require(path.join(__dirname, 'fixture.js'))

// paths the generated configs point at
const mysqlSchema = './test/db/mariadb_and_mysql_schema.sql'
const genericSchema = './test/db/pglite_postgres_and_sqlite_schema.sql'

module.exports = () => {
  const mariadb = fixture.resolve('mariadb')
  const mysql = fixture.resolve('mysql')
  const postgres = fixture.resolve('postgres')

  // create .multi-db-driver-config.json in root directory
  fs.writeFileSync(path.normalize(path.resolve(__dirname, '../..', '.multi-db-driver-config.json')), JSON.stringify({
    default: '',
    mysql: {
      ...mysql,
      schema: mysqlSchema
    },
    pglite: {
      ...fixture.configs.pglite,
      schema: genericSchema
    },
    postgres: {
      ...postgres,
      schema: genericSchema
    },
    sqlite: {
      ...fixture.configs.sqlite,
      schema: genericSchema
    }
  }, null, 2))

  // create db directory if it doesn't already exist and create various SQL files in directory
  fs.mkdirSync(path.normalize(path.join(__dirname, '../db')), { recursive: true })
  fs.writeFileSync(path.normalize(path.resolve(__dirname, '../db', 'mariadb_and_mysql_file.sql')), `
      DROP TABLE IF EXISTS test_table;
      CREATE TABLE test_table (
        name VARCHAR(64) PRIMARY KEY,
        description TEXT
      );
    `)
  fs.writeFileSync(path.normalize(path.resolve(__dirname, '../db', 'mariadb_and_mysql_schema.sql')), `
      DROP TABLE IF EXISTS test_table;
      CREATE TABLE test_table (
        name VARCHAR(64) PRIMARY KEY,
        description TEXT
      );
    `)
  fs.writeFileSync(path.normalize(path.resolve(__dirname, '../db', 'pglite_postgres_and_sqlite_file.sql')), `
    DROP TABLE IF EXISTS test_table;
    CREATE TABLE test_table (
      name TEXT PRIMARY KEY,
      description TEXT
    );
  `)
  fs.writeFileSync(path.normalize(path.resolve(__dirname, '../db', 'pglite_postgres_and_sqlite_schema.sql')), `
      DROP TABLE IF EXISTS test_table;
      CREATE TABLE test_table (
        name TEXT PRIMARY KEY,
        description TEXT
      );
    `)
  fs.writeFileSync(path.normalize(path.resolve(__dirname, '../db', 'invalid_schema.sql')), `
      DROP TABLE IF EXIST test_table;
      CRETE TABLE test_tabl (
        name TEXT PRIMARY KEY,
        description TEXT
      );
    `)

  if (!fs.existsSync(path.normalize(path.join(__dirname, '../sqlite-db')))) fs.mkdirSync(path.join(__dirname, '../sqlite-db')) // create sqlite-db folder

  // create configs folder and the alternate configs the tests point the config finder at. these are rewritten every run so they always match the servers this run is actually talking to
  fs.mkdirSync(path.normalize(path.join(__dirname, '../configs')), { recursive: true })
  fs.writeFileSync(path.normalize(path.resolve(__dirname, '../configs', '.alternate-config.json')), JSON.stringify({
    default: 'sqlite',
    sqlite: {
      config: {
        database: './test/sqlite-db/alternate_config_sqlite_multi_db_tests_database.sqlite'
      },
      schema: genericSchema
    }
  }, null, 2))
  fs.writeFileSync(path.normalize(path.resolve(__dirname, '../configs', '.multi-db-driver-config-no-schema.json')), JSON.stringify({
    default: 'postgres',
    postgres: {
      config: {
        ...postgres.config,
        user: 'no_schema_config_test_user',
        password: 'no_schema_config_test_password',
        database: 'no_schema_config_test_database'
      },
      adminConfig: postgres.adminConfig
    }
  }, null, 2))
  fs.writeFileSync(path.normalize(path.resolve(__dirname, '../configs', '.multi-db-driver-config-invalid-schema.json')), JSON.stringify({
    default: 'postgres',
    postgres: {
      config: {
        ...postgres.config,
        user: 'invalid_schema_config_test_user',
        password: 'invalid_schema_config_test_password',
        database: 'invalid_schema_config_test_database'
      },
      adminConfig: postgres.adminConfig,
      schema: './test/db/invalid_schema.sql'
    }
  }, null, 2))
  fs.writeFileSync(path.normalize(path.resolve(__dirname, '../configs', '.multi-db-driver-config-invalid-schema-path.json')), JSON.stringify({
    default: 'sqlite',
    sqlite: {
      config: {
        database: './test/sqlite-db/sqlite_multi_db_tests_database.sqlite'
      },
      schema: './test/invalid_schema_path.sql'
    }
  }, null, 2))
  fs.writeFileSync(path.normalize(path.resolve(__dirname, '../configs', '.mariadb-config.json')), JSON.stringify({
    default: 'mariadb',
    mariadb: {
      ...mariadb,
      schema: mysqlSchema
    }
  }, null, 2))
  fs.writeFileSync(path.normalize(path.resolve(__dirname, '../configs', '.invalid-config.json')), JSON.stringify({
    default: '',
    sqlite: {
      config: {
        database: './test/sqlite-db/sqlite_multi_db_tests_database.sqlite'
      },
      schema: genericSchema
    }
  }, null, 2))
  fs.writeFileSync(path.normalize(path.resolve(__dirname, '../configs', 'invalid-config.txt')), 'not valid json')
}
