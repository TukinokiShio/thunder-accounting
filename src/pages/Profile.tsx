/**
 * 个人中心页面 — 重构版 v2
 *
 * 架构：
 *   - 5 个独立子组件：AccountInfo / ChangePasswordForm / EmailBinding / PhoneBinding / DangerZone
 *   - 统一使用 friendlyError() 处理所有后端错误
 *   - 按钮全部带图标 + Tailwind 样式（不再用裸文字）
 *   - 验证渠道选择：当只有 1 个渠道时直接发送，不显示选择器
 *
 * 借鉴来源：
 *   - shadcn-admin Settings 模块布局（左侧导航+右侧内容）
 *   - Origin UI Danger Zone 模式（红边警示+输入确认）
 *   - react-hook-form 验证思路（手动实现，无第三方依赖）
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useStore } from '@/store'
import { useLanguage } from '@/i18n/LanguageContext'
import { friendlyError } from '@/utils/errorMessages'
import { isAndroid } from '@/platform'
import { BackupRestore } from '@/components/SettingsDialog/BackupRestore'
import { About } from '@/components/SettingsDialog/About'
import { Preferences } from '@/components/SettingsDialog/Preferences'
import { useDataManagement } from '@/components/SettingsDialog/useDataManagement'
import {
  User, Lock, Link, BarChart3, AlertTriangle, AlertCircle,
  Copy, Check, Eye, EyeOff, Loader2, Trash2,
  Mail, Phone, Shield, Key, LogOut, ChevronDown, ChevronRight, Send, X, FolderTree
} from 'lucide-react'

type Tab = 'info' | 'security' | 'binding' | 'stats' | 'danger'
type LoadState = 'loading' | 'ready' | 'error'

interface AccountInfo {
  accountId: string
  email: string
  phone: string
  nickname?: string
}

interface UserStats {
  billCount: number
  categoryCount: number
  totalExpense: number
  totalIncome: number
}

function hasUserStats(stats: UserStats): boolean {
  return stats.billCount > 0 || stats.categoryCount > 0 || stats.totalExpense !== 0 || stats.totalIncome !== 0
}

function isInternalEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase()
  return !normalized || normalized.endsWith('@phone.tb') || normalized.endsWith('@thunder.invalid') || normalized.endsWith('@lgs.invalid')
}

function isInternalPhone(phone: string): boolean {
  const normalized = phone.replace(/\s/g, '')
  return !normalized || normalized.startsWith('+86140') || normalized.startsWith('86140') || normalized.startsWith('140')
}

function isPasswordValid(pwd: string): boolean {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[()!@#$%^&*|?><_\-]/]
  return pwd.length >= 8 && pwd.length <= 32 && classes.filter(pattern => pattern.test(pwd)).length >= 3
}

function bindingError(e: unknown, lang: Parameters<typeof friendlyError>[1], t: (key: string) => string): string {
  const raw = e instanceof Error ? e.message : String(e)
  if (raw.includes('binding_mapping_pending')) {
    return t('CloudBase Auth 已完成绑定，但账号映射尚未同步。请配置 CLOUDBASE_API_KEY 后刷新重试。')
  }
  return friendlyError(e, lang)
}

/**
 * 云端能力不可用时的降级面板（P2-5 / RL-A9）。
 *
 * ⚠ 实现纪律：`cloudbase-contract.test.ts:133` 明确禁止在 Profile.tsx 里把控件属性
 * disabled 直接绑定到「云端不可用」——云端能力门必须用**条件渲染 / 降级文案**表达，
 * 不能靠禁用控件（该禁写字面量因此在本文件里一个字都不能出现）。
 * 另外此面板只在安卓本地模式渲染（`isAndroid() && !cloudAvailable`），桌面渲染逐位不变。
 */
function LocalModeCloudNotice({ message }: { message: string }) {
  return (
    <div className="profile-surface rounded-xl p-4" role="status">
      <p className="text-sm text-gray-600">{message}</p>
    </div>
  )
}

