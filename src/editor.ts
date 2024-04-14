import * as path from 'node:path'
import { hbuilderx, vscode } from './define'
import { STATUS, status, updateStatus } from './status'
import { connection } from './agent'
import { get as getNetworkProxy } from './proxy'
import { EDITOR_NAME, EDITOR_PLUGIN_NAME, VERSION } from './env'

const workspaces: Record<string, {}> = {}

async function setEditorInfo() {
  const proxy = await getNetworkProxy()
  console.log('setEditorInfo proxy: ', proxy)
  return await connection.sendRequest<'OK'>(
    'setEditorInfo',
    Object.assign(
      {
        editorInfo: {
          name: EDITOR_NAME,
          version: vscode.version,
        },
        editorPluginInfo: {
          name: EDITOR_PLUGIN_NAME,
          version: VERSION,
        },
      },
      proxy,
    ),
  )
}

let isEditorInfoChanged = false
export async function checkEditorInfo() {
  if (isEditorInfoChanged) {
    await setEditorInfo()
    isEditorInfoChanged = false
  }
}

export async function initWorkspace() {
  let workspaceFolder = '/'
  try {
    workspaceFolder = vscode.workspace.workspaceFolders![0].uri.fsPath
  } catch (e) {
    console.error(e)
  }
  // 无激活的编辑器时 HBuilderX getActiveTextEditor 既不会报错也不会返回值
  if (hbuilderx && vscode.window.activeTextEditor) {
    try {
      const editor = await hbuilderx.window.getActiveTextEditor()
      workspaceFolder = editor.document.workspaceFolder.uri.path
    } catch (e) {
      console.error(e)
    }
  }
  console.log('workspaceFolder:', workspaceFolder)
  let item = workspaces[workspaceFolder]
  if (!item) {
    await connection.sendRequest<void>('initialize', {
      rootPath: workspaceFolder,
      rootUri: workspaceFolder,
      capabilities: {},
      trace: 'off',
      processId: process.pid,
      clientInfo: {
        name: EDITOR_PLUGIN_NAME,
      },
    })
    await setEditorInfo()
    const version = await connection.sendRequest<{ version: string }>(
      'getVersion',
      {},
    )
    console.log('version: ', version)
    item = {}
    workspaces[workspaceFolder] = item
  }
  return workspaceFolder
}

