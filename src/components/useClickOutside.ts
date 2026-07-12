import { useEffect, useRef, type RefObject } from 'react'

/**
 * 点击元素外部时触发回调的 hook
 * @param handler - 点击外部时的回调
 * @param enabled - 是否启用监听（下拉关闭后自动停止）
 * @returns ref — 绑定到需要监听外部点击的元素
 */
export function useClickOutside<T extends HTMLElement>(
  handler: () => void,
  enabled: boolean = true
): RefObject<T> {
  const ref = useRef<T>(null)

  useEffect(() => {
    if (!enabled) return

    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        handler()
      }
    }

    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [handler, enabled])

  return ref
}
