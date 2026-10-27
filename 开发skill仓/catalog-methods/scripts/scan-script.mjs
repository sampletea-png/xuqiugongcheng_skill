import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { parse as parseSfc } from "@vue/compiler-sfc";
import { NodeTypes, parse as parseTemplate } from "@vue/compiler-dom";

const GLOBAL_ROOTS = new Set([
  "console",
  "Math",
  "Object",
  "JSON",
  "Number",
  "String",
  "Array",
  "Date",
  "Promise",
  "window",
  "document",
  "globalThis",
]);

export function scanScripts(projectRoot, files) {
  const root = path.resolve(projectRoot);
  const absFiles = files.map((file) => path.resolve(file));
  const vueByCanon = new Map();
  const relByCanon = new Map();
  const projectFiles = new Set();

  for (const file of absFiles) {
    const rel = relative(root, file);
    const key = canon(file);
    relByCanon.set(key, rel);
    projectFiles.add(key);
    if (file.endsWith(".vue")) {
      const prepared = prepareVue(file, rel);
      if (prepared) {
        vueByCanon.set(key, prepared);
      }
    }
  }

  const options = {
    allowJs: true,
    checkJs: false,
    noEmit: true,
    jsx: ts.JsxEmit.Preserve,
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    esModuleInterop: true,
    skipLibCheck: true,
    strict: false,
    allowNonTsExtensions: true,
  };
  const host = ts.createCompilerHost(options);
  host.getCurrentDirectory = () => root;
  const baseGetSourceFile = host.getSourceFile.bind(host);
  const baseFileExists = host.fileExists.bind(host);
  const baseReadFile = host.readFile.bind(host);
  host.fileExists = (fileName) => vueByCanon.has(canon(fileName)) || baseFileExists(fileName);
  host.readFile = (fileName) => {
    const vue = vueByCanon.get(canon(fileName));
    return vue ? vue.shadow : baseReadFile(fileName);
  };
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const vue = vueByCanon.get(canon(fileName));
    if (vue) {
      return ts.createSourceFile(fileName, vue.shadow, languageVersion, true, vue.scriptKind);
    }
    return baseGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };

  const programFiles = absFiles.filter((file) => !file.endsWith(".vue") || vueByCanon.has(canon(file)));
  const program = ts.createProgram({ rootNames: programFiles, options, host });
  const checker = program.getTypeChecker();
  const methods = [];
  const byNode = new Map();
  const symbolToRec = new Map();
  const classInfoBySymbol = new Map();
  const identities = new Set();
  const overloadNodes = [];
  let mode = "define";
  let classStack = [];
  let stack = [];
  let packagePath = "";
  let moduleStem = "";
  let currentFile = "";
  let language = "";

  function current() {
    return stack[stack.length - 1] ?? null;
  }

  function classQualifier() {
    const parts = classStack.filter((part) => part);
    return parts.length ? parts.join(".") : moduleStem;
  }

  function unique(identity) {
    let currentId = identity;
    let suffix = 2;
    while (identities.has(currentId)) {
      currentId = `${identity}#${suffix++}`;
    }
    identities.add(currentId);
    return currentId;
  }

  function addUse(rec, use) {
    if (!rec.useKeys) {
      rec.useKeys = new Set();
    }
    const key = `${use.kind}\0${use.identity ?? ""}\0${use.display ?? ""}`;
    if (rec.useKeys.has(key)) {
      return;
    }
    rec.useKeys.add(key);
    rec.uses.push(use);
  }

  function locationOf(node) {
    const source = node.getSourceFile();
    const start = node.getStart(source, false);
    const end = node.getEnd();
    const startPos = source.getLineAndCharacterOfPosition(start);
    const endPos = source.getLineAndCharacterOfPosition(Math.max(start, end - 1));
    return {
      startLine: startPos.line + 1,
      endLine: endPos.line + 1,
      startColumn: startPos.character + 1,
      startOffset: start,
      endOffset: end,
    };
  }

  function defineRec(node, { name, kind, paramTypes, hostIdentity, hostKey, hostLabel, memberName }) {
    const loc = locationOf(node);
    const className = methodClassName(node);
    const params = (paramTypes ?? []).map(shortType);
    const paramText = params.join(",");
    const rec = {
      language,
      name,
      className,
      packagePath,
      kind,
      hostIdentity: hostIdentity ?? null,
      hostLabel: hostLabel ?? null,
      hostKey: hostKey ?? null,
      file: currentFile,
      ...loc,
      paramTypes: params,
      uses: [],
      useKeys: new Set(),
    };
    if (kind === "匿名") {
      let identity = `${head(packagePath, className)}#${hostIdentity}@${currentFile}:${loc.startLine}:${loc.startColumn}`;
      if (memberName) {
        identity += `#${memberName}(${paramText})`;
      }
      rec.identity = unique(identity);
    } else {
      rec.identity = unique(namedIdentity(packagePath, className, name, paramText));
    }
    return rec;
  }

  function methodClassName(node) {
    if (ts.isMethodDeclaration(node) && node.parent && ts.isObjectLiteralExpression(node.parent)) {
      const bound = objectBinding(node.parent);
      if (bound) {
        return bound;
      }
    }
    return classQualifier() || moduleStem || "（无）";
  }

  function objectBinding(obj) {
    const parent = obj.parent;
    if (!parent) {
      return null;
    }
    if ((ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) && parent.name && ts.isIdentifier(parent.name)) {
      const name = parent.name.text;
      if (name === "methods" || name === "computed" || name === "setup") {
        return null;
      }
      return name;
    }
    return null;
  }

  function paramTypesOf(node) {
    try {
      const signature = checker.getSignatureFromDeclaration(node);
      if (signature) {
        return signature.getParameters().map((parameter) => {
          const declaration = parameter.valueDeclaration ?? node;
          return checker.typeToString(
            checker.getTypeOfSymbolAtLocation(parameter, declaration),
            node,
            ts.TypeFormatFlags.NoTruncation,
          );
        });
      }
    } catch {
      // 签名取不到时改用写在源码里的类型。
    }
    return (node.parameters ?? []).map((parameter) => (parameter.type ? parameter.type.getText() : "any"));
  }

  function bindSymbol(nameNode, rec) {
    if (!nameNode) {
      return;
    }
    const symbol = checker.getSymbolAtLocation(nameNode);
    if (symbol) {
      symbolToRec.set(symbol, rec);
    }
  }

  function rememberClass(node, className) {
    const nameNode = node.name && ts.isIdentifier(node.name) ? node.name : null;
    const symbol = nameNode ? checker.getSymbolAtLocation(nameNode) : null;
    const simple = className.includes(".") ? className.slice(className.lastIndexOf(".") + 1) : className;
    const info = { packagePath, className, simple };
    if (symbol) {
      classInfoBySymbol.set(symbol, info);
    }
    if (ts.isClassExpression(node) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
      const binding = checker.getSymbolAtLocation(node.parent.name);
      if (binding) {
        classInfoBySymbol.set(binding, info);
      }
    }
  }

  function isAnonymousMember(node) {
    const parent = node.parent;
    if (!parent) {
      return false;
    }
    if ((ts.isClassDeclaration(parent) || ts.isClassExpression(parent)) && !classLabel(parent)) {
      return true;
    }
    return false;
  }

  function classLabel(node) {
    if (node.name && ts.isIdentifier(node.name)) {
      return node.name.text;
    }
    if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
      return node.parent.name.text;
    }
    return null;
  }

  function funcName(node) {
    if (ts.isConstructorDeclaration(node) || ts.isConstructSignatureDeclaration(node)) {
      const qualifier = classQualifier();
      const simple = qualifier.includes(".") ? qualifier.slice(qualifier.lastIndexOf(".") + 1) : qualifier;
      return simple || "构造";
    }
    if (!node.name) {
      return null;
    }
    if (ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name)) {
      const text = node.name.text;
      if (ts.isGetAccessor(node)) {
        return `get ${text}`;
      }
      if (ts.isSetAccessor(node)) {
        return `set ${text}`;
      }
      return text;
    }
    return node.name.getText().replace(/\s+/g, " ").trim();
  }

  function siblingsOf(node) {
    const parent = node.parent;
    if (!parent) {
      return [];
    }
    if (ts.isClassLike(parent) || ts.isInterfaceDeclaration(parent) || ts.isObjectLiteralExpression(parent) || ts.isTypeLiteralNode(parent)) {
      return parent.members ?? [];
    }
    if (ts.isModuleBlock(parent) || ts.isSourceFile(parent) || ts.isBlock(parent)) {
      return parent.statements ?? [];
    }
    return [];
  }

  function shouldSkipOverload(node) {
    if (node.body) {
      return false;
    }
    if (ts.isConstructorDeclaration(node) || ts.isMethodSignature(node) || ts.isConstructSignatureDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) {
      return false;
    }
    const name = funcName(node);
    if (!name) {
      return false;
    }
    return siblingsOf(node).some((sibling) => sibling !== node && sibling.body && funcName(sibling) === name);
  }

  function hostForAnonymous(node) {
    const host = current();
    if (host) {
      return { hostIdentity: host.identity, hostKey: host.identity, hostLabel: null };
    }
    const label = syntheticLabel(node);
    const className = classQualifier() || moduleStem || "（无）";
    return {
      hostIdentity: namedIdentity(packagePath, className, label, ""),
      hostKey: null,
      hostLabel: label,
    };
  }

  function syntheticLabel(node) {
    let parent = node.parent;
    while (parent) {
      if ((ts.isPropertyDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isVariableDeclaration(parent)) && parent.name && ts.isIdentifier(parent.name)) {
        return parent.name.text;
      }
      if (ts.isClassStaticBlockDeclaration(parent)) {
        return "clinit";
      }
      parent = parent.parent;
    }
    return "顶层";
  }

  function handleFunctionLike(node) {
    if (shouldSkipOverload(node)) {
      if (mode === "define") {
        overloadNodes.push(node);
      }
      return;
    }
    let rec = byNode.get(node);
    if (mode === "define") {
      const anonymousMember = isAnonymousMember(node);
      const name = funcName(node) || "匿名";
      const constructor = ts.isConstructorDeclaration(node) || ts.isConstructSignatureDeclaration(node);
      const host = anonymousMember ? hostForAnonymous(node) : null;
      rec = defineRec(node, {
        name: anonymousMember ? name : constructor ? name : name,
        kind: anonymousMember ? "匿名" : constructor ? "具名 · 构造" : "具名",
        paramTypes: paramTypesOf(node),
        hostIdentity: host?.hostIdentity,
        hostKey: host?.hostKey,
        hostLabel: host?.hostLabel,
        memberName: anonymousMember ? name : null,
      });
      byNode.set(node, rec);
      methods.push(rec);
      bindSymbol(node.name, rec);
      const enclosing = current();
      if (rec.kind === "匿名" && enclosing) {
        addUse(enclosing, { kind: "匿名", identity: rec.identity });
      }
    }
    if (!rec) {
      return;
    }
    stack.push(rec);
    walkInnards(node);
    stack.pop();
  }

  function handleNamedBinding(node) {
    const fn = node.initializer;
    let rec = byNode.get(fn);
    if (mode === "define") {
      rec = defineRec(fn, {
        name: node.name.text,
        kind: "具名",
        paramTypes: paramTypesOf(fn),
      });
      byNode.set(fn, rec);
      byNode.set(node, rec);
      methods.push(rec);
      bindSymbol(node.name, rec);
      if (ts.isFunctionExpression(fn) && fn.name) {
        bindSymbol(fn.name, rec);
      }
    }
    if (!rec) {
      return;
    }
    stack.push(rec);
    walkInnards(fn);
    stack.pop();
  }

  function handleAnonymous(node) {
    let rec = byNode.get(node);
    if (mode === "define") {
      const host = hostForAnonymous(node);
      const internal = ts.isFunctionExpression(node) && node.name ? node.name.text : null;
      rec = defineRec(node, {
        name: internal || "匿名",
        kind: "匿名",
        paramTypes: paramTypesOf(node),
        hostIdentity: host.hostIdentity,
        hostKey: host.hostKey,
        hostLabel: host.hostLabel,
        memberName: internal,
      });
      byNode.set(node, rec);
      methods.push(rec);
      if (internal) {
        bindSymbol(node.name, rec);
      }
      const enclosing = current();
      if (enclosing) {
        addUse(enclosing, { kind: "匿名", identity: rec.identity });
      }
    }
    if (!rec) {
      return;
    }
    stack.push(rec);
    walkInnards(node);
    stack.pop();
  }

  function walkInnards(node) {
    for (const parameter of node.parameters ?? []) {
      walk(parameter);
    }
    if (node.body) {
      walk(node.body);
    }
  }

  function walk(node) {
    if (!node || typeof node.kind !== "number") {
      return;
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const label = classLabel(node);
      classStack.push(label);
      if (mode === "define" && label) {
        rememberClass(node, classQualifier());
      }
      for (const member of node.members) {
        walk(member);
      }
      classStack.pop();
      return;
    }
    if (ts.isInterfaceDeclaration(node)) {
      classStack.push(node.name?.text ?? null);
      for (const member of node.members) {
        walk(member);
      }
      classStack.pop();
      return;
    }
    if (ts.isModuleDeclaration(node) && node.body && ts.isModuleBlock(node.body) && ts.isIdentifier(node.name)) {
      classStack.push(node.name.text);
      for (const statement of node.body.statements) {
        walk(statement);
      }
      classStack.pop();
      return;
    }
    if (isFunctionLike(node)) {
      handleFunctionLike(node);
      return;
    }
    if (isNamedFunctionBinding(node)) {
      handleNamedBinding(node);
      return;
    }
    if (isFn(node)) {
      handleAnonymous(node);
      return;
    }
    if (mode === "resolve" && (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node))) {
      if (current()) {
        recordCall(node);
      }
      ts.forEachChild(node, walk);
      return;
    }
    if (mode === "resolve" && isPotentialRef(node)) {
      if (current()) {
        recordRef(node);
      }
      return;
    }
    ts.forEachChild(node, walk);
  }

  function recordCall(node) {
    const caller = current();
    const callee = calleeNode(node);
    const seen = displayText(callee ? callee.getText() : node.getText());
    const found = recForCall(node);
    if (found) {
      addUse(caller, { kind: found.kind === "匿名" ? "匿名" : "具名", identity: found.identity });
      return;
    }
    const symbol = symbolAtCallee(callee);
    if (ts.isNewExpression(node) && symbol) {
      const info = classInfoBySymbol.get(aliasOf(symbol));
      if (info && (node.arguments?.length ?? 0) === 0) {
        addUse(caller, { kind: "具名", identity: namedIdentity(info.packagePath, info.className, info.simple, "") });
        return;
      }
    }
    if (symbol && isExternal(symbol)) {
      addUse(caller, { kind: "项目外", display: seen || "（空）" });
      return;
    }
    if (symbol && isGlobalExternal(callee)) {
      addUse(caller, { kind: "项目外", display: seen || "（空）" });
      return;
    }
    addUse(caller, { kind: "未能解析", display: seen || "（空）" });
  }

  function recordRef(node) {
    const caller = current();
    const symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain(node) ? node.name : node);
    if (!symbol || !isCallableSymbol(symbol)) {
      return;
    }
    const found = recForSymbol(symbol);
    const seen = displayText(node.getText());
    if (found) {
      addUse(caller, { kind: found.kind === "匿名" ? "匿名" : "具名", identity: found.identity });
      return;
    }
    if (isExternal(symbol) || isGlobalExternal(node)) {
      addUse(caller, { kind: "项目外", display: seen || "（空）" });
      return;
    }
    addUse(caller, { kind: "未能解析", display: seen || "（空）" });
  }

  function recForCall(node) {
    const signature = checker.getResolvedSignature(node);
    const declaration = signature?.declaration;
    if (declaration && byNode.has(declaration)) {
      return byNode.get(declaration);
    }
    const symbol = symbolAtCallee(calleeNode(node));
    return symbol ? recForSymbol(symbol) : null;
  }

  function recForSymbol(symbol) {
    if (!symbol) {
      return null;
    }
    if (symbolToRec.has(symbol)) {
      return symbolToRec.get(symbol);
    }
    const aliased = aliasOf(symbol);
    if (symbolToRec.has(aliased)) {
      return symbolToRec.get(aliased);
    }
    for (const declaration of aliased.declarations ?? []) {
      if (byNode.has(declaration)) {
        return byNode.get(declaration);
      }
      if (ts.isVariableDeclaration(declaration) && declaration.initializer && byNode.has(declaration.initializer)) {
        return byNode.get(declaration.initializer);
      }
    }
    return null;
  }

  function aliasOf(symbol) {
    if (symbol.flags & ts.SymbolFlags.Alias) {
      try {
        return checker.getAliasedSymbol(symbol);
      } catch {
        return symbol;
      }
    }
    return symbol;
  }

  function isExternal(symbol) {
    const aliased = aliasOf(symbol);
    const declarations = aliased.declarations ?? [];
    if (!declarations.length) {
      return false;
    }
    return declarations.every((declaration) => !projectFiles.has(canon(declaration.getSourceFile().fileName)));
  }

  function isGlobalExternal(node) {
    if (!node) {
      return false;
    }
    const text = ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain(node) ? node.expression.getText() : node.getText();
    const root = text.split(/[.?(]/)[0];
    return GLOBAL_ROOTS.has(root);
  }

  function isCallableSymbol(symbol) {
    const aliased = aliasOf(symbol);
    const flags = ts.SymbolFlags;
    if (aliased.flags & (flags.Function | flags.Method | flags.Constructor | flags.Signature)) {
      return true;
    }
    const declaration = aliased.valueDeclaration ?? aliased.declarations?.[0];
    if (!declaration) {
      return false;
    }
    const type = checker.getTypeOfSymbolAtLocation(aliased, declaration);
    return type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0;
  }

  function calleeNode(node) {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      return node.expression;
    }
    if (ts.isTaggedTemplateExpression(node)) {
      return node.tag;
    }
    return null;
  }

  function symbolAtCallee(callee) {
    if (!callee) {
      return null;
    }
    if ((ts.isPropertyAccessExpression(callee) || ts.isPropertyAccessChain(callee)) && ts.isIdentifier(callee.name)) {
      return checker.getSymbolAtLocation(callee.name);
    }
    if (ts.isIdentifier(callee)) {
      return checker.getSymbolAtLocation(callee);
    }
    return null;
  }

  for (const file of programFiles) {
    const source = program.getSourceFile(file);
    if (!source) {
      console.error(`跳过 ${relative(root, file)}：没有读到源码。`);
      continue;
    }
    beginFile(file);
    try {
      walk(source);
    } catch (error) {
      console.error(`跳过 ${currentFile}：${error.message}`);
    } finally {
      classStack = [];
      stack = [];
    }
  }

  for (const node of overloadNodes) {
    const name = funcName(node);
    const implementation = siblingsOf(node).find((sibling) => sibling !== node && sibling.body && funcName(sibling) === name);
    if (implementation && byNode.has(implementation)) {
      byNode.set(node, byNode.get(implementation));
    }
  }

  mode = "resolve";
  for (const file of programFiles) {
    const source = program.getSourceFile(file);
    if (!source) {
      continue;
    }
    beginFile(file);
    try {
      walk(source);
    } catch (error) {
      console.error(`跳过 ${currentFile} 的调用：${error.message}`);
    } finally {
      classStack = [];
      stack = [];
    }
  }

  for (const file of absFiles) {
    if (!file.endsWith(".vue")) {
      continue;
    }
    const prepared = vueByCanon.get(canon(file));
    if (!prepared?.descriptor.template) {
      continue;
    }
    beginFile(file);
    try {
      attachTemplate(prepared, program.getSourceFile(file));
    } catch (error) {
      console.error(`跳过 ${currentFile} 的模板：${error.message}`);
    }
  }

  for (const method of methods) {
    delete method.useKeys;
  }
  return methods;

  function beginFile(file) {
    currentFile = relByCanon.get(canon(file)) ?? relative(root, file);
    language = languageOf(currentFile);
    moduleStem = path.posix.basename(currentFile).replace(/\.[^.]+$/, "");
    const dir = path.posix.dirname(currentFile);
    packagePath = dir === "." ? "" : dir;
    classStack = [];
    stack = [];
  }

  function attachTemplate(prepared, sourceFile) {
    const nameMap = buildNameMap(prepared.rel, sourceFile);
    const template = prepared.descriptor.template;
    const ast = parseTemplate(template.content, { comments: true });
    for (const expr of collectExpressions(ast, template)) {
      addTemplateExpression(expr, nameMap);
    }
  }

  function buildNameMap(file, sourceFile) {
    const map = new Map();
    const put = (name, value) => {
      if (!name) {
        return;
      }
      const existing = map.get(name);
      if (!existing) {
        map.set(name, value);
        return;
      }
      if (existing.identity && existing.identity === value.identity) {
        return;
      }
      map.set(name, { kind: "未能解析", display: name });
    };
    for (const method of methods) {
      if (method.file === file && method.kind !== "匿名" && method.name && method.name !== "匿名") {
        put(method.name, { kind: "具名", identity: method.identity });
      }
    }
    if (!sourceFile) {
      return map;
    }
    const visitImports = (node) => {
      if (ts.isImportDeclaration(node) && node.importClause) {
        const clause = node.importClause;
        if (clause.name) {
          putImport(clause.name.text, clause.name, put);
        }
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
          putImport(bindings.name.text, bindings.name, put);
        }
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            putImport(element.name.text, element.name, put);
          }
        }
      }
      ts.forEachChild(node, visitImports);
    };
    visitImports(sourceFile);
    return map;
  }

  function putImport(localName, nameNode, put) {
    const symbol = checker.getSymbolAtLocation(nameNode);
    if (!symbol) {
      return;
    }
    const found = recForSymbol(symbol);
    if (found) {
      put(localName, { kind: found.kind === "匿名" ? "匿名" : "具名", identity: found.identity });
      return;
    }
    if (isExternal(symbol)) {
      put(localName, { kind: "项目外", display: localName });
    }
  }

  function collectExpressions(node, template, acc = []) {
    if (!node || typeof node !== "object") {
      return acc;
    }
    if (node.type === NodeTypes.INTERPOLATION && node.content?.content) {
      acc.push(expressionAt(node.content, template, null));
    }
    if (node.type === NodeTypes.DIRECTIVE && node.exp?.content) {
      acc.push(expressionAt(node.exp, template, node.name));
    }
    for (const child of node.children ?? []) {
      collectExpressions(child, template, acc);
    }
    for (const prop of node.props ?? []) {
      collectExpressions(prop, template, acc);
    }
    for (const branch of node.branches ?? []) {
      collectExpressions(branch, template, acc);
    }
    return acc;
  }

  function expressionAt(exp, template, directive) {
    return {
      content: exp.content,
      directive,
      line: template.loc.start.line - 1 + exp.loc.start.line,
      column: exp.loc.start.column,
      offset: template.loc.start.offset + exp.loc.start.offset,
      endOffset: template.loc.start.offset + exp.loc.end.offset,
    };
  }

  function addTemplateExpression(expr, nameMap) {
    let content = expr.content;
    let delta = 0;
    if (!content.trim()) {
      return;
    }
    if (expr.directive === "for") {
      const index = content.lastIndexOf(" in ");
      if (index >= 0) {
        delta = index + 4;
        content = content.slice(delta);
      }
    }
    const placed = {
      ...expr,
      offset: expr.offset + delta,
      column: expr.column + delta,
    };
    const source = ts.createSourceFile("tpl.ts", content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    if (source.parseDiagnostics?.length) {
      return;
    }
    const statement = source.statements[0];
    const top = statement && ts.isExpressionStatement(statement) && isFn(statement.expression) ? statement.expression : null;
    if (top && source.statements.length === 1) {
      const rec = templateRec(placed, top, null);
      methods.push(rec);
      walkTemplateBody(top, rec, nameMap);
      return;
    }
    const found = { uses: [], nested: [] };
    collectTemplateUses(source, found, nameMap);
    if (!found.uses.length && !found.nested.length) {
      return;
    }
    const wrapper = templateRec(placed, null, null);
    for (const use of found.uses) {
      addUse(wrapper, use);
    }
    methods.push(wrapper);
    for (const nested of found.nested) {
      const child = templateRec(expr, nested, wrapper);
      addUse(wrapper, { kind: "匿名", identity: child.identity });
      methods.push(child);
      walkTemplateBody(nested, child, nameMap);
    }
  }

  function templateRec(expr, fn, hostRec) {
    const className = moduleStem || "（无）";
    const host = hostRec
      ? { hostIdentity: hostRec.identity, hostKey: hostRec.identity, hostLabel: null }
      : {
          hostIdentity: namedIdentity(packagePath, className, "模板", ""),
          hostKey: null,
          hostLabel: "模板",
        };
    const internal = fn && ts.isFunctionExpression(fn) && fn.name ? fn.name.text : null;
    const params = fn ? (fn.parameters ?? []).map((parameter) => (parameter.type ? parameter.type.getText() : "any")) : [];
    const loc = {
      startLine: expr.line,
      endLine: expr.endLine ?? expr.line,
      startColumn: expr.column,
      startOffset: expr.offset,
      endOffset: expr.endOffset,
    };
    const rec = {
      language: "vue",
      name: internal || "匿名",
      className,
      packagePath,
      kind: "匿名",
      hostIdentity: host.hostIdentity,
      hostLabel: host.hostLabel,
      hostKey: host.hostKey,
      file: currentFile,
      ...loc,
      paramTypes: params.map(shortType),
      uses: [],
      useKeys: new Set(),
    };
    let identity = `${head(packagePath, className)}#${host.hostIdentity}@${currentFile}:${loc.startLine}:${loc.startColumn}`;
    if (internal) {
      identity += `#${internal}(${rec.paramTypes.join(",")})`;
    }
    rec.identity = unique(identity);
    return rec;
  }

  function walkTemplateBody(fn, rec, nameMap) {
    const found = { uses: [], nested: [] };
    if (fn.body) {
      collectTemplateUses(fn.body, found, nameMap);
    }
    for (const use of found.uses) {
      addUse(rec, use);
    }
    for (const nested of found.nested) {
      const nestedStart = nested.getStart(nested.getSourceFile());
      const child = templateRec(
        {
          content: nested.getText(),
          line: rec.startLine,
          endLine: rec.startLine,
          column: rec.startColumn,
          offset: rec.startOffset + nestedStart,
          endOffset: rec.startOffset + nested.getEnd(),
        },
        nested,
        rec,
      );
      addUse(rec, { kind: "匿名", identity: child.identity });
      methods.push(child);
      walkTemplateBody(nested, child, nameMap);
    }
  }

  function collectTemplateUses(node, found, nameMap) {
    if (!node || typeof node.kind !== "number") {
      return;
    }
    if (isFn(node) && node.getSourceFile().fileName === "tpl.ts") {
      const source = node.getSourceFile();
      const statement = source.statements[0];
      const top = statement && ts.isExpressionStatement(statement) && statement.expression === node;
      if (!top) {
        found.nested.push(node);
        return;
      }
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const use = lookupCall(node, nameMap);
      if (use) {
        found.uses.push(use);
      }
    } else if (isPotentialRef(node)) {
      const use = lookupRef(node, nameMap);
      if (use) {
        found.uses.push(use);
      }
      return;
    }
    ts.forEachChild(node, (child) => collectTemplateUses(child, found, nameMap));
  }

  function lookupCall(node, nameMap) {
    const callee = calleeNode(node);
    const seen = displayText(callee ? callee.getText() : node.getText());
    if (callee && ts.isIdentifier(callee)) {
      return mapped(nameMap.get(callee.text), seen);
    }
    if (callee && (ts.isPropertyAccessExpression(callee) || ts.isPropertyAccessChain(callee)) && ts.isIdentifier(callee.name)) {
      if (callee.expression.kind === ts.SyntaxKind.ThisKeyword) {
        return mapped(nameMap.get(callee.name.text), seen);
      }
      if (isGlobalExternal(callee)) {
        return { kind: "项目外", display: seen || "（空）" };
      }
    }
    if (isGlobalExternal(callee)) {
      return { kind: "项目外", display: seen || "（空）" };
    }
    return { kind: "未能解析", display: seen || "（空）" };
  }

  function lookupRef(node, nameMap) {
    if (ts.isIdentifier(node)) {
      const value = nameMap.get(node.text);
      if (!value) {
        return null;
      }
      return mapped(value, node.text);
    }
    if ((ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain(node)) && ts.isIdentifier(node.name)) {
      if (node.expression.kind === ts.SyntaxKind.ThisKeyword) {
        return mapped(nameMap.get(node.name.text), displayText(node.getText()));
      }
    }
    return null;
  }

  function mapped(value, seen) {
    if (!value) {
      return { kind: "未能解析", display: seen || "（空）" };
    }
    if (value.kind === "项目外") {
      return { kind: "项目外", display: seen || value.display || "（空）" };
    }
    if (value.identity) {
      return { kind: value.kind === "匿名" ? "匿名" : "具名", identity: value.identity };
    }
    return { kind: "未能解析", display: seen || "（空）" };
  }
}

