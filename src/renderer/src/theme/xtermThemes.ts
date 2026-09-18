import type { ITheme } from '@xterm/xterm'

/** 深色：GitHub Dark Dimmed 系；浅色：GitHub Light 系。终端底色跟随 UI 主题（深色深底、浅色浅底），终端容器区恒为 --terminal-bg */
export const xtermDark: ITheme = {
  background: '#0d1117',
  foreground: '#adbac7',
  cursor: '#f78166',
  cursorAccent: '#0d1117',
  selectionBackground: 'rgba(247,129,102,.25)',
  black: '#545d68', red: '#f47067', green: '#57ab5a', yellow: '#c69026',
  blue: '#539bf5', magenta: '#b083f0', cyan: '#39c5cf', white: '#909dab',
  brightBlack: '#636e7b', brightRed: '#ff938a', brightGreen: '#7bc96f', brightYellow: '#e3b341',
  brightBlue: '#6cb6ff', brightMagenta: '#dcbdfb', brightCyan: '#56d4dd', brightWhite: '#cdd9e5'
}

export const xtermLight: ITheme = {
  background: '#fafbfc',
  foreground: '#4b5563',
  cursor: '#316dca',
  cursorAccent: '#fafbfc',
  selectionBackground: 'rgba(49,109,202,.22)',
  black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#4d2d00',
  blue: '#0550ae', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
  brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#633c01',
  brightBlue: '#0969da', brightMagenta: '#8250df', brightCyan: '#3192aa', brightWhite: '#8c959f'
}

export function xtermThemeFor(theme: 'light' | 'dark'): ITheme {
  return theme === 'dark' ? xtermDark : xtermLight
}
