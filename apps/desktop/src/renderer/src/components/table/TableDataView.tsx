import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { RefreshCw, Plus, Save, Copy, Search, ChevronLeft, ChevronRight, X, Filter, Download, Trash2, Database, Rows3, HardDrive, Info, Braces } from 'lucide-react'
import { clsx } from 'clsx'
import type { SchemaColumn } from '@shared/types/query'
import type { DBType } from '@shared/types/connection'
import type { QueryTab, TableSortDirection, TableViewState, TableSortRule, TableColumnFilterRule } from '@renderer/stores/queryStore'
import { useConnectionStore } from '@renderer/stores/connectionStore'
import { useQueryStore } from '@renderer/stores/queryStore'

interface TableDataViewProps {
  tab: QueryTab
}

interface DisplayRow {
  key: string
  row: Record<string, unknown>
  isNew: boolean
  isPendingDelete: boolean
  draftId?: string
}

interface RowMenuState {
  x: number
  y: number
  selectedRows: DisplayRow[]
}

type RowSelectionMode = 'replace' | 'add' | 'remove'

interface DragSelectionState {
  anchorKey: string
  baseKeys: string[]
  mode: RowSelectionMode
}

interface EditingCell {
  rowKey: string
  columnName: string
}

interface TableMetaInfo {
  engine?: string
  tableRows?: number
  dataLength?: number
  indexLength?: number
  totalSize?: number
  pageCount?: number
  pageSize?: number
  updatedAt?: string
  comment?: string
}

const emptyTableView = (): TableViewState => ({
  page: 1,
  pageSize: 100,
  totalRows: 0,
  sortColumn: null,
  sortDirection: 'asc',
  sortRules: [],
  filterText: '',
  columnFilters: [],
  columns: [],
  rows: [],
  pendingEdits: {},
  pendingInserts: [],
  pendingDeletes: {}
})

