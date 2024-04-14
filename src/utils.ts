import { vscode } from './define'

export function positionToNumber(
  position: vscode.Position,
  source: string,
): number {
  const lines = source.split('\n')
  let index = 0
  for (let i = 0; i < position.line; i++) {
    index += lines[i].length + 1
  }
  index += position.character
  return index
}
