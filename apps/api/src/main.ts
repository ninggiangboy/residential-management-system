import { buildApp } from './app'

const port = Number(process.env.PORT ?? 3000)
buildApp().listen(port)
console.warn(`api listening on :${port}`)
debugger
const wrongType: number = 'not a number'
console.warn(wrongType)
