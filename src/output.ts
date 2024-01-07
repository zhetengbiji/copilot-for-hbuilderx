import * as path from 'node:path'
import * as fs from 'node:fs'
import vscode = require('vscode')
// @ts-ignore
let hbx: typeof import('hbuilderx')
try {
  hbx = require('hbuilderx')
} catch (error) {
  console.warn('hbuilderx not found')
}

if (hbx) {
  vscode.window.createWebviewPanel = function (
    viewType: string,
    title: string,
    showOptions: unknown,
    options: unknown,
  ): vscode.WebviewPanel {
    const panel = hbx.window.createWebView(viewType, options)
    Object.defineProperty(panel, 'webview', {
      get() {
        return this.webView
      },
    })
    panel.reveal = function () {
      hbx.window.showView({
        viewid: viewType,
        containerid: viewType,
      })
    }
    panel.reveal()
    return panel
  }
}

export const name = 'GitHub Copilot Chat'

type Line = {
  text: string
  end: boolean
}
const lines: Array<Line> = []
let webviewPanel: vscode.WebviewPanel | null = null
let ready = false

export function append(text: string) {
  const line = lines[lines.length - 1]
  if (!line || line.end) {
    lines.push({ text: text, end: false })
  } else {
    line.text += text
  }
}

export function appendLine(text: string) {
  let line = lines[lines.length - 1]
  if (line && !line.end) {
    line.text += text
    line.end = true
  } else {
    line = {
      text: text,
      end: true,
    }
    lines.push(line)
  }
  if (ready) {
    webviewPanel?.webview.postMessage({
      command: 'appendLine',
      text: line.text,
    })
  }
}

export function replace() {
  // TODO
}

export function clear() {
  // TODO
}

export function hide() {
  // TODO
}

export function dispose() {
  // TODO
}

function initVar(htmlContent: string): string {
  if (!hbx) {
    return htmlContent
  }
  const config = hbx.workspace.getConfiguration()
  const colorScheme = (
    (config.get('editor.colorScheme') || 'Default') as
      | 'Atom One Dark'
      | 'Monokai'
      | 'Default'
  ).toLocaleLowerCase()
  const colorKey = (colorScheme.includes('dark') ? 'dark' : colorScheme) as
    | 'default'
    | 'dark'
    | 'monokai'
  const data: Record<string, Record<typeof colorKey, string>> = {
    '--vscode-editor-background': {
      default: 'rgb(255,250,232)',
      dark: 'rgb(40,44,53)',
      monokai: 'rgb(39,40,34)',
    },
    '--vscode-editor-foreground': {
      default: 'rgb(40,40,40)',
      dark: 'rgb(182,182,182)',
      monokai: 'rgb(182,182,182)',
    },
    '--vscode-input-background': {
      default: 'rgb(255,253,245)',
      dark: 'rgb(27,29,35)',
      monokai: 'rgb(83,83,83)',
    },
    '--vscode-input-border': {
      default: 'rgb(220,208,168)',
      dark: 'rgb(99,109,131)',
      monokai: 'rgb(109,109,109)',
    },
    '--vscode-input-foreground': {
      default: 'rgb(40,40,40)',
      dark: 'rgb(182,182,182)',
      monokai: 'rgb(182,182,182)',
    },
    '--vscode-input-placeholderForeground': {
      default: 'rgb(147,146,142)',
      dark: 'rgb(104,105,108)',
      monokai: 'rgb(132,132,132)',
    },
    '--vscode-inputOption-activeBorder': {
      default: 'rgb(65,168,99)',
      dark: 'rgb(81,139,254)',
      monokai: 'rgb(65,168,99)',
    },
  }

  Object.keys(data).forEach(key => {
    const obj = data[key as keyof typeof data]
    htmlContent = htmlContent.replace(
      new RegExp(`var\\(${key}\\)`, 'g'),
      obj[colorKey],
    )
  })
  return htmlContent
}

export function show() {
  if (webviewPanel) {
    webviewPanel.reveal()
    return
  }
  const htmlPath = path.join(__dirname, '../www/index.html')
  const htmlContent = initVar(fs.readFileSync(htmlPath, 'utf-8'))
  webviewPanel = vscode.window.createWebviewPanel(
    'github-copilot-chat-activitybar',
    name,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
    },
  )
  webviewPanel.onDidDispose(() => {
    webviewPanel = null
  })
  webviewPanel.webview.onDidReceiveMessage(message => {
    if (message.command === 'ready') {
      ready = true
      lines.forEach(line => {
        if (line.end) {
          webviewPanel?.webview.postMessage({
            command: 'appendLine',
            text: line.text,
          })
        }
      })
    } else if (message.command === 'input') {
      const input = message.text
      callbacks.forEach(callback => {
        callback(input)
      })
    }
  })
  webviewPanel.webview.html = htmlContent
}

type InputCallback = (input: string) => void

const callbacks: Array<InputCallback> = []

export function onInput(callback: InputCallback) {
  callbacks.push(callback)
}
