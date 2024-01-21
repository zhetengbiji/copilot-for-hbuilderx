import { vscode, hbuilderx } from './define'
import { COPILOT_NAME } from './env'
import {
  STATUS,
  status,
  command as statusCommandId,
  activate as activateStatus,
  signout,
  signin,
} from './status'
import { selector, selectorCache, activate as activateEditor } from './editor'
import { creatChatHandler, activate as activateChat } from './chat'

async function showQuickPick() {
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
        // if (hbuilderx) {
        //   registerInlineCompletionItemProvider(subscriptions)
        // }
      } else if (res === chatStart) {
        creatChatHandler()()
      } else if (res === settings) {
        if (hbuilderx) {
          hbuilderx.workspace.gotoConfiguration(
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

async function activate(context: vscode.ExtensionContext) {
  await activateChat(context)
  await activateStatus(context)
  await activateEditor(context)

  context.subscriptions.push(
    vscode.commands.registerCommand(statusCommandId, showQuickPick),
  )
}

function deactivate() {
  // TODO HBuilderX 卸载不会触发 deactivate
}

module.exports = {
  activate,
  deactivate,
}
