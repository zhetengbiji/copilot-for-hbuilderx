import { fork } from 'node:child_process'
import { JSONRPCClient, JSONRPCServer } from 'json-rpc-2.0'
import path = require('node:path')
import * as vscode from 'vscode'
// @ts-ignore
let hbx: import('hbuilderx')
try {
  hbx = require('hbuilderx')
} catch (error) {
  console.warn('hbuilderx not found')
}

let statusBarItem: vscode.StatusBarItem

const child = fork(path.join(__dirname, '../dist/agent.js'), [
  // '--node-ipc', '--stdio' or '--socket={number}'
  '--stdio'
], {
  stdio: 'pipe'
})

const client = new JSONRPCClient((jsonRPCRequest) => {
  console.log(jsonRPCRequest)
  const json = Buffer.from(JSON.stringify(jsonRPCRequest), 'utf8')
  const length = json.length
  const header = `Content-Length: ${length}\r\n\r\n`
  child.stdin!.write(header)
  child.stdin!.write(json)
})

const server = new JSONRPCServer()
server.addMethod('LogMessage', (params) => {
  console.log('LogMessage: ', params)
})
server.addMethod('featureFlagsNotification', (params) => {
  console.log('featureFlagsNotification: ', params)
})
server.addMethod('statusNotification', (params) => {
  console.log('statusNotification: ', params)
})

let all = ''
child.stdout!.on('data', (data) => {
  console.log('stdout: ', data.toString())
  const content = data.toString()
  all += content
  let next = true
  while (next) {
    const res = all.match(/Content-Length: (\d+)\r\n\r\n/)
    if (res) {
      const index = all.indexOf('\r\n\r\n')
      const header = all.substring(0, index)
      const other = Buffer.from(all.substring(index + 4), 'utf8')
      const length = parseInt(res[1])
      if (other.length >= length) {
        all = other.toString('utf8')
        const body = other.subarray(0, length).toString('utf8')
        all = other.subarray(length).toString('utf8')
        const obj = JSON.parse(body)
        if (obj.id) {
          client.receive(obj)
        } else if (obj.method) {
          server.receive(obj)
        }
      } else {
        next = false
      }
    } else {
      next = false
    }
  }
})

child.stdout!.on('end', () => {
  console.log('end')
})

child.stderr!.on('data', (err) => {
  console.log('err: ', err.toString())
})

const workspaces: Record<string, {}> = {}
let isSignedIn = false

function positionToNumber(position: vscode.Position, source: string): number {
  const lines = source.split('\n')
  let index = 0
  for (let i = 0; i < position.line; i++) {
    index += lines[i].length + 1
  }
  index += position.character
  return index
}

async function get() {
  const editor = vscode.window.activeTextEditor!
  let workspaceFolder = vscode.workspace.workspaceFolders![0].uri.fsPath
  if (hbx) {
    const editor = await hbx.window.getActiveTextEditor()
    workspaceFolder = editor.document.workspaceFolder.uri.path
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
        name: 'Copilot for HBuilderX'
      }
    })
    await client.request('setEditorInfo', {
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
  if (!isSignedIn) {
    const res = await client.request('checkStatus', {
      // options: { localChecksOnly: true }
    })
    // {"status":"NotSignedIn"}
    // {"status":"OK","user":"zhetengbiji"}
    if (res.status === 'NotSignedIn') {
      try {
        const res = await client.request('signInInitiate', {

        })
        // {"status":"PromptUserDeviceFlow","userCode":"XXXX-XXXX","verificationUri":"https://github.com/login/device","expiresIn":899,"interval":5}
        vscode.window.showInformationMessage(`请在浏览器中打开 ${res.verificationUri} 并输入 ${res.userCode} 进行登录`)
        await client.request('signInConfirm', {
          userCode: res.userCode
        })
        isSignedIn = true
      } catch (error) {

      }
    } else {
      isSignedIn = true
    }
  }
  // await client.request('getVersion', {})
  const document = editor.document
  const uri = document.uri.toString()
  const fileName = document.fileName
  const text = document.getText()
  const languageId = document.languageId
  // client.notify('textDocument/didOpen', {
  //   textDocument: {
  //     text,
  //     languageId,
  //     uri,
  //     version: 0
  //   }
  // })
  // await client.request('setEditorInfo', {
  //   editorInfo: {
  //     name: 'HBuilderX',
  //     version: ''
  //   },
  //   editorPluginInfo: {
  //     name: 'Copilot for HBuilderX',
  //     version: ''
  //   }
  // })
  // client.notify('textDocument/didChange', {
  //   contentChanges: [{
  //     text,
  //   }],
  //   textDocument: {
  //     uri,
  //     version: 0
  //   }
  // })
  const position = editor.selection.start
  const res = await client.request('getCompletionsCycling', {
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
  // client.notify('textDocument/didSave', {
  //   textDocument: {
  //     uri
  //   }
  // })
  const completions = res.completions
  if (completions.length) {
    const completion = completions[0]
    // await client.request('notifyAccepted', {
    //   uuid: completion.uuid
    // })
    console.log('completion: ', completion)
    const position = completion.position
    const range = completion.range
    const start = range.start
    const end = range.end
    const completionText = completion.text.trimEnd()
    if (hbx) {
      const editor = await hbx.window.getActiveTextEditor()
      const range = {
        start: positionToNumber(start, text),
        end: positionToNumber(end, text)
      }
      await editor.edit((editBuilder: any) => {
        editBuilder.replace(range, completionText)
      })
    } else {
      // TODO HBuilderX 兼容有问题
      await editor.edit((editBuilder) => {
        editBuilder.replace(new vscode.Range(new vscode.Position(start.line, start.character), new vscode.Position(end.line, end.character)), completionText)
      })
    }
  }
}

async function signout() {
  await client.request('signOut', {})
  isSignedIn = false
  vscode.window.showInformationMessage('已退出登录')
}

async function checkStatus() {

}

function activate({ subscriptions }: vscode.ExtensionContext) {
  subscriptions.push(vscode.commands.registerCommand('copilot.get', () => {
    get()
  }))
  subscriptions.push(vscode.commands.registerCommand('copilot.signout', () => {
    signout()
  }))
  const statusCommandId = 'copilot.status'
  subscriptions.push(vscode.commands.registerCommand('copilot.status', () => {
    checkStatus()
  }))
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  statusBarItem.command = statusCommandId
  statusBarItem.text = 'Copilot'
  subscriptions.push(statusBarItem)
  statusBarItem.show()
}

function deactivate() { }

module.exports = {
  activate,
  deactivate
}
