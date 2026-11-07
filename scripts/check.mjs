#!/usr/bin/env node
// Local quality gates: the single definition run by developers, the factory reconciler and CI.
// Node standard library only. Runs every step in order and stops at the first failure.
// Factory-owned file: agents must not edit it.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Resolve a dev dependency's JS entry so it runs through `node` without a shell (works on Windows). */
function packageBin(pkg, bin) {
  const manifestPath = join(root, "node_modules", pkg, "package.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`${pkg} is not installed; run "npm install" first`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const rel = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[bin];
  if (!rel) {
    throw new Error(`${pkg} does not declare a "${bin}" executable`);
  }
  return [process.execPath, join(root, "node_modules", pkg, rel)];
}

/** Find a native executable on PATH. On Windows only .exe/.com can be spawned without a shell. */
function findOnPath(name) {
  const exts = process.platform === "win32" ? [".exe", ".com"] : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
  }
  return null;
}

function run(label, argv) {
  console.log(`\n==> ${label}: ${argv.slice(1).join(" ")}`);
  const result = spawnSync(argv[0], argv.slice(1), { cwd: root, stdio: "inherit", shell: false });
  if (result.error) {
    console.error(`${label}: FAILED to start (${result.error.message})`);
    return false;
  }
  if (result.status !== 0) {
    console.error(`${label}: FAILED (exit ${result.status ?? result.signal})`);
    return false;
  }
  console.log(`${label}: ok`);
  return true;
}

function secrets() {
  const gitleaks = findOnPath("gitleaks");
  if (gitleaks) {
    return run("secrets", [gitleaks, "dir", ".", "--redact", "--verbose", "--no-banner"]);
  }
  if (process.env.FABRICA_ALLOW_MISSING_GITLEAKS === "1") {
    console.log("\n==> secrets\ngitleaks: SKIPPED (not installed)");
    return true;
  }
  console.error(
    "\n==> secrets\nsecrets: FAILED, gitleaks is not on PATH.\n" +
      "Install it (https://github.com/gitleaks/gitleaks#installing): " +
      "`winget install Gitleaks.Gitleaks`, `brew install gitleaks`, or download a release binary.\n" +
      "To skip this step explicitly, set FABRICA_ALLOW_MISSING_GITLEAKS=1.",
  );
  return false;
}

/** Known vulnerabilities in production dependencies, through the npm that runs `npm run check`. */
function audit() {
  if (process.env.FABRICA_ALLOW_OFFLINE_AUDIT === "1") {
    console.log("\n==> audit\naudit: SKIPPED (FABRICA_ALLOW_OFFLINE_AUDIT=1)");
    return true;
  }
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (Object.keys(manifest.dependencies ?? {}).length === 0) {
    console.log("\n==> audit\naudit: no runtime dependencies");
    return true;
  }
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    console.error("\n==> audit\naudit: FAILED, run the gates through `npm run check`.");
    return false;
  }
  return run("audit", [process.execPath, npmCli, "audit", "--omit=dev", "--audit-level=moderate"]);
}

function main() {
  const steps = [
    () =>
      run("lint+format", [
        ...packageBin("@biomejs/biome", "biome"),
        "ci",
        ...(process.stdout.isTTY ? [] : ["--colors=off"]),
        ".",
      ]),
    () => run("types", [...packageBin("typescript", "tsc"), "--noEmit"]),
    () => run("tests", [...packageBin("vitest", "vitest"), "run", "--coverage"]),
    () => run("docs", [process.execPath, join(root, "scripts", "check-docs.mjs")]),
    secrets,
    audit,
  ];
  for (const step of steps) {
    if (!step()) return 1;
  }
  console.log("\nAll gates passed.");
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`check: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
