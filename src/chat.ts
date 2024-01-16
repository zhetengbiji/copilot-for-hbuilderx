import * as os from 'node:os'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import fetch from 'node-fetch'
import vscode = require('vscode')
import { COPILOT_NAME } from './env'
import * as outputChannel from './output'

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

let githubToken: {
  user: string
  oauth_token: string
  dev_override?: {
    copilot_token_url?: string
  }
} | null = null

function getGithubToken() {
  if (!githubToken) {
    const home = os.homedir()
    // ~/.config/github-copilot/hosts.json
    let hostsFile = path.join(home, '.config', 'github-copilot', 'hosts.json')
    if (!fs.existsSync(hostsFile)) {
      // C:\Users\user\AppData\Local\github-copilot\hosts.json
      hostsFile = path.join(
        home,
        'AppData',
        'Local',
        'github-copilot',
        'hosts.json',
      )
      if (!fs.existsSync(hostsFile)) {
        throw new Error('获取 GitHub Token 文件失败')
      }
    }
    const content = fs.readFileSync(hostsFile, { encoding: 'utf-8' })
    const hosts = JSON.parse(content)
    if ('github.com' in hosts) {
      githubToken = hosts['github.com']
    }
  }
  if (!githubToken) {
    throw new Error('获取 GitHub Token 失败')
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
  annotations_enabled: boolean
  chat_enabled: boolean
  chat_jetbrains_enabled: boolean
  code_quote_enabled: boolean
  copilot_ide_agent_chat_gpt4_small_prompt: boolean
  copilotignore_enabled: boolean
  expires_at: number
  intellij_editor_fetcher: boolean
  prompt_8k: boolean
  public_suggestions: string
  refresh_in: number
  sku: string
  snippy_load_test_enabled: boolean
  telemetry: string
  token: string
  tracking_id: string
  vsc_panel_v2: boolean
}

let token: string | null = null

const HEADERS = {
  'editor-version': 'vscode/1.85.1',
  'editor-plugin-version': 'copilot-chat/0.12.2023120701',
  'user-agent': 'GitHubCopilotChat/0.12.2023120701',
}

async function getToken() {
  if (token) {
    return token
  }
  const githubToken = getGithubToken()
  console.log('githubToken: ', githubToken)
  const url =
    githubToken.dev_override?.copilot_token_url ||
    'https://api.github.com/copilot_internal/v2/token'
  const headers = Object.assign(
    {
      authorization: `token ${githubToken.oauth_token}`,
    },
    HEADERS,
  )
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
    const chars = '0123456789abcdef'
    machineid = Array.from(
      { length },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join('')
  }
  return machineid
}

type Chat = { content: string; role: string }

const history: Chat[] = []

export async function chat(input?: string) {
  const document = vscode.window.activeTextEditor?.document
  const code =
    document?.getText(vscode.window.activeTextEditor!.selection) || ''
  outputChannel.show()
  const prompt = input || ''
  if (!prompt) {
    return
  }
  let authorization = ''
  try {
    const token = await getToken()
    authorization = `Bearer ${token}`
  } catch (error) {
    vscode.window.showErrorMessage((error as Error).message)
    return
  }
  const vscodeSessionid = getVscodeSessionid()
  console.log('vscodeSessionid:', vscodeSessionid)
  const machineid = getMachineid()
  console.log('machineid:', machineid)
  const url = 'https://api.githubcopilot.com/chat/completions'
  const headers = Object.assign(
    {
      authorization,
      'x-request-id': uuidv4(),
      'vscode-sessionid': vscodeSessionid,
      machineid: machineid,
      'openai-organization': 'github-copilot',
      'openai-intent': 'conversation-panel',
      'content-type': 'application/json',
    },
    HEADERS,
  )
  outputChannel.appendLine(`🙋 ${githubToken!.user}:`)
  if (document) {
    const fileName = path.basename(document.fileName)
    history.push({
      content: `Active selection:\n\n\nFrom the file: ${document.fileName}\n\`\`\`${document.languageId}\n${code}\n\`\`\`\n\n`,
      role: 'user',
    })
    outputChannel.appendLine(`Used 1 reference: ${fileName}:${code.length}`)
  }
  history.push({ content: prompt, role: 'user' })
  outputChannel.appendLine(prompt)
  outputChannel.appendLine(`🤖 ${COPILOT_NAME}:`)
  outputChannel.append('')
  const messages: Chat[] = []
  const config = vscode.workspace.getConfiguration()
  const role = config.get<string>('GithubCopilot.chat.role', 'copilot')
  if (role === 'copilot') {
    messages.push({
      content: COPILOT_INSTRUCTIONS,
      role: 'system',
    })
  }
  const data = {
    intent: true,
    model: 'gpt-4',
    n: 1,
    stream: true,
    temperature: 0.1,
    top_p: 1,
    messages: messages.concat(history),
  }
  console.log('data: ', data)
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  })
  function receive(obj: {
    choices?: {
      index: number
      delta: {
        content: string
        role: string | null
      }
    }[]
    created: number
    id: string
    promipt_filter_results: {
      content_filter_results: {
        hate: {
          filtered: boolean
          serverity: 'safe'
        }
        self_harm: {
          filtered: boolean
          serverity: 'safe'
        }
        sexual: {
          filtered: boolean
          serverity: 'safe'
        }
        violence: {
          filtered: boolean
          serverity: 'safe'
        }
      }
      prompt_index: number
    }[]
  }) {
    const content = obj.choices?.[0]?.delta.content
    if (content) {
      outputChannel.append(content)
    }
  }
  let all = Buffer.alloc(0)
  res.body.on('data', (data: Uint8Array) => {
    console.log('data chunk: ', data.toString())
    all = Buffer.concat([all, data])
    let next = true
    while (next) {
      const allStr = all.toString()
      const start = 'data: '
      const res = allStr.startsWith(start)
      if (res) {
        const endStr = '\n\n'
        const index = allStr.indexOf(endStr)
        if (index > 0) {
          const body = allStr.substring(6, index)
          if (body === '[DONE]') {
            all = Buffer.alloc(0)
            outputChannel.appendLine('')
            break
          }
          const obj = JSON.parse(body)
          receive(obj)
          all = all.slice(Buffer.from(start + body + endStr).length)
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
    if (all.length > 0) {
      const allStr = all.toString()
      vscode.window.showErrorMessage(allStr)
    }
  })
}

outputChannel.onInput(chat)
