import { connection } from './agent'
import { hbuilderx, vscode } from './define'
import { checkEditorInfo, initWorkspace } from './editor'
import { COPILOT_NAME } from './env'

export enum STATUS {
  loading,
  warning,
  NotSignedIn,
  // 同官方 IDEA 插件暂不单独处理此状态
  NotAuthorized,
  OK,
}
export let status: STATUS = STATUS.NotSignedIn

let loading: boolean = false

export const command = 'copilot.status'
let statusBarItem: vscode.StatusBarItem = vscode.window.createStatusBarItem(
  vscode.StatusBarAlignment.Right,
  100,
)
statusBarItem.command = command

export function updateStatus(statusOrLoading: STATUS | boolean) {
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
    (statusConfig === 'auto' &&
      process.platform === 'win32' &&
      status === STATUS.NotSignedIn)
      ? 'Copilot'
      : ''
  switch (statusOrLoading) {
    case STATUS.loading:
      statusBarItem.text =
        (hbuilderx ? '$(copilot-loading~spin)' : '$(loading~spin)') + fixString
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

export async function checkStatus() {
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

export async function signout() {
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

export async function signin() {
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

export async function activate({ subscriptions }: vscode.ExtensionContext) {
  updateStatus(status)
  subscriptions.push(statusBarItem)
  statusBarItem.show()
  subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(function (event) {
      if (event.affectsConfiguration('GithubCopilot.status.show')) {
        updateStatus(status)
      }
    }),
  )
  await checkStatus()
}
