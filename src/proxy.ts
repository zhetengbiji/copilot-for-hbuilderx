import { vscode } from './define'
import { get as getSystemProxy } from 'get-system-proxy'

export async function get() {
  const config = vscode.workspace.getConfiguration()
  const strictSSL = config.get<boolean>('GithubCopilot.proxy.strictSSL')
  const enable = config.get<boolean>('GithubCopilot.proxy.enable')
  const networkProxy: {
    host?: string
    port?: number
    username?: string
    password?: string
    rejectUnauthorized?: boolean
  } = {}
  if (enable) {
    const host = config.get<string>('GithubCopilot.proxy.host') || ''
    const [_, hostname, port] =
      host.match(/(?:socks[45]?|https?)?[:：]?\/*([a-z0-9-_.]+)[:：](\d+)/i) ||
      []
    if (hostname && port) {
      networkProxy.host = hostname
      networkProxy.port = Number(port)
      const user = config.get<string>('GithubCopilot.proxy.user') || ''
      const [username, password] = user.split(/[:：]/)
      if (username && password) {
        networkProxy.username = username
        networkProxy.password = password
      }
      networkProxy.rejectUnauthorized = !!strictSSL
      return { networkProxy }
    }
  }
  const proxy = await getSystemProxy(['HTTP', 'HTTPS'])
  if (proxy) {
    networkProxy.host = proxy.host
    networkProxy.port = proxy.port
    networkProxy.rejectUnauthorized = !!strictSSL
    return { networkProxy }
  }
  return {}
}
