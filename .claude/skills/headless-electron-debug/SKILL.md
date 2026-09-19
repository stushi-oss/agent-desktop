---
name: headless-electron-debug
description: Use when debugging Electron app UI layout, spacing, theming, or visual density issues without macOS screen-control access. Triggers when console.log / DOM-reading / user-screenshot feedback loop is too slow, when an element looks misaligned/miscolored/wrong-sized, when xterm/canvas/three.js rendering looks off, or when the agent suspects CSS/layout/box-model geometry bugs in a renderer that only a human with a running window can see otherwise.
---

# Headless Electron Debug

## Overview

When the agent cannot see the desktop and the user cannot keep screenshotting, drive the Electron main process to **capture pixels** (`webContents.capturePage`) and **dump live DOM geometry** (`webContents.executeJavaScript`) back over stdout / PNG. Replaces the user-screenshot loop with a self-service debug channel.

**Core principle:** the debug code is **temporary instrumentation** — added to `whenReady`, used for one diagnosis, then deleted in the same commit.

## When to Use

Use this pattern when:
- UI bug involves CSS layout, box-model, theme seams (light/dark panels meeting each other), flex/grid computations, or DOM-classed xterm/canvas/three.js rendering
- User reports "spacing off" / "color wrong" / "black bars" / "panel leaks into another" / "element looks wrong" and you don't trust their screenshot alone
- You need actual pixel data OR a dump of `.xterm-screen`, `.terminal-area`, etc. computed geometry — `getBoundingClientRect()` + `getComputedStyle()` are the right tools
- You're tempted to spend 3+ rounds guessing from textual descriptions

**Do NOT use** when:
- The bug is in the main process (IPC, fs, child_process) — `console.log` is enough
- The user can run DevTools and read DOM for you — ask them to paste
- It's a logic bug (wrong filter, wrong state) — fix the code, no GUI debug needed

## Core Pattern

### 1. Add instrumentation to `src/main/index.ts` `whenReady` callback

Inject **immediately after the existing app assembly**, before `createWindow()` so the captures land after first paint:

```ts
// ==== 临时调试（定位后必删） ====
{
  const capture = async (tag: string): Promise<void> => {
    const w = mainWindow
    if (!w || w.isDestroyed()) return
    try {
      const img = await w.webContents.capturePage()
      const p = join(app.getPath('userData'), `debug-shot-${tag}.png`)
      writeFileSync(p, img.toPNG())
      console.log(`[debug] screenshot saved: ${p}`)
    } catch (e) { console.error('[debug] capture failed', e) }
  }
  const dumpDom = async (tag: string, selector: string): Promise<void> => {
    const w = mainWindow
    if (!w || w.isDestroyed()) return
    void w.webContents
      .executeJavaScript(`(() => {
        const root = document.querySelector(${JSON.stringify(selector)})
        if (!root) return 'NOT FOUND: ' + ${JSON.stringify(selector)}
        const lines = []
        const walk = (el, depth) => {
          const r = el.getBoundingClientRect()
          const cs = getComputedStyle(el)
          lines.push('  '.repeat(depth) + '<' + el.tagName.toLowerCase() +
            (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '') + '>' +
            ' rect=' + Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) +
            ' bg=' + cs.backgroundColor)
          if (depth < 6) for (const c of el.children) walk(c, depth + 1)
        }
        walk(root, 0)
        return lines.join('\\n')
      })()`)
      .then((out: string) => console.log('[debug-dom-' + tag + ']\n' + out))
      .catch((e: unknown) => console.error('[debug-dom] failed', e))
  }
  setTimeout(() => void capture('2s'), 2000)
  setTimeout(() => void capture('8s'), 8000)
  setTimeout(() => void dumpDom('subtree', '.terminal-area'), 8500)
}
```

Add to imports:

```ts
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
```

### 2. Watch the dev log + read the PNG

```bash
# In Claude's terminal:
npm run dev > /tmp/dev.log 2>&1 &
sleep 12
grep "debug" /tmp/dev.log
# Then read the image:
# Read tool on ~/Library/Application Support/<app>/debug-shot-8s.png
```

