import { Zap, Github } from 'lucide-react'
import pkg from '../../../package.json'

interface Props {
  t: (key: string) => string
}

export function About({ t }: Props) {
  return (
    <section className="border-t border-gray-100 pt-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">{t('关于')}</h3>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 bg-[var(--accent)] rounded-xl flex items-center justify-center">
          <Zap size={20} className="text-white" />
        </div>
        <div>
          <div className="font-semibold text-gray-900 text-sm">{t('雷霆记账')}</div>
          <div className="text-xs text-gray-400">v{pkg.version} — {t('轻量级个人日常记账工具')}</div>
        </div>
      </div>

      <div className="space-y-1.5 text-xs text-gray-500">
        <div className="flex items-center gap-2">
          <span className="w-16 text-gray-400">{t('快捷键')}</span>
          <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600 font-mono text-xs">Ctrl+N</kbd>
          <span>{t('快速记一笔')}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-16 text-gray-400">{t('数据存储')}</span>
          <span>{t('本地 SQLite + 云端同步')}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-16 text-gray-400">{t('开源协议')}</span>
          <span>MIT License</span>
        </div>
      </div>

      <a
        href="https://github.com/TukinokiShio/thunder-accounting"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 mt-3 text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        <Github size={14} />
        GitHub
      </a>
    </section>
  )
}
