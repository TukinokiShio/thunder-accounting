/**
 * 门禁共用小工具（轮询等待 / sleep）。
 * 独立成文件是为了让驱动器只关注断言本身。
 */
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 轮询等待条件成立；超时返回 null（不抛错，由调用方判 FAIL 并给出可读证据） */
export async function waitFor<T>(probe: () => T | null | undefined, timeoutMs: number, stepMs = 50): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = probe()
    if (v) return v
    if (Date.now() > deadline) return null
    await sleep(stepMs)
  }
}