The PNG is at `app.getPath('userData')` — on macOS that's `~/Library/Application Support/<productName>/`. **Use the Read tool on the absolute path; Claude Code displays PNG inline.**

### 3. Clean-up contract (mandatory)

After diagnosis:

1. Remove the entire `==== 临时调试 ====` block
2. Remove `writeFileSync` from the `node:fs` import if no other use remains
3. Remove leftover `debug-shot-*.png` files
4. Verify `npm run typecheck` still passes
5. **The fix commit must include the deletion** — debug code + fix must land in the same commit (or paired commits)

Never commit debug instrumentation alone.

## Common Mistakes

| Mistake | Fix |
|--------|-----|
| `executeJavaScript` script errored — "Cannot find name 'as HTMLElement'" | Strip TS-only assertions from the evaluated JS. `executeJavaScript` runs in renderer context; use `(el).style.background` directly, not `(el as HTMLElement).style.background`. |
| Screenshot looks identical across 2s/4s/8s | Layout is static (or nothing changed since main reload). The DOM dump will still tell you the geometry. |
| `webContents.capturePage` returns blank/transparent | Window may not be painted yet. Schedule via `setTimeout` after a delay or after `did-finish-load`. |
| `document.querySelector` returns null | Element may render only after `hydrate()` roundtrip — increase the delay or dump after `app:tasks:changed` push. |
| Debug code lands in a commit by itself | Embed the fix and the deletion in the same commit, OR pair them as two consecutive commits. Debug-only commits pollute history and have no production value. |

## Reusable Templates

### "What color is X?" — single-element style dump

```ts
w.webContents.executeJavaScript(`(() => {
  const el = document.querySelector('.your-selector')
  if (!el) return 'NOT FOUND'
  const cs = getComputedStyle(el)
  return JSON.stringify({
    background: cs.backgroundColor,
    color: cs.color,
    border: cs.borderTopWidth + ' ' + cs.borderTopColor,
    padding: cs.padding,
    margin: cs.margin,
    rect: el.getBoundingClientRect()
  }, null, 2)
})()`)
```

### "Why is X misaligned?" — ancestors + self geometry

Use the `walk()` function above with a low depth limit (3-4). Gives you the chain of containers that contributed to the final position.

### "What does xterm actually have?" — special case for xterm 6

xterm 6 uses a DOM renderer that puts canvas-like content in `.xterm-screen > div.xterm-rows > div` (one div per row). The `background-color` on `.xterm-scrollable-element` is what dominates visual color — check that first. The canvas itself is sized to fit its `viewport`, so `getBoundingClientRect()` on it gives the visible glyph area.

## Implementation reference

```ts
import { writeFileSync } from 'node:fs'
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

declare const mainWindow: BrowserWindow | null

async function capture(tag: string): Promise<void> {
  const w = mainWindow
  if (!w || w.isDestroyed()) return
  const img = await w.webContents.capturePage()
  const p = join(app.getPath('userData'), `debug-shot-${tag}.png`)
  writeFileSync(p, img.toPNG())
  console.log(`[debug] saved ${p}`)
}
```

For test-friendly variants, `executeJavaScript` returning a string is more reliable than trying to serialize objects — the main-process side prints the result.

## Real-World Impact

- Turned a "user keeps saying black bars, I keep guessing" loop into one round: PNG + DOM dump → root cause (`terminal-area` had `background: var(--terminal-bg)` while xterm-dom-renderer painted its own `#fafbfc` — fix: `background: transparent` on `.terminal-area`)
- Caught a HMR-cache bug where `useModeStore((s) => s.effective)` looked correct but the value was the literal `'light'` string from a deleted hook (DOM dump showed `themeMode="light"` overriding the runtime theme)
- Confirmed drag-region breakage where `> *` selector missed grandchild `.tab` elements (capture showed intact terminal area + DOM dump showed which ancestors were no-drag)
