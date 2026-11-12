#!/usr/bin/env node
/** DB envelope fetch for the shell shape masker. Never logs driver details. */
import postgres from 'postgres'
import { USAGE_PROVIDERS } from '../collector/domain/usage/providers.mjs'

const provider = process.argv[2] ?? 'claude'
if (!USAGE_PROVIDERS.includes(provider) || !process.env.DB_URL) {
  process.stderr.write('Usage shape configuration error\n')
  process.exit(78)
}
let client
try {
  client = postgres(process.env.DB_URL, {max:1,prepare:false,connect_timeout:10,onnotice:()=>{}})
  const rows = await client.unsafe('SELECT envelope::text AS value FROM usage_snapshot WHERE provider = $1 LIMIT 1',[provider])
  process.stdout.write(rows[0]?.value ?? 'null')
} catch {
  process.stderr.write('Usage shape database read failed\n')
  process.exitCode = 1
} finally {
  await client?.end({timeout:1})
}
