import { useState, useMemo } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'
import { Download, AlertCircle, CheckCircle2, Clock } from 'lucide-react'
import type { QueryResult } from '@shared/types/query'
import { clsx } from 'clsx'

interface ResultsPanelProps {
  result: QueryResult | null
  isLoading: boolean
}

export function ResultsPanel({ result, isLoading }: ResultsPanelProps): JSX.Element {
  const [activeResultTab, setActiveResultTab] = useState<'results' | 'messages'>('results')

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-app-bg text-text-muted">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">执行中...</span>
        </div>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="flex items-center justify-center h-full bg-app-bg text-text-muted text-sm">
        执行查询后结果显示在这里
      </div>
    )
  }

  const hasError = !!result.error
  const hasRows = result.rows.length > 0

  return (
    <div className="flex flex-col h-full bg-app-bg">
      {/* Results toolbar */}
      <div className="flex items-center justify-between px-3 py-1 bg-app-sidebar border-b border-app-border shrink-0">
        <div className="flex items-center gap-3">
          {/* Tab switcher */}
          <div className="flex gap-1">
            <button
              onClick={() => setActiveResultTab('results')}
              className={clsx(
                'px-2 py-0.5 text-xs rounded transition-colors',
                activeResultTab === 'results'
                  ? 'bg-app-active text-white'
                  : 'text-text-secondary hover:text-text-primary'
              )}
            >
              结果
            </button>
            <button
              onClick={() => setActiveResultTab('messages')}
              className={clsx(
                'px-2 py-0.5 text-xs rounded transition-colors',
                activeResultTab === 'messages'
                  ? 'bg-app-active text-white'
                  : 'text-text-secondary hover:text-text-primary'
              )}
            >
              消息
            </button>
          </div>

          {/* Status */}
          <div className="flex items-center gap-1.5 text-xs">
            {hasError ? (
              <><AlertCircle size={12} className="text-accent-red" /><span className="text-accent-red">错误</span></>
            ) : (
              <><CheckCircle2 size={12} className="text-accent-green" /><span className="text-accent-green">{result.rowCount} 行</span></>
            )}
            <Clock size={11} className="text-text-muted ml-2" />
            <span className="text-text-muted">{result.durationMs}ms</span>
          </div>
        </div>

        {/* Export */}
        {hasRows && (
          <button
            onClick={() => exportCSV(result)}
            className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors"
            title="导出 CSV"
          >
            <Download size={12} />
            导出 CSV
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden selectable">
        {activeResultTab === 'results' ? (
          hasError ? (
            <div className="p-4 text-accent-red text-sm font-mono">{result.error}</div>
          ) : hasRows ? (
            <DataTable result={result} />
          ) : (
            <div className="p-4 text-text-muted text-sm">
              执行成功，影响 {result.rowCount} 行。
            </div>
          )
        ) : (
          <div className="p-4 font-mono text-xs text-text-secondary">
            <div>{result.error ?? `执行成功，影响 ${result.rowCount} 行 (${result.durationMs}ms)`}</div>
            <div className="mt-2 text-text-muted whitespace-pre-wrap">{result.sql}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function DataTable({ result }: { result: QueryResult }): JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)

  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () =>
      result.columns.map((col) => ({
        id: col.name,
        accessorKey: col.name,
        header: col.name,
        size: estimateColumnWidth(col.name, result.rows),
        cell: (info) => {
          const val = info.getValue()
          if (val === null || val === undefined) {
            return <span className="text-text-muted italic">NULL</span>
          }
          return <span className="font-mono">{String(val)}</span>
        }
      })),
    [result.columns, result.rows]
  )

  const table = useReactTable({
    data: result.rows,
    columns,
    getCoreRowModel: getCoreRowModel()
  })

  const { rows } = table.getRowModel()

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 20
  })

  const totalSize = virtualizer.getTotalSize()
  const virtualRows = virtualizer.getVirtualItems()
  const paddingTop = virtualRows.length > 0 ? virtualRows[0]?.start ?? 0 : 0
  const paddingBottom =
    virtualRows.length > 0
      ? totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <table className="w-full text-xs border-collapse" style={{ minWidth: 'max-content' }}>
        <thead className="sticky top-0 z-10 bg-app-sidebar">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b border-app-border">
              {/* Row number */}
              <th className="w-10 px-2 py-1.5 text-right text-text-muted border-r border-app-border font-normal">
                #
              </th>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  style={{ width: header.getSize() }}
                  className="px-2 py-1.5 text-left text-text-secondary font-semibold border-r border-app-border whitespace-nowrap"
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {paddingTop > 0 && (
            <tr><td colSpan={columns.length + 1} style={{ height: `${paddingTop}px` }} /></tr>
          )}
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index]
            return (
              <tr
                key={row.id}
                className={clsx(
                  'border-b border-app-border hover:bg-app-hover transition-colors',
                  virtualRow.index % 2 === 0 ? 'bg-app-bg' : 'bg-app-panel'
                )}
              >
                <td className="px-2 py-1 text-right text-text-muted border-r border-app-border font-mono text-2xs">
                  {virtualRow.index + 1}
                </td>
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="px-2 py-1 border-r border-app-border max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            )
          })}
          {paddingBottom > 0 && (
            <tr><td colSpan={columns.length + 1} style={{ height: `${paddingBottom}px` }} /></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function estimateColumnWidth(name: string, rows: Record<string, unknown>[]): number {
  const headerWidth = name.length * 8 + 32
  const sampleRows = rows.slice(0, 20)
  const maxDataWidth = sampleRows.reduce((max, row) => {
    const val = String(row[name] ?? '')
    return Math.max(max, Math.min(val.length * 7 + 16, 300))
  }, 60)
  return Math.max(headerWidth, maxDataWidth)
}

function exportCSV(result: QueryResult): void {
  const headers = result.columns.map((c) => JSON.stringify(c.name)).join(',')
  const dataRows = result.rows.map((row) =>
    result.columns.map((c) => {
      const val = row[c.name]
      if (val == null) return ''
      const str = String(val)
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? JSON.stringify(str)
        : str
    }).join(',')
  )
  const csv = [headers, ...dataRows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `nexsql-export-${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
