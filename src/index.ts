import { fork } from 'node:child_process'
import * as rpc from 'vscode-jsonrpc/node'
import * as path from 'node:path'
import vscode = require('vscode')
import { chat } from './chat'
import { COPILOT_NAME, EDITOR_NAME, EDITOR_PLUGIN_NAME, VERSION } from './env'

// @ts-ignore
let hbx: typeof import('hbuilderx')
try {
  hbx = require('hbuilderx')
} catch (error) {
  console.warn('hbuilderx not found')
}

if (hbx) {
  // 修复参数不一致
  vscode.window.showInformationMessage = function <T extends string>(
    message: string,
    ...items: T[]
  ): Thenable<T | undefined> {
    return hbx.window.showInformationMessage(message, items)
  }
  // 补充缺失的类型
  vscode.InlineCompletionTriggerKind = vscode.InlineCompletionTriggerKind || {
    Invoke: 0,
    Automatic: 1,
    // 撤销，仅 HBuilderX 支持
    Back: 2,
  }
}

const isWin = process.platform === 'win32'
let statusBarItem: vscode.StatusBarItem

const child = fork(
  path.join(__dirname, '../dist/agent.js'),
  [
    // '--node-ipc', '--stdio' or '--socket={number}'
    '--stdio',
  ],
  {
    stdio: 'pipe',
    execArgv: [],
  },
)

const connection = rpc.createMessageConnection(
  new rpc.StreamMessageReader(child.stdout!),
  new rpc.StreamMessageWriter(child.stdin!),
)
connection.listen()

connection.onRequest('LogMessage', params => {
  console.log('LogMessage: ', params)
})
connection.onRequest('featureFlagsNotification', params => {
  console.log('featureFlagsNotification: ', params)
})
connection.onRequest('statusNotification', params => {
  console.log('statusNotification: ', params)
})

const workspaces: Record<string, {}> = {}

// function positionToNumber(position: vscode.Position, source: string): number {
//   const lines = source.split('\n')
//   let index = 0
//   for (let i = 0; i < position.line; i++) {
//     index += lines[i].length + 1
//   }
//   index += position.character
//   return index
// }

