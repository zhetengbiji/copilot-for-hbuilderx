import { fork } from 'node:child_process'
// import { JSONRPCClient, JSONRPCServer } from 'json-rpc-2.0'
import * as rpc from 'vscode-jsonrpc/node'
import path = require('node:path')
import * as vscode from 'vscode'
// @ts-ignore
let hbx: import('hbuilderx')
try {
  hbx = require('hbuilderx')
} catch (error) {
  console.warn('hbuilderx not found')
}

const TIMEOUT = 1e3 * 60

let statusBarItem: vscode.StatusBarItem

const child = fork(path.join(__dirname, '../dist/agent.js'), [
  // '--node-ipc', '--stdio' or '--socket={number}'
  '--stdio'
], {
  stdio: 'pipe'
})
const logger = {
  log(message: string) {
    console.log(message)
  },
  error(message: string) {
    console.error(message)
  },
  warn(message: string) {
    console.warn(message)
  },
  info(message: string) {
    console.info(message)
  }
}
let connection = rpc.createMessageConnection(new rpc.StreamMessageReader(child.stdout!), new rpc.StreamMessageWriter(child.stdin!), logger)
connection.listen()
// connection.inspect()
// const client = new JSONRPCClient((jsonRPCRequest) => {
//   console.log(jsonRPCRequest)
//   const json = Buffer.from(JSON.stringify(jsonRPCRequest), 'utf8')
//   const length = json.length
//   const header = `Content-Length: ${length}\r\n\r\n`
//   child.stdin!.write(header)
//   child.stdin!.write(json)
// })

const client = {
  timeout(timeout: number) {
    return this
  },
  request(method: string, params: any) {
    console.log('request: ', method, params)
    return connection.sendRequest<any>(method, params)
  },
  rejectAllPendingRequests(message: string) {

  },
  notify(method: string, params: any) {
    console.log('notify: ', method, params)
    connection.sendNotification(method, params)
  }
}

// const server = new JSONRPCServer()
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

// let all = ''
child.stdout!.on('data', (data) => {
  console.log('stdout: ', data.toString())
  // const content = data.toString()
  // all += content
  // let next = true
  // while (next) {
  //   const res = all.match(/Content-Length: (\d+)\r\n\r\n/)
  //   if (res) {
  //     const index = all.indexOf('\r\n\r\n')
  //     const header = all.substring(0, index)
  //     const other = Buffer.from(all.substring(index + 4), 'utf8')
  //     const length = parseInt(res[1])
  //     if (other.length >= length) {
  //       all = other.toString('utf8')
  //       const body = other.subarray(0, length).toString('utf8')
  //       all = other.subarray(length).toString('utf8')
  //       const obj = JSON.parse(body)
  //       if (obj.id) {
  //         client.receive(obj)
  //       } else if (obj.method) {
  //         server.receive(obj)
  //       }
  //     } else {
  //       next = false
  //     }
  //   } else {
  //     next = false
  //   }
  // }
})

// child.stdout!.on('end', () => {
//   console.log('end')
// })

// child.stderr!.on('data', (err) => {
//   console.log('err: ', err.toString())
// })

const workspaces: Record<string, {}> = {}

function positionToNumber(position: vscode.Position, source: string): number {
  const lines = source.split('\n')
  let index = 0
  for (let i = 0; i < position.line; i++) {
    index += lines[i].length + 1
  }
  index += position.character
  return index
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
    await client.timeout(TIMEOUT).request('initialize', {
      rootPath: workspaceFolder,
      rootUri: workspaceFolder,
      capabilities: {},
      trace: 'off',
      processId: process.pid,
      clientInfo: {
        name: 'Copilot for HBuilderX'
      }
    })
    await client.timeout(TIMEOUT).request('setEditorInfo', {
      editorInfo: {
        name: 'HBuilderX',
        version: ''
      },
      editorPluginInfo: {
        name: 'Copilot for HBuilderX',
        version: ''
      }
    })
    item = {}
    workspaces[workspaceFolder] = item
  }
  return workspaceFolder
}

