import type { DatabaseSchema, SchemaTable } from '@shared/types/query'

export function buildSchemaContext(
  schema: DatabaseSchema,
  tableHints?: string[]
): string {
  const lines: string[] = []

  for (const db of schema.databases) {
    let tables = db.tables
    if (tableHints && tableHints.length > 0) {
      const hintSet = new Set(tableHints.map((t) => t.toLowerCase()))
      tables = tables.filter((t) => hintSet.has(t.name.toLowerCase()))
      // If hints don't match any tables, include all
      if (tables.length === 0) {
        tables = db.tables
      }
    }

    lines.push(`-- Database: ${db.name}`)
    for (const table of tables) {
      lines.push(buildTableDDL(table))
    }
  }

  return lines.join('\n\n')
}

function buildTableDDL(table: SchemaTable): string {
  const lines: string[] = []
  const tableRef = table.schema ? `${table.schema}.${table.name}` : table.name
  lines.push(`CREATE TABLE ${tableRef} (`)

  const colLines = table.columns.map((col) => {
    const parts: string[] = [`  ${col.name} ${col.type.toUpperCase()}`]
    if (col.primaryKey) parts.push('PRIMARY KEY')
    if (!col.nullable && !col.primaryKey) parts.push('NOT NULL')
    if (col.defaultValue !== undefined) parts.push(`DEFAULT ${col.defaultValue}`)
    return parts.join(' ')
  })

  lines.push(colLines.join(',\n'))
  lines.push(');')

  return lines.join('\n')
}