export default function ProfilePage() {
  const { user, addToast, appLogout } = useStore()
  const { t, lang } = useLanguage()
  const [activeTab, setActiveTab] = useState<Tab>('info')

  // 安卓首版为纯本地单机：无云端账号能力 → cloudAvailable 初值直接是 false（桌面仍是 null=检测中）
  const localMode = isAndroid()

  // ── 账号信息 ──
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [copied, setCopied] = useState(false)
  const [accountStatus, setAccountStatus] = useState<LoadState>('loading')
  // 云端服务可用性：null = 检测中, true = 可用, false = 未配置
  const [cloudAvailable, setCloudAvailable] = useState<boolean | null>(() => (localMode ? false : null))

  // ── 数据概览 ──
  const [stats, setStats] = useState<UserStats | null>(null)
  const [statsStatus, setStatsStatus] = useState<LoadState>('loading')

  // ── 加载账号信息 ──
  const loadAccount = useCallback(async () => {
    setAccountStatus('loading')
    try {
      const info = await window.electronAPI.getAccountBindings()
      setAccount(info)
      setAccountStatus('ready')
    } catch (e) {
      console.error('Failed to load account bindings:', e)
      setAccountStatus('error')
    }
  }, [])

  const loadStats = useCallback(async () => {
    setStatsStatus('loading')
    try {
      const s = await window.electronAPI.getUserStats()
      setStats(s)
      setStatsStatus('ready')
    } catch (e) {
      console.error('Failed to load user stats:', e)
      setStatsStatus('error')
    }
  }, [])

  const checkCloud = useCallback(async () => {
    try {
      const ok = await window.electronAPI.isCloudSyncEnabled()
      setCloudAvailable(ok)
    } catch {
      setCloudAvailable(false)
    }
  }, [])

  useEffect(() => {
    // 安卓本地模式（纯本地单机）：
    // - `loadStats()`（getUserStats）**照常调用** —— 桌面侧 `cloudbase.ts` 与安卓适配器
    //   `android-adapter.ts:389-395` 都证明它是**本地库聚合**，与云端能力无关；
    //   若被云门挡住，安卓「我的 → 数据概览」会恒为空态（真实功能缺失）。
    // - 只有 `loadAccount()` / `checkCloud()` 这两个**真正依赖云**的挂载期调用不发起（RL-A9 修正版：
    //   门控范围 = 2 个云调用 + 1 个本地调用）。
    // 桌面分支与改动前逐位一致：仍然是 loadAccount → loadStats → checkCloud，同一顺序。
    if (localMode) {
      setAccountStatus('ready')
      loadStats()
      return
    }
    loadAccount()
    loadStats()
    checkCloud()
  }, [localMode, loadAccount, loadStats, checkCloud])

  // ── 派生值 ──
  const accountId = account?.accountId || user?.accountId || ''
  const visibleEmail = account?.email && !isInternalEmail(account.email) ? account.email : ''
  const nickname =
    account?.nickname ||
    user?.nickname ||
    (visibleEmail.split('@')[0] ?? '') ||
    t('未知用户')
  const boundEmail = visibleEmail
  const boundPhone = account?.phone && !isInternalPhone(account.phone) ? account.phone : ''

  // ── 复制账号 ID ──
  const copyAccountId = () => {
    if (!accountId) return
    navigator.clipboard.writeText(accountId)
    setCopied(true)
    addToast('success', t('已复制账号ID'))
    setTimeout(() => setCopied(false), 2000)
  }

  // ── 退出登录 ──
  const handleLogout = async () => {
    await appLogout()
    addToast('info', t('已退出登录'))
  }

  /**
   * 安卓本地模式（纯本地单机）在**所有 hook 之后**整页早返回。
   *
   * 为什么是「整页换掉」而不是「在桌面版式上少渲染几项」：
   *  - 本机模式没有账号 → 「个人中心」这个类别本身就是错的（没有中心，也没有账号）；
   *  - 剩余的 Tab 项在 412px 里依然放不下：旧版把 4 项压成单行 chip + 横向滚动，
   *    真机实测第 4 项被裁在屏幕外、用户点不到（这就是 `mobile/android.css` 里
   *    那段「故意不含 .profile-nav 任何规则」注释的由来）；
   *  - 即使塞得下，每个 Tab 面板只有 100~200px 内容，而可用内容带约 795px
   *    → 无论切到哪个 Tab，页面都有约 70% 是空白（真机反馈）。
   * 所以改按**信息密度**组织成一块纵向单面板，见 `LocalProfilePanel`。
   *
   * ⚠ 桌面（`isAndroid()` 为假）走的是下面那段**逐位未改**的 5 Tab 版式；
   *   本早返回之后的所有 `const` / JSX 都只服务桌面分支。
   */
  if (localMode) {
    return <LocalProfilePanel stats={stats} statsStatus={statsStatus} onRetryStats={loadStats} />
  }

  /**
   * 桌面导航：5 个 Tab 全部渲染（安卓本地模式在函数开头就早返回了，
   * 根本走不到这里 —— 所以这里不再需要「按平台裁剪 Tab」的分支，
   * 那些分支连同 `.profile-nav` 的窄屏规则一起被删掉了）。
   */
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'info', label: t('账号信息'), icon: <User size={16} /> },
    { id: 'security', label: t('安全设置'), icon: <Lock size={16} /> },
    { id: 'binding', label: t('绑定管理'), icon: <Link size={16} /> },
    { id: 'stats', label: t('数据概览'), icon: <BarChart3 size={16} /> },
    { id: 'danger', label: t('危险操作'), icon: <AlertTriangle size={16} /> },
  ]

  return (
    <div className="profile-layout page-view w-full min-w-0 flex min-h-full flex-col gap-4 md:flex-row">
      {/* ── 左侧标签导航（仅桌面） ── */}
      <aside className="profile-nav w-full min-w-0 shrink-0 md:w-48">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">{t('个人中心')}</h2>
        <nav className="space-y-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'profile-tab-active'
                  : 'profile-tab-idle'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* ── 右侧内容区 ── */}
      <div className="profile-content flex-1 min-w-0 space-y-4">
        {/* 云端服务状态提示（统一在顶部展示） */}
        {/* CloudBase 配置异常不在产品界面暴露内部配置细节，改由 Codex 交付报告反馈。 */}

        {activeTab === 'info' && (
          <InfoTab
            nickname={nickname}
            email={boundEmail}
            accountId={accountId}
            copied={copied}
            onCopy={copyAccountId}
            onLogout={handleLogout}
            accountStatus={accountStatus}
            onRetry={loadAccount}
            language={lang}
            retryLabel={t('点击重试')}
            localMode={localMode}
          />
        )}
        {activeTab === 'security' && (
          <SecurityTab
            email={boundEmail}
            phone={boundPhone}
            cloudAvailable={cloudAvailable === true}
          />
        )}
        {activeTab === 'binding' && (
          <BindingTab
            email={boundEmail}
            phone={boundPhone}
            cloudAvailable={cloudAvailable === true}
            onChange={loadAccount}
          />
        )}
        {activeTab === 'stats' && statsStatus === 'loading' && (
          <ProfileStatus
            kind="loading"
            message={t('正在加载数据概览…')}
          />
        )}
        {activeTab === 'stats' && statsStatus === 'error' && (
          <ProfileStatus
            kind="error"
            message={t('数据概览加载失败')}
            detail={t('请检查本地账本状态后重试。')}
            onRetry={loadStats}
            retryLabel={t('点击重试')}
          />
        )}
        {activeTab === 'stats' && statsStatus === 'ready' && stats && hasUserStats(stats) && (
          <StatsTab stats={stats} />
        )}
        {activeTab === 'stats' && statsStatus === 'ready' && (!stats || !hasUserStats(stats)) && (
          <ProfileStatus
            kind="empty"
            message={t('暂无数据概览')}
            detail={t('记录账单后，这里会显示你的累计收支。')}
          />
        )}
        {activeTab === 'danger' && (
          <DangerTab
            accountId={accountId}
            email={boundEmail}
            phone={boundPhone}
            nickname={nickname}
            cloudAvailable={cloudAvailable === true}
            onDeleted={() => setTimeout(() => appLogout(), 500)}
          />
        )}
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 子组件：「我的」页 —— 安卓本机账本（localMode）
// ═════════════════════════════════════════════════════════════════

/**
 * 安卓本地模式（纯本地单机）的「我的」页：一整块纵向滚动的单面板。
 *
 * ── 为什么不是「Tab 导航 + 内容区」 ──
 * 本机模式没有账号，所以「个人中心」这个概念本身就是类别错误：既没有账号可管，也没有「中心」。
 * 用户在这一页真正要做的事只有三件 —— **看清数据规模 / 管数据 / 改设置**。
 * 旧版按「账号中心」的分区去做，结果两头都错：
 *   · 5 个 Tab 里 3 个（安全设置/绑定管理/危险操作）在安卓端无任何可做的事；
 *   · 剩下的 4 项在 412px 里放不下，被横向滚动容器裁掉第 4 项（真机事故）；
 *   · 而且每个 Tab 面板自身只有 100~200px 内容，可用内容带约 795px → 无论切到哪个
 *     Tab，页面都有约 70% 是空白（真机反馈）。
 * 所以这一页不再分区导航，而按**信息密度**从上到下排：
 *   ① 本机身份 ② 数据概览 ③ 数据管理 ④ 分类管理 ⑤ 偏好设置 ⑥ 关于
 * 其中 ③④⑤⑥ 都是「设置」类内容 —— 也就是说：**这一页本身就是安卓端的设置页**，
 * 不再需要先点开设置弹窗（语言切换因此**直接可见可点**）。
 *
 * ── 与桌面/共享实现的关系 ──
 *   · 数据概览复用桌面同一个 `StatsTab` / `ProfileStatus`；
 *   · 数据管理复用同一个 `BackupRestore` + 同一个 `useDataManagement`（不写第二套）；
 *   · 偏好设置复用同一个 `Preferences`（`idPrefix` 换掉，避免与弹窗的 id 冲突）；
 *   · 关于复用同一个 `About`，只把「本机模式下为假」的两行换掉（见 `About` 的 `localMode`）。
 * 桌面 5 Tab 分支在 `ProfilePage` 里早返回之前，逐位未动。
 */
