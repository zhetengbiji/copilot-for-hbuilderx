import { fork } from 'node:child_process'
import * as rpc from 'vscode-jsonrpc/node'
import path = require('node:path')
import vscode = require('vscode')
// @ts-ignore
let hbx: import('hbuilderx')
try {
  hbx = require('hbuilderx')
} catch (error) {
  console.warn('hbuilderx not found')
}

const isWin = process.platform === 'win32'
let statusBarItem: vscode.StatusBarItem

const child = fork(path.join(__dirname, '../dist/agent.js'), [
  // '--node-ipc', '--stdio' or '--socket={number}'
  '--stdio'
], {
  stdio: 'pipe'
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
    const [hostname, port] = host.split(':')
    if (hostname && port) {
      networkProxy.host = hostname
      networkProxy.port = Number(port)
      const user = config.get<string>('GithubCopilot.proxy.user') || ''
      const [username, password] = user.split(':')
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
      name: 'HBuilderX',
      version: vscode.version
    },
    editorPluginInfo: {
      name: 'GitHub Copilot for HBuilderX',
      version: '0.3.2'
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
        name: 'GitHub Copilot for HBuilderX'
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
      statusBarItem.tooltip = 'GitHub Copilot 加载中...'
      break
    case STATUS.warning:
      statusBarItem.text = '$(copilot-warning)' + fixString
      statusBarItem.tooltip = 'GitHub Copilot 加载出错'
      break
    case STATUS.disable:
      // Windows 拼接 Copilot 字符串
      statusBarItem.text = '$(copilot-disable)' + fixString
      statusBarItem.tooltip = 'GitHub Copilot 未启用'
      break
    case STATUS.enable:
      statusBarItem.text = '$(copilot-enable)' + fixString
      statusBarItem.tooltip = 'GitHub Copilot 已启用'
      break
  }
}

async function checkStatus() {
  updateStatus(true)
  await initWorkspace()
  if (status === STATUS.disable) {
    await checkEditorInfo()
    const res = await client.request('checkStatus', {
      // options: { localChecksOnly: true }
    })
    console.log('res: ', res)
    // {"status":"NotSignedIn"}
    // {"status":"OK","user":"zhetengbiji"}
    if (res.status === 'OK') {
      updateStatus(STATUS.enable)
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
        await (hbx ? hbx.window.showInformationMessage(message, ['好的']) : vscode.window.showInformationMessage(message, '好的'))
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

async function statusClick() {
  const message = `是否${status === STATUS.enable ? '退出' : '登录'} Copilot？`
  const res = await (hbx ? hbx.window.showInformationMessage(message, ['是', '否']) : vscode.window.showInformationMessage(message, '是', '否'))
  if (res === '是') {
    status === STATUS.enable ? signout() : signin()
  }
}

let inlineCompletionItemProviderDisposable: vscode.Disposable | null = null
function registerInlineCompletionItemProvider(subscriptions: vscode.ExtensionContext["subscriptions"]) {
  if (inlineCompletionItemProviderDisposable) {
    inlineCompletionItemProviderDisposable.dispose()
    const index = subscriptions.indexOf(inlineCompletionItemProviderDisposable)
    if (index !== -1) {
      subscriptions.splice(index, 1)
    }
  }
  const config = vscode.workspace.getConfiguration()
  const enableAutoCompletions = config.get('GithubCopilot.editor.enableAutoCompletions')
  if (!enableAutoCompletions) {
    return
  }
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
  ])
  const selector: string[] = []
  const enableSelector = config.get<string>('GithubCopilot.enable') || ''
  enableSelector.split(',').forEach((item) => {
    let [key, val] = item.split('=')
    key = key.trim()
    val = val.trim()
    if (!key || !val) {
      return
    }
    const keys = key === 'all' || key === '*' ? ALL_SELECTOR : [key]
    if (val === 'true') {
      keys.forEach((key) => {
        selector.push(key)
      })
    } else if (val === 'false') {
      keys.forEach((key) => {
        const index = selector.indexOf(key)
        if (index !== -1) {
          selector.splice(index, 1)
        }
      })
    }
  })
  inlineCompletionItemProviderDisposable = vscode.languages.registerInlineCompletionItemProvider(selector, {
    async provideInlineCompletionItems(document, position, token, context) {
      const editor = vscode.window.activeTextEditor!
      // fix position
      position = editor.selection.start
      const items: vscode.InlineCompletionItem[] = []
      if (status === STATUS.disable) {
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

async function activate({ subscriptions }: vscode.ExtensionContext) {
  const statusCommandId = 'copilot.status'
  subscriptions.push(vscode.commands.registerCommand('copilot.status', () => {
    statusClick()
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
    if (event.affectsConfiguration('GithubCopilot.enable') || event.affectsConfiguration('GithubCopilot.editor.enableAutoCompletions')) {
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