export function TableDataView({ tab }: TableDataViewProps): JSX.Element {
  const { connections } = useConnectionStore()
  const { patchTab, updateTableView } = useQueryStore()
  const connection = connections.find((item) => item.id === tab.connectionId) ?? null
  const tableView = tab.tableView ?? emptyTableView()
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null)
  const [filterInput, setFilterInput] = useState(tableView.filterText)
  const [columnFilterRows, setColumnFilterRows] = useState<TableColumnFilterRule[]>(
    tableView.columnFilters?.length
      ? tableView.columnFilters
      : [{ id: crypto.randomUUID(), column: '', value: '' }]
  )
  const [showColumnFilters, setShowColumnFilters] = useState((tableView.columnFilters?.length ?? 0) > 0)
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])
  const [activeRowKey, setActiveRowKey] = useState<string | null>(null)
  const [dragSelection, setDragSelection] = useState<DragSelectionState | null>(null)
  const [tableMeta, setTableMeta] = useState<TableMetaInfo | null>(null)
  const [metaLoading, setMetaLoading] = useState(false)
  const [metaError, setMetaError] = useState<string | null>(null)
  const [showDetailsPanel, setShowDetailsPanel] = useState(true)
  const [jsonViewField, setJsonViewField] = useState<{ name: string; value: string } | null>(null)

  const dbType = connection?.type ?? 'mysql'
  const pkColumns = useMemo(
    () => tableView.columns.filter((column) => column.primaryKey),
    [tableView.columns]
  )
  const hasPrimaryKey = pkColumns.length > 0
  const totalPages = Math.max(1, Math.ceil(tableView.totalRows / tableView.pageSize || 1))

  useEffect(() => {
    setFilterInput(tableView.filterText)
  }, [tab.id, tableView.filterText])

  useEffect(() => {
    setSelectedRowKeys([])
    setActiveRowKey(null)
    setDragSelection(null)
    setTableMeta(null)
    setMetaError(null)
  }, [tab.id, tab.tableName, tab.connectionId, tab.selectedDatabase])

  useEffect(() => {
    setColumnFilterRows(
      tableView.columnFilters?.length
        ? tableView.columnFilters
        : [{ id: crypto.randomUUID(), column: '', value: '' }]
    )
    if ((tableView.columnFilters?.length ?? 0) > 0) setShowColumnFilters(true)
  }, [tab.id, tableView.columnFilters])

  const setPendingState = (view: TableViewState): TableViewState => view

  const updateView = (updater: (view: TableViewState) => TableViewState): void => {
    const current =
      useQueryStore.getState().tabs.find((item) => item.id === tab.id)?.tableView ?? emptyTableView()
    const next = setPendingState(updater(current))
    const hasPendingChanges =
      Object.keys(next.pendingEdits).length > 0 ||
      next.pendingInserts.length > 0 ||
      Object.keys(next.pendingDeletes).length > 0

    updateTableView(tab.id, () => next)
    patchTab(tab.id, { hasPendingChanges })
  }

  const loadRows = async (overrides?: Partial<TableViewState>): Promise<void> => {
    if (!tab.connectionId || !tab.tableName || !window.db) return

    const currentView = tab.tableView ?? emptyTableView()
    const nextPage = overrides?.page ?? currentView.page
    const nextPageSize = overrides?.pageSize ?? currentView.pageSize
    const nextFilter = overrides?.filterText ?? currentView.filterText
    const nextColumnFilters = overrides?.columnFilters ?? currentView.columnFilters ?? []

    patchTab(tab.id, { isLoading: true, error: null })

    try {
      const columns =
        currentView.columns.length > 0 && !overrides?.columns
          ? currentView.columns
          : await window.db.getTableColumns(tab.connectionId, tab.tableName, tab.selectedDatabase ?? undefined)

      const defaultSortColumn =
        overrides?.sortColumn ??
        currentView.sortColumn ??
        columns.find((column) => column.primaryKey)?.name ??
        columns[0]?.name ??
        null
      const sortDirection = overrides?.sortDirection ?? currentView.sortDirection
      const nextSortRules =
        overrides?.sortRules ??
        (currentView.sortRules?.length
          ? currentView.sortRules
          : defaultSortColumn
          ? [{ column: defaultSortColumn, direction: sortDirection }]
          : [])
      const whereClause = buildCombinedWhere(columns, nextFilter, nextColumnFilters, dbType)
      const dataSql = buildPagedQuery({
        dbType,
        tableName: tab.tableName,
        page: nextPage,
        pageSize: nextPageSize,
        sortRules: nextSortRules,
        whereClause
      })
      const countSql = `SELECT COUNT(*) AS total FROM ${quoteIdentifier(dbType, tab.tableName)}${whereClause}`

      const [dataResult, countResult] = await Promise.all([
        window.db.executeQuery(tab.connectionId, dataSql, tab.selectedDatabase ?? undefined),
        window.db.executeQuery(tab.connectionId, countSql, tab.selectedDatabase ?? undefined)
      ])

      const totalRows = Number(countResult.rows[0]?.total ?? countResult.rows[0]?.TOTAL ?? 0)

      updateTableView(tab.id, (view) => ({
        ...view,
        columns,
        rows: dataResult.rows,
        totalRows,
        page: nextPage,
        pageSize: nextPageSize,
        sortColumn: defaultSortColumn,
        sortDirection,
        sortRules: nextSortRules,
        filterText: nextFilter
        ,
        columnFilters: nextColumnFilters
      }))
      patchTab(tab.id, { isLoading: false, error: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      patchTab(tab.id, { isLoading: false, error: message })
    }
  }

  useEffect(() => {
    if ((tab.tableView?.columns.length ?? 0) === 0 && (tab.tableView?.rows.length ?? 0) === 0) {
      void loadRows()
    }
  }, [tab.id, tab.connectionId, tab.tableName, tab.selectedDatabase])

  const displayRows = useMemo<DisplayRow[]>(() => {
    const rows: DisplayRow[] = []

    for (const draft of tableView.pendingInserts) {
      rows.push({
        key: `new:${draft.id}`,
        row: draft.values,
        isNew: true,
        isPendingDelete: false,
        draftId: draft.id
      })
    }

    tableView.rows.forEach((row, index) => {
      const rowKey = buildRowKey(row, pkColumns, index)
      const pendingEdit = tableView.pendingEdits[rowKey]
      const pendingDelete = !!tableView.pendingDeletes[rowKey]
      rows.push({
        key: rowKey,
        row: pendingEdit ? applyPendingEdit(row, pendingEdit.values) : row,
        isNew: false,
        isPendingDelete: pendingDelete
      })
    })

    return rows
  }, [tableView.pendingEdits, tableView.pendingDeletes, tableView.pendingInserts, tableView.rows, pkColumns])

  const rowIndexByKey = useMemo(
    () => new Map(displayRows.map((row, index) => [row.key, index])),
    [displayRows]
  )

  const selectedRowSet = useMemo(() => new Set(selectedRowKeys), [selectedRowKeys])

  const selectedDisplayRows = useMemo(() => {
    const rowMap = new Map(displayRows.map((row) => [row.key, row]))
    return selectedRowKeys
      .map((rowKey) => rowMap.get(rowKey))
      .filter((row): row is DisplayRow => !!row)
  }, [displayRows, selectedRowKeys])

  const selectedDisplayRow = useMemo(() => {
    const preferredKey = activeRowKey && selectedRowSet.has(activeRowKey) ? activeRowKey : selectedRowKeys[0] ?? null
    if (!preferredKey) return displayRows[0] ?? null
    return displayRows.find((row) => row.key === preferredKey) ?? displayRows[0] ?? null
  }, [activeRowKey, displayRows, selectedRowKeys, selectedRowSet])

  useEffect(() => {
    if (displayRows.length === 0) {
      setSelectedRowKeys([])
      setActiveRowKey(null)
      return
    }

    const validKeys = selectedRowKeys.filter((rowKey) => rowIndexByKey.has(rowKey))
    if (validKeys.length !== selectedRowKeys.length) {
      setSelectedRowKeys(validKeys)
    }

    if (validKeys.length === 0) {
      setSelectedRowKeys([displayRows[0].key])
      setActiveRowKey(displayRows[0].key)
      return
    }

    if (!activeRowKey || !rowIndexByKey.has(activeRowKey)) {
      setActiveRowKey(validKeys[0])
    }
  }, [activeRowKey, displayRows, rowIndexByKey, selectedRowKeys])

  useEffect(() => {
    if (!dragSelection) return undefined

    const stopDragSelection = (): void => setDragSelection(null)

    window.addEventListener('mouseup', stopDragSelection)
    window.addEventListener('blur', stopDragSelection)

    return () => {
      window.removeEventListener('mouseup', stopDragSelection)
      window.removeEventListener('blur', stopDragSelection)
    }
  }, [dragSelection])

  useEffect(() => {
    const loadTableMeta = async (): Promise<void> => {
      if (!tab.connectionId || !tab.tableName || !window.db) return

      setMetaLoading(true)
      setMetaError(null)
      try {
        if (dbType === 'sqlite') {
          const [pageCountRes, pageSizeRes] = await Promise.all([
            window.db.executeQuery(tab.connectionId, 'PRAGMA page_count;', tab.selectedDatabase ?? undefined),
            window.db.executeQuery(tab.connectionId, 'PRAGMA page_size;', tab.selectedDatabase ?? undefined)
          ])
          if (pageCountRes.error) throw new Error(pageCountRes.error)
          if (pageSizeRes.error) throw new Error(pageSizeRes.error)

          const pageCount = toNumber(pageCountRes.rows[0]?.page_count)
          const pageSize = toNumber(pageSizeRes.rows[0]?.page_size)
          const totalSize = pageCount != null && pageSize != null ? pageCount * pageSize : undefined

          setTableMeta({
            tableRows: tableView.totalRows,
            pageCount,
            pageSize,
            totalSize
          })
          return
        }

        const metaSql = buildTableMetaQuery(dbType, tab.tableName, tab.selectedDatabase ?? undefined)
        const result = await window.db.executeQuery(tab.connectionId, metaSql, tab.selectedDatabase ?? undefined)
        if (result.error) throw new Error(result.error)

        const row = result.rows[0] ?? {}
        setTableMeta({
          engine: toText(row.engine),
          tableRows: toNumber(row.tableRows) ?? tableView.totalRows,
          dataLength: toNumber(row.dataLength),
          indexLength: toNumber(row.indexLength),
          totalSize: toNumber(row.totalSize),
          updatedAt: toText(row.updatedAt),
          comment: toText(row.comment)
        })
      } catch (err) {
        setMetaError(err instanceof Error ? err.message : String(err))
      } finally {
        setMetaLoading(false)
      }
    }

    void loadTableMeta()
  }, [tab.connectionId, tab.tableName, tab.selectedDatabase, tab.id, dbType, tableView.totalRows])

  const beginCellEdit = (displayRow: DisplayRow, columnName: string): void => {
    if (displayRow.isPendingDelete) return
    if (!displayRow.isNew && !hasPrimaryKey) return
    setEditingCell({ rowKey: displayRow.key, columnName })
  }

  const updateCellValue = (displayRow: DisplayRow, columnName: string, nextValue: string): void => {
    if (displayRow.isNew) {
      updateView((view) => ({
        ...view,
        pendingInserts: view.pendingInserts.map((draft) =>
          draft.id === displayRow.draftId
            ? { ...draft, values: { ...draft.values, [columnName]: nextValue } }
            : draft
        )
      }))
      return
    }

    const originalRow = tableView.rows.find((row, index) => buildRowKey(row, pkColumns, index) === displayRow.key)
    if (!originalRow) return

    updateView((view) => ({
      ...view,
      pendingEdits: {
        ...view.pendingEdits,
        [displayRow.key]: {
          originalRow,
          values: {
            ...(view.pendingEdits[displayRow.key]?.values ?? objectToEditableRow(originalRow, view.columns)),
            [columnName]: nextValue
          }
        }
      }
    }))
  }

  const addDraftRow = (): void => {
    updateView((view) => ({
      ...view,
      pendingInserts: [
        {
          id: crypto.randomUUID(),
          values: Object.fromEntries(view.columns.map((column) => [column.name, '']))
        },
        ...view.pendingInserts
      ]
    }))
  }

  const discardChanges = (): void => {
    if (!tab.hasPendingChanges) return
    const confirmed = confirm('确认丢弃当前未提交的修改吗？')
    if (!confirmed) return
    updateTableView(tab.id, (view) => ({
      ...view,
      pendingEdits: {},
      pendingInserts: [],
      pendingDeletes: {}
    }))
    patchTab(tab.id, { hasPendingChanges: false })
    setEditingCell(null)
  }

  const toggleDelete = (displayRow: DisplayRow): void => {
    if (displayRow.isNew) {
      updateView((view) => ({
        ...view,
        pendingInserts: view.pendingInserts.filter((draft) => draft.id !== displayRow.draftId)
      }))
      return
    }

    if (!hasPrimaryKey) return

    const originalRow = tableView.rows.find((row, index) => buildRowKey(row, pkColumns, index) === displayRow.key)
    if (!originalRow) return

    updateView((view) => {
      const nextDeletes = { ...view.pendingDeletes }
      if (nextDeletes[displayRow.key]) {
        delete nextDeletes[displayRow.key]
      } else {
        nextDeletes[displayRow.key] = originalRow
      }
      return {
        ...view,
        pendingDeletes: nextDeletes
      }
    })
  }

  const markRowsForDelete = (rows: DisplayRow[]): void => {
    const draftIds = new Set(rows.filter((row) => row.isNew && row.draftId).map((row) => row.draftId as string))
    const rowKeys = new Set(rows.filter((row) => !row.isNew && !row.isPendingDelete).map((row) => row.key))

    if (draftIds.size === 0 && rowKeys.size === 0) return

    updateView((view) => {
      const nextPendingDeletes = { ...view.pendingDeletes }

      view.rows.forEach((row, index) => {
        const rowKey = buildRowKey(row, pkColumns, index)
        if (rowKeys.has(rowKey)) {
          nextPendingDeletes[rowKey] = row
        }
      })

      return {
        ...view,
        pendingInserts: view.pendingInserts.filter((draft) => !draftIds.has(draft.id)),
        pendingDeletes: nextPendingDeletes
      }
    })
  }

  const unmarkRowsForDelete = (rows: DisplayRow[]): void => {
    const rowKeys = new Set(rows.filter((row) => !row.isNew && row.isPendingDelete).map((row) => row.key))
    if (rowKeys.size === 0) return

    updateView((view) => {
      const nextPendingDeletes = { ...view.pendingDeletes }
      rowKeys.forEach((rowKey) => {
        delete nextPendingDeletes[rowKey]
      })
      return {
        ...view,
        pendingDeletes: nextPendingDeletes
      }
    })
  }

  const removeDraftRows = (rows: DisplayRow[]): void => {
    const draftIds = new Set(rows.filter((row) => row.isNew && row.draftId).map((row) => row.draftId as string))
    if (draftIds.size === 0) return

    updateView((view) => ({
      ...view,
      pendingInserts: view.pendingInserts.filter((draft) => !draftIds.has(draft.id))
    }))
  }

  const handleRowMouseDown = (
    event: React.MouseEvent<HTMLTableRowElement>,
    displayRow: DisplayRow
  ): void => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return

    event.preventDefault()
    setRowMenu(null)

    if (event.shiftKey && activeRowKey && rowIndexByKey.has(activeRowKey)) {
      setSelectedRowKeys(getRowRangeKeys(displayRows, rowIndexByKey, activeRowKey, displayRow.key))
      setActiveRowKey(displayRow.key)
      return
    }

    if (event.ctrlKey || event.metaKey) {
      const mode: RowSelectionMode = selectedRowSet.has(displayRow.key) ? 'remove' : 'add'
      setSelectedRowKeys(
        applyDragSelection(displayRows, rowIndexByKey, selectedRowKeys, displayRow.key, displayRow.key, mode)
      )
      setActiveRowKey(displayRow.key)
      setDragSelection({
        anchorKey: displayRow.key,
        baseKeys: selectedRowKeys,
        mode
      })
      return
    }

    setSelectedRowKeys([displayRow.key])
    setActiveRowKey(displayRow.key)
    setDragSelection({
      anchorKey: displayRow.key,
      baseKeys: [displayRow.key],
      mode: 'replace'
    })
  }

  const handleRowMouseEnter = (displayRow: DisplayRow): void => {
    if (!dragSelection) return

    setSelectedRowKeys(
      applyDragSelection(
        displayRows,
        rowIndexByKey,
        dragSelection.baseKeys,
        dragSelection.anchorKey,
        displayRow.key,
        dragSelection.mode
      )
    )
    setActiveRowKey(displayRow.key)
  }

  const openRowContextMenu = (
    event: React.MouseEvent<HTMLTableRowElement>,
    displayRow: DisplayRow
  ): void => {
    event.preventDefault()

    const nextKeys = selectedRowSet.has(displayRow.key) ? selectedRowKeys : [displayRow.key]
    const rowMap = new Map(displayRows.map((row) => [row.key, row]))
    const nextRows = nextKeys
      .map((rowKey) => rowMap.get(rowKey))
      .filter((row): row is DisplayRow => !!row)

    if (!selectedRowSet.has(displayRow.key)) {
      setSelectedRowKeys([displayRow.key])
    }
    setActiveRowKey(displayRow.key)
    setRowMenu({
      x: event.clientX,
      y: event.clientY,
      selectedRows: nextRows.length > 0 ? nextRows : [displayRow]
    })
  }

  const commitChanges = async (): Promise<void> => {
    if (!tab.connectionId || !tab.tableName || !window.db) return
    const view = tab.tableView ?? emptyTableView()
    patchTab(tab.id, { isLoading: true, error: null })

    try {
      for (const draft of view.pendingInserts) {
        const filledColumns = view.columns.filter((column) => (draft.values[column.name] ?? '') !== '')
        if (filledColumns.length === 0) continue
        const sql = `INSERT INTO ${quoteIdentifier(dbType, tab.tableName)} (${filledColumns
          .map((column) => quoteIdentifier(dbType, column.name))
          .join(', ')}) VALUES (${filledColumns
          .map((column) => sqlValue(draft.values[column.name]))
          .join(', ')})`
        const result = await window.db.executeQuery(tab.connectionId, sql, tab.selectedDatabase ?? undefined)
        if (result.error) throw new Error(result.error)
      }

      for (const [rowKey, pendingEdit] of Object.entries(view.pendingEdits)) {
        const changedColumns = view.columns.filter((column) => {
          const oldValue = pendingEdit.originalRow[column.name] == null ? '' : String(pendingEdit.originalRow[column.name])
          return (pendingEdit.values[column.name] ?? '') !== oldValue
        })
        if (changedColumns.length === 0) continue
        const setClause = changedColumns
          .map((column) => `${quoteIdentifier(dbType, column.name)} = ${sqlValue(pendingEdit.values[column.name])}`)
          .join(', ')
        const whereClause = buildWhereClause(pkColumns, pendingEdit.originalRow, dbType)
        const sql = `UPDATE ${quoteIdentifier(dbType, tab.tableName)} SET ${setClause} WHERE ${whereClause}`
        const result = await window.db.executeQuery(tab.connectionId, sql, tab.selectedDatabase ?? undefined)
        if (result.error) throw new Error(`${rowKey}: ${result.error}`)
      }

      for (const row of Object.values(view.pendingDeletes)) {
        const sql = `DELETE FROM ${quoteIdentifier(dbType, tab.tableName)} WHERE ${buildWhereClause(pkColumns, row, dbType)}`
        const result = await window.db.executeQuery(tab.connectionId, sql, tab.selectedDatabase ?? undefined)
        if (result.error) throw new Error(result.error)
      }

      updateTableView(tab.id, (current) => ({
        ...current,
        pendingEdits: {},
        pendingInserts: [],
        pendingDeletes: {}
      }))
      patchTab(tab.id, { hasPendingChanges: false })
      setEditingCell(null)
      await loadRows()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      patchTab(tab.id, { isLoading: false, error: message })
    }
  }

  const copyTableName = async (): Promise<void> => {
    if (!tab.tableName) return
    await navigator.clipboard.writeText(tab.tableName)
  }

  const copyText = async (value: string): Promise<void> => {
    await navigator.clipboard.writeText(value)
    setRowMenu(null)
  }

  const copyTextSilent = async (value: string): Promise<void> => {
    await navigator.clipboard.writeText(value)
  }

  const getSortMeta = (columnName: string): { direction: TableSortDirection; index: number } | null => {
    const index = tableView.sortRules.findIndex((rule) => rule.column === columnName)
    if (index === -1) return null
    return { direction: tableView.sortRules[index].direction, index: index + 1 }
  }

  const handleSortClick = (columnName: string, multi: boolean): void => {
    const currentRules = tableView.sortRules ?? []
    const existing = currentRules.find((rule) => rule.column === columnName)

    let nextRules: TableSortRule[]
    if (!existing) {
      nextRules = multi ? [...currentRules, { column: columnName, direction: 'asc' }] : [{ column: columnName, direction: 'asc' }]
    } else if (existing.direction === 'asc') {
      nextRules = currentRules.map((rule) =>
        rule.column === columnName ? { ...rule, direction: 'desc' } : rule
      )
      if (!multi) nextRules = [{ column: columnName, direction: 'desc' }]
    } else {
      nextRules = currentRules.filter((rule) => rule.column !== columnName)
      if (!multi && nextRules.length > 0) nextRules = [nextRules[0]]
    }

    if (!multi && nextRules.length > 1) {
      nextRules = [nextRules[nextRules.length - 1]]
    }

    const fallbackSort = nextRules[0]?.column ?? null
    const fallbackDirection = nextRules[0]?.direction ?? 'asc'
    void loadRows({
      page: 1,
      sortRules: nextRules,
      sortColumn: fallbackSort,
      sortDirection: fallbackDirection
    })
  }

  const addColumnFilterRow = (): void => {
    setColumnFilterRows((prev) => [...prev, { id: crypto.randomUUID(), column: '', value: '' }])
  }

  const updateColumnFilterRow = (id: string, patch: Partial<TableColumnFilterRule>): void => {
    setColumnFilterRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  const removeColumnFilterRow = (id: string): void => {
    setColumnFilterRows((prev) => {
      const next = prev.filter((row) => row.id !== id)
      return next.length > 0 ? next : [{ id: crypto.randomUUID(), column: '', value: '' }]
    })
  }

  const applyColumnFilters = (): void => {
    const normalized = columnFilterRows
      .map((row) => ({ ...row, value: row.value.trim() }))
      .filter((row) => row.column && row.value)
    void loadRows({ page: 1, columnFilters: normalized })
  }

  const clearColumnFilters = (): void => {
    const empty = [{ id: crypto.randomUUID(), column: '', value: '' }]
    setColumnFilterRows(empty)
    void loadRows({ page: 1, columnFilters: [] })
  }

  const exportCurrentPageCsv = (): void => {
    downloadCsv(
      `${tab.tableName ?? 'table'}-page-${tableView.page}.csv`,
      rowsToCsv(tableView.columns, tableView.rows)
    )
  }

  const exportFilteredCsv = async (): Promise<void> => {
    if (!tab.connectionId || !tab.tableName || !window.db) return
    const whereClause = buildCombinedWhere(
      tableView.columns,
      tableView.filterText,
      tableView.columnFilters ?? [],
      dbType
    )
    const orderBy = buildOrderByClause(tableView.sortRules, dbType)
    const sql = `SELECT * FROM ${quoteIdentifier(dbType, tab.tableName)}${whereClause}${orderBy}`
    const result = await window.db.executeQuery(tab.connectionId, sql, tab.selectedDatabase ?? undefined)
    if (result.error) {
      patchTab(tab.id, { error: result.error })
      return
    }
    downloadCsv(
      `${tab.tableName ?? 'table'}-filtered.csv`,
      rowsToCsv(tableView.columns, result.rows)
    )
  }

  const copySelectedInsertSql = async (rows: DisplayRow[]): Promise<void> => {
    await copyText(rows.map((row) => buildInsertSql(tab.tableName!, tableView.columns, row.row, connection!.type)).join('\n'))
  }

  const copySelectedUpdateSql = async (rows: DisplayRow[]): Promise<void> => {
    const sql = rows
      .filter((row) => !row.isNew)
      .map((row) => buildUpdateSql(tab.tableName!, tableView.columns, pkColumns, row.row, connection!.type))
      .join('\n')
    await copyText(sql)
  }

  const copySelectedCsv = async (rows: DisplayRow[]): Promise<void> => {
    const csv = rows.length <= 1
      ? buildCsv(tableView.columns, rows[0].row)
      : rowsToCsv(tableView.columns, rows.map((row) => row.row))
    await copyText(csv)
  }

  const canEditSelectedRow = !!selectedDisplayRow && !selectedDisplayRow.isPendingDelete && (selectedDisplayRow.isNew || hasPrimaryKey)

  return (
    <div className="flex flex-col h-full bg-app-bg">
      <div className="flex items-center justify-between px-4 py-3 bg-app-sidebar border-b border-app-border shrink-0 gap-3">
        <div className="min-w-0 flex items-center gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-text-primary truncate">{tab.tableName}</div>
            <div className="text-xs text-text-muted truncate">
              {tab.selectedDatabase || connection?.database || 'default'} · 共 {tableView.totalRows} 行 · 每页 {tableView.pageSize} 条
            </div>
          </div>
          <button
            onClick={() => void copyTableName()}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-app-hover transition-colors"
            title="复制表名"
          >
            <Copy size={13} />
          </button>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={addDraftRow}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors"
          >
            <Plus size={12} />
            新增行
          </button>
          <button
            onClick={discardChanges}
            disabled={!tab.hasPendingChanges}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors disabled:opacity-40"
          >
            <X size={12} />
            放弃修改
          </button>
          <button
            onClick={() => void commitChanges()}
            disabled={!tab.hasPendingChanges || tab.isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-accent-blue text-white hover:bg-blue-600 transition-colors disabled:opacity-40"
          >
            <Save size={12} />
            提交
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 py-2 bg-app-bg border-b border-app-border shrink-0 flex-wrap">
        <div className="relative min-w-[260px] flex-1 max-w-[420px]">
          <Filter size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={filterInput}
            onChange={(e) => setFilterInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void loadRows({ page: 1, filterText: filterInput.trim() })
            }}
            placeholder="筛选当前数据表..."
            className="w-full bg-app-input border border-app-border rounded pl-7 pr-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
          />
        </div>
        <button
          onClick={() => void loadRows({ page: 1, filterText: filterInput.trim() })}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors"
        >
          <Search size={12} />
          筛选
        </button>
        <button
          onClick={() => {
            setFilterInput('')
            void loadRows({ page: 1, filterText: '' })
          }}
          className="px-3 py-1.5 text-xs rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors"
        >
          清空
        </button>
        <button
          onClick={() => setShowColumnFilters((v) => !v)}
          className="px-3 py-1.5 text-xs rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors"
          title="显示或隐藏列筛选条件"
        >
          {showColumnFilters ? '隐藏列筛选' : `显示列筛选${(tableView.columnFilters?.length ?? 0) > 0 ? ` (${tableView.columnFilters!.length})` : ''}`}
        </button>
        <button
          onClick={exportCurrentPageCsv}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors"
          title="导出当前页 CSV"
        >
          <Download size={12} />
          导出当前页
        </button>
        <button
          onClick={() => void exportFilteredCsv()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors"
          title="导出当前筛选结果 CSV"
        >
          <Download size={12} />
          导出筛选结果
        </button>
        <button
          onClick={() => setShowDetailsPanel((v) => !v)}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors',
            showDetailsPanel
              ? 'border-accent-blue/40 text-accent-blue bg-accent-blue/10 hover:bg-accent-blue/20'
              : 'border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue'
          )}
          title="显示或隐藏右侧详情区域"
        >
          <Database size={12} />
          {showDetailsPanel ? '隐藏详情' : '显示详情'}
        </button>
        <div className="ml-auto flex items-center gap-2 text-xs text-text-secondary">
          <label className="flex items-center gap-1">
            每页
            <select
              value={tableView.pageSize}
              onChange={(e) => void loadRows({ page: 1, pageSize: parseInt(e.target.value, 10) || 100 })}
              className="bg-app-input border border-app-border rounded px-2 py-1 text-xs text-text-primary focus:outline-none"
            >
              {[100, 200, 500].map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
          <button
            onClick={() => void loadRows({ page: Math.max(1, tableView.page - 1) })}
            disabled={tableView.page <= 1}
            className="p-1.5 rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors disabled:opacity-40"
          >
            <ChevronLeft size={12} />
          </button>
          <span>第 {tableView.page} / {totalPages} 页</span>
          <button
            onClick={() => void loadRows({ page: Math.min(totalPages, tableView.page + 1) })}
            disabled={tableView.page >= totalPages}
            className="p-1.5 rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors disabled:opacity-40"
          >
            <ChevronRight size={12} />
          </button>
          <button
            onClick={() => void loadRows()}
            className="p-1.5 rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors"
            title="刷新当前页"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {showColumnFilters && (
        <div className="px-4 py-2 bg-app-panel border-b border-app-border space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">列筛选条件（AND）</span>
            <button
              onClick={addColumnFilterRow}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors"
            >
              <Plus size={11} />
              新增条件
            </button>
          </div>
          {columnFilterRows.map((rule) => (
            <div key={rule.id} className="flex items-center gap-2">
              <select
                value={rule.column}
                onChange={(e) => updateColumnFilterRow(rule.id, { column: e.target.value })}
                className="w-44 bg-app-input border border-app-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none"
              >
                <option value="">选择字段...</option>
                {tableView.columns.map((column) => (
                  <option key={column.name} value={column.name}>{column.name}</option>
                ))}
              </select>
              <input
                type="text"
                value={rule.value}
                onChange={(e) => updateColumnFilterRow(rule.id, { value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyColumnFilters()
                }}
                placeholder="包含关键字..."
                className="flex-1 min-w-[220px] bg-app-input border border-app-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
              />
              <button
                onClick={() => removeColumnFilterRow(rule.id)}
                className="p-1.5 rounded border border-app-border text-text-secondary hover:text-accent-red hover:border-accent-red transition-colors"
                title="删除条件"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={applyColumnFilters}
              className="px-3 py-1.5 text-xs rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors"
              title="应用列级筛选"
            >
              应用列筛选
            </button>
            <button
              onClick={clearColumnFilters}
              className="px-3 py-1.5 text-xs rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors"
              title="清空列级筛选"
            >
              清空列筛选
            </button>
          </div>
        </div>
      )}

      {tab.error && (
        <div className="px-4 py-2 text-xs text-accent-red border-b border-app-border bg-red-900/10">{tab.error}</div>
      )}

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 overflow-auto selectable">
          <table className="w-full text-xs border-collapse" style={{ minWidth: 'max-content' }}>
            <thead className="sticky top-0 z-10 bg-app-sidebar border-b border-app-border">
              <tr>
                <th className="px-2 py-2 text-left text-text-muted border-r border-app-border font-normal">#</th>
                {tableView.columns.map((column) => (
                  <th
                    key={column.name}
                    onClick={(e) => handleSortClick(column.name, e.shiftKey)}
                    className="px-2 py-2 text-left text-text-secondary font-semibold border-r border-app-border whitespace-nowrap cursor-pointer select-none"
                  >
                    <span className="inline-flex items-center gap-1">
                      {column.name}
                      {column.primaryKey && <span className="text-accent-yellow">*</span>}
                      {getSortMeta(column.name) && (
                        <>
                          <span className="text-accent-blue">
                            {getSortMeta(column.name)?.direction === 'asc' ? '↑' : '↓'}
                          </span>
                          <span className="text-2xs text-accent-blue/80">{getSortMeta(column.name)?.index}</span>
                        </>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((displayRow, rowIndex) => (
                <tr
                  key={displayRow.key}
                  onMouseDown={(event) => handleRowMouseDown(event, displayRow)}
                  onMouseEnter={() => handleRowMouseEnter(displayRow)}
                  onContextMenu={(event) => openRowContextMenu(event, displayRow)}
                  className={clsx(
                    'border-b border-app-border transition-colors',
                    selectedRowSet.has(displayRow.key) && 'bg-accent-blue/10',
                    activeRowKey === displayRow.key && 'ring-1 ring-inset ring-accent-blue/50',
                    displayRow.isPendingDelete
                      ? 'bg-red-900/10 opacity-60'
                      : displayRow.isNew
                      ? 'bg-accent-blue/5 hover:bg-accent-blue/10'
                      : rowIndex % 2 === 0
                      ? 'bg-app-bg hover:bg-app-hover'
                      : 'bg-app-panel hover:bg-app-hover'
                  )}
                >
                  <td className="px-2 py-1.5 border-r border-app-border text-text-muted whitespace-nowrap">
                    {displayRow.isNew ? 'new' : rowIndex + 1}
                  </td>
                  {tableView.columns.map((column) => {
                    const isEditing =
                      editingCell?.rowKey === displayRow.key && editingCell?.columnName === column.name
                    const cellValue = displayRow.row[column.name] == null ? '' : String(displayRow.row[column.name])
                    return (
                      <td
                        key={column.name}
                        onDoubleClick={() => beginCellEdit(displayRow, column.name)}
                        className="px-2 py-1.5 border-r border-app-border min-w-[160px] max-w-[360px] align-top"
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            type="text"
                            value={cellValue}
                            onChange={(e) => updateCellValue(displayRow, column.name, e.target.value)}
                            onBlur={() => setEditingCell(null)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') setEditingCell(null)
                              if (e.key === 'Escape') setEditingCell(null)
                            }}
                            className="w-full bg-app-input border border-app-border rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                          />
                        ) : (
                          <span className={clsx(
                            'font-mono whitespace-nowrap overflow-hidden text-ellipsis block',
                            displayRow.isPendingDelete && 'line-through'
                          )}>
                            {cellValue || 'NULL'}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {showDetailsPanel && (
          <aside className="w-[360px] shrink-0 border-l border-app-border bg-app-panel overflow-auto">
            <div className="p-3 border-b border-app-border bg-gradient-to-br from-accent-blue/15 to-cyan-500/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                  <Database size={14} className="text-accent-blue" />
                  表信息
                </div>
                <span className="px-2 py-0.5 rounded-full text-2xs border border-accent-blue/40 text-accent-blue bg-accent-blue/10">
                  {dbType.toUpperCase()}
                </span>
              </div>

              {metaLoading ? (
                <div className="mt-3 text-xs text-text-muted">加载中...</div>
              ) : metaError ? (
                <div className="mt-3 text-xs text-accent-red break-all">{metaError}</div>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded border border-app-border bg-app-bg px-2.5 py-2">
                    <div className="flex items-center gap-1 text-text-muted"><Rows3 size={11} /> 行数</div>
                    <div className="mt-1 text-text-primary font-semibold">{tableMeta?.tableRows ?? tableView.totalRows}</div>
                  </div>
                  <div className="rounded border border-app-border bg-app-bg px-2.5 py-2">
                    <div className="flex items-center gap-1 text-text-muted"><HardDrive size={11} /> 总大小</div>
                    <div className="mt-1 text-text-primary font-semibold">{formatBytes(tableMeta?.totalSize)}</div>
                  </div>
                  <div className="rounded border border-app-border bg-app-bg px-2.5 py-2">
                    <div className="flex items-center gap-1 text-text-muted"><Info size={11} /> 数据</div>
                    <div className="mt-1 text-text-primary">{formatBytes(tableMeta?.dataLength)}</div>
                  </div>
                  <div className="rounded border border-app-border bg-app-bg px-2.5 py-2">
                    <div className="flex items-center gap-1 text-text-muted"><Info size={11} /> 索引</div>
                    <div className="mt-1 text-text-primary">{formatBytes(tableMeta?.indexLength)}</div>
                  </div>
                </div>
              )}

              <div className="mt-2 text-2xs text-text-secondary">{tab.tableName}</div>
              {(tableMeta?.engine || tableMeta?.updatedAt) && (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-text-muted">
                  {tableMeta?.engine && <span>引擎: {tableMeta.engine}</span>}
                  {tableMeta?.updatedAt && <span>更新时间: {tableMeta.updatedAt}</span>}
                </div>
              )}
              {tableMeta?.comment && <div className="mt-1 text-2xs text-text-muted">备注: {tableMeta.comment}</div>}
            </div>

            <div className="p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-text-primary">选中行</div>
                <span className={clsx(
                  'px-2 py-0.5 rounded-full text-2xs border',
                  selectedDisplayRow?.isPendingDelete
                    ? 'text-accent-red border-accent-red/40 bg-red-900/10'
                    : selectedDisplayRow?.isNew
                    ? 'text-accent-blue border-accent-blue/40 bg-accent-blue/10'
                    : 'text-emerald-500 border-emerald-500/40 bg-emerald-500/10'
                )}>
                  已选 {selectedDisplayRows.length} 行{selectedDisplayRow ? ` · ${selectedDisplayRow.isPendingDelete ? '删除标记' : selectedDisplayRow.isNew ? '新增草稿' : '可编辑'}` : ''}
                </span>
              </div>

              {!selectedDisplayRow ? (
                <div className="mt-2 text-xs text-text-muted">当前页暂无数据</div>
              ) : (
                <>
                  <div className="mt-2 rounded border border-app-border bg-app-bg px-2.5 py-2 text-2xs text-text-secondary">
                    行键: <span className="text-text-primary break-all">{selectedDisplayRow.key}</span>
                  </div>
                  {selectedDisplayRows.length > 1 && (
                    <div className="mt-2 text-2xs text-text-muted">
                      当前正在查看多选中的活动行，批量操作请直接在表格中右键。
                    </div>
                  )}
                  <div className="mt-2 space-y-2">
                    {tableView.columns.map((column) => {
                      const value = selectedDisplayRow.row[column.name] == null ? '' : String(selectedDisplayRow.row[column.name])
                      const prettyJson = /^\s*[{[]/.test(value) ? tryFormatJson(value) : null
                      return (
                        <label key={column.name} className="block">
                          <div className="mb-1 flex items-center justify-between gap-2 text-2xs text-text-muted">
                            <span className="inline-flex items-center gap-1 min-w-0">
                              <Info size={10} />
                              <span className="truncate">{column.name}{column.primaryKey ? ' (PK)' : ''}</span>
                            </span>
                            <span className="inline-flex items-center gap-1">
                              {prettyJson !== null && (
                                <button
                                  type="button"
                                  onClick={() => setJsonViewField({ name: column.name, value: prettyJson })}
                                  className="p-0.5 rounded text-text-muted hover:text-accent-blue transition-colors"
                                  title="查看 JSON 格式化"
                                >
                                  <Braces size={10} />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => { void copyTextSilent(column.name) }}
                                className="p-0.5 rounded text-text-muted hover:text-text-primary transition-colors"
                                title="复制字段名"
                              >
                                <Copy size={10} />
                              </button>
                            </span>
                          </div>
                          <input
                            type="text"
                            value={value}
                            disabled={!canEditSelectedRow}
                            onChange={(e) => updateCellValue(selectedDisplayRow, column.name, e.target.value)}
                            className="w-full bg-app-input border border-app-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue disabled:opacity-50"
                          />
                        </label>
                      )
                    })}
                  </div>
                  {!canEditSelectedRow && (
                    <div className="mt-2 text-2xs text-text-muted">
                      {selectedDisplayRow.isPendingDelete
                        ? '该行已标记删除，取消删除后可编辑。'
                        : '当前表没有主键，无法更新已有行。'}
                    </div>
                  )}
                </>
              )}
            </div>
          </aside>
        )}
      </div>

      {rowMenu && tab.tableName && connection && (
        <RowContextMenu
          x={rowMenu.x}
          y={rowMenu.y}
          selectedRows={rowMenu.selectedRows}
          canCopyUpdate={hasPrimaryKey && rowMenu.selectedRows.some((row) => !row.isNew)}
          onClose={() => setRowMenu(null)}
          onMarkDelete={() => {
            markRowsForDelete(rowMenu.selectedRows)
            setRowMenu(null)
          }}
          onUnmarkDelete={() => {
            unmarkRowsForDelete(rowMenu.selectedRows)
            setRowMenu(null)
          }}
          onRemoveDraftRows={() => {
            removeDraftRows(rowMenu.selectedRows)
            setRowMenu(null)
          }}
          onCopyInsert={() => void copySelectedInsertSql(rowMenu.selectedRows)}
          onCopyUpdate={() => void copySelectedUpdateSql(rowMenu.selectedRows)}
          onCopyCsv={() => void copySelectedCsv(rowMenu.selectedRows)}
        />
      )}
      {jsonViewField && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setJsonViewField(null)}>
          <div className="bg-app-sidebar border border-app-border rounded-lg shadow-2xl w-[560px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
              <span className="inline-flex items-center gap-2 text-sm font-medium text-text-primary">
                <Braces size={14} />
                {jsonViewField.name}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { void copyTextSilent(jsonViewField.value) }}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-app-active transition-colors"
                  title="复制 JSON"
                >
                  <Copy size={12} />
                  复制
                </button>
                <button
                  type="button"
                  onClick={() => setJsonViewField(null)}
                  className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-app-active transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <pre className="p-4 text-xs text-text-primary overflow-auto flex-1 leading-5 whitespace-pre-wrap break-all select-text cursor-text">{jsonViewField.value}</pre>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

function RowContextMenu({
  x,
  y,
  selectedRows,
  canCopyUpdate,
  onClose,
  onMarkDelete,
  onUnmarkDelete,
  onRemoveDraftRows,
  onCopyInsert,
  onCopyUpdate,
  onCopyCsv
}: {
  x: number
  y: number
  selectedRows: DisplayRow[]
  canCopyUpdate: boolean
  onClose: () => void
  onMarkDelete: () => void
  onUnmarkDelete: () => void
  onRemoveDraftRows: () => void
  onCopyInsert: () => void
  onCopyUpdate: () => void
  onCopyCsv: () => void
}): JSX.Element {
  const selectedNewRows = selectedRows.filter((row) => row.isNew)
  const selectedPendingDeleteRows = selectedRows.filter((row) => !row.isNew && row.isPendingDelete)
  const selectedActiveRows = selectedRows.filter((row) => !row.isNew && !row.isPendingDelete)

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-app-sidebar border border-app-border rounded shadow-2xl py-1 min-w-[200px] text-xs"
        style={{ top: y, left: x }}
      >
        {selectedRows.length > 1 && (
          <div className="px-3 py-1.5 text-text-muted border-b border-app-border">
            已选择 {selectedRows.length} 行
          </div>
        )}
        <button
          onClick={onCopyInsert}
          className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-text-secondary hover:bg-app-active hover:text-text-primary transition-colors"
        >
          <Copy size={12} />
          {selectedRows.length > 1 ? '复制选中行为 INSERT SQL' : '复制 INSERT SQL'}
        </button>
        <button
          onClick={onCopyUpdate}
          disabled={!canCopyUpdate}
          className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-text-secondary hover:bg-app-active hover:text-text-primary transition-colors disabled:opacity-40"
        >
          <Copy size={12} />
          {selectedRows.length > 1 ? '复制选中行为 UPDATE SQL' : '复制 UPDATE SQL'}
        </button>
        <button
          onClick={onCopyCsv}
          className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-text-secondary hover:bg-app-active hover:text-text-primary transition-colors"
        >
          <Copy size={12} />
          {selectedRows.length > 1 ? '复制选中行为 CSV' : '复制 CSV'}
        </button>
        {(selectedActiveRows.length > 0 || selectedPendingDeleteRows.length > 0 || selectedNewRows.length > 0) && (
          <div className="border-t border-app-border my-1" />
        )}
        {selectedActiveRows.length > 0 && (
          <button
            onClick={onMarkDelete}
            className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-text-secondary hover:bg-app-active hover:text-text-primary transition-colors"
          >
            <X size={12} />
            {selectedActiveRows.length > 1 ? `标记选中 ${selectedActiveRows.length} 行删除` : '标记删除'}
          </button>
        )}
        {selectedPendingDeleteRows.length > 0 && (
          <button
            onClick={onUnmarkDelete}
            className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-text-secondary hover:bg-app-active hover:text-text-primary transition-colors"
          >
            <X size={12} />
            {selectedPendingDeleteRows.length > 1 ? `取消 ${selectedPendingDeleteRows.length} 行删除标记` : '取消删除标记'}
          </button>
        )}
        {selectedNewRows.length > 0 && (
          <button
            onClick={onRemoveDraftRows}
            className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-text-secondary hover:bg-app-active hover:text-text-primary transition-colors"
          >
            <X size={12} />
            {selectedNewRows.length > 1 ? `移除 ${selectedNewRows.length} 条新增草稿` : '移除新增行'}
          </button>
        )}
      </div>
    </>,
    document.body
  )
}

function getRowRangeKeys(
  displayRows: DisplayRow[],
  rowIndexByKey: Map<string, number>,
  startKey: string,
  endKey: string
): string[] {
  const startIndex = rowIndexByKey.get(startKey)
  const endIndex = rowIndexByKey.get(endKey)
  if (startIndex === undefined || endIndex === undefined) return [endKey]

  const [from, to] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex]
  return displayRows.slice(from, to + 1).map((row) => row.key)
}

function applyDragSelection(
  displayRows: DisplayRow[],
  rowIndexByKey: Map<string, number>,
  baseKeys: string[],
  anchorKey: string,
  targetKey: string,
  mode: RowSelectionMode
): string[] {
  const rangeKeys = getRowRangeKeys(displayRows, rowIndexByKey, anchorKey, targetKey)
  if (mode === 'replace') return rangeKeys

  const nextKeys = new Set(baseKeys)
  rangeKeys.forEach((rowKey) => {
    if (mode === 'add') nextKeys.add(rowKey)
    else nextKeys.delete(rowKey)
  })

  return displayRows.map((row) => row.key).filter((rowKey) => nextKeys.has(rowKey))
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    ? !!target.closest('input, textarea, select, button, a, [contenteditable="true"]')
    : false
}

function tryFormatJson(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return null
  }
}

function objectToEditableRow(row: Record<string, unknown>, columns: SchemaColumn[]): Record<string, string> {
  return Object.fromEntries(
    columns.map((column) => [column.name, row[column.name] == null ? '' : String(row[column.name])])
  )
}

function applyPendingEdit(
  row: Record<string, unknown>,
  values: Record<string, string>
): Record<string, unknown> {
  return { ...row, ...values }
}

function buildRowKey(row: Record<string, unknown>, pkColumns: SchemaColumn[], index: number): string {
  if (pkColumns.length === 0) return `row:${index}`
  return pkColumns.map((column) => `${column.name}=${String(row[column.name] ?? 'NULL')}`).join('|')
}

function quoteIdentifier(type: DBType, value: string): string {
  if (type === 'postgresql') return `"${value.replace(/"/g, '""')}"`
  if (type === 'mssql') return `[${value.replace(/\]/g, ']]')}]`
  return `\`${value.replace(/\`/g, '``')}\``
}

function sqlValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'NULL'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  return `'${String(value).replace(/'/g, "''")}'`
}

function buildWhereClause(columns: SchemaColumn[], row: Record<string, unknown>, type: DBType): string {
  return columns
    .map((column) => `${quoteIdentifier(type, column.name)} = ${sqlValue(row[column.name])}`)
    .join(' AND ')
}

function buildInsertSql(
  tableName: string,
  columns: SchemaColumn[],
  row: Record<string, unknown>,
  type: DBType
): string {
  const usedColumns = columns.filter((column) => row[column.name] !== undefined)
  const cols = usedColumns.map((column) => quoteIdentifier(type, column.name)).join(', ')
  const values = usedColumns.map((column) => sqlValue(row[column.name])).join(', ')
  return `INSERT INTO ${quoteIdentifier(type, tableName)} (${cols}) VALUES (${values});`
}

function buildUpdateSql(
  tableName: string,
  columns: SchemaColumn[],
  pkColumns: SchemaColumn[],
  row: Record<string, unknown>,
  type: DBType
): string {
  const setClause = columns
    .filter((column) => !column.primaryKey)
    .map((column) => `${quoteIdentifier(type, column.name)} = ${sqlValue(row[column.name])}`)
    .join(', ')
  return `UPDATE ${quoteIdentifier(type, tableName)} SET ${setClause} WHERE ${buildWhereClause(pkColumns, row, type)};`
}

function buildCsv(columns: SchemaColumn[], row: Record<string, unknown>): string {
  return columns
    .map((column) => {
      const value = row[column.name]
      if (value == null) return ''
      const text = String(value)
      return text.includes(',') || text.includes('"') || text.includes('\n')
        ? `"${text.replace(/"/g, '""')}"`
        : text
    })
    .join(',')
}

function buildCombinedWhere(
  columns: SchemaColumn[],
  globalFilterText: string,
  columnFilters: TableColumnFilterRule[],
  dbType: DBType
): string {
  const clauses: string[] = []

  const globalKeyword = globalFilterText.trim()
  if (globalKeyword) {
    const lowered = globalKeyword.toLowerCase().replace(/'/g, "''")
    const globalClauses = columns.map((column) => {
      const expr = sqlTextExpression(dbType, column.name)
      return `LOWER(${expr}) LIKE '%${lowered}%'`
    })
    if (globalClauses.length > 0) clauses.push(`(${globalClauses.join(' OR ')})`)
  }

  for (const rule of columnFilters) {
    const filterValue = (rule.value ?? '').trim()
    if (!rule.column || !filterValue) continue
    const targetColumn = columns.find((column) => column.name === rule.column)
    if (!targetColumn) continue
    const lowered = filterValue.toLowerCase().replace(/'/g, "''")
    const expr = sqlTextExpression(dbType, targetColumn.name)
    clauses.push(`LOWER(${expr}) LIKE '%${lowered}%'`)
  }

  return clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : ''
}

function buildTableMetaQuery(dbType: DBType, tableName: string, database?: string): string {
  const escapedTable = escapeSqlLiteral(tableName)

  if (dbType === 'mysql') {
    const schema = escapeSqlLiteral(database ?? '')
    return `SELECT ENGINE AS engine, TABLE_ROWS AS tableRows, DATA_LENGTH AS dataLength, INDEX_LENGTH AS indexLength, (DATA_LENGTH + INDEX_LENGTH) AS totalSize, UPDATE_TIME AS updatedAt, TABLE_COMMENT AS comment FROM information_schema.tables WHERE table_schema = '${schema}' AND table_name = '${escapedTable}' LIMIT 1`
  }

  if (dbType === 'postgresql') {
    return `SELECT pg_total_relation_size('${escapedTable}'::regclass) AS totalSize, pg_relation_size('${escapedTable}'::regclass) AS dataLength, pg_indexes_size('${escapedTable}'::regclass) AS indexLength, COALESCE((SELECT reltuples::bigint FROM pg_class WHERE oid = '${escapedTable}'::regclass), 0) AS tableRows`
  }

  if (dbType === 'mssql') {
    return `SELECT TOP 1 SUM(p.rows) AS tableRows, SUM(a.total_pages) * 8192 AS totalSize, SUM(a.used_pages) * 8192 AS dataLength, (SUM(a.total_pages) - SUM(a.used_pages)) * 8192 AS indexLength FROM sys.tables t JOIN sys.indexes i ON t.object_id = i.object_id JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id JOIN sys.allocation_units a ON p.partition_id = a.container_id WHERE t.name = '${escapedTable}' GROUP BY t.name`
  }

  return ''
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''")
}

function toText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  return String(value)
}

function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function formatBytes(value: number | undefined): string {
  if (!value || value <= 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let current = value
  let idx = 0
  while (current >= 1024 && idx < units.length - 1) {
    current /= 1024
    idx += 1
  }
  return `${current.toFixed(current >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`
}

function sqlTextExpression(dbType: DBType, columnName: string): string {
  const ident = quoteIdentifier(dbType, columnName)
  if (dbType === 'mysql') return `CAST(${ident} AS CHAR)`
  if (dbType === 'mssql') return `CAST(${ident} AS NVARCHAR(MAX))`
  return `CAST(${ident} AS TEXT)`
}

function buildPagedQuery({
  dbType,
  tableName,
  page,
  pageSize,
  sortRules,
  whereClause
}: {
  dbType: DBType
  tableName: string
  page: number
  pageSize: number
  sortRules: TableSortRule[]
  whereClause: string
}): string {
  const table = quoteIdentifier(dbType, tableName)
  const orderBy = buildOrderByClause(sortRules, dbType)
  const offset = Math.max(0, (page - 1) * pageSize)

  if (dbType === 'mssql') {
    return `SELECT * FROM ${table}${whereClause}${orderBy} OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`
  }

  return `SELECT * FROM ${table}${whereClause}${orderBy} LIMIT ${pageSize} OFFSET ${offset}`
}

function buildOrderByClause(sortRules: TableSortRule[], dbType: DBType): string {
  if (!sortRules || sortRules.length === 0) return ''
  const rules = sortRules.map((rule) => `${quoteIdentifier(dbType, rule.column)} ${rule.direction.toUpperCase()}`)
  return rules.length > 0 ? ` ORDER BY ${rules.join(', ')}` : ''
}

function rowsToCsv(columns: SchemaColumn[], rows: Record<string, unknown>[]): string {
  const headers = columns.map((column) => csvEscape(column.name)).join(',')
  const lines = rows.map((row) =>
    columns
      .map((column) => csvEscape(row[column.name] == null ? '' : String(row[column.name])))
      .join(',')
  )
  return [headers, ...lines].join('\n')
}

function csvEscape(value: string): string {
  return value.includes(',') || value.includes('"') || value.includes('\n')
    ? `"${value.replace(/"/g, '""')}"`
    : value
}

function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
