import { config } from 'dotenv'
import path from 'path'
import '@testing-library/jest-dom'

// Prefer .env.local so we can keep project keys out of .env committed to source control.
const envPath = path.resolve(process.cwd(), '.env.local')
config({ path: envPath })

// Fallback to default .env if .env.local is missing.
config()