function LocalProfilePanel({
  stats,
  statsStatus,
  onRetryStats
}: {
  stats: UserStats | null
  statsStatus: LoadState
  onRetryStats: () => void | Promise<void>
}) {
  const { t } = useLanguage()
  const setActivePage = useStore((s) => s.setActivePage)
  const data = useDataManagement()

  return (
    /* `data-testid` 是给布局门禁（`scripts/verify-profile-mobile.cjs`）量「内容高度」用的：
       这一页的判据是几何量（内容 ≥ 可用内容带的 60%），jsdom 量不了。 */
    <div className="page-view local-profile-panel w-full min-w-0" data-testid="local-profile">
      <div className="space-y-6">
        {/* ① 本机身份：不渲染头像/昵称/账号 ID —— 本机模式没有账号，写「未知用户」是编造。 */}
        <div className="profile-surface rounded-xl p-4">
          <p className="text-sm font-semibold text-gray-800">{t('本地模式')}</p>
          <p className="text-xs text-gray-500 mt-1">{t('数据保存在本机，无需登录即可使用。')}</p>
        </div>

        {/* ② 偏好设置。
            ⚠ 位置是**刻意选的**，不是随手排的：真机事故的原文是「页面还是没有做到中英文切换」
            —— 用户是**找不到**语言入口，不是不会用。所以语言切换器必须落在**首屏**内
            （不滚动、不点弹窗就看得见）。它排在数据概览**之前**就是这个原因：
            数据概览占约 360px，排在它后面时切换器会被推到首屏之外。
            几何判据（切换器落在可视内容带内）由 `scripts/verify-profile-mobile.cjs` 断言。 */}
        <section className="border-t border-gray-100 pt-4">
          <Preferences idPrefix="local-profile" />
        </section>

        {/* ③ 数据概览（复用桌面同一个组件与同一个空/错/载态面板） */}
        {statsStatus === 'loading' && (
          <ProfileStatus kind="loading" message={t('正在加载数据概览…')} />
        )}
        {statsStatus === 'error' && (
          <ProfileStatus
            kind="error"
            message={t('数据概览加载失败')}
            detail={t('请检查本地账本状态后重试。')}
            onRetry={onRetryStats}
            retryLabel={t('点击重试')}
          />
        )}
        {statsStatus === 'ready' && stats && hasUserStats(stats) && <StatsTab stats={stats} />}
        {statsStatus === 'ready' && (!stats || !hasUserStats(stats)) && (
          <ProfileStatus
            kind="empty"
            message={t('暂无数据概览')}
            detail={t('记录账单后，这里会显示你的累计收支。')}
          />
        )}

        {/* ④ 数据管理 */}
        <BackupRestore
          exporting={data.exporting}
          importing={data.importing}
          clearing={data.clearing}
          clearStep={data.clearStep}
          onExport={data.handleExport}
          onImport={data.handleImport}
          onClear={data.handleClear}
          onCancelClear={data.cancelClear}
          t={t}
        />

        {/* ⑤ 分类管理：底部导航只有 4 个 Tab，它是第 5 个页面，入口归在「我的」 */}
        <section className="border-t border-gray-100 pt-4">
          <button
            type="button"
            onClick={() => setActivePage('categories')}
            className="profile-action w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left text-gray-700 transition-colors"
            aria-label={t('分类管理')}
          >
            <FolderTree size={16} className="profile-accent-icon shrink-0" aria-hidden="true" />
            <span className="flex-1 min-w-0">
              <span className="block font-medium">{t('分类管理')}</span>
              {/* 副标题用分类管理页**真实存在**的操作，而不是泛泛的「管理你的分类」 */}
              <span className="block text-xs text-gray-400">{t('点右上角「编辑」可拖动排序或删除分类')}</span>
            </span>
            <ChevronRight size={16} className="text-gray-400 shrink-0" aria-hidden="true" />
          </button>
        </section>

        {/* ⑥ 关于 */}
        <About t={t} localMode />
      </div>
    </div>
  )
}

