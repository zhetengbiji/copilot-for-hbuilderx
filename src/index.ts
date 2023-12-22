import { fork } from 'node:child_process'
import * as rpc from 'vscode-jsonrpc/node'
import * as path from 'node:path'
import vscode = require('vscode')
import { chat } from './chat'
import { COPILOT_NAME, EDITOR_NAME, EDITOR_PLUGIN_NAME, VERSION, setUser } from './env'

// @ts-ignore
let hbx: import('hbuilderx')
try {
  hbx = require('hbuilderx')
} catch (error) {
  console.warn('hbuilderx not found')
}

if (hbx) {
  // 修复参数不一致
  vscode.window.showInformationMessage = function <T extends string>(message: string, ...items: T[]): Thenable<T | undefined> {
    return hbx.window.showInformationMessage(message, items)
  }
  // 补充缺失的类型
  vscode.InlineCompletionTriggerKind = vscode.InlineCompletionTriggerKind || {
    Invoke: 0,
    Automatic: 1,
    // 撤销，仅 HBuilderX 支持
    Back: 2
  }
}

const isWin = process.platform === 'win32'
let statusBarItem: vscode.StatusBarItem

const child = fork(path.join(__dirname, '../dist/agent.js'), [
  // '--node-ipc', '--stdio' or '--socket={number}'
  '--stdio'
], {
  stdio: 'pipe',
  execArgv: []
})

let connection = rpc.createMessageConnection(new rpc.StreamMessageReader(child.stdout!), new rpc.StreamMessageWriter(child.stdin!))
connection.listen()

const client = {
  request(method: string, params: any) {
    console.log('request: ', method, params)
    return connection.sendRequest<any>(method, params)
  },
  rejectAllPendingRequests(message: string) {

  },
  notify(method: string, params: any) {
    // console.log('notify: ', method, params)
    connection.sendNotification(method, params)
  }
}

const server = {
  addMethod(method: string, callback: (...params: any[]) => void) {
    connection.onRequest(method, callback)
  }
}
server.addMethod('LogMessage', (params) => {
  console.log('LogMessage: ', params)
})
server.addMethod('featureFlagsNotification', (params) => {
  console.log('featureFlagsNotification: ', params)
})
server.addMethod('statusNotification', (params) => {
  console.log('statusNotification: ', params)
})