export const selector: string[] = []
const selectorAll: string[] = []
export const selectorCache: Map<string, boolean> = new Map()
let inlineCompletionItemProviderDisposable: vscode.Disposable | null = null
function registerInlineCompletionItemProvider(
  subscriptions: vscode.ExtensionContext['subscriptions'],
) {
  let disposeError: Error | null = null
  if (inlineCompletionItemProviderDisposable) {
    try {
      inlineCompletionItemProviderDisposable.dispose()
      const index = subscriptions.indexOf(
        inlineCompletionItemProviderDisposable,
      )
      if (index !== -1) {
        subscriptions.splice(index, 1)
      }
    } catch (err) {
      disposeError = err as Error
      console.error(err)
    }
  }
  const config = vscode.workspace.getConfiguration()
  const ALL_SELECTOR = [
    'abap',
    'bat',
    'bibtex',
    'clojure',
    'coffeescript',
    'c',
    'cpp',
    'csharp',
    'dockercompose',
    'css',
    'cuda-cpp',
    'diff',
    'dockerfile',
    'fsharp',
    'git-commit',
    'git-rebase',
    'go',
    'groovy',
    'handlebars',
    'haml',
    'html',
    'ini',
    'java',
    'javascript',
    'javascriptreact',
    'json',
    'jsonc',
    'latex',
    'less',
    'lua',
    'makefile',
    'markdown',
    'objective-c',
    'objective-cpp',
    'perl ',
    'perl6',
    'php',
    'plaintext',
    'powershell',
    'jade',
    'pug',
    'python',
    'r',
    'razor',
    'ruby',
    'rust',
    'scss',
    'sass',
    'shaderlab',
    'shellscript',
    'slim',
    'sql',
    'stylus',
    'swift',
    'typescript',
    'typescriptreact',
    'tex',
    'vb',
    'vue',
    'vue-html',
    'xml',
    'xsl',
    'yaml',
  ]
    .concat([
      'uts',
      'nvue',
      'uvue',
      'jsona',
      'jsonl',
      'dart',
      'kotlin',
      'scala',
      'shell',
      'perl',
      'elixir',
      'erlang',
      'haskell',
      'ocaml',
      'purescript',
      'reason',
      'scheme',
    ])
    .concat([
      'txt',
      'actionscript',
      'ada',
      'asm',
      'asp',
      'autoit',
      'baanc',
      'bash',
      'batch',
      'cs',
      'cmake',
      'caml',
      'cobol',
      'd',
      'ejs',
      'fortran',
      'fortran77',
      'html_es6',
      'inno',
      'json_tm',
      'javascript_es6',
      'kix',
      'lisp',
      'matlab',
      'njs',
      'nml',
      'nsis',
      'nss',
      'objc',
      'pascal',
      'postscript',
      'rc',
      'smalltalk',
      'tcl',
      'ux',
      'vhdl',
      'verilog',
      'wxml',
    ])
  const enableSelector = config.get<string>('GithubCopilot.enable') || ''
  selector.length = 0
  selectorCache.clear()
  enableSelector.split(',').forEach(item => {
    let [key, val] = item.split('=')
    key = key && key.trim()
    val = val && val.trim()
    if (!key || !val) {
      return
    }
    if (key === 'all') {
      key = '*'
    }
    const keys = key === '*' ? ALL_SELECTOR : [key]
    if (val === 'true') {
      keys.forEach(item => {
        selector.push(item)
        selectorCache.set(key, true)
      })
    } else if (val === 'false') {
      keys.forEach(item => {
        const index = selector.indexOf(item)
        if (index !== -1) {
          selector.splice(index, 1)
        }
        selectorCache.set(key, false)
      })
    }
  })
  if (selector.length && !selectorAll.length) {
    selectorAll.push(...selector)
  }
  let selectorUse = selector
  // fix HBuilderX dispose
  if (disposeError) {
    selectorUse = []
    selector.forEach(item => {
      if (!selectorAll.includes(item)) {
        selectorUse.push(item)
        selectorAll.push(item)
      }
    })
  }
  console.log('selectorUse', selectorUse.join(','))
  if (selectorUse.length) {
    inlineCompletionItemProviderDisposable =
      vscode.languages.registerInlineCompletionItemProvider(selectorUse, {
        async provideInlineCompletionItems(document, position, context, token) {
          console.log('context.triggerKind:', context.triggerKind)
          const editor = vscode.window.activeTextEditor!
          // fix HBuilderX position
          position = editor.selection.start
          const items: vscode.InlineCompletionItem[] = []
          const config = vscode.workspace.getConfiguration()
          const enableAutoCompletions = config.get(
            'GithubCopilot.editor.enableAutoCompletions',
          )
          if (
            !(
              (enableAutoCompletions &&
                context.triggerKind ===
                  vscode.InlineCompletionTriggerKind.Automatic) ||
              context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke
            )
          ) {
            return { items }
          }
          // fix HBuilderX dispose
          if (
            status === STATUS.NotSignedIn ||
            !selector.includes(document.languageId)
          ) {
            return { items }
          }
          updateStatus(true)
          try {
            await checkEditorInfo()
            const editor = vscode.window.activeTextEditor!
            const workspaceFolder = await initWorkspace()
            const uri = document.uri.toString()
            const fileName = document.fileName
            const text = document.getText()
            const languageId = document.languageId
            type Range = {
              line: number
              character: number
            }
            const doc = {
              source: text,
              position: {
                line: position.line,
                character: position.character,
              },
              // indentSize: 4,
              // insertSpaces: true,
              // tabSize: 4,
              version: 0,
              languageId,
              uri,
              path: fileName,
              relativePath: path.relative(
                workspaceFolder.replace(
                  /^\/([A-Z]+):\/(.+)/,
                  function (_, p1, p2) {
                    return `${p1.toLowerCase()}:\\${p2.replace(/\//g, '\\')}`
                  },
                ),
                fileName,
              ),
            }
            console.log('doc: ', doc)
            const res = await connection.sendRequest<{
              completions: {
                uuid: string
                text: string
                displayText: string
                docVersion: number
                range: {
                  start: Range
                  end: Range
                }
                position: Range
              }[]
            }>('getCompletionsCycling', {
              doc,
            })
            console.log('getCompletionsCycling res: ', res)
            const completions = res.completions
            for (let index = 0; index < completions.length; index++) {
              const completion = completions[index]
              // await connection.sendRequest('notifyAccepted', {
              //   uuid: completion.uuid
              // })
              const position = completion.position
              const positionLeft = position.character
              const range = completion.range
              const start = range.start
              const end = range.end
              const completionText = completion.displayText.trimEnd()
              const codeRange = new vscode.Range(
                new vscode.Position(start.line, positionLeft),
                new vscode.Position(end.line, end.character),
              )
              items.push({
                insertText: completionText,
                range: codeRange,
              })
            }
          } catch (error) {
            console.error(error)
          }
          updateStatus(false)
          return { items }
        },
      })
    subscriptions.push(inlineCompletionItemProviderDisposable)
  }
}

