import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const maxFailureText = 6000;
const maxCommandOutputBytes = 8 * 1024 * 1024;
const runEngineSmoke = true;

const checks = [
  checkSettingsDefault,
  checkSettingsConfigurable,
  checkLifecycleService,
  checkProcessPolicy,
  checkDocumentPolicy,
  checkTestsExist,
  checkDocsClaims,
  checkNoAuthTokenOutput,
];

const failures = [];
for (const check of checks) {
  try {
    await check();
  } catch (error) {
    failures.push(boundedDiagnostic(error?.message ?? String(error)));
  }
}

if (runEngineSmoke) {
  const result = spawnSync(platformCommand('npm'), ['run', 'smoke:lsp-stdio'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: maxCommandOutputBytes,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: safeEnv(),
  });
  if (result.error?.code === 'ENOENT') {
    failures.push('smoke:lsp-stdio could not start because npm was not found on PATH.');
  } else if (result.error !== undefined) {
    failures.push(boundedDiagnostic(`smoke:lsp-stdio could not start: ${result.error.message}`));
  } else if (result.signal !== null) {
    failures.push(`smoke:lsp-stdio was interrupted by ${result.signal}.`);
  } else if (result.status !== 0) {
    failures.push(boundedDiagnostic(`smoke:lsp-stdio failed with exit code ${result.status ?? 'unknown'}\n${result.stderr || ''}${result.stdout || ''}`));
  }
}

if (failures.length > 0) {
  console.error(`JetBrains LSP foundation smoke failed (${failures.length} issue${failures.length === 1 ? '' : 's'}).`);
  failures.slice(0, 5).forEach((failure, index) => {
    console.error(`- [${index + 1}] ${failure}`);
  });
  process.exit(1);
}

console.log('JetBrains LSP foundation smoke passed.');
console.log(runEngineSmoke ? 'Included: npm run smoke:lsp-stdio' : 'Skipped: npm run smoke:lsp-stdio');

async function checkSettingsDefault() {
  const source = await readSource('apps/plugins/jetbrains/src/main/kotlin/ai/yet/plugin/settings/YetSettingsState.kt');
  assert(/lspEnabled:\s*Boolean\s*=\s*false\b/.test(source), 'YetSettingsState.kt does not default lspEnabled to false.');
}

async function checkSettingsConfigurable() {
  const source = await readSource('apps/plugins/jetbrains/src/main/kotlin/ai/yet/plugin/settings/YetSettingsConfigurable.kt');
  assert(/Enable read-only LSP MVP/.test(source), 'YetSettingsConfigurable.kt does not expose the read-only LSP MVP setting text.');
}

async function checkLifecycleService() {
  const source = await readSource('apps/plugins/jetbrains/src/main/kotlin/ai/yet/plugin/lsp/JetBrainsLspLifecycleService.kt');
  assert(/buildJetBrainsLspCommand\(binaryPath\)/.test(source), 'JetBrainsLspLifecycleService.kt does not use the JetBrains LSP command policy.');
  assert(!/\/v1\/ping/.test(source), 'JetBrainsLspLifecycleService.kt references /v1/ping.');
  assert(!/prepareRuntime\b/.test(source), 'JetBrainsLspLifecycleService.kt references RuntimeConnectionManager.prepare.');
  assert(!/restartRuntime\b/.test(source), 'JetBrainsLspLifecycleService.kt references RuntimeConnectionManager.restartRuntime.');
  assert(/filterJetBrainsLspEnvironment/.test(source), 'JetBrainsLspLifecycleService.kt does not use JetBrainsLspProcessPolicy environment filtering.');
  assert(/sanitizeJetBrainsLspDiagnosticText/.test(source), 'JetBrainsLspLifecycleService.kt does not use JetBrainsLspProcessPolicy sanitization.');
}

async function checkProcessPolicy() {
  const source = await readSource('apps/plugins/jetbrains/src/main/kotlin/ai/yet/plugin/lsp/JetBrainsLspProcessPolicy.kt');
  assert(/allowedEnvironmentKeys\s*=\s*setOf\("PATH",\s*"Path",\s*"SystemRoot",\s*"WINDIR"\)/.test(source), 'JetBrainsLspProcessPolicy.kt does not allowlist only OS basics.');
  assert(/secretKeyPattern/.test(source), 'JetBrainsLspProcessPolicy.kt does not strip secret-like env keys.');
  assert(/buildJetBrainsLspCommand\(binaryPath:\s*Path\):\s*List<String>\s*=\s*listOf\(binaryPath\.toString\(\),\s*"--lsp-stdio"\)/.test(source), 'JetBrainsLspProcessPolicy.kt does not build the stdio command exactly.');
}

async function checkDocumentPolicy() {
  const source = await readSource('apps/plugins/jetbrains/src/main/kotlin/ai/yet/plugin/lsp/JetBrainsLspDocumentPolicy.kt');
  assert(/maxDocumentUriBytes\s*=\s*512/.test(source), 'JetBrainsLspDocumentPolicy.kt does not bound URI length to 512 bytes.');
  assert(/maxDocumentTextBytes\s*=\s*256\s*\*\s*1024/.test(source), 'JetBrainsLspDocumentPolicy.kt does not bound text size to 256 KiB.');
  assert(/maxTrackedDocumentCount\s*=\s*32/.test(source), 'JetBrainsLspDocumentPolicy.kt does not bound document count to 32.');
  assert(/uri\.scheme\s*!=\s*"file"/.test(source), 'JetBrainsLspDocumentPolicy.kt does not enforce file-scheme only documents.');
}

