import { useState } from 'react'
import { X, Globe, Type, Palette, Sparkles, Settings } from 'lucide-react'
import { clsx } from 'clsx'
import { useUIStore } from '@renderer/stores/uiStore'
import { useI18nStore } from '@renderer/stores/i18nStore'
import { usePrefsStore, type FontSize, type Theme } from '@renderer/stores/prefsStore'

type SettingsTab = 'general' | 'ai'

export function AppSettingsDialog(): JSX.Element {
  const { setShowAppSettings, setShowSettings } = useUIStore()
  const { lang, setLang, t } = useI18nStore()
  const { fontSize, setFontSize, theme, setTheme } = usePrefsStore()

  const [activeTab, setActiveTab] = useState<SettingsTab>('general')

  const fontOptions: { value: FontSize; label: string }[] = [
    { value: 'small', label: t('settings.fontSmall') },
    { value: 'medium', label: t('settings.fontMedium') },
    { value: 'large', label: t('settings.fontLarge') }
  ]

  const themeOptions: { value: Theme; label: string }[] = [
    { value: 'dark', label: t('settings.themeDark') },
    { value: 'light', label: t('settings.themeLight') },
    { value: 'light-blue', label: t('settings.themeLightBlue') }
  ]

  const handleOpenAISettings = (): void => {
    setShowAppSettings(false)
    setShowSettings(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-app-sidebar border border-app-border rounded-lg shadow-2xl w-[560px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-app-border shrink-0">
          <div className="flex items-center gap-2">
            <Settings size={14} className="text-accent-blue" />
            <h2 className="text-sm font-semibold text-text-primary">{t('settings.title')}</h2>
          </div>
          <button
            onClick={() => setShowAppSettings(false)}
            className="text-text-muted hover:text-text-primary p-1 rounded hover:bg-app-hover transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left nav */}
          <div className="w-36 border-r border-app-border p-2 space-y-0.5 shrink-0">
            <NavItem
              icon={<Globe size={13} />}
              label={t('settings.general')}
              active={activeTab === 'general'}
              onClick={() => setActiveTab('general')}
            />
            <NavItem
              icon={<Sparkles size={13} />}
              label={t('settings.ai')}
              active={activeTab === 'ai'}
              onClick={() => setActiveTab('ai')}
            />
          </div>

          {/* Content */}
          <div className="flex-1 p-5 overflow-y-auto space-y-6">
            {activeTab === 'general' && (
              <>
                {/* Language */}
                <Section icon={<Globe size={13} />} title={t('settings.lang')}>
                  <div className="flex gap-2">
                    <OptionBtn
                      active={lang === 'zh'}
                      onClick={() => setLang('zh')}
                      label={t('settings.langZh')}
                    />
                    <OptionBtn
                      active={lang === 'en'}
                      onClick={() => setLang('en')}
                      label={t('settings.langEn')}
                    />
                  </div>
                </Section>

                {/* Font size */}
                <Section icon={<Type size={13} />} title={t('settings.fontSize')}>
                  <div className="flex gap-2">
                    {fontOptions.map((opt) => (
                      <OptionBtn
                        key={opt.value}
                        active={fontSize === opt.value}
                        onClick={() => setFontSize(opt.value)}
                        label={opt.label}
                      />
                    ))}
                  </div>
                  <p className="text-2xs text-text-muted mt-1.5">
                    {lang === 'zh'
                      ? '字体大小会在重启后完全生效于编辑器'
                      : 'Font size change applies to the editor after restart'}
                  </p>
                </Section>

                {/* Theme */}
                <Section icon={<Palette size={13} />} title={t('settings.theme')}>
                  <div className="flex gap-2">
                    {themeOptions.map((opt) => (
                      <OptionBtn
                        key={opt.value}
                        active={theme === opt.value}
                        onClick={() => setTheme(opt.value)}
                        label={opt.label}
                      />
                    ))}
                  </div>
                  <p className="text-2xs text-text-muted mt-1.5">
                    {lang === 'zh' ? '主题切换实时生效' : 'Theme switch is applied immediately'}
                  </p>
                </Section>
              </>
            )}

            {activeTab === 'ai' && (
              <div className="flex flex-col items-center justify-center gap-4 h-40 text-text-muted">
                <Sparkles size={28} className="text-accent-blue/50" />
                <p className="text-xs text-center leading-relaxed">
                  {lang === 'zh'
                    ? 'AI 设置已移至独立面板。'
                    : 'AI settings are managed in a dedicated panel.'}
                </p>
                <button
                  onClick={handleOpenAISettings}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-accent-blue text-white hover:bg-blue-600 transition-colors"
                >
                  <Sparkles size={12} />
                  {t('settings.ai')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function NavItem({
  icon,
  label,
  active,
  onClick
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs transition-colors text-left',
        active
          ? 'bg-accent-blue/20 text-accent-blue'
          : 'text-text-secondary hover:text-text-primary hover:bg-app-hover'
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function Section({
  icon,
  title,
  children
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-text-muted">{icon}</span>
        <h3 className="text-xs font-semibold text-text-primary">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function OptionBtn({
  active,
  label,
  onClick
}: {
  active: boolean
  label: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'px-3 py-1.5 text-xs rounded border transition-colors',
        active
          ? 'bg-accent-blue border-accent-blue text-white'
          : 'border-app-border text-text-secondary hover:border-accent-blue hover:text-text-primary'
      )}
    >
      {label}
    </button>
  )
}