function prepareVue(file, rel) {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    console.error(`跳过 ${rel}：${error.message}`);
    return null;
  }
  let parsed;
  try {
    parsed = parseSfc(text, { filename: rel });
  } catch (error) {
    console.error(`跳过 ${rel}：${error.message}`);
    return null;
  }
  const { descriptor } = parsed;
  const langs = [descriptor.script?.lang, descriptor.scriptSetup?.lang].filter((lang) => lang !== undefined);
  const supported = new Set(["js", "javascript", "jsx", "ts", "tsx", "typescript"]);
  if (langs.some((lang) => !supported.has(lang))) {
    console.error(`跳过 ${rel}：脚本语言 ${langs.join(", ")} 不在这次范围内。`);
    return null;
  }
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i += 1) {
    if (chars[i] !== "\n") {
      chars[i] = " ";
    }
  }
  const keep = (block) => {
    if (!block) {
      return;
    }
    for (let i = block.loc.start.offset; i < block.loc.end.offset && i < text.length; i += 1) {
      chars[i] = text[i];
    }
  };
  keep(descriptor.script);
  keep(descriptor.scriptSetup);
  let scriptKind = ts.ScriptKind.JS;
  if (langs.some((lang) => lang === "tsx" || lang === "jsx")) {
    scriptKind = ts.ScriptKind.TSX;
  } else if (langs.some((lang) => lang === "ts" || lang === "typescript")) {
    scriptKind = ts.ScriptKind.TS;
  }
  return { rel, descriptor, shadow: chars.join(""), scriptKind };
}