function ProfileStatus({
  kind,
  message,
  detail,
  onRetry,
  retryLabel
}: {
  kind: 'loading' | 'error' | 'empty'
  message: string
  detail?: string
  onRetry?: () => void | Promise<void>
  retryLabel?: string
}) {
  const isError = kind === 'error'
  return (
    <div
      role={isError ? 'alert' : 'status'}
      className="profile-surface flex items-start gap-3 rounded-xl p-4"
      aria-live={isError ? 'assertive' : 'polite'}
    >
      {kind === 'loading' ? (
        <Loader2 size={18} className="profile-accent-icon motion-safe:animate-spin shrink-0 mt-0.5" aria-hidden="true" />
      ) : (
        <AlertCircle
          size={18}
          className="shrink-0 mt-0.5"
          style={{ color: isError ? 'var(--danger)' : 'var(--text2)' }}
          aria-hidden="true"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium" style={{ color: isError ? 'var(--danger)' : 'var(--text)' }}>{message}</p>
        {detail && <p className="text-xs mt-1" style={{ color: 'var(--text2)' }}>{detail}</p>}
        {onRetry && (
          <button
            type="button"
            onClick={() => void onRetry()}
            className="profile-action mt-3 inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm"
          >
            {retryLabel}
          </button>
        )}
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 子组件：账号信息
// ═════════════════════════════════════════════════════════════════

function InfoTab({
  nickname, email, accountId, copied, onCopy, onLogout, accountStatus, onRetry, language, retryLabel, localMode
}: {
  nickname: string
  email: string
  accountId: string
  copied: boolean
  onCopy: () => void
  onLogout: () => void
  accountStatus: LoadState
  onRetry: () => void | Promise<void>
  language: 'zh' | 'en'
  retryLabel: string
  /** 安卓本地模式：隐藏账号 ID 卡（无账号体系）、邮箱行与「退出登录」 */
  localMode: boolean
}) {
  const { t } = useLanguage()
  return (
    <div className="max-w-2xl space-y-6">
      {accountStatus === 'loading' && (
        <ProfileStatus
          kind="loading"
          message={t('正在加载账号信息…')}
        />
      )}
      {accountStatus === 'error' && (
        <ProfileStatus
          kind="error"
          message={t('账号信息加载失败')}
          detail={t('现有登录账号仍可使用；恢复连接后可重试。')}
          onRetry={onRetry}
          retryLabel={retryLabel}
        />
      )}
      {/* 空态只在桌面（有账号体系）出现：它的引导文案指向「绑定管理」，
          而安卓本地模式下该 Tab 整体不渲染 → 引导会指向不存在的页面。 */}
      {!localMode && accountStatus === 'ready' && !email && !accountId && (
        <ProfileStatus
          kind="empty"
          message={t('暂无账号绑定信息')}
          detail={t('可以在“绑定管理”中添加邮箱或手机号。')}
        />
      )}
      <div className="flex items-center gap-4">
        <div className="profile-avatar w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold">
          {nickname?.charAt(0).toUpperCase() || '?'}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-xl font-semibold text-gray-900 truncate">{nickname}</h3>
          <p className="text-sm text-gray-500 truncate">
            {localMode ? t('本地模式') : (email || t('雷霆记账用户'))}
          </p>
        </div>
      </div>

      {localMode ? (
        /* 本地身份卡：安卓本地模式没有账号 ID（`android-adapter.ts` 恒返回 null）也没有
           绑定/登录链路，因此不渲染账号 ID 卡（旧版会永久停在「加载中...」占位）、
           不渲染邮箱行、也不渲染「退出登录」（旧版点击只会抛 cloudUnavailable 错）。 */
        <div className="profile-surface rounded-xl p-4">
          <p className="text-sm text-gray-600">{t('数据保存在本机，无需登录即可使用。')}</p>
        </div>
      ) : (
        <>
          <div className="profile-surface rounded-xl p-4">
            <label className="text-xs text-gray-500 mb-1 block">{t('雷霆记账账号')}</label>
            <div className="flex items-center gap-2">
              <code className="text-lg font-mono font-bold text-gray-800 tracking-wider flex-1">
                {accountId || t('加载中...')}
              </code>
              <button
                onClick={onCopy}
                disabled={!accountId}
                className="profile-action inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 transition-colors"
                title={t('复制账号ID')}
              >
                {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                {copied ? t('已复制') : t('复制')}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">{t('你的雷霆记账专属账号ID，可用于登录、找回账号和跨设备数据同步。')}</p>
          </div>

          <div className="profile-surface flex items-center gap-4 p-4 rounded-xl">
            <Mail size={20} className="text-gray-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-500">{t('邮箱')}</p>
              <p className="text-sm text-gray-800 truncate">{email || t('未绑定邮箱')}</p>
            </div>
            {email && (
              <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">{t('已绑定')}</span>
            )}
          </div>

          <button
            onClick={onLogout}
            className="profile-action profile-danger-outline inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors"
          >
            <LogOut size={16} />{t('退出登录')}</button>
        </>
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 子组件：安全设置（修改密码）
// ═════════════════════════════════════════════════════════════════

function SecurityTab({ email, phone, cloudAvailable }: { email: string; phone: string; cloudAvailable: boolean }) {
  const [verifyChannel, setVerifyChannel] = useState<'email' | 'phone' | null>(null)
  const [showChannelDropdown, setShowChannelDropdown] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const { addToast } = useStore()
  const { t, lang } = useLanguage()

  // 可用渠道
  const channels: Array<{ key: 'email' | 'phone'; label: string; value: string }> = []
  if (email) channels.push({ key: 'email', label: t('邮箱'), value: email })
  if (phone) channels.push({ key: 'phone', label: t('手机号'), value: phone })

  // 点击外部关闭下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowChannelDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // 重置所有状态
  const reset = () => {
    setVerifyChannel(null)
    setCode('')
    setCodeSent(false)
    setNewPwd('')
    setConfirmPwd('')
    setExpanded(false)
  }

  // 发送验证码
  const handleSendCode = async () => {
    if (channels.length === 0) {
      addToast('error', t('请先在「绑定管理」中绑定邮箱或手机号'))
      return
    }
    // 只有 1 个渠道时直接发送，不显示选择器
    const target = verifyChannel || channels[0].key
    if (!channels.find(c => c.key === target)?.value) return

    setSending(true)
    try {
      await window.electronAPI.sendReauthCode(target === 'phone' ? 'phone_code' : 'email_code')
      setCodeSent(true)
      setVerifyChannel(target) // 记住用户选择（多个渠道时）
      addToast('success', target === 'phone' ? t('验证码已发送到手机') : t('验证码已发送到邮箱'))
    } catch (e) {
      addToast('error', bindingError(e, lang, t))
    } finally {
      setSending(false)
    }
  }

  // 提交修改
  const handleSubmit = async () => {
    if (!code) {
      addToast('error', t('请先发送并填写验证码'))
      return
    }
    if (!isPasswordValid(newPwd)) {
      addToast('error', t('新密码需为 8-32 位，并包含小写字母、大写字母、数字、特殊字符中的至少三类'))
      return
    }
    if (newPwd !== confirmPwd) {
      addToast('error', t('两次输入的密码不一致'))
      return
    }
    setSubmitting(true)
    try {
      if (!verifyChannel) {
        addToast('error', t('请选择验证方式并发送验证码'))
        return
      }
      await window.electronAPI.changePassword(newPwd, code)
      addToast('success', t('密码修改成功，请使用新密码重新登录'))
      reset()
    } catch (e) {
      addToast('error', bindingError(e, lang, t))
    } finally {
      setSubmitting(false)
    }
  }

  // 安卓本地模式：无云端账号能力 → 修改密码链路整体不可用，改为降级说明（不渲染任何云控件）
  if (isAndroid() && !cloudAvailable) {
    return (
      <div className="max-w-2xl space-y-6">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Shield size={20} className="profile-accent-icon" />{t('安全设置')}</h2>
        <LocalModeCloudNotice message={t('本版本为本地模式，未接入云端账号服务，因此「修改密码」不可用。')} />
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
        <Shield size={20} className="profile-accent-icon" />{t('安全设置')}</h2>

      {/* 修改密码卡片 */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <Key size={18} className="text-gray-400" />
            <div>
              <p className="text-sm font-medium text-gray-900">{t('修改密码')}</p>
              <p className="text-xs text-gray-500">{t('无需旧密码，验证身份后即可设置新密码')}</p>
            </div>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="profile-action inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors"
          >
            {expanded ? t('收起') : t('修改')}
            <ChevronRight size={14} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </button>
        </div>

        {expanded && (
          <div className="px-4 pb-4 pt-2 space-y-3 border-t border-gray-100 bg-gray-50/50">
            {channels.length === 0 ? (
              <div className="text-sm text-amber-600 p-3 bg-amber-50 rounded-lg">{t('⚠ 请先在「绑定管理」中绑定邮箱或手机号')}</div>
            ) : (
              <>
                {/* 渠道选择（只在多个渠道时显示） */}
                {channels.length > 1 && (
                  <div ref={dropdownRef} className="relative">
                    <label className="text-xs text-gray-500 block mb-1">{t('验证方式')}</label>
                    <button
                      onClick={() => setShowChannelDropdown(!showChannelDropdown)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-left flex items-center justify-between"
                    >
                      <span>
                        {verifyChannel
                          ? channels.find(c => c.key === verifyChannel)?.label
                          : t('请选择验证方式')}
                      </span>
                      <ChevronDown size={14} className="text-gray-400" />
                    </button>
                    {showChannelDropdown && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                        {channels.map(c => (
                          <button
                            key={c.key}
                            onClick={() => {
                              setVerifyChannel(c.key)
                              setShowChannelDropdown(false)
                              setCodeSent(false)
                              setCode('')
                            }}
                            className="w-full px-3 py-2 text-sm text-left hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
                          >
                            {c.label} ({c.value})
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 单渠道时的明确展示 */}
                {channels.length === 1 && !verifyChannel && (
                  <div className="text-xs text-gray-600">{t('验证码将发送到')} {channels[0].label}{t('：')}{channels[0].value}
                  </div>
                )}

                {/* 发送验证码 */}
                <button
                  onClick={handleSendCode}
                  disabled={sending || (channels.length > 1 && !verifyChannel)}
                  className="profile-accent-action inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sending && <Loader2 size={14} className="animate-spin" />}
                  <Send size={14} />
                  {codeSent ? t('重新发送验证码') : t('发送验证码')}
                </button>

                {codeSent && (
                  <>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">{t('验证码')}</label>
                      <input
                        value={code}
                        onChange={e => setCode(e.target.value)}
                        className="profile-input w-full px-3 py-2 rounded-lg text-sm"
                        placeholder={t('输入收到的验证码')}
                        maxLength={6}
                      />
                    </div>

                    <div>
                      <label className="text-xs text-gray-500 block mb-1">{t('新密码')} <span className="text-gray-400">{t('（8-32 位，至少包含三类字符）')}</span>
                      </label>
                      <div className="relative">
                        <input
                          type={showPwd ? 'text' : 'password'}
                          value={newPwd}
                          onChange={e => setNewPwd(e.target.value)}
                          className="profile-input w-full px-3 py-2 pr-10 rounded-lg text-sm"
                          placeholder={t('输入新密码')}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPwd(!showPwd)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                        >
                          {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-gray-500 block mb-1">{t('确认新密码')}</label>
                      <div className="relative">
                        <input
                          type={showPwd ? 'text' : 'password'}
                          value={confirmPwd}
                          onChange={e => setConfirmPwd(e.target.value)}
                          className={`profile-input w-full px-3 py-2 pr-10 rounded-lg text-sm ${
                            confirmPwd && newPwd !== confirmPwd ? 'is-invalid' : ''
                          }`}
                          placeholder={t('再次输入新密码')}
                        />
                      </div>
                      {confirmPwd && newPwd !== confirmPwd && (
                        <p className="text-xs text-red-500 mt-1">{t('两次密码不一致')}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSubmit}
                        disabled={submitting || !code || !newPwd || newPwd !== confirmPwd || !isPasswordValid(newPwd)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {submitting && <Loader2 size={14} className="animate-spin" />}{t('确认修改')}</button>
                      <button
                        onClick={reset}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
                      >
                        <X size={14} />{t('取消')}</button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* 安全提示 */}
      <div className="profile-security-tip rounded-xl p-4 text-sm">
        <p className="profile-security-tip-title font-medium mb-1 flex items-center gap-2">
          <Shield size={14} />{t('安全提示')}</p>
        <ul className="profile-security-tip-list list-disc list-inside space-y-1">
          <li>{t('密码应包含字母、数字和特殊字符')}</li>
          <li>{t('不要在多个平台使用相同密码')}</li>
          <li>{t('如发现异常登录，请立即修改密码')}</li>
        </ul>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 子组件：绑定管理（邮箱 + 手机号）
// ═════════════════════════════════════════════════════════════════

function BindingTab({ email, phone, onChange, cloudAvailable }: {
  email: string
  phone: string
  onChange: () => void | Promise<void>
  cloudAvailable?: boolean
}) {
  const { t } = useLanguage()
  // 安卓本地模式：无云端账号能力 → 邮箱/手机绑定整体不可用，改为降级说明
  if (isAndroid() && !cloudAvailable) {
    return (
      <div className="max-w-2xl space-y-6">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Link size={20} className="profile-accent-icon" />{t('绑定管理')}</h2>
        <LocalModeCloudNotice message={t('本版本为本地模式，未接入云端账号服务，因此邮箱/手机绑定不可用。')} />
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
        <Link size={20} className="profile-accent-icon" />{t('绑定管理')}</h2>
      <p className="text-sm text-gray-500">{t('绑定邮箱和手机号可以增强账号安全性，用于找回密码和接收重要通知。')}{email && !phone && t(' 至少需要保留一种绑定方式。')}
      </p>

      <EmailBindingCard boundEmail={email} boundPhone={phone} onChange={onChange} />
      <PhoneBindingCard boundPhone={phone} boundEmail={email} onChange={onChange} />
    </div>
  )
}

// ─── 邮箱绑定 ──────────────────────────────────────────

function EmailBindingCard({ boundEmail, boundPhone, onChange }: {
  boundEmail: string
  boundPhone: string
  onChange: () => void | Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const [target, setTarget] = useState('')
  const [code, setCode] = useState('')
  const [vid, setVid] = useState('')
  const [step, setStep] = useState<'idle' | 'reauth-sent' | 'code-sent'>('idle')
  const [reauthCode, setReauthCode] = useState('')
  const [reauthVid, setReauthVid] = useState('')
  const [sending, setSending] = useState(false)
  const [binding, setBinding] = useState(false)
  const [unbinding, setUnbinding] = useState(false)
  const [unbindCode, setUnbindCode] = useState('')
  const [unbindVid, setUnbindVid] = useState('')
  const [unbindStep, setUnbindStep] = useState<'idle' | 'code-sent'>('idle')
  const [sendingUnbind, setSendingUnbind] = useState(false)
  const { addToast } = useStore()
  const { t, lang } = useLanguage()

  const reset = () => { setTarget(''); setCode(''); setVid(''); setReauthCode(''); setReauthVid(''); setStep('idle') }

  const sendCode = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      addToast('error', t('请输入正确的邮箱地址'))
      return
    }
    setSending(true)
    try {
      const r = await window.electronAPI.sendBindCode(target)
      setVid(r.verificationId)
      setStep('code-sent')
      addToast('success', t('验证码已发送到邮箱 {email}，10分钟内有效').replace('{email}', target))
    } catch (e) {
      addToast('error', bindingError(e, lang, t))
    } finally {
      setSending(false)
    }
  }

  const confirmBind = async () => {
    if (!code || !vid) { addToast('error', t('请输入邮箱验证码')); return }
    if (!reauthCode || !reauthVid) {
      setSending(true)
      try {
        const r = await window.electronAPI.sendBindingReauthCode()
        setReauthVid(r.verificationId)
        setStep('reauth-sent')
        addToast('success', t('邮箱验证码已收到，请再验证当前绑定渠道，有效期10分钟'))
      } catch (e) { addToast('error', bindingError(e, lang, t)) }
      finally { setSending(false) }
      return
    }
    setBinding(true)
    try {
      await window.electronAPI.bindEmail(target, code, vid, reauthCode, reauthVid)
      addToast('success', t('邮箱绑定成功'))
      reset()
      await onChange()
    } catch (e) {
      addToast('error', bindingError(e, lang, t))
    } finally {
      setBinding(false)
    }
  }

  const sendUnbindCode = async () => {
    if (!boundEmail) return
    if (!boundPhone) {
      addToast('error', t('当前只绑定一个平台，不能进行解绑操作，请先绑定另一个平台'))
      return
    }
    setSendingUnbind(true)
    try {
      const r = await window.electronAPI.sendBindCode(boundEmail)
      setUnbindVid(r.verificationId)
      setUnbindStep('code-sent')
      addToast('success', t('验证码已发送到邮箱'))
    } catch (e) {
      addToast('error', friendlyError(e, lang))
    } finally {
      setSendingUnbind(false)
    }
  }

  const confirmUnbind = async () => {
    if (!unbindCode || !unbindVid) { addToast('error', t('请输入验证码')); return }
    setUnbinding(true)
    try {
      await window.electronAPI.unbindEmail(unbindCode, unbindVid)
      addToast('success', t('邮箱解绑成功'))
      setUnbindCode(''); setUnbindVid(''); setUnbindStep('idle')
      await onChange()
    } catch (e) {
      addToast('error', friendlyError(e, lang))
    } finally {
      setUnbinding(false)
    }
  }

  return (
    <div className="profile-surface rounded-xl p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Mail size={18} className="text-gray-400" />
          <div>
            <p className="text-sm font-medium text-gray-900">{t('邮箱')}</p>
            <p className={`text-xs truncate max-w-[200px] ${boundEmail ? 'text-gray-500' : 'profile-unbound-label'}`}>
              {boundEmail || t('未绑定邮箱')}
            </p>
          </div>
        </div>
        {boundEmail && unbindStep === 'idle' && (
          <button
            onClick={sendUnbindCode}
            disabled={sendingUnbind}
            className="profile-action profile-danger-outline inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg disabled:opacity-50"
          >
            {sendingUnbind && <Loader2 size={14} className="animate-spin" />}{t('解绑')}</button>
        )}
        {!boundEmail && (
          <button onClick={() => setExpanded(v => !v)} className="profile-action inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg">
            {expanded ? t('取消') : t('绑定')}
          </button>
        )}
      </div>

      {/* 解绑流程 */}
      {unbindStep === 'code-sent' && (
        <div className="profile-danger-step mt-4 pl-11 space-y-3 -mx-5 -mb-5 px-5 pb-5 pt-4 border-t">
          <p className="text-xs text-red-700">{t('验证码已发送到：')}{boundEmail}</p>
          <div className="profile-field-shell">
            <input
              value={unbindCode}
              onChange={e => setUnbindCode(e.target.value)}
              placeholder={t('输入验证码')}
              maxLength={6}
              className="profile-input w-full px-3 py-2 rounded-lg text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={confirmUnbind}
              disabled={unbinding || !unbindCode}
            className="profile-danger-button inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm disabled:opacity-50"
            >
              {unbinding && <Loader2 size={14} className="animate-spin" />}{t('确认解绑邮箱')}</button>
            <button
              onClick={() => { setUnbindCode(''); setUnbindVid(''); setUnbindStep('idle') }}
            className="profile-action inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg"
            >
              <X size={14} />{t('取消')}</button>
          </div>
        </div>
      )}

      {/* 绑定新邮箱 */}
      {!boundEmail && expanded && step === 'idle' && (
        <div className="mt-4 pl-11 space-y-3">
          <div className="profile-field-shell">
            <input
              type="email"
              value={target}
              onChange={e => setTarget(e.target.value)}
              placeholder={t('输入要绑定的邮箱')}
              className="profile-input w-full px-3 py-2 rounded-lg text-sm"
            />
          </div>
          <div className="profile-code-field flex items-center">
            <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder={t('输入验证码')} maxLength={6} className="profile-input min-w-0 flex-1 px-3 text-sm" />
            <button type="button" onClick={() => void sendCode()} disabled={!target || sending} className="profile-code-action h-full shrink-0 px-3 text-sm">{sending ? t('发送中…') : t('获取验证码')}</button>
          </div>
        </div>
      )}

      {!boundEmail && expanded && step === 'reauth-sent' && (
        <div className="profile-step mt-4 pl-11 space-y-3 -mx-5 -mb-5 px-5 pb-5 pt-4 border-t">
          <p className="profile-accent-text text-xs">{t('验证码已发送到当前绑定渠道，请先验证身份（有效期10分钟）')}</p>
          <div className="profile-field-shell">
            <input value={reauthCode} onChange={e => setReauthCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder={t('输入当前渠道验证码')} maxLength={6} className="profile-input w-full px-3 py-2 rounded-lg text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void confirmBind()} disabled={!reauthCode || sending} className="profile-accent-action inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm disabled:opacity-50">
              {sending && <Loader2 size={14} className="animate-spin" />} {t('验证身份并绑定邮箱')}</button>
            <button onClick={reset} className="profile-action inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg"><X size={14} />{t('取消')}</button>
          </div>
        </div>
      )}

      {!boundEmail && expanded && step === 'code-sent' && (
        <div className="profile-step mt-4 pl-11 space-y-3 -mx-5 -mb-5 px-5 pb-5 pt-4 border-t">
          <p className="profile-accent-text text-xs">{t('验证码已发送到：')}{target}</p>
          <div className="profile-field-shell">
            <input type="email" value={target} onChange={e => setTarget(e.target.value)} placeholder={t('输入要绑定的邮箱')} className="profile-input w-full px-3 py-2 rounded-lg text-sm" />
          </div>
          <div className="profile-code-field flex items-center">
            <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder={t('输入验证码')} maxLength={6} className="profile-input min-w-0 flex-1 px-3 text-sm" />
            <button type="button" onClick={() => void sendCode()} disabled={sending} className="profile-code-action h-full shrink-0 px-3 text-sm">{sending ? t('发送中…') : t('获取验证码')}</button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={confirmBind}
              disabled={binding || !code}
            className="profile-accent-action inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm disabled:opacity-50"
            >
              {binding && <Loader2 size={14} className="animate-spin" />}{t('验证邮箱并继续')}</button>
            <button
              onClick={reset}
            className="profile-action inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg"
            >
              <X size={14} />{t('取消')}</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 手机号绑定 ──────────────────────────────────────────

function PhoneBindingCard({ boundPhone, boundEmail, onChange }: {
  boundPhone: string
  boundEmail: string
  onChange: () => void | Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const [target, setTarget] = useState('')
  const [code, setCode] = useState('')
  const [vid, setVid] = useState('')
  const [step, setStep] = useState<'idle' | 'code-sent'>('idle')
  const [sending, setSending] = useState(false)
  const [binding, setBinding] = useState(false)
  const [unbinding, setUnbinding] = useState(false)
  const [unbindCode, setUnbindCode] = useState('')
  const [unbindVid, setUnbindVid] = useState('')
  const [unbindStep, setUnbindStep] = useState<'idle' | 'code-sent'>('idle')
  const [sendingUnbind, setSendingUnbind] = useState(false)
  const { addToast } = useStore()
  const { t, lang } = useLanguage()

  const reset = () => { setTarget(''); setCode(''); setVid(''); setStep('idle') }

  const sendCode = async () => {
    if (target.length !== 11) { addToast('error', t('请输入11位手机号')); return }
    setSending(true)
    try {
      const r = await window.electronAPI.sendBindCode(target)
      setVid(r.verificationId)
      setStep('code-sent')
      addToast('success', t('验证码已发送到手机'))
    } catch (e) {
      addToast('error', friendlyError(e, lang))
    } finally {
      setSending(false)
    }
  }

  const confirmBind = async () => {
    if (!code || !vid) { addToast('error', t('请输入验证码')); return }
    setBinding(true)
    try {
      await window.electronAPI.bindPhone(target, code, vid)
      addToast('success', t('手机号绑定成功'))
      reset()
      await onChange()
    } catch (e) {
      addToast('error', friendlyError(e, lang))
    } finally {
      setBinding(false)
    }
  }

  const sendUnbindCode = async () => {
    if (!boundPhone) return
    if (!boundEmail) {
      addToast('error', t('当前只绑定一个平台，不能进行解绑操作，请先绑定另一个平台'))
      return
    }
    setSendingUnbind(true)
    try {
      const r = await window.electronAPI.sendBindCode(boundPhone)
      setUnbindVid(r.verificationId)
      setUnbindStep('code-sent')
      addToast('success', t('验证码已发送到手机'))
    } catch (e) {
      addToast('error', friendlyError(e, lang))
    } finally {
      setSendingUnbind(false)
    }
  }

  const confirmUnbind = async () => {
    if (!unbindCode || !unbindVid) { addToast('error', t('请输入验证码')); return }
    setUnbinding(true)
    try {
      await window.electronAPI.unbindPhone(unbindCode, unbindVid)
      addToast('success', t('手机号解绑成功'))
      setUnbindCode(''); setUnbindVid(''); setUnbindStep('idle')
      await onChange()
    } catch (e) {
      addToast('error', friendlyError(e, lang))
    } finally {
      setUnbinding(false)
    }
  }

  return (
    <div className="profile-surface rounded-xl p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Phone size={18} className="text-gray-400" />
          <div>
            <p className="text-sm font-medium text-gray-900">{t('手机号')}</p>
            <p className={`text-xs ${boundPhone ? 'text-gray-500' : 'profile-unbound-label'}`}>{boundPhone || t('未绑定手机号')}</p>
          </div>
        </div>
        {boundPhone && unbindStep === 'idle' && (
          <button
            onClick={sendUnbindCode}
            disabled={sendingUnbind}
            className="profile-action profile-danger-outline inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg disabled:opacity-50"
          >
            {sendingUnbind && <Loader2 size={14} className="animate-spin" />}{t('解绑')}</button>
        )}
        {!boundPhone && (
          <button onClick={() => setExpanded(v => !v)} className="profile-action inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg">
            {expanded ? t('取消') : t('绑定')}
          </button>
        )}
      </div>

      {/* 解绑流程 */}
      {unbindStep === 'code-sent' && (
        <div className="profile-danger-step mt-4 pl-11 space-y-3 -mx-5 -mb-5 px-5 pb-5 pt-4 border-t">
          <p className="text-xs text-red-700">{t('验证码已发送到：')}{boundPhone}</p>
          <div className="profile-field-shell">
            <input
              value={unbindCode}
              onChange={e => setUnbindCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder={t('输入验证码')}
              className="profile-input w-full px-3 py-2 rounded-lg text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={confirmUnbind}
              disabled={unbinding || !unbindCode}
            className="profile-danger-button inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm disabled:opacity-50"
            >
              {unbinding && <Loader2 size={14} className="animate-spin" />}{t('确认解绑手机号')}</button>
            <button
              onClick={() => { setUnbindCode(''); setUnbindVid(''); setUnbindStep('idle') }}
            className="profile-action inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg"
            >
              <X size={14} />{t('取消')}</button>
          </div>
        </div>
      )}

      {/* 绑定新手机号 */}
      {!boundPhone && expanded && step === 'idle' && (
        <div className="mt-4 pl-11 space-y-3">
          <div className="profile-field-shell">
            <input
              value={target}
              onChange={e => setTarget(e.target.value.replace(/\D/g, '').slice(0, 11))}
              placeholder={t('输入11位手机号')}
              maxLength={11}
              className="profile-input w-full px-3 py-2 rounded-lg text-sm"
            />
          </div>
          <div className="profile-code-field flex items-center">
            <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder={t('输入验证码')} maxLength={6} className="profile-input min-w-0 flex-1 px-3 text-sm" />
            <button type="button" onClick={() => void sendCode()} disabled={target.length !== 11 || sending} className="profile-code-action h-full shrink-0 px-3 text-sm">{sending ? t('发送中…') : t('获取验证码')}</button>
          </div>
        </div>
      )}

      {!boundPhone && expanded && step === 'code-sent' && (
        <div className="profile-step mt-4 pl-11 space-y-3 -mx-5 -mb-5 px-5 pb-5 pt-4 border-t">
          <p className="profile-accent-text text-xs">{t('验证码已发送到：')}{target}</p>
          <div className="profile-field-shell">
            <input value={target} onChange={e => setTarget(e.target.value.replace(/\D/g, '').slice(0, 11))} placeholder={t('输入11位手机号')} maxLength={11} className="profile-input w-full px-3 py-2 rounded-lg text-sm" />
          </div>
          <div className="profile-code-field flex items-center">
            <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder={t('输入验证码')} maxLength={6} className="profile-input min-w-0 flex-1 px-3 text-sm" />
            <button type="button" onClick={() => void sendCode()} disabled={sending} className="profile-code-action h-full shrink-0 px-3 text-sm">{sending ? t('发送中…') : t('获取验证码')}</button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={confirmBind}
              disabled={binding || !code}
            className="profile-accent-action inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm disabled:opacity-50"
            >
              {binding && <Loader2 size={14} className="animate-spin" />}{t('确认绑定手机号')}</button>
            <button
              onClick={reset}
            className="profile-action inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg"
            >
              <X size={14} />{t('取消')}</button>
          </div>
        </div>
      )}

      {/* 安全提示：解绑后只剩一种绑定 */}
      {!boundPhone && boundEmail && (
        <p className="text-xs text-gray-400 mt-3 pl-11">{t('提示：解绑邮箱后，账号将无法通过邮箱找回密码')}</p>
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 子组件：数据概览
// ═════════════════════════════════════════════════════════════════

function StatsTab({ stats }: { stats: UserStats }) {
  const { t } = useLanguage()
  const net = stats.totalIncome - stats.totalExpense
  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
        <BarChart3 size={20} className="profile-accent-icon" />{t('数据概览')}</h2>

      <div className="grid grid-cols-2 gap-4">
        <StatCard label={t('账单总数')} value={stats.billCount} variant="gold" />
        <StatCard label={t('分类总数')} value={stats.categoryCount} variant="green" />
        <StatCard label={t('累计支出')} value={`¥${stats.totalExpense.toLocaleString()}`} variant="red" />
        <StatCard label={t('累计收入')} value={`¥${stats.totalIncome.toLocaleString()}`} variant="emerald" />
      </div>

      <div className="profile-stat profile-stat-neutral rounded-xl p-4">
        <p className="text-xs profile-stat-gold-label font-medium">{t('净收支')}</p>
        <p className={`text-2xl font-bold mt-1 ${net >= 0 ? 'profile-stat-income-label' : 'profile-stat-expense-label'}`}>
          ¥{net.toLocaleString()}
        </p>
        <p className="text-xs text-gray-500 mt-1">
          {net >= 0 ? t('收大于支') : t('支大于收')} · {stats.totalIncome >= stats.totalExpense ? t('盈余') : t('亏损')}
        </p>
      </div>
    </div>
  )
}

function StatCard({ label, value, variant }: {
  label: string
  value: string | number
  variant: 'gold' | 'green' | 'red' | 'emerald'
}) {
  const colors = {
    gold: 'profile-stat-neutral profile-stat-gold-label profile-stat-value',
    green: 'profile-stat-neutral profile-stat-positive-label profile-stat-value',
    red: 'profile-stat-neutral profile-stat-expense-label profile-stat-value',
    emerald: 'profile-stat-neutral profile-stat-income-label profile-stat-value'
  }
  const [bg, light, dark] = colors[variant].split(' ')
  return (
      <div className={`profile-stat ${bg} rounded-xl p-4`}>
      <p className={`text-xs ${light} font-medium`}>{label}</p>
      <p className={`text-2xl font-bold ${dark} mt-1`}>{value}</p>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 子组件：危险操作（注销账号）
// ═════════════════════════════════════════════════════════════════

function DangerTab({
  accountId, email, phone, nickname, onDeleted, cloudAvailable
}: {
  accountId: string
  email: string
  phone: string
  nickname: string
  onDeleted: () => void
  cloudAvailable?: boolean
}) {
  const [step, setStep] = useState<'idle' | 'code-sent'>('idle')
  const [code, setCode] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [sending, setSending] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { addToast } = useStore()
  const { t, lang } = useLanguage()

  // 可用注销验证渠道
  const verifyTarget = phone || email
  const verifyType = phone ? 'phone' : 'email'

  const reset = () => {
    setStep('idle')
    setCode('')
    setConfirmText('')
  }

  const sendCode = async () => {
    if (!verifyTarget) {
      addToast('error', t('请先在「绑定管理」中绑定邮箱或手机号'))
      return
    }
    setSending(true)
    try {
      await window.electronAPI.sendReauthCode(verifyType === 'phone' ? 'phone_code' : 'email_code')
      setStep('code-sent')
      addToast('success', verifyType === 'phone' ? t('验证码已发送到手机') : t('验证码已发送到邮箱'))
    } catch (e) {
      addToast('error', friendlyError(e, lang))
    } finally {
      setSending(false)
    }
  }

  const handleDelete = async () => {
    if (confirmText !== accountId) {
      addToast('error', t('请输入正确的账号ID {id} 确认注销').replace('{id}', accountId))
      return
    }
    if (!code) { addToast('error', t('请输入验证码')); return }
    setDeleting(true)
    try {
      const result = await window.electronAPI.deleteAccount(code)
      addToast('success', result.cleanupPending ? t('账号已注销，云端数据正在后台清理') : t('账号和云端数据已注销'))
      setTimeout(onDeleted, 500)
    } catch (e) {
      addToast('error', friendlyError(e, lang))
    } finally {
      setDeleting(false)
    }
  }

  // 安卓本地模式：无云端账号能力 → 注销账号链路整体不可用，改为降级说明
  if (isAndroid() && !cloudAvailable) {
    return (
      <div className="max-w-2xl space-y-6">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <AlertTriangle size={20} className="text-red-600" />{t('危险操作')}</h2>
        <LocalModeCloudNotice message={t('本版本为本地模式，未接入云端账号服务，因此「注销账号」不可用。')} />
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
        <AlertTriangle size={20} className="text-red-600" />{t('危险操作')}</h2>
      <p className="text-sm text-gray-500">{t('以下操作不可逆，请谨慎操作。')}</p>

      {/* 注销账号 — Danger Zone 模式 */}
      <div className="profile-danger-card rounded-xl overflow-hidden">
        <div className="p-5">
          <div className="flex items-start gap-3">
            <Trash2 size={20} className="text-red-500 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-red-800">{t('注销账号')}</h3>
              <p className="text-xs text-red-600 mt-1">{t('注销后，您的所有账单数据、分类数据和账号信息将被永久删除且无法恢复。 请确保已导出重要数据。')}</p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {!verifyTarget ? (
              <div className="text-sm text-amber-600 p-3 bg-amber-50 rounded-lg">{t('⚠ 您尚未绑定任何邮箱或手机号，请先在「绑定管理」中添加联系方式才能注销。')}</div>
            ) : step === 'idle' ? (
              <button
                onClick={sendCode}
                disabled={sending}
                className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm disabled:opacity-50"
              >
                {sending && <Loader2 size={14} className="animate-spin" />}
                <Send size={14} />{t('发送验证码到')} {verifyType === 'phone' ? t('手机') : t('邮箱')}
              </button>
            ) : (
              <>
                <p className="text-xs text-red-700">{t('验证码将发送到：')}{verifyTarget}
                </p>

                <div>
                  <label className="text-xs text-red-700 block mb-1">{t('验证码')}</label>
                  <input
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    placeholder={t('输入收到的验证码')}
                    maxLength={6}
                    className="profile-input-danger w-full px-3 py-2 rounded-lg text-sm"
                  />
                </div>

                <div>
                  <label className="text-xs text-red-700 block mb-1">{t('输入账号ID')} <code className="font-mono text-red-700 font-bold">{accountId}</code> {t('确认注销')}</label>
                  <input
                    value={confirmText}
                    onChange={e => setConfirmText(e.target.value)}
                    placeholder={accountId || t('加载中...')}
                    className="profile-input-danger w-full px-3 py-2 rounded-lg text-sm font-mono"
                  />
                  {confirmText && confirmText !== accountId && (
                    <p className="text-xs text-red-500 mt-1">{t('账号ID 不匹配')}</p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleDelete}
                    disabled={deleting || confirmText !== accountId || !code || !accountId}
                    className="inline-flex items-center gap-2 px-6 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {deleting && <Loader2 size={14} className="animate-spin" />}{t('确认注销，删除我的账号')}</button>
                  <button
                    onClick={reset}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
                  >
                    <X size={14} />{t('取消')}</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 数据导出提示 */}
      <div className="border border-gray-200 rounded-xl p-5">
        <h4 className="text-sm font-medium text-gray-700 mb-2">{t('数据导出')}</h4>
        <p className="text-xs text-gray-500">{t('在注销账号前，建议导出您的所有数据。您可以在「设置 → 数据管理」中进行备份。')}</p>
      </div>
    </div>
  )
}
