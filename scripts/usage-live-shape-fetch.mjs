#!/usr/bin/env node
/** D1 envelope fetch for the shell masker. Raw output is only for the masking pipe. */
import {tmpdir} from 'node:os'
import {createWranglerD1Query} from '../collector/infra/usage/wrangler-d1-query.mjs'
import {USAGE_PROVIDERS} from '../collector/domain/usage/providers.mjs'
const provider=process.argv[2]??'claude'
if(!USAGE_PROVIDERS.includes(provider)){process.stderr.write('Usage shape configuration error\n');process.exit(78)}
const query=createWranglerD1Query({directory:tmpdir(),database:process.env.ZZIK_D1_DATABASE_NAME??'zzik-usage'})
const result=await query.query([{sql:'SELECT envelope AS value FROM usage_snapshot WHERE provider=? LIMIT 1',params:[provider]}])
if(!result.ok){process.stderr.write('Usage shape D1 read failed\n');process.exitCode=1}else process.stdout.write(result.value[0]?.results[0]?.value??'null')