// child.stdout!.on('data', (data) => {
//   console.log('stdout: ', data.toString())
// })

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
    host?: string,
    port?: number,
    username?: string,
    password?: string,
    rejectUnauthorized?: boolean,
  } = {}
  if (enable) {
    const host = config.get<string>('GithubCopilot.proxy.host') || ''
    const [_, hostname, port] = host.match(/(?:socks[45]?|https?)?[:：]?\/*([a-z0-9-_.]+)[:：](\d+)/i) || []
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
  return await client.request('setEditorInfo', Object.assign({
    editorInfo: {
      name: EDITOR_NAME,
      version: vscode.version
    },
    editorPluginInfo: {
      name: EDITOR_PLUGIN_NAME,
      version: VERSION
    }
  }, getNetworkProxy()))
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
  } catch {

  }
  console.log('workspaceFolder:', workspaceFolder)
  let item = workspaces[workspaceFolder]
  if (!item) {
    await client.request('initialize', {
      rootPath: workspaceFolder,
      rootUri: workspaceFolder,
      capabilities: {},
      trace: 'off',
      processId: process.pid,
      clientInfo: {
        name: EDITOR_PLUGIN_NAME
      }
    })
    const res = await setEditorInfo()
    console.log('res: ', res)
    const version = await client.request('getVersion', {})
    console.log('version: ', version)
    item = {}
    workspaces[workspaceFolder] = item
  }
  return workspaceFolder
}

async function signout() {
  client.rejectAllPendingRequests('cancel')
  updateStatus(true)
  await checkEditorInfo()
  await client.request('signOut', {})
  updateStatus(STATUS.disable)
  updateStatus(false)
  vscode.window.showInformationMessage('已退出')
}

enum STATUS {
  loading,
  warning,
  disable,
  enable,
}
let status: STATUS = STATUS.disable
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
  const fixString = (statusConfig === 'icon+text' || (statusConfig !== 'icon' && isWin)) ? 'Copilot' : ''
  switch (statusOrLoading) {
    case STATUS.loading:
      statusBarItem.text = (hbx ? '$(copilot-loading~spin)' : '$(loading~spin)') + fixString
      statusBarItem.tooltip = `${COPILOT_NAME} 加载中...`
      break
    case STATUS.warning:
      statusBarItem.text = '$(copilot-warning)' + fixString
      statusBarItem.tooltip = `${COPILOT_NAME} 加载出错`
      break
    case STATUS.disable:
      // Windows 拼接 Copilot 字符串
      statusBarItem.text = '$(copilot-disable)' + fixString
      statusBarItem.tooltip = `${COPILOT_NAME} 未登录`
      break
    case STATUS.enable:
      statusBarItem.text = '$(copilot-enable)' + fixString
      statusBarItem.tooltip = `${COPILOT_NAME} 已登录`
      break
  }
}

async function checkStatus() {
  updateStatus(true)
  await initWorkspace()
  if (status === STATUS.disable) {
    await checkEditorInfo()
    const res: { status: string, user?: string } = await client.request('checkStatus', {
      // options: { localChecksOnly: true }
    })
    console.log('res: ', res)
    // {"status":"NotSignedIn"}
    // {"status":"OK","user":"zhetengbiji"}
    if (res.status === 'OK') {
      updateStatus(STATUS.enable)
      setUser(res.user!)
    }
  }
  updateStatus(false)
}

async function signin() {
  if (status === STATUS.disable) {
    updateStatus(true)
    client.rejectAllPendingRequests('cancel')
    try {
      await checkEditorInfo()
      const res = await client.request('checkStatus', {
        // options: { localChecksOnly: true }
      })
      // {"status":"NotSignedIn"}
      // {"status":"OK","user":"zhetengbiji"}
      if (res.status === 'NotSignedIn') {
        const res = await client.request('signInInitiate', {

        })
        // {"status":"PromptUserDeviceFlow","userCode":"XXXX-XXXX","verificationUri":"https://github.com/login/device","expiresIn":899,"interval":5}
        const message = `在浏览器中打开 ${res.verificationUri} 进行登录`
        await vscode.window.showInformationMessage(message, '好的')
        await vscode.env.openExternal(vscode.Uri.parse(res.verificationUri))
        await vscode.env.clipboard.writeText(res.userCode)
        vscode.window.showInformationMessage(`验证码 ${res.userCode} 已复制到剪贴板`)
        await client.request('signInConfirm', {
          userCode: res.userCode
        })
        vscode.window.showInformationMessage('登录成功')
        updateStatus(STATUS.enable)
      } else {
        updateStatus(STATUS.enable)
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

async function statusClick(subscriptions: vscode.ExtensionContext["subscriptions"]) {
  if (status === STATUS.enable) {
    const config = vscode.workspace.getConfiguration()
    const enableAutoCompletions = !!selectorCache.get('*')
    const editor = vscode.window.activeTextEditor
    const languageId = editor?.document.languageId
    const languageEnableAutoCompletions = languageId ? (selector.includes(languageId)) : enableAutoCompletions
    const items = [`${COPILOT_NAME} 状态: ${languageEnableAutoCompletions ? '正常' : '已禁用'}`]
    const toggle = `${enableAutoCompletions ? '禁用' : '启用'}自动补全`
    items.push(toggle)
    const toggleLanguage = `${languageEnableAutoCompletions ? '禁用' : '启用'} ${languageId} 的自动补全`
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
        await config.update('GithubCopilot.enable', selectorString, vscode.ConfigurationTarget.Global)
        // if (hbx) {
        //   registerInlineCompletionItemProvider(subscriptions)
        // }
      } else if (res === chatStart) {
        chat()
      } else if (res === settings) {
        if (hbx) {
          hbx.workspace.gotoConfiguration('GithubCopilot.editor.enableAutoCompletions')
        } else {
          vscode.commands.executeCommand('workbench.action.openSettings', 'GithubCopilot')
        }
      }
      return
    }
  }
  const message = `是否${status === STATUS.enable ? '退出' : '登录'} ${COPILOT_NAME}？`
  const res = await vscode.window.showInformationMessage(message, '是', '否')
  if (res === '是') {
    status === STATUS.enable ? signout() : signin()
  }
}

const selector: string[] = []
const selectorAll: string[] = []
const selectorCache: Map<string, boolean> = new Map()
let inlineCompletionItemProviderDisposable: vscode.Disposable | null = null
function registerInlineCompletionItemProvider(subscriptions: vscode.ExtensionContext["subscriptions"]) {
  let disposeError: Error | null = null
  if (inlineCompletionItemProviderDisposable) {
    try {
      inlineCompletionItemProviderDisposable.dispose()
      const index = subscriptions.indexOf(inlineCompletionItemProviderDisposable)
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
  ].concat([
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
    'scheme'
  ]).concat([
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
    'wxml'
  ])
  const enableSelector = config.get<string>('GithubCopilot.enable') || ''
  selector.length = 0
  selectorCache.clear()
  enableSelector.split(',').forEach((item) => {
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
      keys.forEach((item) => {
        selector.push(item)
        selectorCache.set(key, true)
      })
    } else if (val === 'false') {
      keys.forEach((item) => {
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
    inlineCompletionItemProviderDisposable = vscode.languages.registerInlineCompletionItemProvider(selectorUse, {
      async provideInlineCompletionItems(document, position, context, token) {
        console.log('context.triggerKind:', context.triggerKind)
        const editor = vscode.window.activeTextEditor!
        // fix HBuilderX position
        position = editor.selection.start
        const items: vscode.InlineCompletionItem[] = []
        const config = vscode.workspace.getConfiguration()
        const enableAutoCompletions = config.get('GithubCopilot.editor.enableAutoCompletions')
        if (!((enableAutoCompletions && context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) || context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke)) {
          return { items }
        }
        // fix HBuilderX dispose
        if (status === STATUS.disable || !selector.includes(document.languageId)) {
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
          const res = await client.request('getCompletionsCycling', {
            doc: {
              source: text,
              position: {
                line: position.line,
                character: position.character
              },
              // indentSize: 4,
              // insertSpaces: true,
              // tabSize: 4,
              version: 0,
              languageId,
              uri: fileName,
              path: fileName,
              relativePath: path.relative(workspaceFolder, fileName)
            }
          })
          console.log('res: ', res)
          const completions = res.completions
          for (let index = 0; index < completions.length; index++) {
            const completion = completions[index]
            // await client.request('notifyAccepted', {
            //   uuid: completion.uuid
            // })
            console.log('completion: ', completion)
            const position = completion.position
            const positionLeft = position.character
            const range = completion.range
            const start = range.start
            const end = range.end
            const completionText = completion.text.trimEnd()
            let codeRange = new vscode.Range(new vscode.Position(start.line, positionLeft), new vscode.Position(end.line, end.character))
            items.push({
              insertText: completionText.substring(positionLeft),
              range: codeRange
            })
          }
        } catch (error) {
          console.error(error)
        }
        updateStatus(false)
        console.log('items: ', items.length)
        return { items }
      }
    })
    subscriptions.push(inlineCompletionItemProviderDisposable)
  }
}

async function activate({ subscriptions }: vscode.ExtensionContext) {
  function creatChatHandler(prompt?: string) {
    return function () {
      if (status === STATUS.enable) {
        chat(prompt)
      }
    }
  }
  subscriptions.push(vscode.commands.registerCommand('copilot.chat.start', creatChatHandler()))
  subscriptions.push(vscode.commands.registerCommand('copilot.chat.explain', creatChatHandler('对此进行解释')))
  subscriptions.push(vscode.commands.registerCommand('copilot.chat.fix', creatChatHandler('修复此')))
  subscriptions.push(vscode.commands.registerCommand('copilot.chat.generateDocs', creatChatHandler('生成文档')))
  subscriptions.push(vscode.commands.registerCommand('copilot.chat.generateTests', creatChatHandler('生成测试')))
  const statusCommandId = 'copilot.status'
  subscriptions.push(vscode.commands.registerCommand(statusCommandId, () => {
    statusClick(subscriptions)
  }))
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  statusBarItem.command = statusCommandId
  updateStatus(status)
  subscriptions.push(statusBarItem)
  statusBarItem.show()
  async function onDidOpenTextDocument(document: vscode.TextDocument) {
    if (status === STATUS.enable) {
      await initWorkspace()
      const uri = document.uri.toString()
      const text = document.getText()
      const languageId = document.languageId
      client.notify('textDocument/didOpen', {
        textDocument: {
          text,
          languageId,
          uri,
          version: 0
        }
      })
    }
  }
  subscriptions.push(vscode.workspace.onDidOpenTextDocument(onDidOpenTextDocument))
  subscriptions.push(vscode.workspace.onDidChangeTextDocument(async function ({ document }) {
    if (status === STATUS.enable) {
      await initWorkspace()
      const uri = document.uri.toString()
      const text = document.getText()

      client.notify('textDocument/didChange', {
        contentChanges: [{
          text,
        }],
        textDocument: {
          uri,
          version: 0
        }
      })
    }
  }))
  subscriptions.push(vscode.workspace.onDidSaveTextDocument(async function (document) {
    if (status === STATUS.enable) {
      await initWorkspace()
      const uri = document.uri.toString()
      client.notify('textDocument/didSave', {
        textDocument: {
          uri
        }
      })
    }
  }))
  subscriptions.push(vscode.workspace.onDidCloseTextDocument(async function (document) {
    if (status === STATUS.enable) {
      await initWorkspace()
      const uri = document.uri.toString()
      client.notify('textDocument/didClose', {
        textDocument: {
          uri
        }
      })
    }
  }))
  registerInlineCompletionItemProvider(subscriptions)
  subscriptions.push(vscode.workspace.onDidChangeConfiguration(function (event) {
    if (event.affectsConfiguration('GithubCopilot.status.show')) {
      updateStatus(status)
    }
    if (event.affectsConfiguration('GithubCopilot.enable')) {
      registerInlineCompletionItemProvider(subscriptions)
    }
    if (event.affectsConfiguration('GithubCopilot.proxy.enable') || event.affectsConfiguration('GithubCopilot.proxy.host') || event.affectsConfiguration('GithubCopilot.proxy.user') || event.affectsConfiguration('GithubCopilot.proxy.strictSSL')) {
      isEditorInfoChanged = true
    }
  }))
  await checkStatus()
  vscode.window.visibleTextEditors.forEach(editor => {
    onDidOpenTextDocument(editor.document)
  })
}

function deactivate() { }

module.exports = {
  activate,
  deactivate
}