function isFn(node) {
  return Boolean(node) && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
}

function isFunctionLike(node) {
  return ts.isFunctionDeclaration(node)
    || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node)
    || ts.isGetAccessor(node)
    || ts.isSetAccessor(node)
    || ts.isMethodSignature(node)
    || ts.isConstructSignatureDeclaration(node);
}

function isNamedFunctionBinding(node) {
  return (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node))
    && node.initializer
    && isFn(node.initializer)
    && node.name
    && ts.isIdentifier(node.name);
}

function isPotentialRef(node) {
  if (!ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node) && !ts.isPropertyAccessChain(node)) {
    return false;
  }
  if (isCalleeName(node) || isDeclarationName(node) || inTypePosition(node)) {
    return false;
  }
  if (ts.isIdentifier(node) && node.parent && (ts.isPropertyAccessExpression(node.parent) || ts.isPropertyAccessChain(node.parent)) && node.parent.name === node) {
    return false;
  }
  return true;
}

function isCalleeName(node) {
  const parent = node.parent;
  if (!parent) {
    return false;
  }
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node) {
    return true;
  }
  if (ts.isTaggedTemplateExpression(parent) && parent.tag === node) {
    return true;
  }
  if ((ts.isPropertyAccessExpression(parent) || ts.isPropertyAccessChain(parent)) && parent.name === node) {
    return isCalleeName(parent);
  }
  return false;
}

