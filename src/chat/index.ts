import { vscode } from '../define'
import { COPILOT_NAME } from '../env'
import { STATUS, status } from '../status'
import { chat } from './chat'

export function creatChatHandler(prompt?: string) {
  return function () {
    if (status === STATUS.OK) {
      chat(prompt)
    } else {
      vscode.window.showErrorMessage(`请检查 ${COPILOT_NAME} 登录状态`)
    }
  }
}

export async function activate({ subscriptions }: vscode.ExtensionContext) {
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
}
