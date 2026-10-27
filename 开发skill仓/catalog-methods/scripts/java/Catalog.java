import com.sun.source.tree.BlockTree;
import com.sun.source.tree.ClassTree;
import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.ExpressionTree;
import com.sun.source.tree.LambdaExpressionTree;
import com.sun.source.tree.LineMap;
import com.sun.source.tree.MemberReferenceTree;
import com.sun.source.tree.MethodInvocationTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.tree.NewClassTree;
import com.sun.source.tree.Tree;
import com.sun.source.tree.VariableTree;
import com.sun.source.util.SourcePositions;
import com.sun.source.util.TreePath;
import com.sun.source.util.TreeScanner;
import com.sun.source.util.Trees;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import javax.lang.model.element.Element;
import javax.lang.model.element.ElementKind;
import javax.lang.model.element.ExecutableElement;
import javax.lang.model.element.NestingKind;
import javax.lang.model.element.PackageElement;
import javax.lang.model.element.TypeElement;
import javax.lang.model.element.VariableElement;
import javax.lang.model.type.ArrayType;
import javax.lang.model.type.TypeKind;
import javax.lang.model.type.TypeMirror;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticListener;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;

public class Catalog {
    public static void main(String[] args) throws Exception {
        System.setOut(new PrintStream(System.out, true, StandardCharsets.UTF_8));
        System.setErr(new PrintStream(System.err, true, StandardCharsets.UTF_8));
        Path project = null;
        Path list = null;
        Path out = null;
        for (int i = 0; i < args.length; i++) {
            switch (args[i]) {
                case "--project" -> project = Path.of(args[++i]);
                case "--list" -> list = Path.of(args[++i]);
                case "--out" -> out = Path.of(args[++i]);
                default -> throw new IllegalArgumentException("未知参数：" + args[i]);
            }
        }
        if (project == null || list == null || out == null) {
            throw new IllegalArgumentException("需要 --project、--list 和 --out。");
        }
        List<Path> files = readList(list);
        List<MethodRec> methods = files.isEmpty() ? List.of() : scan(project.toAbsolutePath().normalize(), files);
        Files.createDirectories(out.getParent() == null ? Path.of(".") : out.getParent());
        Files.writeString(out, toJson(methods), StandardCharsets.UTF_8);
    }

    private static List<Path> readList(Path list) throws IOException {
        List<Path> files = new ArrayList<>();
        for (String line : Files.readAllLines(list, StandardCharsets.UTF_8)) {
            if (!line.isBlank()) {
                files.add(Path.of(line.trim()));
            }
        }
        return files;
    }

