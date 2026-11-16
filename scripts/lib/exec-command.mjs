// Shared command runner for operator scripts. Callers can inject a fake executor in tests.
import { execFile } from 'node:child_process'

/**
 * @typedef {{exitCode:number,stdout:string,stderr:string}} ExecResult
 * @typedef {{cwd?:string,env?:Record<string,string|undefined>,timeoutMs?:number}} ExecOptions
 * @typedef {(command:string,args:readonly string[],options?:ExecOptions)=>Promise<ExecResult>} Executor
 */

/**
 * Run one command without a shell. stdout/stderr are captured for classification only;
 * operator scripts must never forward them verbatim.
 * @param {string} command
 * @param {readonly string[]} args
 * @param {ExecOptions} [options]
 * @returns {Promise<ExecResult>}
 */
export function executeCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        timeout: options.timeoutMs ?? 600_000,
      },
      (error, stdout, stderr) => {
        const exitCode = error === null ? 0 : (typeof error.code === 'number' ? error.code : 1)
        resolve({ exitCode, stdout: stdout ?? '', stderr: stderr ?? '' })
      },
    )
  })
}
