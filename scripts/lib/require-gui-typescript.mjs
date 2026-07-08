import { lstatSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";

const designDocPath = "docs/architecture/032-controlled-agent-verification-setup-hardening.md";

function pathStatus(path) {
  try {
    const link = lstatSync(path);
    try {
      return { stat: statSync(path), brokenSymlink: false };
    } catch (error) {
      if (link.isSymbolicLink() && error?.code === "ENOENT") {
        return { stat: null, brokenSymlink: true };
      }
      throw error;
    }
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { stat: null, brokenSymlink: false };
    }
    throw error;
  }
}

function dependencyStatus({ packagePath, nodeModulesPath }) {
  const nodeModules = pathStatus(nodeModulesPath);
  if (nodeModules.brokenSymlink) {
    return { found: false, brokenSymlinkPath: nodeModulesPath };
  }
  const dependency = pathStatus(packagePath);
  return {
    found: dependency.stat?.isDirectory() === true,
    brokenSymlinkPath: dependency.brokenSymlink ? packagePath : null,
  };
}

function setupError({ repoRoot, smokeName, checked, brokenSymlinks }) {
  const checkedText = checked.map(({ packagePath }) => `- ${relative(repoRoot, packagePath)}`).join("\n");
  const brokenText = brokenSymlinks.length === 0
    ? ""
    : `\n\nBroken local dependency symlink detected at:\n${brokenSymlinks.map((path) => `- ${relative(repoRoot, path)}`).join("\n")}\nRepair this worktree setup manually, then retry.`;
  return new Error(`${smokeName} setup is incomplete: TypeScript was not found.\nChecked:\n${checkedText}\n\nRepository root: ${repoRoot}\n\nNo install, symlink, or network access was attempted.\nRun one of these local setup steps, then retry:\n- cd apps/gui && npm ci\n- npm ci at the repository root if this smoke is documented to allow the root fallback\n- for an isolated worktree, manually link apps/gui/node_modules to an existing local project install if that is your chosen local setup${brokenText}\n\nSee ${designDocPath}.`);
}

function requireGuiTypescript({ repoRoot, smokeName = "Controlled-agent GUI-transpile smoke" }) {
  const checked = [
    {
      packagePath: join(repoRoot, "apps", "gui", "node_modules", "typescript"),
      nodeModulesPath: join(repoRoot, "apps", "gui", "node_modules"),
    },
    {
      packagePath: join(repoRoot, "node_modules", "typescript"),
      nodeModulesPath: join(repoRoot, "node_modules"),
    },
  ];
  const brokenSymlinks = [];
  for (const candidate of checked) {
    const status = dependencyStatus(candidate);
    if (status.found) {
      const require = createRequire(import.meta.url);
      return require(candidate.packagePath);
    }
    if (status.brokenSymlinkPath) {
      brokenSymlinks.push(status.brokenSymlinkPath);
    }
  }
  throw setupError({ repoRoot, smokeName, checked, brokenSymlinks });
}

export { requireGuiTypescript };
