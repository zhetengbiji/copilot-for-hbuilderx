import { fork } from 'node:child_process'
import * as path from 'node:path'
import * as rpc from 'vscode-jsonrpc/node'

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

export { connection }
