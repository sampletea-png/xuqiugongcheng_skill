import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { planUpdate, writeCatalog } from "./write-md.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(scriptDir, "..");
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".scratch",
  ".idea",
  ".gradle",
  ".svn",
  "dist",
  "build",
  "target",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".output",
  ".turbo",
  "vendor",
  "generated",
  "generated-sources",
]);
const SOURCE_EXT = new Set([".java", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue"]);

const args = parseArgs(process.argv.slice(2));
ensureDeps();
const scope = {
  dir: args.dir,
  packagePrefix: args.packagePrefix,
  className: args.className,
};
const files = walk(args.project);
const rels = files.map((file) => path.relative(args.project, file).split(path.sep).join("/"));
const plan = planUpdate(args.project, rels, scope);
let methods = [];
if (plan.scan) {
  const { scanScripts } = await import("./scan-script.mjs");
  const javaFiles = files.filter((file) => file.endsWith(".java"));
  const scriptFiles = files.filter((file) => !file.endsWith(".java"));
  if (javaFiles.length) {
    methods.push(...scanJava(args.project, javaFiles));
  }
  if (scriptFiles.length) {
    methods.push(...scanScripts(args.project, scriptFiles));
  }
}
const result = writeCatalog(args.project, methods, scope, plan);
console.log(`skipped ${result.skipped}`);
console.log(`wrote ${result.wrote}`);
console.log(`deleted ${result.deleted}`);

function parseArgs(argv) {
  let project = process.cwd();
  let dir = null;
  let packagePrefix = null;
  let className = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help") {
      console.log("node scripts/catalog.mjs --project <项目根> [--dir <相对目录>] [--package <包或目录前缀>] [--class <类名>]");
      process.exit(0);
    } else if (arg === "--project") {
      project = path.resolve(required(argv, ++i, arg));
    } else if (arg === "--dir") {
      dir = required(argv, ++i, arg);
    } else if (arg === "--package") {
      packagePrefix = required(argv, ++i, arg);
    } else if (arg === "--class") {
      className = required(argv, ++i, arg);
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  if (!fs.existsSync(project) || !fs.statSync(project).isDirectory()) {
    throw new Error(`项目根不存在：${project}`);
  }
  if (dir) {
    const abs = path.resolve(project, dir);
    dir = path.relative(project, abs).split(path.sep).join("/");
  }
  return { project, dir, packagePrefix, className };
}

function required(argv, index, flag) {
  if (index >= argv.length || argv[index].startsWith("--")) {
    throw new Error(`${flag} 缺少取值。`);
  }
  return argv[index];
}

function ensureDeps() {
  const require = createRequire(path.join(skillDir, "package.json"));
  try {
    require.resolve("typescript");
    require.resolve("@vue/compiler-sfc");
    require.resolve("@vue/compiler-dom");
  } catch {
    const result = spawnSync("npm", ["install"], {
      cwd: skillDir,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (result.status !== 0) {
      throw new Error("npm install 失败。");
    }
  }
}

function walk(dir) {
  const found = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          continue;
        }
        visit(path.join(current, entry.name));
        continue;
      }
      const ext = path.extname(entry.name);
      if (SOURCE_EXT.has(ext)) {
        found.push(path.join(current, entry.name));
      }
    }
  };
  visit(dir);
  return found;
}

function scanJava(project, files) {
  const javac = spawnSync("javac", ["-version"], { encoding: "utf8" });
  if (javac.status !== 0) {
    throw new Error("整理 Java 需要本机 JDK 里的 javac。");
  }
  const classes = path.join(scriptDir, "java", "classes");
  fs.mkdirSync(classes, { recursive: true });
  const source = path.join(scriptDir, "java", "Catalog.java");
  const compiled = spawnSync("javac", ["--release", "21", "-encoding", "UTF-8", "-d", classes, source], {
    encoding: "utf8",
  });
  if (compiled.status !== 0) {
    throw new Error(compiled.stderr || compiled.stdout || "javac 编译扫描器失败。");
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-methods-"));
  try {
    const list = path.join(tmp, "files.txt");
    const out = path.join(tmp, "methods.json");
    fs.writeFileSync(list, files.map((file) => path.resolve(file)).join("\n"), "utf8");
    const result = spawnSync("java", [
      "--add-modules",
      "jdk.compiler",
      "-cp",
      classes,
      "Catalog",
      "--project",
      project,
      "--list",
      list,
      "--out",
      out,
    ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || "Java 扫描失败。");
    }
    if (result.stderr) {
      process.stderr.write(result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`);
    }
    return JSON.parse(fs.readFileSync(out, "utf8"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
