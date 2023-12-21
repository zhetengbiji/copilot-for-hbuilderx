import * as os from 'node:os'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import fetch from 'node-fetch'
import vscode = require('vscode')
import { COPILOT_NAME, getUser } from './env'

const COPILOT_INSTRUCTIONS = `
You are an AI programming assistant.
When asked for your name, you must respond with "GitHub Copilot".
Follow the user's requirements carefully & to the letter.
Your expertise is strictly limited to software development topics.
Follow Microsoft content policies.
Avoid content that violates copyrights.
For questions not related to software development, simply give a reminder that you are an AI programming assistant.
Keep your answers short and impersonal.

You can answer general programming questions and perform the following tasks:
* Ask a question about the files in your current workspace
* Explain how the selected code works
* Generate unit tests for the selected code
* Propose a fix for the problems in the selected code
* 新工作区的基架代码
* 创建新 Jupyter Notebook
* Ask questions about VS Code
* 为工作区搜索生成查询参数
* Ask about VS Code extension development
* Ask how to do something in the terminal
You use the GPT-4 version of OpenAI's GPT models.
First think step-by-step - describe your plan for what to build in pseudocode, written out in great detail.
Then output the code in a single code block.
Minimize any other prose.
Use Markdown formatting in your answers.
Make sure to include the programming language name at the start of the Markdown code blocks.
Avoid wrapping the whole response in triple backticks.
The user works in an IDE called Visual Studio Code which has a concept for editors with open files, integrated unit test support, an output pane that shows the output of running the code as well as an integrated terminal.
The active document is the source code the user is looking at right now.
You can only give one reply for each conversation turn.
Respond in the following locale: zh-cn`

let githubToken: string | null = null

function getGithubToken() {
  if (!githubToken) {
    const home = os.homedir()
    // ~/.config/github-copilot/hosts.json
    let hostsFile = path.join(home, '.config', 'github-copilot', 'hosts.json')
    if (!fs.existsSync(hostsFile)) {
      // C:\Users\user\AppData\Local\github-copilot\hosts.json
      hostsFile = path.join(home, 'AppData', 'Local', 'github-copilot', 'hosts.json')
      if (!fs.existsSync(hostsFile)) {
        return githubToken
      }
    }
    const content = fs.readFileSync(hostsFile, { encoding: 'utf-8' })
    const hosts = JSON.parse(content);
    if ('github.com' in hosts) {
      githubToken = hosts['github.com']['oauth_token'] as string
    }
  }
  return githubToken
}

let vscodeSessionid: string | null = null

function getVscodeSessionid() {
  if (!vscodeSessionid) {
    vscodeSessionid = `${uuidv4()}${Math.round(Date.now())}`
  }
  return vscodeSessionid
}

type ResponseData = {
  annotations_enabled: boolean;
  chat_enabled: boolean;
  chat_jetbrains_enabled: boolean;
  code_quote_enabled: boolean;
  copilot_ide_agent_chat_gpt4_small_prompt: boolean;
  copilotignore_enabled: boolean;
  expires_at: number;
  intellij_editor_fetcher: boolean;
  prompt_8k: boolean;
  public_suggestions: string;
  refresh_in: number;
  sku: string;
  snippy_load_test_enabled: boolean;
  telemetry: string;
  token: string;
  tracking_id: string;
  vsc_panel_v2: boolean;
}

let token: string | null = null

async function getToken() {
  if (token) {
    return token
  }
  const githubToken = getGithubToken()
  if (!githubToken) {
    return
  }
  console.log('githubToken: ', githubToken)
  const url = "https://api.github.com/copilot_internal/v2/token"
  const headers = {
    "authorization": `token ${githubToken}`,
    "editor-version": "vscode/1.80.1",
    "editor-plugin-version": "copilot-chat/0.4.1",
    "user-agent": "GitHubCopilotChat/0.4.1",
  }
  const res = await fetch(url, {
    method: 'GET',
    headers,
  })
  console.log('res.headers: ', res.headers)
  const body: ResponseData = await res.json()
  console.log('body: ', body)
  token = body.token
  console.log('token: ', token)
  return token
}

