import type { ConnectionConfig } from '@shared/types/connection'
import type { IDbDriver } from '../types'
import { MySQLDriver } from './mysql'
import { PostgresDriver } from './postgres'
import { MSSQLDriver } from './mssql'
import { SQLiteDriver } from './sqlite'

export function createDriver(config: ConnectionConfig, password: string): IDbDriver {
  switch (config.type) {
    case 'mysql':
      return new MySQLDriver({
        host: config.host ?? 'localhost',
        port: config.port ?? 3306,
        database: config.database ?? '',
        user: config.username ?? '',
        password,
        ssl: config.ssl
      })

    case 'postgresql':
      return new PostgresDriver({
        host: config.host ?? 'localhost',
        port: config.port ?? 5432,
        database: config.database ?? '',
        user: config.username ?? '',
        password,
        ssl: config.ssl
      })

    case 'mssql':
      return new MSSQLDriver({
        host: config.host ?? 'localhost',
        port: config.port ?? 1433,
        database: config.database ?? '',
        user: config.username ?? '',
        password,
        ssl: config.ssl
      })

    case 'sqlite':
      return new SQLiteDriver({
        filePath: config.filePath ?? ':memory:'
      })

    default:
      throw new Error(`Unsupported database type: ${config.type}`)
  }
}

export { MySQLDriver, PostgresDriver, MSSQLDriver, SQLiteDriver }
