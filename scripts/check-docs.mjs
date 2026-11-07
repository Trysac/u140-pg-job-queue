#!/usr/bin/env node
// Documentation gate: enforces docs-manifest.json. Node standard library only.
// Factory-owned file: agents must not edit it.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readText(rel) {
  const path = join(root, rel);
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  return readFileSync(path, "utf8");
}

const REGEXP_SPECIAL = new Set([".", "+", "^", "$", "{", "}", "(", ")", "|", "\\"]);

function segmentToRegExp(segment) {
  let source = "";
  for (const char of segment) {
    if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else if (REGEXP_SPECIAL.has(char)) source += `\\${char}`;
    else source += char;
  }
  return new RegExp(`^${source}$`);
}

/** Minimal glob: `*`, `?` and `[...]` within path segments; no `**`. */
function glob(pattern) {
  let current = [""];
  for (const segment of pattern.split("/")) {
    const next = [];
    const wild = /[*?[]/.test(segment);
    for (const base of current) {
      const dir = join(root, base);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
      if (!wild) {
        if (existsSync(join(dir, segment))) next.push(base ? `${base}/${segment}` : segment);
        continue;
      }
      const re = segmentToRegExp(segment);
      for (const entry of readdirSync(dir)) {
        if (re.test(entry)) next.push(base ? `${base}/${entry}` : entry);
      }
    }
    current = next;
  }
  return current.filter((rel) => statSync(join(root, rel)).isFile());
}

function main() {
  const manifest = JSON.parse(readFileSync(join(root, "docs-manifest.json"), "utf8"));
  const errors = [];
  for (const rel of manifest.required ?? []) {
    const text = readText(rel);
    if (text === null) errors.push(`missing required file: ${rel}`);
    else if (text.trim() === "") errors.push(`required file is empty: ${rel}`);
  }
  for (const pattern of manifest.required_globs ?? []) {
    if (glob(pattern).length === 0) errors.push(`no file matches required pattern: ${pattern}`);
  }
  for (const [rel, limit] of Object.entries(manifest.max_lines ?? {})) {
    const text = readText(rel);
    if (text === null) continue;
    const lines = text.replace(/\n$/, "").split("\n").length;
    if (lines > limit) errors.push(`${rel} has ${lines} lines; the limit is ${limit}`);
  }
  for (const [rel, needle] of Object.entries(manifest.must_reference ?? {})) {
    const text = readText(rel);
    if (text !== null && !text.includes(needle)) errors.push(`${rel} must reference ${needle}`);
  }
  if (errors.length > 0) {
    for (const error of errors) console.error(`docs: ${error}`);
    return 1;
  }
  console.log(`docs: ok (${(manifest.required ?? []).length} required files present)`);
  return 0;
}

process.exitCode = main();