async function signout() {
  client.rejectAllPendingRequests('cancel')
  await client.timeout(TIMEOUT).request('signOut', {})
  updateStatus(STATUS.disable)
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
  switch (statusOrLoading) {
    case STATUS.loading:
      statusBarItem.text = '$(copilot-loading)'
      statusBarItem.tooltip = 'Copilot 加载中...'
      break
    case STATUS.warning:
      statusBarItem.text = '$(copilot-warning)'
      statusBarItem.tooltip = 'Copilot 加载出错'
      break
    case STATUS.disable:
      statusBarItem.text = '$(copilot-disable)'
      statusBarItem.tooltip = 'Copilot 未启用'
      break
    case STATUS.enable:
      statusBarItem.text = '$(copilot-enable)'
      statusBarItem.tooltip = 'Copilot 已启用'
      break
  }
}

async function checkStatus() {
  updateStatus(true)
  await initWorkspace()
  if (status === STATUS.disable) {
    updateStatus(true)
    const res = await client.timeout(TIMEOUT).request('checkStatus', {
      // options: { localChecksOnly: true }
    })
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
      const res = await client.timeout(TIMEOUT).request('checkStatus', {
        // options: { localChecksOnly: true }
      })
      // {"status":"NotSignedIn"}
      // {"status":"OK","user":"zhetengbiji"}
      if (res.status === 'NotSignedIn') {
        const res = await client.timeout(TIMEOUT).request('signInInitiate', {

        })
        // {"status":"PromptUserDeviceFlow","userCode":"XXXX-XXXX","verificationUri":"https://github.com/login/device","expiresIn":899,"interval":5}
        vscode.window.showInformationMessage(`请在浏览器中打开 ${res.verificationUri} 并输入 ${res.userCode} 进行登录`)
        await client.timeout(res.expiresIn * 1e3).request('signInConfirm', {
          userCode: res.userCode
        })
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
  const res = await hbx ? hbx.window.showInformationMessage(message, ['是', '否']) : vscode.window.showInformationMessage(message, '是', '否')
  if (res === '是') {
    status === STATUS.enable ? signout() : signin()
  }
}

function activate({ subscriptions }: vscode.ExtensionContext) {
  const statusCommandId = 'copilot.status'
  subscriptions.push(vscode.commands.registerCommand('copilot.status', () => {
    statusClick()
  }))
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  statusBarItem.command = statusCommandId
  updateStatus(status)
  subscriptions.push(statusBarItem)
  statusBarItem.show()
  checkStatus()
  subscriptions.push(vscode.workspace.onDidOpenTextDocument(async function (document) {
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
  }))
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
  const selector = [
    'javascript',
    'typescript',
    'uts',
    'css',
    'scss',
    'sass',
    'less',
    'vue',
    'nvue',
    'uvue'
  ]
  subscriptions.push(vscode.languages.registerInlineCompletionItemProvider(selector, {
    async provideInlineCompletionItems(document, position, token, context) {
      const editor = vscode.window.activeTextEditor!
      // fix position
      position = editor.selection.start
      const items: vscode.InlineCompletionItem[] = []
      if (status === STATUS.disable) {
        signin()
        return { items }
      }
      updateStatus(true)
      try {
        const editor = vscode.window.activeTextEditor!
        const workspaceFolder = await initWorkspace()
        // await client.request('getVersion', {})
        const uri = document.uri.toString()
        const fileName = document.fileName
        const text = document.getText()
        const languageId = document.languageId
        const res = await client.timeout(TIMEOUT).request('getCompletionsCycling', {
          doc: {
            source: text,
            position: {
              line: position.line,
              character: position.character
            },
            indentSize: 4,
            insertSpaces: true,
            tabSize: 4,
            version: 0,
            languageId,
            uri: fileName,
            path: fileName,
            relativePath: path.relative(workspaceFolder, fileName)
          }
        })
        console.log('res: ', res)
        const completions = res.completions
        for (let index = 0; index < completions.length && index < 1; index++) {
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
  }))
}

function deactivate() { }

module.exports = {
  activate,
  deactivate
}
