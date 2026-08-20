import { access, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The patched worker is the win32 COM directory picker. Skipping on other
// platforms keeps npm install from failing on non-Windows machines; the
// packaged app and the patch only ever run on Windows.
if (process.platform !== 'win32') {
  console.log('Skipping DSH directory picker patch: not a Windows host.')
  process.exit(0)
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const moduleRoots = [
  path.join(projectRoot, 'node_modules'),
  path.join(projectRoot, 'runtime', 'node_modules')
]

const vulnerableReadUtf16 = `function readUtf16(koffi, address) {
\tconst bytes = Buffer.from(koffi.view(address, 32768));
\tlet end = 0;
\twhile (end + 1 < bytes.length && bytes[end] !== 0) end += 2;
\treturn bytes.toString("utf16le", 0, end);
}`

const patchedReadUtf16 = `function readUtf16(koffi, address) {
\t// Koffi exposes a bounded NUL-terminated UTF-16 decoder. Avoid creating a
\t// fixed-size external ArrayBuffer: Electron may reject external buffers,
\t// and reading 32 KiB from a COM allocation can cross valid memory.
\treturn koffi.decode.string16(address);
}`

const vulnerablePost = `const post = (message) => {
\t/* v8 ignore next 3 -- disconnect needs a live IPC channel the unit lane must not sever (built-worker.e2e.ts owns the real close path). */
\tsend(message, () => {
\t\tif (process.connected) process.disconnect();
\t});
};`

const patchedPost = `// Keep the IPC channel alive after the intermediate "showing" notice.
// Disconnecting here races the terminal done/error message after Show returns.
const post = (message) => {
\tsend(message);
};
const finish = (message) => {
\tsend(message, () => {
\t\tif (process.connected) process.disconnect();
\t});
};`

const doneCall = `\t\tpost({
\t\t\tkind: "done",`
const errorCall = `\t\tpost({
\t\t\tkind: "error",`
const patchedDoneCall = `\t\tfinish({
\t\t\tkind: "done",`
const patchedErrorCall = `\t\tfinish({
\t\t\tkind: "error",`

const vulnerableExitHandler = `\t\tworker.on("exit", () => {
\t\t\tsettle(() => {
\t\t\t\treject(/* @__PURE__ */ new Error("win32 folder dialog worker exited before reporting a result"));
\t\t\t});
\t\t});`

const patchedExitHandler = `\t\tworker.on("exit", (code, signal) => {
\t\t\tsettle(() => {
\t\t\t\tconst reason = code !== null ? \`exit code \${code}\` : \`signal \${signal ?? "unknown"}\`;
\t\t\t\treject(/* @__PURE__ */ new Error(\`win32 folder dialog worker exited before reporting a result (\${reason})\`));
\t\t\t});
\t\t});`

async function patchRuntime(modulesRoot) {
  const packageRoot = path.join(modulesRoot, '@deepseek-ai', 'dsh-host-directory-picker-native', 'lib')
  const workerPath = path.join(packageRoot, 'worker.cjs')
  const hostPath = path.join(packageRoot, 'index.js')
  try {
    await Promise.all([access(workerPath), access(hostPath)])
  } catch {
    return false
  }

  let worker = await readFile(workerPath, 'utf8')
  let host = await readFile(hostPath, 'utf8')
  let changed = false

  if (worker.includes(vulnerableReadUtf16)) {
    worker = worker.replace(vulnerableReadUtf16, patchedReadUtf16)
    changed = true
  } else if (!worker.includes(patchedReadUtf16)) {
    throw new Error(
      'The DSH directory picker UTF-16 reader no longer matches the supported layout. Review the upstream worker before updating this patch.'
    )
  }

  if (worker.includes(vulnerablePost) && worker.includes(doneCall) && worker.includes(errorCall)) {
    worker = worker
      .replace(vulnerablePost, patchedPost)
      .replace(doneCall, patchedDoneCall)
      .replace(errorCall, patchedErrorCall)
    changed = true
  } else if (!worker.includes(patchedPost) || !worker.includes(patchedDoneCall) || !worker.includes(patchedErrorCall)) {
    throw new Error(
      'The DSH directory picker worker no longer matches the supported layout. Review the upstream worker before updating this patch.'
    )
  }

  if (host.includes(vulnerableExitHandler)) {
    host = host.replace(vulnerableExitHandler, patchedExitHandler)
    changed = true
  } else if (!host.includes(patchedExitHandler)) {
    throw new Error(
      'The DSH directory picker host no longer matches the supported layout. Review the upstream host before updating this patch.'
    )
  }

  if (changed) {
    await Promise.all([
      writeFile(workerPath, worker, 'utf8'),
      writeFile(hostPath, host, 'utf8')
    ])
  }
  return changed
}

const results = await Promise.all(moduleRoots.map(patchRuntime))
if (results.some(Boolean)) console.log('Patched DSH directory picker IPC lifetime, UTF-16 decoding, and exit diagnostics.')
else console.log('DSH directory picker patches already applied.')
