import vscode = require('vscode')

// @ts-ignore
let hbuilderx: typeof import('hbuilderx')
try {
  hbuilderx = require('hbuilderx')
} catch (error) {
  console.warn('hbuilderx not found')
}

if (hbuilderx) {
  // 修复参数不一致
  vscode.window.showInformationMessage = function <T extends string>(
    message: string,
    ...items: T[]
  ): Thenable<T | undefined> {
    return hbuilderx.window.showInformationMessage(message, items)
  }
  // 补充缺失的类型
  vscode.InlineCompletionTriggerKind = vscode.InlineCompletionTriggerKind || {
    Invoke: 0,
    Automatic: 1,
    // 撤销，仅 HBuilderX 支持
    Back: 2,
  }
  // 模拟 createWebviewPanel
  vscode.window.createWebviewPanel = function (
    viewType: string,
    title: string,
    showOptions: unknown,
    options: unknown,
  ): vscode.WebviewPanel {
    const panel = hbuilderx.window.createWebView(viewType, options)
    Object.defineProperty(panel, 'webview', {
      get() {
        return this.webView
      },
    })
    panel.reveal = function () {
      hbuilderx.window.showView({
        viewid: viewType,
        containerid: viewType,
      })
    }
    panel.reveal()
    return panel
  }
}

export { hbuilderx, vscode }
