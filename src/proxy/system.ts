import { exec } from 'node:child_process'
import { promisify } from 'node:util'
const execPromise = promisify(exec)

type ProxyType = 'SOCKS' | 'HTTPS' | 'HTTP'

type ProxyInfo = {
  type: ProxyType
  host: string
  port: number
}

export async function get(
  filter: ProxyType[] = ['HTTP', 'HTTPS', 'SOCKS'],
): Promise<ProxyInfo | undefined> {
  const platform = process.platform
  if (platform === 'darwin') {
    const { stdout } = await execPromise('scutil --proxy')
    const dictionary: {
      ProxyAutoConfigEnable?: boolean
      ProxyAutoConfigURLString?: string
      ExcludeSimpleHostnames?: string
      HTTPEnable?: boolean
      HTTPPort?: number
      HTTPProxy?: string
      HTTPSEnable?: boolean
      HTTPSPort?: number
      HTTPSProxy?: string
      SOCKSEnable?: boolean
      SOCKSPort?: number
      SOCKSProxy?: string
    } = {}
    const lines = stdout.split('\n')
    lines.forEach(line => {
      let [key, value] = line.split(' : ')
      if (key && value) {
        key = key.trim()
        value = value.trim()
        if (key.endsWith('Enable')) {
          dictionary[key as 'HTTPEnable'] = value === '1'
        } else if (key.endsWith('Port')) {
          dictionary[key as 'HTTPPort'] = parseInt(value)
        } else {
          dictionary[key as 'HTTPProxy'] = value
        }
      }
    })
    for (const t of filter) {
      if (
        dictionary[`${t}Enable`] &&
        dictionary[`${t}Proxy`] &&
        dictionary[`${t}Port`]
      ) {
        return {
          type: t,
          host: dictionary[`${t}Proxy`]!,
          port: dictionary[`${t}Port`]!,
        }
      }
    }
  } else if (platform === 'win32') {
    const { stdout } = await execPromise(
      'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"',
    )
    const lines = stdout.split('\n')
    const dictionary: {
      ProxyEnable?: boolean
      ProxyOverride?: string
      ProxyServer?: string
      AutoConfigURL?: string
    } = {}
    lines.forEach(line => {
      const [key, type, value] = line.trim().split(/\s+/)
      if (key && type && value) {
        if (type === 'REG_DWORD') {
          dictionary[key as 'ProxyEnable'] = value === '0x1'
        } else if (type === 'REG_SZ') {
          dictionary[key as 'ProxyServer'] = value
        }
      }
    })
    if (
      filter.includes('HTTP') &&
      dictionary.ProxyEnable &&
      dictionary.ProxyServer
    ) {
      const [host, port] = dictionary.ProxyServer.split(':')
      return {
        type: 'HTTP',
        host,
        port: parseInt(port),
      }
    }
  }
}
