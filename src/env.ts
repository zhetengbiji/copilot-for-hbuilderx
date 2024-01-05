export const EDITOR_NAME = 'HBuilderX'
export const EDITOR_PLUGIN_NAME = 'GitHub Copilot for HBuilderX'
export const COPILOT_NAME = 'GitHub Copilot'
export const VERSION = '0.6.4'

let userName = ''

export function getUser() {
  return userName || 'User'
}

export function setUser(user: string) {
  userName = user
}
