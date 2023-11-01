const {
  spawn
} = require('node:child_process');
const {
  JSONRPCClient,
  JSONRPCServer
} = require('json-rpc-2.0')
const path = require('node:path')
const code = require('vscode')
let hx
try {
  hx = require('hbuilderx')
} catch (error) {
  console.warn('hbuilderx not found')
}

const child = spawn('node', [
  path.join(__dirname, 'dist/agent.js'),
  // '--node-ipc', '--stdio' or '--socket={number}'
  '--stdio'
])

const client = new JSONRPCClient((jsonRPCRequest) => {
  console.log(jsonRPCRequest)
  const json = JSON.stringify(jsonRPCRequest)
  const length = json.length
  const header = `Content-Length: ${length}\r\n\r\n`
  child.stdin.write(header + json)
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
child.stdout.on('data', (data) => {
  console.log('stdout: ', data.toString())
  const content = data.toString()
  all += content
  let next = true
  while (next) {
    const res = all.match(/Content-Length: (\d+)\r\n\r\n/)
    if (res) {
      const index = all.indexOf('\r\n\r\n')
      const header = all.substring(0, index)
      const other = all.substring(index + 4)
      const length = parseInt(res[1])
      if (other.length >= length) {
        all = other
        const body = all.substring(0, length)
        all = all.substring(length)
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

child.stdout.on('end', () => {
  console.log('end')
})

child.stderr.on('data', (err) => {
  console.log('err: ', err.toString())
})

const workspaces = {}
let isSignedIn = false

/**
 * 
 * @param {code.Position} position 
 * @param {string} document
 * @returns {number}
 */
function positionToNumber (position, source) {
  const lines = source.split('\n')
  let index = 0
  for (let i = 0; i < position.line; i++) {
    index += lines[i].length + 1
  }
  index += position.character
  return index
}

async function get () {
  // const editor = await code.window.getActiveTextEditor()
  // const workspaceFolder = editor.document.workspaceFolder
  const workspaceFolder = code.workspace.workspaceFolders[0].uri.fsPath
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
        code.window.showInformationMessage(`请在浏览器中打开 ${res.verificationUri} 并输入 ${res.userCode} 进行登录`)
        await client.request('signInConfirm', {
          userCode: res.userCode
        })
        isSignedIn = true
      } catch (error) {

      }
    }
  }
  // await client.request('getVersion', {})
  const editor = code.window.activeTextEditor
  const document = editor.document
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
  client.notify('textDocument/didChange', {
    contentChanges: [{
      text,
    }],
    textDocument: {
      uri,
      version: 0
    }
  })
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
      uri: document.fileName,
      path: document.fileName,
      relativePath: path.relative(workspaceFolder, document.fileName)
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
    const position = completion.position
    const range = completion
    if (hx) {
      const editor = await hx.window.getActiveTextEditor()
      await editor.edit((editBuilder) => {
        editBuilder.replace(positionToNumber(position, text), completion.text)
      })
    } else {
      // TODO HBuilderX 兼容有问题
      await editor.edit((editBuilder) => {
        editBuilder.replace(new code.Position(position.line, position.character), completion.text)
      })
    }
  }
}

async function signout () {
  await client.request('signOut', {})
  isSignedIn = false
  code.showInformationMessage('已退出登录')
}

function activate (context) {
  // start()
  console.log('activate')
  let command_get = code.commands.registerCommand('copilot.get', () => {
    get()
  })
  context.subscriptions.push(command_get)
  let command_signout = code.commands.registerCommand('copilot.signout', () => {
    signout()
  })
  context.subscriptions.push(command_signout)
}

function deactivate () { }

module.exports = {
  activate,
  deactivate
}
