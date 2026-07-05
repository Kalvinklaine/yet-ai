import { readFile, stat } from "node:fs/promises";

const fixtureRows = [
  {
    id: "S88-M1",
    taskType: "Copy change",
    file: "fixtures/s88/copy-change.md",
    expectedSnippets: [
      "hosted workspace",
      "local-first and user-authorized"
    ],
    commandId: "repository-check"
  },
  {
    id: "S88-M2",
    taskType: "Simple TypeScript fix",
    file: "fixtures/s88/type-fix.ts",
    expectedSnippets: [
      "displayName?: string",
      "return input.displayName;"
    ],
    commandId: "gui-app-tests"
  },
  {
    id: "S88-M3",
    taskType: "Failing test fix",
    file: "fixtures/s88/failing-test.test.ts",
    expectedSnippets: [
      "Stopped after bounded verification",
      "Verification still running"
    ],
    commandId: "gui-app-tests"
  },
  {
    id: "S88-M4",
    taskType: "One-file code cleanup",
    file: "fixtures/s88/code-cleanup-target.ts",
    expectedSnippets: [
      "export function stepSummary",
      "return \"bounded verification\";"
    ],
    commandId: "gui-app-tests"
  },
  {
    id: "S88-M5",
    taskType: "Recovery copy",
    file: "fixtures/s88/recovery-copy.md",
    expectedSnippets: [
      "stopped after verification",
      "approved recovery sentence"
    ],
    commandId: "repository-check"
  }
];

const maxFixtureBytes = 2048;
const forbiddenContentPatterns = [
  /API[_ -]?KEY\s*[:=]/i,
  /TOKEN\s*[:=]/i,
  /SECRET\s*[:=]/i,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
  /\/Users\//,
  /C:\\\\Users\\/i,
  /github\.com\//i,
  /https?:\/\//i,
  /provider\s+call/i,
  /raw\s+(prompt|response|diff|output)/i
];

const matrixPath = "docs/dogfood/s88-useful-autonomy-matrix.md";
const packagePath = "package.json";
const smokeScriptName = "smoke:controlled-agent-dogfood";

const failures = [];

async function readText(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    failures.push(`${path}: cannot read file (${error.message})`);
    return "";
  }
}

function expectIncludes(content, path, snippet) {
  if (!content.includes(snippet)) {
    failures.push(`${path}: missing expected snippet ${JSON.stringify(snippet)}`);
  }
}

function expectPatternAbsent(content, path, pattern) {
  if (pattern.test(content)) {
    failures.push(`${path}: contains unsafe pattern ${pattern}`);
  }
}

for (const row of fixtureRows) {
  const content = await readText(row.file);
  if (content.length === 0) {
    continue;
  }

  const fileStat = await stat(row.file).catch((error) => {
    failures.push(`${row.file}: cannot stat file (${error.message})`);
    return null;
  });

  if (fileStat && fileStat.size > maxFixtureBytes) {
    failures.push(`${row.file}: fixture is ${fileStat.size} bytes, expected at most ${maxFixtureBytes}`);
  }

  const lineCount = content.split("\n").length;
  if (lineCount > 80) {
    failures.push(`${row.file}: fixture has ${lineCount} lines, expected at most 80`);
  }

  for (const snippet of row.expectedSnippets) {
    expectIncludes(content, row.file, snippet);
  }

  for (const pattern of forbiddenContentPatterns) {
    expectPatternAbsent(content, row.file, pattern);
  }
}

const matrix = await readText(matrixPath);
for (const row of fixtureRows) {
  expectIncludes(matrix, matrixPath, `| ${row.id} | ${row.taskType} |`);
  expectIncludes(matrix, matrixPath, `\`${row.file}\``);
  expectIncludes(matrix, matrixPath, `| \`${row.commandId}\` |`);
}
expectIncludes(matrix, matrixPath, "not production autonomy");
expectIncludes(matrix, matrixPath, "npm run smoke:controlled-agent-dogfood");

const packageJson = JSON.parse(await readText(packagePath));
const script = packageJson.scripts?.[smokeScriptName];
if (script !== "node scripts/smoke-controlled-agent-dogfood.mjs") {
  failures.push(`${packagePath}: ${smokeScriptName} must run node scripts/smoke-controlled-agent-dogfood.mjs`);
}

const allowedCommandIds = new Set(["repository-check", "gui-app-tests", "engine-chat-tests"]);
for (const row of fixtureRows) {
  if (!allowedCommandIds.has(row.commandId)) {
    failures.push(`${row.id}: command id ${row.commandId} is not allowlisted`);
  }
}

if (failures.length > 0) {
  console.error("Controlled agent dogfood smoke failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Controlled agent dogfood smoke passed for ${fixtureRows.length} deterministic fixtures.`);