function isDeclarationName(node) {
  const parent = node.parent;
  if (!parent || parent.name !== node) {
    return false;
  }
  return ts.isFunctionDeclaration(parent)
    || ts.isMethodDeclaration(parent)
    || ts.isClassDeclaration(parent)
    || ts.isClassExpression(parent)
    || ts.isVariableDeclaration(parent)
    || ts.isPropertyDeclaration(parent)
    || ts.isPropertyAssignment(parent)
    || ts.isMethodSignature(parent)
    || ts.isGetAccessor(parent)
    || ts.isSetAccessor(parent)
    || ts.isInterfaceDeclaration(parent)
    || ts.isParameter(parent);
}

function inTypePosition(node) {
  let parent = node.parent;
  while (parent) {
    if (ts.isTypeNode(parent)) {
      return true;
    }
    parent = parent.parent;
  }
  return false;
}

function namedIdentity(packagePath, className, name, params) {
  return `${head(packagePath, className)}#${name}(${params ?? ""})`;
}

function head(packagePath, className) {
  const name = className || "（无）";
  return packagePath ? `${packagePath}.${name}` : name;
}

function shortType(value) {
  const text = String(value ?? "any").replace(/\s+/g, "");
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function displayText(value) {
  return String(value ?? "").replace(/\s+/g, " ").replace(/`/g, "'").trim().slice(0, 120);
}

function languageOf(file) {
  if (file.endsWith(".vue")) {
    return "vue";
  }
  if (file.endsWith(".ts") || file.endsWith(".tsx") || file.endsWith(".mts") || file.endsWith(".cts")) {
    return "typescript";
  }
  return "javascript";
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function canon(file) {
  const resolved = path.resolve(file);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
