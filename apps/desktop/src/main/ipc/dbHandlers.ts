import { ipcMain } from 'electron'
import type { ConnectionFormData } from '@shared/types/connection'
import {
  listConnections,
  addConnection,
  updateConnection,
  deleteConnection,
  testConnection,
  connectById,
  disconnectById,
  duplicateConnection,
  exportConnections,
  importConnections
} from '../db/ConnectionManager'
import { 
  executeQuery, 
  getDatabases, 
  getSchema, 
  getHistory, 
  getTableColumns, 
  getTableIndexes, 
  getTableDDL, 
  exportTableSQL,
  exportDatabaseSQL,
  importDatabaseSQL,
  createDatabase,
  dropDatabase,
  alterDatabaseCharset 
} from '../db/QueryExecutor'

export function registerDbHandlers(): void {
  ipcMain.handle('db:listConnections', async () => {
    return listConnections()
  })

  ipcMain.handle(
    'db:addConnection',
    async (_event, formData: ConnectionFormData) => {
      return addConnection(formData)
    }
  )

  ipcMain.handle(
    'db:updateConnection',
    async (_event, id: string, formData: Partial<ConnectionFormData>) => {
      return updateConnection(id, formData)
    }
  )

  ipcMain.handle('db:deleteConnection', async (_event, id: string) => {
    return deleteConnection(id)
  })

  ipcMain.handle(
    'db:testConnection',
    async (_event, formData: ConnectionFormData, existingId?: string) => {
      return testConnection(formData, existingId)
    }
  )

  ipcMain.handle('db:connect', async (_event, id: string) => {
    return connectById(id)
  })

  ipcMain.handle('db:disconnect', async (_event, id: string) => {
    return disconnectById(id)
  })

  ipcMain.handle(
    'db:executeQuery',
    async (_event, connectionId: string, sql: string, database?: string) => {
      return executeQuery(connectionId, sql, database)
    }
  )

  ipcMain.handle(
    'db:getDatabases',
    async (_event, connectionId: string) => {
      return getDatabases(connectionId)
    }
  )

  ipcMain.handle(
    'db:getSchema',
    async (_event, connectionId: string, database?: string) => {
      return getSchema(connectionId, database)
    }
  )

  ipcMain.handle(
    'db:getTableColumns',
    async (_event, connectionId: string, table: string, database?: string) => {
      return getTableColumns(connectionId, table, database)
    }
  )

  ipcMain.handle(
    'db:getTableIndexes',
    async (_event, connectionId: string, table: string, database?: string) => {
      return getTableIndexes(connectionId, table, database)
    }
  )

  ipcMain.handle(
    'db:getTableDDL',
    async (_event, connectionId: string, table: string, database?: string) => {
      return getTableDDL(connectionId, table, database)
    }
  )

  ipcMain.handle(
    'db:exportTableSQL',
    async (_event, connectionId: string, table: string, database?: string) => {
      return exportTableSQL(connectionId, table, database)
    }
  )

  ipcMain.handle(
    'db:exportDatabaseSQL',
    async (_event, connectionId: string, database?: string) => {
      return exportDatabaseSQL(connectionId, database)
    }
  )

  ipcMain.handle(
    'db:importDatabaseSQL',
    async (_event, connectionId: string, sql: string, database?: string) => {
      return importDatabaseSQL(connectionId, sql, database)
    }
  )

  ipcMain.handle(
    'db:getHistory',
    async (_event, connectionId?: string, limit?: number) => {
      return getHistory(connectionId, limit)
    }
  )

  ipcMain.handle('db:duplicateConnection', async (_event, id: string) => {
    return duplicateConnection(id)
  })

  ipcMain.handle('db:exportConnections', async () => {
    return exportConnections()
  })

  ipcMain.handle('db:importConnections', async (_event, jsonStr: string) => {
    return importConnections(jsonStr)
  })

  ipcMain.handle(
    'db:createDatabase',
    async (_event, connectionId: string, database: string, charset?: string, collation?: string) => {
      return createDatabase(connectionId, database, charset, collation)
    }
  )

  ipcMain.handle(
    'db:dropDatabase',
    async (_event, connectionId: string, database: string) => {
      return dropDatabase(connectionId, database)
    }
  )

  ipcMain.handle(
    'db:alterDatabaseCharset',
    async (
      _event,
      connectionId: string,
      database: string,
      charset: string,
      collation?: string,
      applyToAllTables?: boolean
    ) => {
      return alterDatabaseCharset(connectionId, database, charset, collation, applyToAllTables)
    }
  )
}
