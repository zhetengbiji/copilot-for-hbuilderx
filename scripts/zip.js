const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const packageJson = require('../package.json')

const tgzPath = path.join(__dirname, `../${packageJson.name}-${packageJson.version}.tgz`)

execSync(`rm -rf ${__dirname}/../package`)

execSync(`tar -zxvf ${tgzPath} -C ${__dirname}/..`)

fs.writeFileSync(path.join(__dirname, '../package/package.json'), JSON.stringify(Object.assign({}, packageJson, {
  scripts: undefined,
  dependencies: undefined,
  devDependencies: undefined
}), null, 2).replace(/\.woff\b/g, '.ttf'))

execSync(`cd ${__dirname}/../package && zip -r ../${packageJson.name}-${packageJson.version}.zip ./*`)

execSync(`rm -rf ${__dirname}/../package`)
execSync(`rm -f ${tgzPath}`)
