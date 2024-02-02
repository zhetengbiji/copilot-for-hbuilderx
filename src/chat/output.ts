import * as fs from 'node:fs'
import { vscode, hbuilderx } from '../define'
import { CSS_DARK_PATH, CSS_PATH, HTML_PATH } from '../env'

export const name = 'GitHub Copilot Chat'

type Line = {
  text: string
  end: boolean
}
const lines: Array<Line> = []
let webviewPanel: vscode.WebviewPanel | null = null
let ready = false

function createLine(): Line {
  return {
    text: '',
    end: false,
  }
}

export function append(text: string) {
  let line = lines[lines.length - 1]
  if (!line || line.end) {
    line = createLine()
    lines.push(line)
  }
  line.text += text
  if (ready) {
    webviewPanel?.webview.postMessage({
      command: 'append',
      text: text,
    })
  }
}

export function appendLine(text: string) {
  let line = lines[lines.length - 1]
  if (!line || line.end) {
    line = createLine()
    lines.push(line)
  }
  line.text += text
  line.end = true
  if (ready) {
    webviewPanel?.webview.postMessage({
      command: 'appendLine',
      text: text,
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

function getColorScheme() {
  const config = vscode.workspace.getConfiguration()
  const colorScheme = (
    (config.get('editor.colorScheme') || 'Default') as
      | 'Atom One Dark'
      | 'Monokai'
      | 'Default'
  ).toLocaleLowerCase()
  return colorScheme
}

function initVar(htmlContent: string): string {
  if (!hbuilderx) {
    return htmlContent
  }
  const colorScheme = getColorScheme()
  const colorKey = (colorScheme.includes('dark') ? 'dark' : colorScheme) as
    | 'default'
    | 'dark'
    | 'monokai'
  const data: Record<string, Record<typeof colorKey, string>> = {
    '--vscode-background': {
      default: 'rgb(255,250,232)',
      dark: 'rgb(33,37,43)',
      monokai: 'rgb(39,40,34)',
    },
    '--vscode-foreground': {
      default: 'rgb(70,67,60)',
      dark: 'rgb(179,188,204)',
      monokai: 'rgb(227,227,227)',
    },
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

function injectCSS(htmlContent: string) {
  const colorScheme = getColorScheme()
  const cssPath = colorScheme === 'default' ? CSS_PATH : CSS_DARK_PATH
  const cssContent = fs.readFileSync(cssPath, 'utf-8')
  htmlContent = htmlContent.replace(
    '<style>',
    `<style>${cssContent}</style><style>`,
  )
  return htmlContent
}

function fixIndent(code: string, indent: string): string {
  return code
    .split('\n')
    .map((line, index) => `${index ? indent : ''}${line}`)
    .join('\n')
}

export function show() {
  if (webviewPanel) {
    webviewPanel.reveal()
    return
  }

  const htmlContent = injectCSS(initVar(fs.readFileSync(HTML_PATH, 'utf-8')))
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
  webviewPanel.webview.onDidReceiveMessage(async message => {
    switch (message.command) {
      case 'ready':
        ready = true
        lines.forEach(line => {
          webviewPanel?.webview.postMessage({
            command: line.end ? 'appendLine' : 'append',
            text: line.text,
          })
        })
        break
      case 'input':
        callbacks.forEach(callback => {
          callback(message.text)
        })
        break
      case 'copy':
        vscode.env.clipboard.writeText(message.text)
        break
      case 'insert': {
        // vscode 接口在 HBuilderX 兼容有问题
        // const editor = vscode.window.activeTextEditor
        const editor = await hbuilderx.window.getActiveTextEditor()
        // @ts-ignore editBuilder type
        editor?.edit(editBuilder => {
          const line = editor.document
            .getText({
              start: 0,
              end: editor.selection.start,
            })
            .split('\n')
          const space = line[line.length - 1].match(/^\s*/)![0]
          const text = fixIndent(message.text, space)
          editBuilder.replace(editor.selection, text)
        })
        break
      }
    }
  })
  webviewPanel.webview.html = htmlContent
}

type InputCallback = (input: string) => void

const callbacks: Array<InputCallback> = []

export function onInput(callback: InputCallback) {
  callbacks.push(callback)
}
