import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const OUTPUT_DIR = path.join(".scratch", "方法");
const INDEX_NAME = "_sources.json";

export function planUpdate(projectRoot, sourceRels, scope) {
  const root = path.resolve(projectRoot);
  const index = readIndex(root);
  const existing = listMethodFiles(root);
  const bySource = new Map();
  for (const entry of existing) {
    const list = bySource.get(entry.source) ?? [];
    list.push(entry);
    bySource.set(entry.source, list);
  }
  const hashes = new Map();
  const unchanged = new Set();
  const changed = new Set();
  const narrow = Boolean(scope.packagePrefix || scope.className);
  for (const rel of sourceRels) {
    if (scope.dir && !underDir(rel, scope.dir)) {
      continue;
    }
    const hash = hashFile(root, rel, hashes);
    const previous = index[rel];
    const found = bySource.get(rel)?.length ?? 0;
    if (previous && previous.hash === hash && previous.methods === found) {
      unchanged.add(rel);
    } else {
      changed.add(rel);
    }
  }
  return {
    scan: changed.size > 0,
    narrow,
    hashes,
    unchanged,
    changed,
    sources: new Set(sourceRels),
    existing,
    bySource,
  };
}

export function writeCatalog(projectRoot, methods, scope, plan) {
  const root = path.resolve(projectRoot);
  const outRoot = path.join(root, OUTPUT_DIR);
  removeFlatFile(root);
  const touched = new Set();
  let skipped = 0;
  let wrote = 0;
  let deleted = 0;

  for (const rel of plan.unchanged) {
    for (const entry of plan.bySource.get(rel) ?? []) {
      if (!inScope(entry, scope)) {
        continue;
      }
      touched.add(entry.abs);
      skipped += 1;
    }
  }

  const rewrittenSources = new Set();
  const writtenBySource = new Map();
  if (plan.scan) {
    const selected = methods.filter((method) => plan.changed.has(method.file) && inScope(method, scope));
    for (const method of selected) {
      writtenBySource.set(method.file, (writtenBySource.get(method.file) ?? 0) + 1);
    }
    const callers = invert(methods);
    for (const rel of plan.changed) {
      for (const entry of plan.bySource.get(rel) ?? []) {
        if (!inScope(entry, scope)) {
          continue;
        }
        if (removeFile(outRoot, entry.abs)) {
          deleted += 1;
        }
      }
      rewrittenSources.add(rel);
    }
    allocate(selected);
    const fileHashes = plan.hashes;
    for (const method of selected) {
      const abs = path.join(root, method.outputRel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const text = render(
        method,
        hashBody(root, method),
        hashFile(root, method.file, fileHashes),
        callers.get(method.identity) ?? [],
      );
      fs.writeFileSync(abs, text, "utf8");
      touched.add(path.resolve(abs));
      wrote += 1;
    }
  }

  for (const entry of plan.existing) {
    if (touched.has(entry.abs) || !inScope(entry, scope)) {
      continue;
    }
    const sourceGone = !plan.sources.has(entry.source);
    const sourceRewritten = rewrittenSources.has(entry.source);
    if (!sourceGone && !sourceRewritten) {
      continue;
    }
    if (removeFile(outRoot, entry.abs)) {
      deleted += 1;
    }
  }

  if (!plan.narrow) {
    const previousIndex = readIndex(root);
    const index = {};
    for (const rel of plan.sources) {
      if (scope.dir && !underDir(rel, scope.dir)) {
        if (previousIndex[rel]) {
          index[rel] = previousIndex[rel];
        }
        continue;
      }
      const methodCount = plan.changed.has(rel)
        ? (writtenBySource.get(rel) ?? 0)
        : (plan.bySource.get(rel)?.length ?? 0);
      index[rel] = {
        hash: plan.hashes.get(rel) ?? hashFile(root, rel, plan.hashes),
        methods: methodCount,
      };
    }
    if (scope.dir) {
      for (const [rel, value] of Object.entries(previousIndex)) {
        if (!underDir(rel, scope.dir) && !index[rel]) {
          index[rel] = value;
        }
      }
    }
    fs.mkdirSync(outRoot, { recursive: true });
    const ordered = {};
    for (const rel of Object.keys(index).sort()) {
      ordered[rel] = index[rel];
    }
    fs.writeFileSync(path.join(outRoot, INDEX_NAME), `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
  }
  pruneEmpty(outRoot);
  return { skipped, wrote, deleted };
}

function render(method, hash, fileHash, callers) {
  const lines = [
    `# ${method.name}`,
    "",
    `方法：${method.name}`,
    `类：${method.className}`,
    `包路径：${method.packagePath}`,
    `种类：${method.kind}`,
    `身份：\`${method.identity}\``,
  ];
  if (method.kind === "匿名") {
    lines.push(`宿主：\`${method.hostIdentity}\``);
    lines.push(`位置：${method.file}:${method.startLine}:${method.startColumn}`);
  }
  lines.push(`源文件：${method.file}`);
  lines.push(`源文件哈希：${fileHash}`);
  lines.push(`源码范围：${method.startLine}-${method.endLine}`);
  lines.push(`<!-- body:${hash} -->`);
  lines.push("");
  lines.push("## 做了什么");
  lines.push("");
  lines.push("尚未填写");
  lines.push("");
  lines.push("## 被使用");
  lines.push("");
  lines.push(section(sortCalls(callers.map((caller) => ({
    kind: String(caller.kind).startsWith("具名") ? "具名" : "匿名",
    identity: caller.identity,
  }))).map(useLine)));
  lines.push("");
  lines.push("## 使用了");
  lines.push("");
  lines.push(section(sortCalls(method.uses ?? []).map(useLine)));
  lines.push("");
  return lines.join("\n");
}

function allocate(methods) {
  const counts = new Map();
  for (const method of methods) {
    if (method.kind === "匿名") {
      continue;
    }
    const key = `${method.file}\0${method.className}\0${method.name}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const used = new Set();
  for (const method of methods) {
    const dir = path.posix.dirname(method.file);
    const folder = path.posix.join(".scratch/方法", dir === "." ? "" : dir);
    const sourceStem = sanitize(path.posix.basename(method.file).replace(/\.[^.]+$/, ""));
    const overloaded = counts.get(`${method.file}\0${method.className}\0${method.name}`) > 1;
    let stem = `${sourceStem}-${methodStem(method, overloaded)}`;
    let rel = path.posix.join(folder, `${stem}.md`);
    if (used.has(rel)) {
      stem += `-${sanitize(method.className)}-${method.startLine}-${method.startColumn}`;
      rel = path.posix.join(folder, `${stem}.md`);
    }
    used.add(rel);
    method.outputRel = rel;
  }
}

function methodStem(method, overloaded) {
  if (method.kind === "匿名") {
    return `匿名-${method.startLine}-${method.startColumn}`;
  }
  let name = sanitize(method.name);
  if (String(method.name).includes("#")) {
    name = `${sanitize(String(method.name).replaceAll("#", ""))}-private`;
  }
  if (overloaded) {
    const params = (method.paramTypes ?? []).map(sanitize).filter(Boolean);
    name += `-${params.join("-") || "无参数"}`;
  }
  return name || "method";
}

function useLine(use) {
  if (use.kind === "项目外" || use.kind === "未能解析") {
    return `- ${use.kind} · \`${use.display || "（空）"}\``;
  }
  return `- ${use.kind} · \`${use.identity}\``;
}

function section(lines) {
  return lines.length ? lines.join("\n") : "没有";
}

function sortCalls(uses) {
  const order = { 具名: 0, 匿名: 1, 项目外: 2, 未能解析: 3 };
  return [...uses].sort((a, b) => {
    const byKind = (order[a.kind] ?? 9) - (order[b.kind] ?? 9);
    if (byKind !== 0) {
      return byKind;
    }
    return `${a.identity ?? ""}\0${a.display ?? ""}`.localeCompare(`${b.identity ?? ""}\0${b.display ?? ""}`, "en");
  });
}

function listMethodFiles(projectRoot) {
  const dir = path.join(projectRoot, OUTPUT_DIR);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const found = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(abs);
        continue;
      }
      if (!entry.name.endsWith(".md")) {
        continue;
      }
      const text = fs.readFileSync(abs, "utf8");
      const identity = text.match(/^身份：`([^`]*)`/m)?.[1] ?? "";
      if (!identity) {
        continue;
      }
      found.push({
        abs: path.resolve(abs),
        source: text.match(/^源文件：(.+)$/m)?.[1]?.trim() ?? "",
        file: text.match(/^源文件：(.+)$/m)?.[1]?.trim() ?? "",
        packagePath: text.match(/^包路径：(.+)$/m)?.[1]?.trim() ?? "",
        className: text.match(/^类：(.+)$/m)?.[1]?.trim() ?? "",
        identity,
      });
    }
  };
  visit(dir);
  return found;
}

function readIndex(projectRoot) {
  const file = path.join(projectRoot, OUTPUT_DIR, INDEX_NAME);
  if (!fs.existsSync(file)) {
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const normalized = {};
    for (const [rel, value] of Object.entries(parsed)) {
      if (value && typeof value === "object" && typeof value.hash === "string") {
        normalized[rel] = { hash: value.hash, methods: Number(value.methods) || 0 };
      }
    }
    return normalized;
  } catch {
    return {};
  }
}

function removeFlatFile(projectRoot) {
  const file = path.join(projectRoot, ".scratch", "方法.md");
  if (fs.existsSync(file)) {
    const head = fs.readFileSync(file, "utf8").slice(0, 20);
    if (head.startsWith("# 方法")) {
      fs.rmSync(file, { force: true });
    }
  }
  const legacyIndex = path.join(projectRoot, OUTPUT_DIR, "_index.json");
  if (fs.existsSync(legacyIndex)) {
    fs.rmSync(legacyIndex, { force: true });
  }
}

function removeFile(outRoot, abs) {
  const file = path.resolve(abs);
  const root = path.resolve(outRoot);
  const relativePath = path.relative(root, file);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return false;
  }
  if (!fs.existsSync(file)) {
    return false;
  }
  fs.rmSync(file, { force: true });
  return true;
}

function pruneEmpty(outRoot) {
  if (!fs.existsSync(outRoot)) {
    return;
  }
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        visit(path.join(current, entry.name));
      }
    }
    if (current !== outRoot && fs.readdirSync(current).length === 0) {
      fs.rmdirSync(current);
    }
  };
  visit(outRoot);
}

function hashFile(projectRoot, rel, cache) {
  if (cache.has(rel)) {
    return cache.get(rel);
  }
  const hex = crypto.createHash("sha256").update(fs.readFileSync(path.join(projectRoot, rel))).digest("hex");
  cache.set(rel, hex);
  return hex;
}

function hashBody(projectRoot, method) {
  const text = fs.readFileSync(path.join(projectRoot, method.file), "utf8");
  const start = Math.max(0, Number(method.startOffset) || 0);
  const end = method.endOffset < 0 ? text.length : Math.min(text.length, Number(method.endOffset));
  return crypto.createHash("sha256").update(text.slice(start, end), "utf8").digest("hex");
}

function invert(methods) {
  const map = new Map();
  for (const caller of methods) {
    for (const use of caller.uses ?? []) {
      if (!use.identity || (use.kind !== "具名" && use.kind !== "匿名")) {
        continue;
      }
      const list = map.get(use.identity) ?? [];
      if (!list.some((item) => item.identity === caller.identity)) {
        list.push(caller);
      }
      map.set(use.identity, list);
    }
  }
  return map;
}

function underDir(rel, dir) {
  const source = rel.replace(/\\/g, "/");
  const prefix = dir.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  return source === prefix || source.startsWith(`${prefix}/`);
}

function sanitize(value) {
  const text = String(value ?? "")
    .replace(/[\\/:*?"<>|#\s,()[\]{}]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return text || "unnamed";
}

export function inScope(method, scope) {
  if (scope.dir) {
    const source = String(method.file ?? method.source ?? "").replace(/\\/g, "/");
    const dir = scope.dir.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
    if (!(source === dir || source.startsWith(`${dir}/`))) {
      return false;
    }
  }
  if (scope.packagePrefix) {
    const pkg = method.packagePath ?? "";
    const prefix = scope.packagePrefix;
    if (!(pkg === prefix || pkg.startsWith(`${prefix}.`) || pkg.startsWith(`${prefix}/`))) {
      return false;
    }
  }
  if (scope.className) {
    const className = method.className ?? "";
    const simple = className.includes(".") ? className.slice(className.lastIndexOf(".") + 1) : className;
    const full = method.packagePath ? `${method.packagePath}.${className}` : className;
    if (className !== scope.className && simple !== scope.className && full !== scope.className) {
      return false;
    }
  }
  return true;
}
