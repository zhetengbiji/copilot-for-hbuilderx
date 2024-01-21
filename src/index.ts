import { vscode, hbuilderx } from './define'
import { COPILOT_NAME, HOMEPAGE } from './env'
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
  const items: Array<{
    key: string
    action?: () => void
  }> = []
  const about = {
    key: '关于本插件',
    action: () => {
      vscode.env.openExternal(vscode.Uri.parse(HOMEPAGE))
    },
  }
  if (status === STATUS.OK) {
    const config = vscode.workspace.getConfiguration()
    const enableAutoCompletions = !!selectorCache.get('*')
    const editor = vscode.window.activeTextEditor
    const languageId = editor?.document.languageId
    const languageEnableAutoCompletions = languageId
      ? selector.includes(languageId)
      : enableAutoCompletions
    items.push({
      key: `${COPILOT_NAME} 状态: ${
        languageEnableAutoCompletions ? '正常' : '已禁用'
      }`,
    })
    items.push(about)
    async function toggle(language: boolean = false) {
      if (language) {
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
    }
    items.push({
      key: `${enableAutoCompletions ? '禁用' : '启用'}自动补全`,
      action: toggle,
    })
    if (languageId) {
      items.push({
        key: `${
          languageEnableAutoCompletions ? '禁用' : '启用'
        } ${languageId} 的自动补全`,
        action: () => toggle(true),
      })
    }
    items.push({
      key: '开始代码聊天',
      action: creatChatHandler(),
    })
  } else {
    items.push({ key: `${COPILOT_NAME} 状态: 未登录` })
    items.push(about)
  }
  items.push({
    key: '打开设置',
    action: () => {
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
    },
  })
  const title = `${status === STATUS.OK ? '退出' : '登录'} ${COPILOT_NAME}`
  items.push({
    key: title,
    action: async () => {
      const message = `是否${title}？`
      const res = await vscode.window.showInformationMessage(
        message,
        '是',
        '否',
      )
      if (res === '是') {
        status === STATUS.OK ? signout() : signin()
      }
    },
  })
  const res = await vscode.window.showQuickPick(items.map(item => item.key))
  if (res) {
    const item = items.find(item => item.key === res)
    item?.action?.()
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
