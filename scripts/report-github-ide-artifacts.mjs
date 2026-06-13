import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { expectedPublicGithubIdeArtifactNames } from "./ide-artifact-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const sha = args.sha ?? readHeadSha();
  if (!/^[a-f0-9]{7,40}$/i.test(sha)) {
    throw new Error("Commit SHA for artifact names must be 7-40 hexadecimal characters.");
  }

  console.log(`Expected public Yet AI IDE artifacts for ${sha}:`);
  console.log("Dev-preview status: install-from-file evidence only; unsigned, unpublished, not a production release.");
  for (const artifactName of expectedPublicGithubIdeArtifactNames(sha)) {
    console.log(`- ${artifactName}`);
  }
  console.log("VS Code unzip-first artifacts must be unzipped before installing the inner VSIX; JetBrains direct-install artifacts are selected directly in the IDE; the combined manifest contains metadata.");
} catch (error) {
  console.error(`GitHub IDE artifact summary failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = { help: false, sha: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--sha") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--sha requires a 7-40 character hexadecimal value.");
      }
      parsed.sha = value;
      index += 1;
    } else if (arg.startsWith("--sha=")) {
      parsed.sha = arg.slice("--sha=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function readHeadSha() {
  const result = spawnSync(platformCommand("git"), ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: safeEnv(),
  });
  if (result.error?.code === "ENOENT") {
    throw new Error("Required command `git` was not found on PATH.");
  }
  if (result.error !== undefined) {
    throw new Error(`Could not run git rev-parse HEAD: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error("Could not determine commit SHA from git rev-parse HEAD.");
  }
  return result.stdout.trim();
}

function printHelp() {
  console.log(`Usage: node scripts/report-github-ide-artifacts.mjs [--sha <7-40-hex-sha>]

Prints the expected public dev-preview GitHub IDE artifact names for a commit.
The output contains artifact names only: no private paths, tokens, env dumps, signing,
marketplace publication, or production-release claims.`);
}

function safeEnv() {
  return { ...process.env, PATH: process.env.PATH ?? "" };
}

function platformCommand(command) {
  if (process.platform !== "win32") {
    return command;
  }
  return { git: "git.exe" }[command] ?? command;
}
