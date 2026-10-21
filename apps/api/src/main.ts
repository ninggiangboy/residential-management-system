import { buildApp } from './app'

const port = Number(process.env.PORT ?? 3000)
buildApp().listen(port)
console.warn(`api listening on :${port}`)