export async function activate({ subscriptions }: vscode.ExtensionContext) {
  async function onDidOpenTextDocument(document: vscode.TextDocument) {
    if (status === STATUS.OK) {
      const uri = document.uri.toString()
      if (uri.startsWith('output:')) {
        return
      }
      const text = document.getText()
      const languageId = document.languageId
      connection.sendNotification('textDocument/didOpen', {
        textDocument: {
          text,
          languageId,
          uri,
          version: 0,
        },
      })
    }
  }
  subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(onDidOpenTextDocument),
  )
  subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(async function ({ document }) {
      if (status === STATUS.OK) {
        const uri = document.uri.toString()
        if (uri.startsWith('output:')) {
          return
        }
        await initWorkspace()
        const text = document.getText()

        connection.sendNotification('textDocument/didChange', {
          contentChanges: [
            {
              text,
            },
          ],
          textDocument: {
            uri,
            version: 0,
          },
        })
      }
    }),
  )
  subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async function (document) {
      if (status === STATUS.OK) {
        await initWorkspace()
        const uri = document.uri.toString()
        connection.sendNotification('textDocument/didSave', {
          textDocument: {
            uri,
          },
        })
      }
    }),
  )
  subscriptions.push(
    vscode.workspace.onDidCloseTextDocument(async function (document) {
      if (status === STATUS.OK) {
        const uri = document.uri.toString()
        if (uri.startsWith('output:')) {
          return
        }
        await initWorkspace()
        connection.sendNotification('textDocument/didClose', {
          textDocument: {
            uri,
          },
        })
      }
    }),
  )
  registerInlineCompletionItemProvider(subscriptions)
  subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(function (event) {
      if (event.affectsConfiguration('GithubCopilot.enable')) {
        registerInlineCompletionItemProvider(subscriptions)
      }
      if (
        event.affectsConfiguration('GithubCopilot.proxy.enable') ||
        event.affectsConfiguration('GithubCopilot.proxy.host') ||
        event.affectsConfiguration('GithubCopilot.proxy.user') ||
        event.affectsConfiguration('GithubCopilot.proxy.strictSSL')
      ) {
        isEditorInfoChanged = true
      }
    }),
  )
  vscode.window.visibleTextEditors.forEach(editor => {
    onDidOpenTextDocument(editor.document)
  })
}