async function checkTestsExist() {
  const files = [
    'apps/plugins/jetbrains/src/test/kotlin/ai/yet/plugin/lsp/JetBrainsLspProcessPolicyTest.kt',
    'apps/plugins/jetbrains/src/test/kotlin/ai/yet/plugin/lsp/JetBrainsLspLifecycleServiceTest.kt',
    'apps/plugins/jetbrains/src/test/kotlin/ai/yet/plugin/lsp/JetBrainsLspDocumentPolicyTest.kt',
  ];
  for (const file of files) {
    const source = await readSource(file);
    assert(/@Test\b/.test(source), `${path.basename(file)} does not contain tests.`);
  }
}

async function checkDocsClaims() {
  const sources = await Promise.all([
    readSource('README.md'),
    readSource('apps/engine/README.md'),
    readSource('apps/plugins/jetbrains/README.md'),
    readSource('docs/architecture/003-target-architecture.md'),
  ]);
  const combined = sources.join('\n');
  assert(/off by default/i.test(combined), 'Docs do not say the JetBrains LSP path is off by default.');
  assert(/no provider calls/i.test(combined), 'Docs do not say the JetBrains LSP path makes no provider calls.');
  assert(/no edits/i.test(combined), 'Docs do not say the JetBrains LSP path makes no edits.');
  assert(/no production completion claim/i.test(combined) || /does not claim production/i.test(combined), 'Docs do not disclaim production JetBrains LSP support.');
  assert(/yet-lsp --lsp-stdio/.test(combined), 'Docs do not mention the separate yet-lsp --lsp-stdio mode.');
}

async function checkNoAuthTokenOutput() {
  const source = await readSource('apps/plugins/jetbrains/src/main/kotlin/ai/yet/plugin/lsp/JetBrainsLspLifecycleService.kt');
  assert(!/YET_AI_AUTH_TOKEN/.test(source), 'JetBrainsLspLifecycleService.kt references YET_AI_AUTH_TOKEN in output path.');
}

async function readSource(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

function boundedDiagnostic(text) {
  const sanitized = sanitizeDiagnostic(text);
  return sanitized.length > maxFailureText ? `${sanitized.slice(0, maxFailureText)}…` : sanitized;
}

function sanitizeDiagnostic(text) {
  return String(text)
    .replaceAll(root, '<root>')
    .replace(/Bearer\s+[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/gi, 'Bearer <redacted>')
    .replace(/sk-(?:proj-)?[A-Za-z0-9._-]{8,}/gi, '<redacted-api-key>')
    .replace(/((?:access|refresh|session|auth)[_-]?token)([\"'`\s:=]+)[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/gi, '$1$2<redacted>')
    .replace(/(authorization|cookie|set-cookie|client_secret|auth_code|verifier)([\"'`\s:=]+)[^\s,;)]+/gi, '$1$2<redacted>')
    .replace(/mock-(auth-code|access-token|refresh-token|cookie|session|state)-[A-Za-z0-9-]+/gi, 'mock-$1-<redacted>')
    .replace(/(?:codex|provider-login)-(session|state)-[A-Za-z0-9-]+/gi, '$1-<redacted>')
    .replace(/(vscode-runtime-token|login-smoke-runtime-token)-[A-Za-z0-9-]+/gi, '$1-<redacted>')
    .replace(/jb\.wrapper\.runtime\.[A-Za-z0-9._-]+/gi, 'jb.wrapper.runtime.<redacted>')
    .replace(/YET_AI_AUTH_TOKEN/g, '<redacted-token>')
    .replace(/\/Users\/[^\s'"`)]+/g, '<path>')
    .replace(/file:\/\/[^\s'"`)]+/g, '<file-url>');
}

function safeEnv() {
  const safeNames = new Set([
    'PATH',
    'HOME',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'PATHEXT',
    'TMPDIR',
    'TMP',
    'TEMP',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'LC_COLLATE',
    'LC_MESSAGES',
    'LC_MONETARY',
    'LC_NUMERIC',
    'LC_TIME',
    'NPM_CONFIG_CACHE',
    'CARGO_HOME',
    'RUSTUP_HOME',
    'RUST_BACKTRACE',
    'NO_COLOR',
    'FORCE_COLOR',
    'CI',
  ]);
  const unsafeName = /(^|[_-])(?:access[_-]?token|refresh[_-]?token|session[_-]?token|auth[_-]?token|token|api[_-]?key|authorization|bearer|cookie|client[_-]?secret|secret|provider|openai|anthropic|github|aws|azure|google)(?:$|[_-])/i;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => safeNames.has(name.toUpperCase()) && !unsafeName.test(name)),
  );
  env.PATH = process.env.PATH ?? '';
  return env;
}

function platformCommand(command) {
  if (process.platform !== 'win32') {
    return command;
  }
  return { npm: 'npm.cmd' }[command] ?? command;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
