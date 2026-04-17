import { useDeferredValue, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Bot, Loader2, Save, WandSparkles, X } from 'lucide-react'
import { clsx } from 'clsx'
import type { DatabaseInfo } from '@shared/types/query'
import type { ERGraphEdge, ERGraphNode, ERRelationType } from '@shared/types/ai'
import { useAIStore } from '@renderer/stores/aiStore'

const NODE_WIDTH = 250
const HEADER_HEIGHT = 34
const ROW_HEIGHT = 24
const VIEWPORT_OVERSCAN = 240

interface ViewportRect {
  left: number
  top: number
  width: number
  height: number
}

interface FieldRef {
  tableName: string
  columnName: string
}

interface Props {
  connectionId: string
  databases: DatabaseInfo[]
}

interface DragPreview {
  tableName: string
  x: number
  y: number
}

export function ERDiagramWorkbench({ connectionId, databases }: Props): JSX.Element {
  const [databaseName, setDatabaseName] = useState('')
  const [tableFilterInput, setTableFilterInput] = useState('')
  const [draftNodes, setDraftNodes] = useState<ERGraphNode[]>([])
  const [draftEdges, setDraftEdges] = useState<ERGraphEdge[]>([])
  const [relationType, setRelationType] = useState<ERRelationType>('1:N')
  const [activeSource, setActiveSource] = useState<FieldRef | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)
  const [viewport, setViewport] = useState<ViewportRect>({ left: 0, top: 0, width: 0, height: 0 })

  const dragRef = useRef<{ tableName: string; offsetX: number; offsetY: number } | null>(null)
  const pendingPositionRef = useRef<DragPreview | null>(null)
  const rafRef = useRef<number | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const viewportRafRef = useRef<number | null>(null)

  const {
    erGraphByKey,
    isLoadingERGraph,
    isSavingERGraph,
    isInferringERGraph,
    loadERGraph,
    saveERGraph,
    inferSchemaRelations
  } = useAIStore()

  useEffect(() => {
    if (!databaseName && databases.length > 0) {
      setDatabaseName(databases[0].name)
    }
  }, [databaseName, databases])

  const graphKey = `${connectionId}:${databaseName}`
  const graph = erGraphByKey[graphKey]
  const deferredTableFilterInput = useDeferredValue(tableFilterInput)

  useEffect(() => {
    if (!databaseName) return
    void loadERGraph(connectionId, databaseName)
  }, [connectionId, databaseName, loadERGraph])

  useEffect(() => {
    if (!graph) return
    setDraftNodes(graph.nodes)
    setDraftEdges(graph.edges)
    setDragPreview(null)
  }, [graph])

  const renderedNodes = useMemo(() => {
    if (!dragPreview) return draftNodes
    return draftNodes.map((node) =>
      node.tableName === dragPreview.tableName
        ? { ...node, x: dragPreview.x, y: dragPreview.y }
        : node
    )
  }, [draftNodes, dragPreview])

  const filterKeywords = useMemo(() => {
    return deferredTableFilterInput
      .split(/[\s,，]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  }, [deferredTableFilterInput])

  const filteredNodes = useMemo(() => {
    if (filterKeywords.length === 0) return renderedNodes
    return renderedNodes.filter((node) =>
      filterKeywords.some((keyword) => node.tableName.toLowerCase().includes(keyword))
    )
  }, [filterKeywords, renderedNodes])

  const canvasSize = useMemo(() => {
    const sourceNodes = filteredNodes.length > 0 ? filteredNodes : renderedNodes
    if (sourceNodes.length === 0) {
      return { width: 1200, height: 900 }
    }

    const maxRight = Math.max(...sourceNodes.map((node) => node.x + NODE_WIDTH))
    const maxBottom = Math.max(...sourceNodes.map((node) => node.y + getNodeHeight(node)))

    return {
      width: Math.max(1200, maxRight + 240),
      height: Math.max(900, maxBottom + 240)
    }
  }, [filteredNodes, renderedNodes])

  const nodeMap = useMemo(() => new Map(filteredNodes.map((node) => [node.tableName, node])), [filteredNodes])

  const visibleNodes = useMemo(() => {
    const minLeft = viewport.left - VIEWPORT_OVERSCAN
    const minTop = viewport.top - VIEWPORT_OVERSCAN
    const maxRight = viewport.left + viewport.width + VIEWPORT_OVERSCAN
    const maxBottom = viewport.top + viewport.height + VIEWPORT_OVERSCAN

    if (viewport.width === 0 || viewport.height === 0) {
      return filteredNodes.slice(0, 80)
    }

    return filteredNodes.filter((node) => {
      const nodeLeft = node.x
      const nodeTop = node.y
      const nodeRight = nodeLeft + NODE_WIDTH
      const nodeBottom = nodeTop + getNodeHeight(node)
      return nodeRight >= minLeft && nodeLeft <= maxRight && nodeBottom >= minTop && nodeTop <= maxBottom
    })
  }, [filteredNodes, viewport])

  const visibleNodeSet = useMemo(() => new Set(visibleNodes.map((node) => node.tableName)), [visibleNodes])
  const filteredNodeSet = useMemo(() => new Set(filteredNodes.map((node) => node.tableName)), [filteredNodes])

  const visibleEdges = useMemo(() => {
    const draggingTable = dragPreview?.tableName ?? dragRef.current?.tableName ?? null
    if (draggingTable) {
      return draftEdges.filter(
        (edge) =>
          filteredNodeSet.has(edge.sourceTable) &&
          filteredNodeSet.has(edge.targetTable) &&
          (edge.sourceTable === draggingTable || edge.targetTable === draggingTable)
      )
    }

    return draftEdges.filter(
      (edge) => visibleNodeSet.has(edge.sourceTable) && visibleNodeSet.has(edge.targetTable)
    )
  }, [draftEdges, dragPreview, filteredNodeSet, visibleNodeSet])

  useEffect(() => {
    const syncViewport = (): void => {
      const element = viewportRef.current
      if (!element) return
      setViewport({
        left: element.scrollLeft,
        top: element.scrollTop,
        width: element.clientWidth,
        height: element.clientHeight
      })
    }

    syncViewport()

    const handleResize = (): void => {
      syncViewport()
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    if (filterKeywords.length === 0) return
    if (filteredNodes.length === 0) return

    const left = Math.max(0, Math.min(...filteredNodes.map((node) => node.x)) - 48)
    const top = Math.max(0, Math.min(...filteredNodes.map((node) => node.y)) - 48)

    element.scrollTo({ left, top, behavior: 'smooth' })
    setViewport({
      left,
      top,
      width: element.clientWidth,
      height: element.clientHeight
    })
  }, [filterKeywords, filteredNodes])

  const handleFieldClick = (tableName: string, columnName: string): void => {
    setMessage('')
    setError('')

    if (!activeSource) {
      setActiveSource({ tableName, columnName })
      setMessage(`已选起点 ${tableName}.${columnName}，请点击目标字段完成连线。`)
      return
    }

    if (activeSource.tableName === tableName && activeSource.columnName === columnName) {
      setActiveSource(null)
      setMessage('已取消连线起点。')
      return
    }

    const key = `${activeSource.tableName}.${activeSource.columnName}->${tableName}.${columnName}`.toLowerCase()
    const duplicated = draftEdges.some((edge) => `${edge.sourceTable}.${edge.sourceColumn}->${edge.targetTable}.${edge.targetColumn}`.toLowerCase() === key)
    if (duplicated) {
      setError('该关系线已存在。')
      setActiveSource(null)
      return
    }

    const now = Date.now()
    const newEdge: ERGraphEdge = {
      id: crypto.randomUUID(),
      connectionId,
      databaseName,
      sourceTable: activeSource.tableName,
      sourceColumn: activeSource.columnName,
      targetTable: tableName,
      targetColumn: columnName,
      relationType,
      confidence: 1,
      sourceType: 'manual',
      note: '手工连线',
      status: 'confirmed',
      createdAt: now,
      updatedAt: now
    }

    setDraftEdges((prev) => [newEdge, ...prev])
    setActiveSource(null)
    setMessage('关系线已添加。')
  }

  const handleDeleteEdge = (id: string): void => {
    setDraftEdges((prev) => prev.filter((edge) => edge.id !== id))
  }

  const handleSave = async (): Promise<void> => {
    setMessage('')
    setError('')
    if (!databaseName) return
    try {
      await saveERGraph(
        connectionId,
        databaseName,
        renderedNodes.map((node) => ({
          tableName: node.tableName,
          x: node.x,
          y: node.y,
          collapsed: node.collapsed
        })),
        draftEdges
      )
      setMessage('E-R 图已保存。')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleInfer = async (): Promise<void> => {
    setMessage('')
    setError('')
    if (!databaseName) return

    try {
      const candidates = await inferSchemaRelations(connectionId, databaseName, 80)
      if (candidates.length === 0) {
        setMessage('未推断到候选关系。')
        return
      }

      const existing = new Set(
        draftEdges.map((edge) => `${edge.sourceTable}.${edge.sourceColumn}->${edge.targetTable}.${edge.targetColumn}`.toLowerCase())
      )
      const merged = [...draftEdges]
      for (const edge of candidates) {
        const key = `${edge.sourceTable}.${edge.sourceColumn}->${edge.targetTable}.${edge.targetColumn}`.toLowerCase()
        if (existing.has(key)) continue
        existing.add(key)
        merged.push(edge)
      }
      setDraftEdges(merged)
      setMessage(`已新增 ${merged.length - draftEdges.length} 条 AI 候选关系（pending）。`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleAcceptPending = (): void => {
    const now = Date.now()
    setDraftEdges((prev) =>
      prev.map((edge) =>
        edge.status === 'pending'
          ? { ...edge, status: 'confirmed', updatedAt: now }
          : edge
      )
    )
    setMessage('已确认全部 pending 关系。')
  }

  const handleRejectPending = (): void => {
    setDraftEdges((prev) => prev.filter((edge) => edge.status !== 'pending'))
    setMessage('已移除全部 pending 关系。')
  }

  const onNodeMouseDown = (event: ReactMouseEvent, tableName: string): void => {
    const node = nodeMap.get(tableName)
    if (!node) return
    dragRef.current = {
      tableName,
      offsetX: event.clientX - node.x,
      offsetY: event.clientY - node.y
    }
    setDragPreview({ tableName, x: node.x, y: node.y })
    event.preventDefault()
  }

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent): void => {
      if (!dragRef.current) return
      const { tableName, offsetX, offsetY } = dragRef.current
      const nextX = Math.max(16, event.clientX - offsetX)
      const nextY = Math.max(16, event.clientY - offsetY)
      pendingPositionRef.current = { tableName, x: nextX, y: nextY }
      if (rafRef.current !== null) return
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null
        if (pendingPositionRef.current) {
          setDragPreview(pendingPositionRef.current)
        }
      })
    }

    const handleMouseUp = (): void => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      const nextPosition = pendingPositionRef.current
      if (nextPosition) {
        setDraftNodes((prev) =>
          prev.map((node) =>
            node.tableName === nextPosition.tableName
              ? { ...node, x: nextPosition.x, y: nextPosition.y }
              : node
          )
        )
      }
      pendingPositionRef.current = null
      setDragPreview(null)
      dragRef.current = null
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
      }
      if (viewportRafRef.current !== null) {
        window.cancelAnimationFrame(viewportRafRef.current)
      }
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  const pendingCount = draftEdges.filter((edge) => edge.status === 'pending').length

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <select
          value={databaseName}
          onChange={(event) => setDatabaseName(event.target.value)}
          className="rounded border border-app-border bg-app-input px-2 py-1.5 text-xs text-text-primary focus:border-accent-blue focus:outline-none"
        >
          {databases.map((db) => (
            <option key={db.name} value={db.name}>
              {db.name}
            </option>
          ))}
        </select>

        <select
          value={relationType}
          onChange={(event) => setRelationType(event.target.value as ERRelationType)}
          className="rounded border border-app-border bg-app-input px-2 py-1.5 text-xs text-text-primary focus:border-accent-blue focus:outline-none"
        >
          <option value="1:1">1:1</option>
          <option value="1:N">1:N</option>
          <option value="N:M">N:M</option>
          <option value="unknown">unknown</option>
        </select>

        <button
          onClick={() => void handleInfer()}
          disabled={!databaseName || isInferringERGraph}
          className="flex items-center gap-1 rounded border border-app-border px-2 py-1 text-2xs text-text-secondary hover:border-accent-blue hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isInferringERGraph ? <Loader2 size={12} className="animate-spin" /> : <Bot size={12} />}
          AI 自动补线
        </button>

        <button
          onClick={() => void handleSave()}
          disabled={!databaseName || isSavingERGraph}
          className="flex items-center gap-1 rounded bg-accent-blue px-2 py-1 text-2xs text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isSavingERGraph ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          保存关系图
        </button>

        <button
          onClick={() => void loadERGraph(connectionId, databaseName)}
          disabled={!databaseName || isLoadingERGraph}
          className="flex items-center gap-1 rounded border border-app-border px-2 py-1 text-2xs text-text-secondary hover:border-accent-blue hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isLoadingERGraph ? <Loader2 size={12} className="animate-spin" /> : <WandSparkles size={12} />}
          重新加载
        </button>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={tableFilterInput}
          onChange={(event) => setTableFilterInput(event.target.value)}
          placeholder="筛选表名，支持空格或逗号分隔多个关键词"
          className="w-full max-w-md rounded border border-app-border bg-app-input px-2 py-1.5 text-xs text-text-primary focus:border-accent-blue focus:outline-none"
        />
        <button
          onClick={() => setTableFilterInput('')}
          disabled={!tableFilterInput}
          className="rounded border border-app-border px-2 py-1 text-2xs text-text-secondary hover:border-accent-blue hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          清空筛选
        </button>
        <div className="text-2xs text-text-muted">
          当前显示 {filteredNodes.length}/{renderedNodes.length} 张表
        </div>
      </div>

      {filterKeywords.length > 0 && (
        <div className="rounded border border-app-border bg-app-panel px-2 py-1.5 text-2xs text-text-muted">
          已按关键词筛选：{filterKeywords.join('、')}。画布和连线仅显示命中的表。
        </div>
      )}

      {activeSource && (
        <div className="rounded border border-accent-blue bg-app-panel px-2 py-1 text-2xs text-text-secondary">
          当前起点: {activeSource.tableName}.{activeSource.columnName}
        </div>
      )}

      {pendingCount > 0 && (
        <div className="flex items-center gap-2 rounded border border-app-border bg-app-panel px-2 py-1.5 text-2xs text-text-secondary">
          <span>当前有 {pendingCount} 条 AI 候选关系待确认。</span>
          <button onClick={handleAcceptPending} className="rounded border border-app-border px-2 py-0.5 hover:border-accent-blue hover:text-text-primary">全部接受</button>
          <button onClick={handleRejectPending} className="rounded border border-app-border px-2 py-0.5 hover:border-accent-blue hover:text-text-primary">全部拒绝</button>
        </div>
      )}

      {message && <div className="text-2xs text-accent-green">{message}</div>}
      {error && <div className="text-2xs text-accent-red">{error}</div>}

      <div
        ref={viewportRef}
        onScroll={() => {
          if (viewportRafRef.current !== null) return
          viewportRafRef.current = window.requestAnimationFrame(() => {
            viewportRafRef.current = null
            const element = viewportRef.current
            if (!element) return
            setViewport({
              left: element.scrollLeft,
              top: element.scrollTop,
              width: element.clientWidth,
              height: element.clientHeight
            })
          })
        }}
        className="h-[520px] overflow-auto rounded border border-app-border bg-app-panel"
      >
        <div
          className="relative"
          style={{ width: canvasSize.width, height: canvasSize.height }}
        >
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            {visibleEdges.map((edge) => {
              const sourceNode = nodeMap.get(edge.sourceTable)
              const targetNode = nodeMap.get(edge.targetTable)
              if (!sourceNode || !targetNode) return null

              const sourceIndex = sourceNode.columns.findIndex((column) => column.name === edge.sourceColumn)
              const targetIndex = targetNode.columns.findIndex((column) => column.name === edge.targetColumn)
              if (sourceIndex < 0 || targetIndex < 0) return null

              const sx = sourceNode.x + NODE_WIDTH
              const sy = sourceNode.y + HEADER_HEIGHT + sourceIndex * ROW_HEIGHT + ROW_HEIGHT / 2
              const tx = targetNode.x
              const ty = targetNode.y + HEADER_HEIGHT + targetIndex * ROW_HEIGHT + ROW_HEIGHT / 2
              const c1x = sx + 70
              const c2x = tx - 70
              const path = `M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${ty}, ${tx} ${ty}`

              const color =
                edge.status === 'pending'
                  ? '#f59e0b'
                  : edge.sourceType === 'manual'
                    ? '#3b82f6'
                    : '#22c55e'

              return (
                <path
                  key={edge.id}
                  d={path}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeDasharray={edge.status === 'pending' ? '6 4' : undefined}
                />
              )
            })}
          </svg>

          {visibleNodes.map((node) => (
            <div
              key={node.tableName}
              className="absolute rounded border border-app-border bg-app-bg shadow-sm"
              style={{ left: node.x, top: node.y, width: NODE_WIDTH }}
            >
              <div
                onMouseDown={(event) => onNodeMouseDown(event, node.tableName)}
                className="cursor-move border-b border-app-border bg-app-panel px-2 py-1.5 text-xs font-semibold text-text-primary"
              >
                {node.tableName}
              </div>
              <div className="max-h-56 overflow-auto">
                {node.columns.map((column) => {
                  const isActive = activeSource?.tableName === node.tableName && activeSource.columnName === column.name
                  return (
                    <button
                      key={column.name}
                      onClick={() => handleFieldClick(node.tableName, column.name)}
                      className={clsx(
                        'flex w-full items-center justify-between gap-2 border-b border-app-border/60 px-2 py-1 text-left text-2xs text-text-secondary last:border-b-0 hover:bg-app-hover',
                        isActive && 'bg-accent-blue/20 text-text-primary'
                      )}
                    >
                      <span className="truncate">{column.name}</span>
                      <span className="shrink-0 text-[10px] text-text-muted">{column.primaryKey ? 'PK' : column.type}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs text-text-secondary">关系清单（{draftEdges.length}）</div>
        <div className="max-h-52 overflow-auto rounded border border-app-border bg-app-panel">
          {draftEdges.length === 0 ? (
            <div className="px-2 py-2 text-2xs text-text-muted">暂无关系线，点击字段即可开始连线。</div>
          ) : (
            draftEdges.map((edge) => (
              <div key={edge.id} className="flex items-center justify-between gap-2 border-b border-app-border/60 px-2 py-1.5 text-2xs last:border-b-0">
                <div className="min-w-0 text-text-secondary">
                  <span className="text-text-primary">{edge.sourceTable}.{edge.sourceColumn}</span>
                  {' -> '}
                  <span className="text-text-primary">{edge.targetTable}.{edge.targetColumn}</span>
                  <span className="ml-2 text-text-muted">[{edge.relationType}]</span>
                  <span className={clsx('ml-2', edge.status === 'pending' ? 'text-amber-500' : 'text-accent-green')}>
                    {edge.status}
                  </span>
                  <span className="ml-2 text-text-muted">{Math.round(edge.confidence * 100)}%</span>
                </div>
                <button
                  onClick={() => handleDeleteEdge(edge.id)}
                  className="rounded border border-app-border p-1 text-text-muted hover:border-accent-blue hover:text-text-primary"
                  title="删除关系"
                >
                  <X size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function getNodeHeight(node: ERGraphNode): number {
  return HEADER_HEIGHT + Math.max(node.columns.length, 1) * ROW_HEIGHT
}
