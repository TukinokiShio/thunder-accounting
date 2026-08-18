import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('index shell splash transition', () => {
  it('removes the ready splash from layout flow while revealing the app root', () => {
    const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    const styleText = indexHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1]

    expect(styleText).toBeTruthy()

    document.head.innerHTML = `<style>${styleText}</style>`
    document.body.className = 'ready'
    document.body.innerHTML = '<div id="splash"></div><div id="root"></div>'

    const splash = document.getElementById('splash')
    const root = document.getElementById('root')

    expect(splash).not.toBeNull()
    expect(root).not.toBeNull()
    expect(getComputedStyle(splash as HTMLElement).position).toBe('absolute')
    expect(getComputedStyle(splash as HTMLElement).pointerEvents).toBe('none')
    expect(getComputedStyle(root as HTMLElement).display).toBe('block')
  })
})
