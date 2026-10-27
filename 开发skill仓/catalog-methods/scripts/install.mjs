import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const START = "<!-- catalog-methods:start -->";
const END = "<!-- catalog-methods:end -->";

const args = parseArgs(process.argv.slice(2));
const agentsFile = path.join(args.project, "AGENTS.md");
const catalog = path.join(scriptDir, "catalog.mjs");
const block = renderBlock(catalog, args.project);
const previous = fs.existsSync(agentsFile) ? fs.readFileSync(agentsFile, "utf8") : "";
fs.writeFileSync(agentsFile, upsert(previous, block), "utf8");
console.log(`agents ${path.relative(args.project, agentsFile).split(path.sep).join("/")}`);

const result = spawnSync(process.execPath, [catalog, "--project", args.project], {
  stdio: "inherit",
  cwd: args.project,
});
if (result.status !== 0) {
  throw new Error("初始化失败。");
}

function renderBlock(catalogScript, projectRoot) {
  const command = `node "${posix(catalogScript)}" --project "${posix(projectRoot)}"`;
  return [
    "## 整理方法",
    "",
    "新增、修改或删除 `.java`、`.ts`、`.tsx`、`.js`、`.jsx`、`.mjs`、`.cjs`、`.mts`、`.cts`、`.vue` 源码后，在这次修改收尾前执行：",
    "",
    "```text",
    command,
    "```",
    "",
    "与上次 SHA-256 相同的方法文件跳过；变了的删掉后按当前源码重新生成；没再碰到的方法文件删掉。不要手写这些方法文件，也不要在这次执行里填写「做了什么」。脚本失败就停下。不要改用 `--class` 或 `--package` 代替上面这条命令。",
    "",
  ].join("\n");
}

function upsert(existing, block) {
  const section = `${START}\n${block}${END}\n`;
  const start = existing.indexOf(START);
  const end = existing.indexOf(END);
  if (start !== -1 && end > start) {
    const after = existing.slice(end + END.length).replace(/^\r?\n/, "");
    return `${existing.slice(0, start)}${section}${after}`;
  }
  if (start !== -1 || end !== -1) {
    throw new Error("AGENTS.md 里的整理方法标记不完整。");
  }
  const trimmed = existing.replace(/\s*$/, "");
  return trimmed ? `${trimmed}\n\n${section}` : section;
}

function posix(value) {
  return path.resolve(value).split(path.sep).join("/");
}

function parseArgs(argv) {
  let project = process.cwd();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help") {
      console.log("node scripts/install.mjs --project <项目根>");
      process.exit(0);
    } else if (arg === "--project") {
      project = path.resolve(required(argv, ++i, arg));
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  if (!fs.existsSync(project) || !fs.statSync(project).isDirectory()) {
    throw new Error(`项目根不存在：${project}`);
  }
  return { project };
}

function required(argv, index, flag) {
  if (index >= argv.length || argv[index].startsWith("--")) {
    throw new Error(`${flag} 缺少取值。`);
  }
  return argv[index];
}