    private static List<MethodRec> scan(Path project, List<Path> files) throws IOException {
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) {
            throw new IllegalStateException("找不到系统 Java 编译器。请使用 JDK，而不是只有 JRE。");
        }
        int[] errors = {0};
        DiagnosticListener<JavaFileObject> listener = diagnostic -> {
            if (diagnostic.getKind() == Diagnostic.Kind.ERROR) {
                errors[0]++;
            }
        };
        try (StandardJavaFileManager fm = compiler.getStandardFileManager(listener, Locale.ROOT, StandardCharsets.UTF_8)) {
            Path classOut = Files.createTempDirectory("catalog-methods-");
            try {
                List<String> options = List.of(
                        "-d", classOut.toString(),
                        "-encoding", "UTF-8",
                        "-proc:none",
                        "-Xlint:none",
                        "--release", "21");
                Iterable<? extends JavaFileObject> objects = fm.getJavaFileObjectsFromPaths(files);
                var task = (com.sun.source.util.JavacTask) compiler.getTask(
                        null, fm, listener, options, null, objects);
                Iterable<? extends CompilationUnitTree> units = task.parse();
                try {
                    task.analyze();
                } catch (RuntimeException ex) {
                    System.err.println("Java 类型分析没有完成，调用目标能确定的仍会写入：" + ex.getMessage());
                }
                if (errors[0] > 0) {
                    System.err.println("Java 源码有 " + errors[0] + " 条错误，能确定的方法仍会写入。");
                }
                Trees trees = Trees.instance(task);
                SourcePositions positions = trees.getSourcePositions();
                Scanner scanner = new Scanner(project, trees, positions);
                for (CompilationUnitTree unit : units) {
                    scanner.scanUnit(unit, false);
                }
                for (CompilationUnitTree unit : units) {
                    scanner.scanUnit(unit, true);
                }
                scanner.finish();
                return scanner.methods;
            } finally {
                deleteAll(classOut);
            }
        }
    }

    private static final class Use {
        final String kind;
        final String identity;
        final String display;

        Use(String kind, String identity, String display) {
            this.kind = kind;
            this.identity = identity;
            this.display = display;
        }
    }

    private static final class MethodRec {
        String language = "java";
        String name;
        String className;
        String packagePath;
        String kind;
        String identity;
        String hostIdentity;
        String hostLabel;
        String hostKey;
        String file;
        int startLine;
        int endLine;
        int startColumn;
        long startOffset;
        long endOffset;
        List<String> paramTypes = new ArrayList<>();
        List<Use> uses = new ArrayList<>();
        Set<String> useKeys = new HashSet<>();

        void addUse(String kind, String identity, String display) {
            String key = kind + "\0" + (identity == null ? "" : identity) + "\0" + (display == null ? "" : display);
            if (!useKeys.add(key)) {
                return;
            }
            uses.add(new Use(kind, identity, display));
        }
    }

    private static final class ClassFrame {
        final String packageName;
        final String className;
        final boolean anonymous;

        ClassFrame(String packageName, String className, boolean anonymous) {
            this.packageName = packageName == null ? "" : packageName;
            this.className = className == null ? "" : className;
            this.anonymous = anonymous;
        }
    }

    private static final class Scanner extends TreeScanner<Void, Void> {
        private final Path project;
        private final Trees trees;
        private final SourcePositions positions;
        private final List<MethodRec> methods = new ArrayList<>();
        private final IdentityHashMap<Tree, MethodRec> byTree = new IdentityHashMap<>();
        private final IdentityHashMap<ExecutableElement, MethodRec> byElement = new IdentityHashMap<>();
        private final Set<String> identities = new HashSet<>();
        private final ArrayDeque<ClassFrame> classStack = new ArrayDeque<>();
        private final ArrayDeque<MethodRec> methodStack = new ArrayDeque<>();
        private TreePath currentPath;
        private CompilationUnitTree unit;
        private String file = "";
        private String text = "";
        private boolean resolveUses;

        Scanner(Path project, Trees trees, SourcePositions positions) {
            this.project = project;
            this.trees = trees;
            this.positions = positions;
        }

        void scanUnit(CompilationUnitTree unit, boolean resolveUses) {
            this.resolveUses = resolveUses;
            this.unit = unit;
            this.file = relative(unit);
            if (this.file == null) {
                return;
            }
            try {
                this.text = unit.getSourceFile().getCharContent(true).toString();
            } catch (IOException ex) {
                this.text = "";
            }
            this.currentPath = new TreePath(unit);
            unit.accept(this, null);
        }

        void finish() {
            methods.sort(Comparator
                    .comparing((MethodRec m) -> m.file)
                    .thenComparingInt(m -> m.startLine)
                    .thenComparingInt(m -> m.startColumn)
                    .thenComparing(m -> m.identity));
            for (MethodRec method : methods) {
                method.uses.sort(Comparator
                        .comparing((Use use) -> kindOrder(use.kind))
                        .thenComparing(use -> use.identity == null ? "" : use.identity)
                        .thenComparing(use -> use.display == null ? "" : use.display));
            }
        }

        @Override
        public Void scan(Tree tree, Void unused) {
            if (tree == null) {
                return null;
            }
            TreePath previous = currentPath;
            currentPath = new TreePath(previous, tree);
            try {
                return tree.accept(this, null);
            } finally {
                currentPath = previous;
            }
        }

        @Override
        public Void visitClass(ClassTree node, Void unused) {
            ClassFrame frame = classFrame(node);
            classStack.push(frame);
            try {
                return super.visitClass(node, unused);
            } finally {
                classStack.pop();
            }
        }

        @Override
        public Void visitMethod(MethodTree node, Void unused) {
            boolean anonymousClass = currentClass() != null && currentClass().anonymous;
            boolean constructor = node.getName().contentEquals("<init>");
            if (anonymousClass && constructor) {
                return super.visitMethod(node, unused);
            }
            MethodRec rec = byTree.get(node);
            if (!resolveUses) {
                rec = defineMethod(node, anonymousClass, constructor);
                if (rec != null) {
                    byTree.put(node, rec);
                    methods.add(rec);
                    Element element = trees.getElement(currentPath);
                    if (element instanceof ExecutableElement executable) {
                        byElement.put(executable, rec);
                    }
                    MethodRec host = currentMethod();
                    if ("匿名".equals(rec.kind) && host != null) {
                        host.addUse("匿名", rec.identity, null);
                    }
                }
            }
            if (rec == null) {
                return super.visitMethod(node, unused);
            }
            methodStack.push(rec);
            try {
                return super.visitMethod(node, unused);
            } finally {
                methodStack.pop();
            }
        }

        @Override
        public Void visitLambdaExpression(LambdaExpressionTree node, Void unused) {
            MethodRec rec = byTree.get(node);
            if (!resolveUses) {
                rec = defineLambda(node);
                if (rec != null) {
                    byTree.put(node, rec);
                    methods.add(rec);
                    MethodRec host = currentMethod();
                    if (host != null) {
                        host.addUse("匿名", rec.identity, null);
                    }
                }
            }
            if (rec == null) {
                return super.visitLambdaExpression(node, unused);
            }
            methodStack.push(rec);
            try {
                return super.visitLambdaExpression(node, unused);
            } finally {
                methodStack.pop();
            }
        }

        @Override
        public Void visitMethodInvocation(MethodInvocationTree node, Void unused) {
            if (resolveUses) {
                recordInvocation(node);
            }
            return super.visitMethodInvocation(node, unused);
        }

        @Override
        public Void visitNewClass(NewClassTree node, Void unused) {
            if (resolveUses && node.getClassBody() == null) {
                recordConstructor(node);
            }
            if (node.getClassBody() == null) {
                return super.visitNewClass(node, unused);
            }
            ClassFrame frame = anonymousFrame();
            classStack.push(frame);
            try {
                return super.visitNewClass(node, unused);
            } finally {
                classStack.pop();
            }
        }

        @Override
        public Void visitMemberReference(MemberReferenceTree node, Void unused) {
            if (resolveUses) {
                recordReference(node);
            }
            return super.visitMemberReference(node, unused);
        }

        private void recordInvocation(MethodInvocationTree node) {
            MethodRec caller = currentMethod();
            if (caller == null) {
                return;
            }
            addResolvedUse(caller, snippet(node.getMethodSelect()));
        }

        private void recordConstructor(NewClassTree node) {
            MethodRec caller = currentMethod();
            if (caller == null) {
                return;
            }
            addResolvedUse(caller, snippet(node.getIdentifier()));
        }

        private void recordReference(MemberReferenceTree node) {
            MethodRec caller = currentMethod();
            if (caller == null) {
                return;
            }
            addResolvedUse(caller, snippet(node));
        }

        private void addResolvedUse(MethodRec caller, String seen) {
            Element element = trees.getElement(currentPath);
            if (element instanceof ExecutableElement executable) {
                MethodRec target = byElement.get(executable);
                if (target != null) {
                    caller.addUse(target.kind.equals("匿名") ? "匿名" : "具名", target.identity, null);
                    return;
                }
                if (declaredOnProjectType(executable)) {
                    String identity = identityFromElement(executable);
                    if (identity != null) {
                        caller.addUse("具名", identity, null);
                        return;
                    }
                    if (!seen.isBlank()) {
                        caller.addUse("未能解析", null, seen);
                    }
                    return;
                }
                if (!seen.isBlank()) {
                    caller.addUse("项目外", null, seen);
                }
                return;
            }
            if (!seen.isBlank()) {
                caller.addUse("未能解析", null, seen);
            }
        }

        private boolean inProject(Element element) {
            TreePath path = trees.getPath(element);
            if (path == null) {
                return false;
            }
            return relative(path.getCompilationUnit()) != null;
        }

        private boolean declaredOnProjectType(ExecutableElement executable) {
            if (inProject(executable)) {
                return true;
            }
            Element owner = executable.getEnclosingElement();
            return owner != null && inProject(owner);
        }

        private MethodRec defineMethod(MethodTree node, boolean anonymousClass, boolean constructor) {
            long[] range = range(node);
            if (range == null || blankRange(range)) {
                return null;
            }
            ClassFrame named = nearestNamed();
            String packageName = named == null ? packageFromUnit() : named.packageName;
            String className = named == null ? fileStem() : named.className;
            if (className.isBlank()) {
                className = fileStem();
            }
            List<String> params = parameterTypes(node);
            String paramText = String.join(",", params);
            String simple = simpleName(className);
            String methodName = constructor ? simple : node.getName().toString();
            MethodRec rec = base(packageName, className, range);
            rec.paramTypes = params;
            rec.name = methodName;
            if (anonymousClass) {
                String hostIdentity = hostIdentity();
                rec.kind = "匿名";
                rec.hostIdentity = hostIdentity;
                rec.hostKey = currentMethod() == null ? null : currentMethod().identity;
                rec.hostLabel = currentMethod() == null ? hostLabel() : null;
                rec.identity = unique(anonymousIdentity(packageName, className, hostIdentity, rec, methodName, paramText));
                return rec;
            }
            rec.kind = constructor ? "具名 · 构造" : "具名";
            rec.identity = unique(namedIdentity(packageName, className, methodName, paramText));
            return rec;
        }

        private MethodRec defineLambda(LambdaExpressionTree node) {
            long[] range = range(node);
            if (range == null) {
                return null;
            }
            ClassFrame named = nearestNamed();
            String packageName = named == null ? packageFromUnit() : named.packageName;
            String className = named == null ? fileStem() : named.className;
            if (className.isBlank()) {
                className = fileStem();
            }
            String hostIdentity = hostIdentity();
            MethodRec rec = base(packageName, className, range);
            rec.name = "匿名";
            rec.kind = "匿名";
            rec.hostIdentity = hostIdentity;
            rec.hostKey = currentMethod() == null ? null : currentMethod().identity;
            rec.hostLabel = currentMethod() == null ? hostLabel() : null;
            rec.identity = unique(anonymousIdentity(packageName, className, hostIdentity, rec, null, ""));
            return rec;
        }

        private String anonymousIdentity(
                String packageName,
                String className,
                String hostIdentity,
                MethodRec rec,
                String methodName,
                String params) {
            String id = head(packageName, className) + "#" + hostIdentity + "@" + rec.file + ":" + rec.startLine + ":" + rec.startColumn;
            if (methodName != null) {
                id += "#" + methodName + "(" + (params == null ? "" : params) + ")";
            }
            return id;
        }

        private MethodRec base(String packageName, String className, long[] range) {
            MethodRec rec = new MethodRec();
            rec.packagePath = packageName;
            rec.className = className;
            rec.file = file;
            rec.startOffset = range[0];
            rec.endOffset = range[1];
            LineMap lines = unit.getLineMap();
            rec.startLine = (int) lines.getLineNumber(range[0]);
            rec.startColumn = (int) lines.getColumnNumber(range[0]);
            long endChar = Math.max(range[0], range[1] - 1);
            rec.endLine = (int) lines.getLineNumber(endChar);
            return rec;
        }

        private String hostIdentity() {
            MethodRec host = currentMethod();
            if (host != null) {
                return host.identity;
            }
            ClassFrame named = nearestNamed();
            String packageName = named == null ? packageFromUnit() : named.packageName;
            String className = named == null ? fileStem() : named.className;
            return namedIdentity(packageName, className, hostLabel(), "");
        }

        private String hostLabel() {
            TreePath cursor = currentPath == null ? null : currentPath.getParentPath();
            while (cursor != null) {
                Tree leaf = cursor.getLeaf();
                if (leaf instanceof VariableTree variable && cursor.getParentPath() != null
                        && cursor.getParentPath().getLeaf() instanceof ClassTree) {
                    return variable.getName().toString();
                }
                if (leaf instanceof BlockTree block && cursor.getParentPath() != null
                        && cursor.getParentPath().getLeaf() instanceof ClassTree) {
                    return block.isStatic() ? "clinit" : "init块";
                }
                cursor = cursor.getParentPath();
            }
            return "顶层";
        }

        private List<String> parameterTypes(MethodTree node) {
            Element element = trees.getElement(currentPath);
            if (element instanceof ExecutableElement executable) {
                return parameterTypes(executable);
            }
            List<String> params = new ArrayList<>();
            List<? extends VariableTree> variables = node.getParameters();
            for (int i = 0; i < variables.size(); i++) {
                VariableTree variable = variables.get(i);
                String name = variable.getType() == null ? "?" : variable.getType().toString().replace("java.lang.", "");
                if (i == variables.size() - 1 && name.endsWith("[]") && parameterSource(variable).contains("...")) {
                    name = name.substring(0, name.length() - 2) + "...";
                }
                params.add(name);
            }
            return params;
        }

        private String parameterSource(VariableTree variable) {
            long start = positions.getStartPosition(unit, variable);
            long end = positions.getEndPosition(unit, variable);
            if (start < 0 || end < start || end > text.length()) {
                return "";
            }
            return text.substring((int) start, (int) end);
        }

        private List<String> parameterTypes(ExecutableElement executable) {
            List<String> params = new ArrayList<>();
            List<? extends VariableElement> variables = executable.getParameters();
            for (int i = 0; i < variables.size(); i++) {
                boolean varargs = executable.isVarArgs() && i == variables.size() - 1;
                params.add(typeName(variables.get(i).asType(), varargs));
            }
            return params;
        }

        private String identityFromElement(ExecutableElement executable) {
            if (!(executable.getEnclosingElement() instanceof TypeElement type)) {
                return null;
            }
            if (type.getNestingKind() == NestingKind.ANONYMOUS) {
                return null;
            }
            String packageName = packageName(type);
            String className = className(type);
            boolean constructor = executable.getKind() == ElementKind.CONSTRUCTOR;
            String name = constructor ? simpleName(className) : executable.getSimpleName().toString();
            if ("<init>".equals(name)) {
                name = simpleName(className);
            }
            return namedIdentity(packageName, className, name, String.join(",", parameterTypes(executable)));
        }

        private ClassFrame classFrame(ClassTree node) {
            Element element = trees.getElement(currentPath);
            if (element instanceof TypeElement type && type.getNestingKind() != NestingKind.ANONYMOUS) {
                return new ClassFrame(packageName(type), className(type), false);
            }
            return anonymousFrame(node.getSimpleName() == null ? "" : node.getSimpleName().toString());
        }

        private ClassFrame anonymousFrame() {
            return anonymousFrame("");
        }

        private ClassFrame anonymousFrame(String simple) {
            ClassFrame named = nearestNamed();
            if (named != null) {
                return new ClassFrame(named.packageName, named.className, true);
            }
            String name = simple == null || simple.isBlank() ? fileStem() : simple;
            return new ClassFrame(packageFromUnit(), name, true);
        }

        private ClassFrame nearestNamed() {
            for (ClassFrame frame : classStack) {
                if (!frame.anonymous && !frame.className.isBlank()) {
                    return frame;
                }
            }
            return null;
        }

        private ClassFrame currentClass() {
            return classStack.peekFirst();
        }

        private MethodRec currentMethod() {
            return methodStack.peekFirst();
        }

        private String packageName(TypeElement type) {
            Element element = type;
            while (element != null && !(element instanceof PackageElement)) {
                element = element.getEnclosingElement();
            }
            if (element instanceof PackageElement pkg) {
                return pkg.getQualifiedName().toString();
            }
            return packageFromUnit();
        }

        private String className(TypeElement type) {
            List<String> parts = new ArrayList<>();
            Element element = type;
            while (element instanceof TypeElement current) {
                if (current.getNestingKind() != NestingKind.ANONYMOUS && !current.getSimpleName().isEmpty()) {
                    parts.add(0, current.getSimpleName().toString());
                }
                element = current.getEnclosingElement();
            }
            return String.join(".", parts);
        }

        private String packageFromUnit() {
            ExpressionTree name = unit.getPackageName();
            return name == null ? "" : name.toString();
        }

        private String fileStem() {
            String base = Path.of(file).getFileName().toString();
            int dot = base.lastIndexOf('.');
            return dot > 0 ? base.substring(0, dot) : base;
        }

        private boolean blankRange(long[] range) {
            if (range[1] <= range[0] || text.isEmpty()) {
                return true;
            }
            int from = (int) Math.min(range[0], text.length());
            int to = (int) Math.min(range[1], text.length());
            return text.substring(from, to).isBlank();
        }

        private long[] range(Tree node) {
            long start = positions.getStartPosition(unit, node);
            long end = positions.getEndPosition(unit, node);
            if (start < 0) {
                return null;
            }
            if (end < start) {
                end = start;
            }
            return new long[] {start, end};
        }

        private String snippet(Tree node) {
            if (node == null || text.isEmpty()) {
                return "";
            }
            long start = positions.getStartPosition(unit, node);
            long end = positions.getEndPosition(unit, node);
            if (start < 0 || end < start || start > text.length()) {
                return "";
            }
            int from = (int) start;
            int to = (int) Math.min(text.length(), Math.min(end, start + 160));
            return text.substring(from, to).replaceAll("\\s+", " ").replace("`", "'").trim();
        }

        private String relative(CompilationUnitTree tree) {
            try {
                Path source = Path.of(tree.getSourceFile().toUri());
                Path relative = project.relativize(source.toAbsolutePath().normalize());
                String value = relative.toString().replace('\\', '/');
                if (value.startsWith("../") || Path.of(value).isAbsolute()) {
                    return null;
                }
                return value;
            } catch (RuntimeException ex) {
                return null;
            }
        }

        private String unique(String identity) {
            String current = identity;
            int suffix = 2;
            while (!identities.add(current)) {
                current = identity + "#" + suffix++;
            }
            return current;
        }
    }

    private static String head(String packageName, String className) {
        String value = className == null || className.isBlank() ? "（无）" : className;
        if (packageName != null && !packageName.isBlank()) {
            value = packageName + "." + value;
        }
        return value;
    }

    private static String namedIdentity(String packageName, String className, String name, String params) {
        return head(packageName, className) + "#" + name + "(" + (params == null ? "" : params) + ")";
    }

    private static String typeName(TypeMirror type, boolean varargs) {
        if (varargs && type.getKind() == TypeKind.ARRAY) {
            return typeName(((ArrayType) type).getComponentType(), false) + "...";
        }
        return type.toString().replace("java.lang.", "");
    }

    private static String simpleName(String className) {
        int dot = className.lastIndexOf('.');
        return dot < 0 ? className : className.substring(dot + 1);
    }

    private static int kindOrder(String kind) {
        return switch (kind) {
            case "具名" -> 0;
            case "匿名" -> 1;
            case "项目外" -> 2;
            default -> 3;
        };
    }

    private static void deleteAll(Path root) throws IOException {
        if (!Files.exists(root)) {
            return;
        }
        try (var walk = Files.walk(root)) {
            walk.sorted(Comparator.reverseOrder()).forEach(path -> {
                try {
                    Files.deleteIfExists(path);
                } catch (IOException ignored) {
                    // 临时目录留到进程结束后也可接受。
                }
            });
        }
    }

    private static String toJson(List<MethodRec> methods) {
        StringBuilder out = new StringBuilder();
        out.append("[\n");
        for (int i = 0; i < methods.size(); i++) {
            MethodRec method = methods.get(i);
            out.append("  {\n");
            field(out, "language", method.language, true);
            field(out, "name", method.name, true);
            field(out, "className", method.className, true);
            field(out, "packagePath", method.packagePath, true);
            field(out, "kind", method.kind, true);
            field(out, "identity", method.identity, true);
            field(out, "hostIdentity", method.hostIdentity, true);
            field(out, "hostLabel", method.hostLabel, true);
            field(out, "hostKey", method.hostKey, true);
            field(out, "file", method.file, true);
            field(out, "startLine", method.startLine, true);
            field(out, "endLine", method.endLine, true);
            field(out, "startColumn", method.startColumn, true);
            field(out, "startOffset", method.startOffset, true);
            field(out, "endOffset", method.endOffset, true);
            out.append("    \"paramTypes\": [");
            for (int p = 0; p < method.paramTypes.size(); p++) {
                if (p > 0) {
                    out.append(", ");
                }
                out.append(json(method.paramTypes.get(p)));
            }
            out.append("],\n");
            out.append("    \"uses\": [");
            if (!method.uses.isEmpty()) {
                out.append("\n");
            }
            for (int u = 0; u < method.uses.size(); u++) {
                Use use = method.uses.get(u);
                out.append("      {\"kind\": ").append(json(use.kind))
                        .append(", \"identity\": ").append(json(use.identity))
                        .append(", \"display\": ").append(json(use.display))
                        .append("}");
                if (u + 1 < method.uses.size()) {
                    out.append(",");
                }
                out.append("\n");
            }
            if (!method.uses.isEmpty()) {
                out.append("    ");
            }
            out.append("]\n");
            out.append("  }");
            if (i + 1 < methods.size()) {
                out.append(",");
            }
            out.append("\n");
        }
        out.append("]\n");
        return out.toString();
    }

    private static void field(StringBuilder out, String name, String value, boolean comma) {
        out.append("    \"").append(name).append("\": ").append(json(value));
        if (comma) {
            out.append(",");
        }
        out.append("\n");
    }

    private static void field(StringBuilder out, String name, long value, boolean comma) {
        out.append("    \"").append(name).append("\": ").append(value);
        if (comma) {
            out.append(",");
        }
        out.append("\n");
    }

    private static String json(String value) {
        if (value == null) {
            return "null";
        }
        StringBuilder out = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '\\' -> out.append("\\\\");
                case '"' -> out.append("\\\"");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> {
                    if (c < 0x20) {
                        out.append(String.format("\\u%04x", (int) c));
                    } else {
                        out.append(c);
                    }
                }
            }
        }
        return out.append('"').toString();
    }
}
