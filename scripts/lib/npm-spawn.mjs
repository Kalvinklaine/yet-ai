import process from "node:process";

export function npmRunInvocation(scriptName, forwardedArgs = [], options = {}) {
  const npmArgs = ["run", scriptName];
  if (forwardedArgs.length > 0) {
    npmArgs.push("--", ...forwardedArgs);
  }
  return npmInvocation(npmArgs, options);
}

export function npmInvocation(npmArgs, options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const execPath = options.execPath ?? process.execPath;
  const npmExecPath = typeof env.npm_execpath === "string" && env.npm_execpath.trim() !== "" ? env.npm_execpath : undefined;

  if (npmExecPath !== undefined) {
    return { command: execPath, args: [npmExecPath, ...npmArgs] };
  }

  return { command: platform === "win32" ? "npm.cmd" : "npm", args: npmArgs };
}
