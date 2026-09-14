/**
 * AuthGuard 平台分支门禁（P2-5 / RL-A5）。
 *
 * 安卓首版是纯本地单机 → 不得出现登录页；桌面分支必须**逐位不变**（`if (!user) return <LoginPage />`）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AuthGuard } from './AuthGuard'
import { useStore } from '@/store'
import { ANDROID_PLATFORM_CLASS } from '@/platform'

// 隔离 Login 页：本用例只关心「是否渲染登录页」，不关心登录页内部实现
vi.mock('@/pages/Login', () => ({ LoginPage: () => <div data-testid="login-page" /> }))

const setAndroid = (on: boolean) => {
  document.documentElement.classList.toggle(ANDROID_PLATFORM_CLASS, on)
}

describe('AuthGuard 平台分支', () => {
  beforeEach(() => {
    setAndroid(false)
    useStore.setState({ user: null, isCheckingSession: false })
  })
  afterEach(() => setAndroid(false))

  it('桌面 + 未登录 → 渲染登录页（原逻辑不变）', () => {
    render(<AuthGuard><div data-testid="app-content" /></AuthGuard>)
    expect(screen.getByTestId('login-page')).toBeInTheDocument()
    expect(screen.queryByTestId('app-content')).not.toBeInTheDocument()
  })

  it('安卓 + 未登录 → 直接渲染 children，不出现登录页', () => {
    setAndroid(true)
    render(<AuthGuard><div data-testid="app-content" /></AuthGuard>)
    expect(screen.getByTestId('app-content')).toBeInTheDocument()
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
  })

  it('两端在会话判定中都会显示加载态（不因平台差异跳过）', () => {
    useStore.setState({ user: null, isCheckingSession: true })
    setAndroid(true)
    render(<AuthGuard><div data-testid="app-content" /></AuthGuard>)
    expect(screen.getByText('加载中...')).toBeInTheDocument()
    expect(screen.queryByTestId('app-content')).not.toBeInTheDocument()
  })

  it('桌面 + 已登录 → 渲染 children', () => {
    useStore.setState({ user: { uid: 'u1', email: 'u1@example.com', emailVerified: true }, isCheckingSession: false })
    render(<AuthGuard><div data-testid="app-content" /></AuthGuard>)
    expect(screen.getByTestId('app-content')).toBeInTheDocument()
  })
})