function getNetworkProxy() {
  const config = vscode.workspace.getConfiguration()
  const enable = config.get<boolean>('GithubCopilot.proxy.enable')
  const networkProxy: {
    host?: string
    port?: number
    username?: string
    password?: string
    rejectUnauthorized?: boolean
  } = {}
  if (enable) {
    const host = config.get<string>('GithubCopilot.proxy.host') || ''
    const [_, hostname, port] =
      host.match(/(?:socks[45]?|https?)?[:：]?\/*([a-z0-9-_.]+)[:：](\d+)/i) ||
      []
    if (hostname && port) {
      networkProxy.host = hostname
      networkProxy.port = Number(port)
      const user = config.get<string>('GithubCopilot.proxy.user') || ''
      const [username, password] = user.split(/[:：]/)
      if (username && password) {
        networkProxy.username = username
        networkProxy.password = password
      }
      const strictSSL = config.get<boolean>('GithubCopilot.proxy.strictSSL')
      networkProxy.rejectUnauthorized = !!strictSSL
      return { networkProxy }
    }
  }
  return {}
}

async function setEditorInfo() {
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
      getNetworkProxy(),
    ),
  )
}

let isEditorInfoChanged = false
async function checkEditorInfo() {
  if (isEditorInfoChanged) {
    await setEditorInfo()
    isEditorInfoChanged = false
  }
}

async function initWorkspace() {
  let workspaceFolder = '/'
  try {
    workspaceFolder = vscode.workspace.workspaceFolders![0].uri.fsPath
    if (hbx) {
      const editor = await hbx.window.getActiveTextEditor()
      workspaceFolder = editor.document.workspaceFolder.uri.path
    }
  } catch (e) {
    console.error(e)
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

async function signout() {
  // TODO rejectAllPendingRequests('cancel')
  updateStatus(true)
  await checkEditorInfo()
  const res = await connection.sendRequest<SignedStatus>('signOut', {})
  if (res.status === 'NotSignedIn') {
    updateStatus(STATUS.NotSignedIn)
    updateStatus(false)
    vscode.window.showInformationMessage('已退出')
  }
}

enum STATUS {
  loading,
  warning,
  NotSignedIn,
  // 同官方 IDEA 插件暂不单独处理此状态
  NotAuthorized,
  OK,
}
let status: STATUS = STATUS.NotSignedIn
let loading: boolean = false
function updateStatus(statusOrLoading: STATUS | boolean) {
  if (typeof statusOrLoading === 'boolean') {
    loading = statusOrLoading
    statusOrLoading = statusOrLoading ? STATUS.loading : status
  } else {
    status = statusOrLoading
    if (loading) {
      statusOrLoading = STATUS.loading
    }
  }
  const config = vscode.workspace.getConfiguration()
  const statusConfig = config.get('GithubCopilot.status.show')
  // 默认 auto 用于处理部分设备 HBuilderX 首次启动不显示图标的问题
  const fixString =
    statusConfig === 'icon+text' ||
    (statusConfig === 'auto' && isWin && status === STATUS.NotSignedIn)
      ? 'Copilot'
      : ''
  switch (statusOrLoading) {
    case STATUS.loading:
      statusBarItem.text =
        (hbx ? '$(copilot-loading~spin)' : '$(loading~spin)') + fixString
      statusBarItem.tooltip = `${COPILOT_NAME} 加载中...`
      break
    case STATUS.warning:
      statusBarItem.text = '$(copilot-warning)' + fixString
      statusBarItem.tooltip = `${COPILOT_NAME} 加载出错`
      break
    case STATUS.NotSignedIn:
      // Windows 拼接 Copilot 字符串
      statusBarItem.text = '$(copilot-disable)' + fixString
      statusBarItem.tooltip = `${COPILOT_NAME} 未登录`
      break
    case STATUS.OK:
      statusBarItem.text = '$(copilot-enable)' + fixString
      statusBarItem.tooltip = `${COPILOT_NAME} 已登录`
      break
  }
}

type SignedStatus = {
  status: 'OK' | 'NotSignedIn' | 'NotAuthorized'
  user?: string
}

async function checkStatus() {
  updateStatus(true)
  await initWorkspace()
  if (status === STATUS.NotSignedIn) {
    await checkEditorInfo()
    const res = await connection.sendRequest<SignedStatus>('checkStatus', {
      // options: { localChecksOnly: true }
    })
    if (res.status === 'OK') {
      updateStatus(STATUS.OK)
    }
  }
  updateStatus(false)
}

async function signin() {
  if (status === STATUS.NotSignedIn) {
    updateStatus(true)
    // TODO rejectAllPendingRequests('cancel')
    try {
      await checkEditorInfo()
      const res = await connection.sendRequest<SignedStatus>('checkStatus', {
        // options: { localChecksOnly: true }
      })
      if (res.status !== 'OK') {
        const res = await connection.sendRequest<{
          status: 'PromptUserDeviceFlow'
          userCode: string
          verificationUri: string
          expiresIn: number
          interval: number
        }>('signInInitiate', {})
        const message = `在浏览器中打开 ${res.verificationUri} 进行登录，设备码：${res.userCode}`
        const button = '复制并打开'
        const input = await vscode.window.showInformationMessage(
          message,
          button,
        )
        if (input === button) {
          await vscode.env.clipboard.writeText(res.userCode)
          vscode.window.showInformationMessage(
            `设备码 ${res.userCode} 已复制到剪贴板`,
          )
          await vscode.env.openExternal(vscode.Uri.parse(res.verificationUri))
          const res1 = await connection.sendRequest<SignedStatus>(
            'signInConfirm',
            {
              userCode: res.userCode,
            },
          )
          if (res1.status === 'OK') {
            vscode.window.showInformationMessage('登录成功')
            updateStatus(STATUS.OK)
          } else if (res1.status === 'NotAuthorized') {
            const url = 'https://github.com/settings/copilot'
            const button = '好的'
            const res = await vscode.window.showInformationMessage(
              `你无法访问 ${COPILOT_NAME}。请访问 ${url} 进行注册。`,
              button,
            )
            if (res === button) {
              await vscode.env.openExternal(vscode.Uri.parse(url))
            }
          }
        }
      } else {
        updateStatus(STATUS.OK)
      }
    } catch (error) {
      console.error(error)
      const message = error instanceof Error ? error.message : String(error)
      if (message !== 'cancel') {
        vscode.window.showInformationMessage(message)
      }
    }
    updateStatus(false)
  }
}

function creatChatHandler(prompt?: string) {
  return function () {
    if (status === STATUS.OK) {
      chat(prompt)
    } else {
      vscode.window.showErrorMessage(`请检查 ${COPILOT_NAME} 登录状态`)
    }
  }
}

async function statusClick(
  subscriptions: vscode.ExtensionContext['subscriptions'],
) {
  if (status === STATUS.OK) {
    const config = vscode.workspace.getConfiguration()
    const enableAutoCompletions = !!selectorCache.get('*')
    const editor = vscode.window.activeTextEditor
    const languageId = editor?.document.languageId
    const languageEnableAutoCompletions = languageId
      ? selector.includes(languageId)
      : enableAutoCompletions
    const items = [
      `${COPILOT_NAME} 状态: ${
        languageEnableAutoCompletions ? '正常' : '已禁用'
      }`,
    ]
    const toggle = `${enableAutoCompletions ? '禁用' : '启用'}自动补全`
    items.push(toggle)
    const toggleLanguage = `${
      languageEnableAutoCompletions ? '禁用' : '启用'
    } ${languageId} 的自动补全`
    if (languageId) {
      items.push(toggleLanguage)
    }

    const chatStart = '开始代码聊天'
    items.push(chatStart)
    const settings = '打开设置'
    items.push(settings)
    const signout = `退出 ${COPILOT_NAME}`
    items.push(signout)
    const res = await vscode.window.showQuickPick(items)
    if (res !== signout) {
      if (res === toggle || res === toggleLanguage) {
        if (res === toggleLanguage) {
          selectorCache.delete(languageId!)
          selectorCache.set(languageId!, !languageEnableAutoCompletions)
        } else {
          selectorCache.set('*', !enableAutoCompletions)
        }
        const selectorArray: Array<string> = []
        for (const [key, val] of selectorCache) {
          selectorArray.push(`${key}=${val}`)
        }
        const selectorString = selectorArray.join(',')
        await config.update(
          'GithubCopilot.enable',
          selectorString,
          vscode.ConfigurationTarget.Global,
        )
        // if (hbx) {
        //   registerInlineCompletionItemProvider(subscriptions)
        // }
      } else if (res === chatStart) {
        creatChatHandler()()
      } else if (res === settings) {
        if (hbx) {
          hbx.workspace.gotoConfiguration(
            'GithubCopilot.editor.enableAutoCompletions',
          )
        } else {
          vscode.commands.executeCommand(
            'workbench.action.openSettings',
            'GithubCopilot',
          )
        }
      }
      return
    }
  }
  const message = `是否${
    status === STATUS.OK ? '退出' : '登录'
  } ${COPILOT_NAME}？`
  const res = await vscode.window.showInformationMessage(message, '是', '否')
  if (res === '是') {
    status === STATUS.OK ? signout() : signin()
  }
}

const selector: string[] = []
const selectorAll: string[] = []
const selectorCache: Map<string, boolean> = new Map()
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
              const completionText = completion.text.trimEnd()
              const codeRange = new vscode.Range(
                new vscode.Position(start.line, positionLeft),
                new vscode.Position(end.line, end.character),
              )
              items.push({
                insertText: completionText.substring(positionLeft),
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

async function activate({ subscriptions }: vscode.ExtensionContext) {
  subscriptions.push(
    vscode.commands.registerCommand('copilot.chat.start', creatChatHandler()),
  )
  subscriptions.push(
    vscode.commands.registerCommand(
      'copilot.chat.explain',
      creatChatHandler('对此进行解释'),
    ),
  )
  subscriptions.push(
    vscode.commands.registerCommand(
      'copilot.chat.fix',
      creatChatHandler('修复此'),
    ),
  )
  subscriptions.push(
    vscode.commands.registerCommand(
      'copilot.chat.generateDocs',
      creatChatHandler('生成文档'),
    ),
  )
  subscriptions.push(
    vscode.commands.registerCommand(
      'copilot.chat.generateTests',
      creatChatHandler('生成测试'),
    ),
  )
  const statusCommandId = 'copilot.status'
  subscriptions.push(
    vscode.commands.registerCommand(statusCommandId, () => {
      statusClick(subscriptions)
    }),
  )
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  )
  statusBarItem.command = statusCommandId
  updateStatus(status)
  subscriptions.push(statusBarItem)
  statusBarItem.show()
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
      if (event.affectsConfiguration('GithubCopilot.status.show')) {
        updateStatus(status)
      }
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
  await checkStatus()
  vscode.window.visibleTextEditors.forEach(editor => {
    onDidOpenTextDocument(editor.document)
  })
}

function deactivate() {
  // TODO HBuilderX 卸载不会触发 deactivate
}

module.exports = {
  activate,
  deactivate,
}
