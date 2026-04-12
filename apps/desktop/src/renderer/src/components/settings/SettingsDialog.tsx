import { useState, useEffect } from 'react'
import { X, Loader2, CheckCircle2, XCircle, Sparkles } from 'lucide-react'
import { clsx } from 'clsx'
import { useAIStore } from '@renderer/stores/aiStore'
import { useUIStore } from '@renderer/stores/uiStore'
import type { AIConfig, AIProviderType } from '@shared/types/ai'

export function SettingsDialog(): JSX.Element {
  const { config, loadConfig, updateConfig } = useAIStore()
  const { setShowSettings } = useUIStore()

  const [form, setForm] = useState<Partial<AIConfig>>({})
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!loaded) {
      loadConfig().then(() => setLoaded(true))
    }
  }, [loaded, loadConfig])

  useEffect(() => {
    if (config && loaded) {
      setForm({ ...config })
    }
  }, [config, loaded])

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      await updateConfig(form)
      setShowSettings(false)
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      // Save first, then trigger a test generate
      await updateConfig(form)
      const sql = await window.ai!.generateSQL({
        question: 'SELECT 1',
        connectionId: '',
        dialect: 'sql'
      })
      setTestResult({ ok: true, msg: 'AI 连接成功！' })
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }

  const provider = form.provider ?? 'openai'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-app-sidebar border border-app-border rounded-lg shadow-2xl w-[520px] max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-accent-blue" />
            <h2 className="text-sm font-semibold text-text-primary">设置</h2>
          </div>
          <button
            onClick={() => setShowSettings(false)}
            className="text-text-muted hover:text-text-primary p-1 rounded hover:bg-app-hover transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Section: AI */}
          <div>
            <div className="text-2xs text-text-muted uppercase tracking-wider font-semibold mb-3 pb-1 border-b border-app-border">
              AI 配置
            </div>

            {/* Provider */}
            <Field label="AI 提供商">
              <div className="grid grid-cols-2 gap-2">
                {(['openai', 'ollama'] as AIProviderType[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setForm((f) => ({ ...f, provider: p }))}
                    className={clsx(
                      'py-2 text-xs rounded border transition-colors',
                      provider === p
                        ? 'bg-accent-blue border-accent-blue text-white'
                        : 'border-app-border text-text-secondary hover:border-accent-blue hover:text-text-primary'
                    )}
                  >
                    {p === 'openai' ? '☁️ OpenAI 兼容' : '🤖 Ollama 本地'}
                  </button>
                ))}
              </div>
            </Field>

            {provider === 'openai' ? (
              <div className="mt-3 space-y-3">
                <Field label="API Key">
                  <input
                    type="password"
                    value={form.apiKey ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                    placeholder="sk-... 或其他 API Key"
                    className={inputClass}
                    autoComplete="off"
                  />
                </Field>
                <Field label="Base URL（OpenAI 兼容接口）">
                  <input
                    type="text"
                    value={form.baseUrl ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                    placeholder="https://api.openai.com/v1（留空使用默认）"
                    className={inputClass}
                  />
                  <p className="text-2xs text-text-muted mt-1">
                    支持 DeepSeek、通义千问、Moonshot、Groq 等 OpenAI 兼容 API
                  </p>
                </Field>
                <Field label="模型">
                  <input
                    type="text"
                    value={form.model ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                    placeholder="gpt-4o-mini"
                    className={inputClass}
                  />
                  <div className="flex flex-wrap gap-1 mt-1">
                    {['gpt-4o-mini', 'gpt-4o', 'deepseek-chat', 'qwen-turbo', 'moonshot-v1-8k'].map((m) => (
                      <button
                        key={m}
                        onClick={() => setForm((f) => ({ ...f, model: m }))}
                        className="text-2xs px-1.5 py-0.5 rounded border border-app-border text-text-muted hover:border-accent-blue hover:text-text-primary transition-colors"
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <Field label="Ollama 地址">
                  <input
                    type="text"
                    value={form.ollamaBaseUrl ?? 'http://localhost:11434'}
                    onChange={(e) => setForm((f) => ({ ...f, ollamaBaseUrl: e.target.value }))}
                    placeholder="http://localhost:11434"
                    className={inputClass}
                  />
                </Field>
                <Field label="模型">
                  <input
                    type="text"
                    value={form.ollamaModel ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, ollamaModel: e.target.value }))}
                    placeholder="qwen2.5-coder:7b"
                    className={inputClass}
                  />
                  <div className="flex flex-wrap gap-1 mt-1">
                    {['qwen2.5-coder:7b', 'codellama:7b', 'deepseek-coder:6.7b', 'llama3.1:8b'].map((m) => (
                      <button
                        key={m}
                        onClick={() => setForm((f) => ({ ...f, ollamaModel: m }))}
                        className="text-2xs px-1.5 py-0.5 rounded border border-app-border text-text-muted hover:border-accent-blue hover:text-text-primary transition-colors"
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
            )}

            {/* Advanced */}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="最大 Token">
                <input
                  type="number"
                  value={form.maxTokens ?? 1024}
                  onChange={(e) => setForm((f) => ({ ...f, maxTokens: parseInt(e.target.value) || 1024 }))}
                  className={inputClass}
                />
              </Field>
              <Field label="温度 (0~1)">
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  value={form.temperature ?? 0.1}
                  onChange={(e) => setForm((f) => ({ ...f, temperature: parseFloat(e.target.value) || 0.1 }))}
                  className={inputClass}
                />
              </Field>
            </div>

            {/* Test result */}
            {testResult && (
              <div
                className={clsx(
                  'flex items-center gap-2 mt-3 p-2 rounded text-xs',
                  testResult.ok
                    ? 'bg-green-900/30 border border-green-700/50 text-accent-green'
                    : 'bg-red-900/30 border border-red-700/50 text-accent-red'
                )}
              >
                {testResult.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                {testResult.msg}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-app-border">
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors disabled:opacity-50"
          >
            {testing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            测试 AI 连接
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => setShowSettings(false)}
              className="px-3 py-1.5 text-xs rounded border border-app-border text-text-secondary hover:text-text-primary transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-accent-blue text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
            >
              {saving && <Loader2 size={12} className="animate-spin" />}
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const inputClass =
  'w-full bg-app-input border border-app-border rounded px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue transition-colors selectable'

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="space-y-1">
      <label className="text-2xs text-text-secondary font-medium uppercase tracking-wider">
        {label}
      </label>
      {children}
    </div>
  )
}