let machineid: string | null = null
function getMachineid() {
  if (!machineid) {
    const length = 65
    const chars = "0123456789abcdef"
    machineid = Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  }
  return machineid
}

type Chat = { content: string, role: string }

const history: Chat[] = []

const outputChannel = vscode.window.createOutputChannel('Github Copilot Chat')
const outputChannelProxy = (function (outputChannel: vscode.OutputChannel) {
  let data = ''
  return {
    append: function (value: string) {
      // HBuilderX 不支持 append
      // outputChannel.append(value)
      // TODO 按行结算
      data += value
    },
    appendEnd: function () {
      outputChannel.appendLine(data)
      data = ''
    },
    appendLine: function (value: string) {
      outputChannel.appendLine(value)
    }
  }
})(outputChannel)

export async function chat(input?: string) {
  const token = await getToken()
  if (!token) {
    return
  }
  const vscodeSessionid = getVscodeSessionid()
  console.log('vscodeSessionid:', vscodeSessionid)
  const machineid = getMachineid()
  console.log('machineid:', machineid)
  const url = "https://copilot-proxy.githubusercontent.com/v1/chat/completions"
  const headers = {
    "authorization": `Bearer ${token}`,
    "x-request-id": uuidv4(),
    "vscode-sessionid": vscodeSessionid,
    "machineid": machineid,
    "editor-version": "vscode/1.80.1",
    "editor-plugin-version": "copilot-chat/0.4.1",
    "openai-organization": "github-copilot",
    "openai-intent": "conversation-panel",
    "content-type": "application/json",
    "user-agent": "GitHubCopilotChat/0.4.1",
  }
  const prompt = input || (await vscode.window.showInputBox({
    // prompt: '询问 Copilot 问题',
    placeHolder: '询问 Copilot',
    // value: ''
  })) || ''
  if (!prompt) {
    return
  }
  outputChannelProxy.appendLine(`${getUser()}:`)
  const document = vscode.window.activeTextEditor?.document
  if (document) {
    const code = document?.getText(vscode.window.activeTextEditor!.selection) || ''
    const fileName = path.basename(document.fileName)
    history.push({
      content: `Active selection:\n\n\nFrom the file: ${document.fileName}\n\`\`\`${document.languageId}\n${code}\n\`\`\`\n\n`,
      role: "user",
    })
    outputChannelProxy.appendLine(`Used 1 reference: ${fileName}:${code.length}`)
  }
  history.push({ content: prompt, role: "user" })
  outputChannelProxy.appendLine(prompt)
  outputChannelProxy.appendLine(`${COPILOT_NAME}:`)
  const data = {
    intent: true,
    model: 'copilot-chat',
    n: 1,
    stream: true,
    temperature: 0.1,
    top_p: 1,
    messages: [
      {
        "content": COPILOT_INSTRUCTIONS,
        "role": "system",
      }
    ].concat(history),
  }
  console.log('data: ', data)
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(data)
  })
  outputChannel.show()
  function receive(obj: {
    choices: {
      index: number;
      delta: {
        content: string;
        role: string | null;
      }
    }[];
    created: number;
    id: string;
  }) {
    const content = obj.choices[0].delta.content
    if (content) {
      outputChannelProxy.append(content)
    }
  }
  let all = ''
  res.body.on('data', (data) => {
    console.log('data chunk: ', data.toString())
    const content = data.toString()
    all += content
    let next = true
    while (next) {
      const res = all.match(/data\: .+/)
      if (res) {
        const endStr = '\n\n'
        const index = all.indexOf(endStr)
        if (index > 0) {
          const body = all.substring(6, index)
          if (body === '[DONE]') {
            all = ''
            outputChannelProxy.appendEnd()
            break
          }
          const obj = JSON.parse(body)
          receive(obj)
          all = all.substring(index + endStr.length)
        } else {
          next = false
        }
      } else {
        next = false
      }
    }
  })
  res.body.on('end', () => {
    console.log('data end')
  })
}
