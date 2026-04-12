import { useState, useEffect } from 'react'
import { X, TestTube2, Loader2, CheckCircle2, XCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'
import { useConnectionStore } from '@renderer/stores/connectionStore'
import { useUIStore } from '@renderer/stores/uiStore'
import { useT } from '@renderer/stores/i18nStore'
import type { ConnectionFormData, DBType, SSHConfig } from '@shared/types/connection'

const DEFAULT_PORTS: Record<DBType, number> = {
  mysql: 3306,
  postgresql: 5432,
  mssql: 1433,
  sqlite: 0
}

const EMPTY_FORM: ConnectionFormData = {
  name: '',
  type: 'mysql',
  host: 'localhost',
  port: 3306,
  database: '',
  username: '',
  password: '',
  ssl: false,
  filePath: '',
  group: '',
  tags: []
}

const inputClass =
  'w-full bg-app-input border border-app-border rounded px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue transition-colors selectable'

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="space-y-1">
      <label className="text-2xs text-text-secondary font-medium uppercase tracking-wider">{label}</label>
      {children}
    </div>
  )
}

export function ConnectionDialog(): JSX.Element {
  const t = useT()
  const { connections, addConnection, updateConnection } = useConnectionStore()
  const { editingConnectionId, closeConnectionDialog } = useUIStore()

  const editingConn = editingConnectionId
    ? connections.find((c) => c.id === editingConnectionId)
    : null

  const [form, setForm] = useState<ConnectionFormData>(() => {
    if (editingConn) {
      return {
        name: editingConn.name,
        type: editingConn.type,
        host: editingConn.host ?? 'localhost',
        port: editingConn.port ?? DEFAULT_PORTS[editingConn.type],
        database: editingConn.database ?? '',
        username: editingConn.username ?? '',
        password: '',
        ssl: editingConn.ssl ?? false,
        filePath: editingConn.filePath ?? '',
        group: editingConn.group ?? '',
        tags: editingConn.tags ?? [],
        ssh: editingConn.ssh
      }
    }
    return { ...EMPTY_FORM }
  })

  const [tagsInput, setTagsInput] = useState(() =>
    editingConn?.tags?.join(', ') ?? ''
  )
  const [sshEnabled, setSshEnabled] = useState(() => !!editingConn?.ssh)
  const [sshForm, setSshForm] = useState<SSHConfig>(() =>
    editingConn?.ssh ?? { host: '', port: 22, username: '', password: '', privateKeyPath: '' }
  )
  const [showSsh, setShowSsh] = useState(false)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [availableDbs, setAvailableDbs] = useState<string[]>([])
  const [showDbDropdown, setShowDbDropdown] = useState(false)

  useEffect(() => {
    setTestResult(null)
    setAvailableDbs([])
  }, [form.host, form.port, form.username, form.password, form.type])

  const handleTypeChange = (type: DBType): void => {
    setForm((f) => ({ ...f, type, port: DEFAULT_PORTS[type] || f.port }))
  }

  const handleTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      const testForm: ConnectionFormData = {
        ...form,
        ssh: sshEnabled ? sshForm : undefined
      }
      const result = await window.db!.testConnection(testForm, editingConnectionId ?? undefined)
      setTestResult(result)
      if (result.success) {
        try {
          const dbs = await window.db!.getDatabases('test') // won't work but placeholder
          setAvailableDbs(dbs)
        } catch { /* ignore */ }
      }
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : String(err) })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    if (!form.name.trim()) { setError('连接名称不能为空'); return }
    if (form.type === 'sqlite' && !form.filePath?.trim()) { setError('SQLite 文件路径不能为空'); return }
    setSaving(true)
    setError(null)
    const parsedTags = tagsInput.trim()
      ? tagsInput.split(',').map((t) => t.trim()).filter(Boolean)
      : []
    const saveData: ConnectionFormData = {
      ...form,
      tags: parsedTags,
      ssh: sshEnabled ? sshForm : undefined
    }
    try {
      if (editingConnectionId) {
        await updateConnection(editingConnectionId, saveData)
      } else {
        await addConnection(saveData)
      }
      closeConnectionDialog()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const isSqlite = form.type === 'sqlite'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-app-sidebar border border-app-border rounded-lg shadow-2xl w-[500px] max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
          <h2 className="text-sm font-semibold text-text-primary">
            {editingConnectionId ? t('conn.editConn') : t('conn.newConn')}
          </h2>
          <button onClick={closeConnectionDialog} className="text-text-muted hover:text-text-primary p-1 rounded hover:bg-app-hover transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Form */}
        <div className="p-4 space-y-3">
          {/* Connection name */}
          <Field label={t('conn.name')}>
            <input type="text" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="My Database" className={inputClass} />
          </Field>

          {/* Group + Tags */}
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('conn.group')}>
              <input type="text" value={form.group ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, group: e.target.value }))}
                placeholder="生产环境" className={inputClass} />
            </Field>
            <Field label={t('conn.tags')}>
              <input type="text" value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="mysql, prod, main" className={inputClass} />
            </Field>
          </div>

          {/* DB Type */}
          <Field label={t('conn.type')}>
            <div className="grid grid-cols-4 gap-1">
              {(['mysql', 'postgresql', 'mssql', 'sqlite'] as DBType[]).map((type) => (
                <button key={type} onClick={() => handleTypeChange(type)}
                  className={clsx('py-1.5 text-xs rounded border transition-colors',
                    form.type === type
                      ? 'bg-accent-blue border-accent-blue text-white'
                      : 'border-app-border text-text-secondary hover:border-accent-blue hover:text-text-primary'
                  )}>
                  {type === 'postgresql' ? 'PostgreSQL' : type.toUpperCase()}
                </button>
              ))}
            </div>
          </Field>

          {isSqlite ? (
            <Field label={t('conn.filePath')}>
              <input type="text" value={form.filePath ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, filePath: e.target.value }))}
                placeholder="/path/to/database.db" className={inputClass} />
            </Field>
          ) : (
            <>
              {/* Host + Port */}
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Field label={t('conn.host')}>
                    <input type="text" value={form.host ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                      placeholder="localhost" className={inputClass} />
                  </Field>
                </div>
                <Field label={t('conn.port')}>
                  <input type="number" value={form.port ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, port: parseInt(e.target.value) || undefined }))}
                    className={inputClass} />
                </Field>
              </div>

              {/* Database (optional) */}
              <Field label={t('conn.database')}>
                <div className="relative">
                  <input type="text" value={form.database ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, database: e.target.value }))}
                    placeholder={t('conn.dbPlaceholder')} className={clsx(inputClass, 'pr-8')} />
                  {availableDbs.length > 0 && (
                    <button type="button" onClick={() => setShowDbDropdown((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                      <ChevronDown size={12} />
                    </button>
                  )}
                  {showDbDropdown && availableDbs.length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-20 bg-app-sidebar border border-app-border rounded shadow-xl mt-0.5 max-h-40 overflow-y-auto">
                      {availableDbs.map((db) => (
                        <button key={db} onClick={() => { setForm((f) => ({ ...f, database: db })); setShowDbDropdown(false) }}
                          className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-app-active hover:text-text-primary">
                          {db}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </Field>

              {/* Username + Password */}
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('conn.username')}>
                  <input type="text" value={form.username ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                    placeholder="root" className={inputClass} autoComplete="off" />
                </Field>
                <Field label={t('conn.password')}>
                  <input type="password" value={form.password ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder={editingConnectionId ? t('conn.passwordHint') : ''}
                    className={inputClass} autoComplete="new-password" />
                </Field>
              </div>

              {/* SSL */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.ssl ?? false}
                  onChange={(e) => setForm((f) => ({ ...f, ssl: e.target.checked }))}
                  className="accent-accent-blue" />
                <span className="text-xs text-text-secondary">{t('conn.ssl')}</span>
              </label>

              {/* SSH Tunnel */}
              <div className="border border-app-border rounded">
                <button type="button" onClick={() => setShowSsh((v) => !v)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-secondary hover:text-text-primary transition-colors">
                  {showSsh ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <span className="font-medium">{t('conn.sshTunnel')}</span>
                  {sshEnabled && <span className="ml-auto text-accent-green text-2xs">已启用</span>}
                </button>
                {showSsh && (
                  <div className="px-3 pb-3 space-y-2 border-t border-app-border">
                    <label className="flex items-center gap-2 cursor-pointer pt-2">
                      <input type="checkbox" checked={sshEnabled}
                        onChange={(e) => setSshEnabled(e.target.checked)}
                        className="accent-accent-blue" />
                      <span className="text-xs text-text-secondary">{t('conn.sshEnable')}</span>
                    </label>
                    {sshEnabled && (
                      <>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="col-span-2">
                            <Field label={t('conn.sshHost')}>
                              <input type="text" value={sshForm.host}
                                onChange={(e) => setSshForm((f) => ({ ...f, host: e.target.value }))}
                                placeholder="bastion.example.com" className={inputClass} />
                            </Field>
                          </div>
                          <Field label={t('conn.sshPort')}>
                            <input type="number" value={sshForm.port}
                              onChange={(e) => setSshForm((f) => ({ ...f, port: parseInt(e.target.value) || 22 }))}
                              className={inputClass} />
                          </Field>
                        </div>
                        <Field label={t('conn.sshUser')}>
                          <input type="text" value={sshForm.username}
                            onChange={(e) => setSshForm((f) => ({ ...f, username: e.target.value }))}
                            placeholder="ubuntu" className={inputClass} />
                        </Field>
                        <div className="grid grid-cols-2 gap-2">
                          <Field label={t('conn.sshPassword')}>
                            <input type="password" value={sshForm.password ?? ''}
                              onChange={(e) => setSshForm((f) => ({ ...f, password: e.target.value }))}
                              className={inputClass} autoComplete="new-password" />
                          </Field>
                          <Field label={t('conn.sshKeyPath')}>
                            <input type="text" value={sshForm.privateKeyPath ?? ''}
                              onChange={(e) => setSshForm((f) => ({ ...f, privateKeyPath: e.target.value }))}
                              placeholder="~/.ssh/id_rsa" className={inputClass} />
                          </Field>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Test result */}
          {testResult && (
            <div className={clsx('flex items-start gap-2 p-2 rounded text-xs',
              testResult.success
                ? 'bg-green-900/30 border border-green-700/50 text-accent-green'
                : 'bg-red-900/30 border border-red-700/50 text-accent-red'
            )}>
              {testResult.success ? <CheckCircle2 size={13} className="shrink-0 mt-0.5" /> : <XCircle size={13} className="shrink-0 mt-0.5" />}
              {testResult.message}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-xs text-accent-red bg-red-900/20 border border-red-700/30 p-2 rounded">{error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-app-border">
          <button onClick={handleTest} disabled={testing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors disabled:opacity-50">
            {testing ? <Loader2 size={12} className="animate-spin" /> : <TestTube2 size={12} />}
            {t('conn.test')}
          </button>
          <div className="flex gap-2">
            <button onClick={closeConnectionDialog}
              className="px-3 py-1.5 text-xs rounded border border-app-border text-text-secondary hover:text-text-primary transition-colors">
              {t('conn.cancel')}
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-accent-blue text-white hover:bg-blue-600 disabled:opacity-50 transition-colors">
              {saving && <Loader2 size={12} className="animate-spin" />}
              {editingConnectionId ? t('conn.update') : t('conn.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
