import { createRequire } from "module"

const require = createRequire(import.meta.url)

export const pkg = require('../../package.json') as { version: string, name: string }
