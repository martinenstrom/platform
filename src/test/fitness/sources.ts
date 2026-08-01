/**
 * The parsed source model the fitness rules judge.
 *
 * Every rule used to do its own `readFileSync` and its own regex. That is how
 * eleven rules ended up containing a literal backspace byte where `\b` was
 * meant: each expression was written once, read by eye, and never exercised
 * against anything it was supposed to catch. A rule matching nothing passes.
 *
 * So the scanning happens once, here, through TypeScript's own parser rather
 * than through a regex over raw text. `imports` comes from the AST, which knows
 * a type-only import from a value one and a module specifier from a string that
 * happens to look like a path. `code` comes from the parser's own view of what
 * is a comment and what is a literal — where the old regex `codeOnly` could be
 * defeated by an apostrophe inside a comment, and was.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve as resolvePath, sep } from 'node:path'
import ts from 'typescript'

/** Absolute path to `src/`, resolved from cwd — see the note in `loadTree`. */
export const SRC = resolvePath(process.cwd(), 'src')

export interface ImportRef {
  /** Exactly as written: '~/domain/analysis', './envelope', 'node:fs'. */
  specifier: string
  kind: 'import' | 'export-from' | 'dynamic' | 'require'
  /** `import type { X }` — erased at compile time, so it ships nothing. */
  typeOnly: boolean
  /**
   * The bindings this import introduces: `['buildThesis', 'reviseThesis']`.
   *
   * Needed because a name is not unique across the codebase. `reviseThesis` is
   * both a domain builder and a command factory, and a rule that looked for
   * the call by name could not tell which one it had found — it flagged the
   * command registry for calling its own handler.
   */
  names: readonly string[]
}

export interface AnalysedSource {
  /** Repo-relative, forward-slashed: 'domain/analysis/theses.ts'. */
  path: string
  /** Verbatim file contents. */
  text: string
  /**
   * The same text with comment bodies and string/template/JSX contents blanked
   * to spaces, character-for-character, so offsets and line numbers still line
   * up. A rule may therefore be documented beside the code it governs without
   * the sentence explaining it tripping it.
   */
  code: string
  imports: readonly ImportRef[]
  ast: ts.SourceFile
  isTest: boolean
}

/** The names an import clause binds — default, namespace and named alike. */
function boundNames(clause: ts.ImportClause | undefined): string[] {
  if (!clause) return []
  const names: string[] = []
  if (clause.name) names.push(clause.name.text)
  if (clause.namedBindings) {
    if (ts.isNamespaceImport(clause.namedBindings)) {
      names.push(clause.namedBindings.name.text)
    } else {
      for (const element of clause.namedBindings.elements) {
        // The exported name, not the local alias: what was imported is the
        // question, and an alias is exactly how a rule gets evaded.
        names.push((element.propertyName ?? element.name).text)
      }
    }
  }
  return names
}

function scriptKind(path: string): ts.ScriptKind {
  return path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
}

/**
 * Blanks a range to spaces, preserving newlines.
 *
 * Newlines survive so that a failure can still name a line number, and the
 * length is preserved so every offset in the AST stays valid against `code`.
 */
function blank(chars: string[], start: number, end: number): void {
  for (let index = start; index < end && index < chars.length; index += 1) {
    if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' '
  }
}

/**
 * Everything the parser considers a comment.
 *
 * Every comment in a file is leading or trailing trivia of some token,
 * including the end-of-file token — which is why this walks tokens rather than
 * nodes. `forEachChild` skips tokens, and would miss the comment before a
 * closing brace and every comment at the end of a file.
 */
function commentRanges(source: ts.SourceFile): ts.CommentRange[] {
  const found: ts.CommentRange[] = []
  const seen = new Set<number>()

  const record = (ranges: ts.CommentRange[] | undefined) => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue
      seen.add(range.pos)
      found.push(range)
    }
  }

  const walk = (node: ts.Node) => {
    if (node.getChildCount(source) === 0) {
      record(ts.getLeadingCommentRanges(source.text, node.pos))
      record(ts.getTrailingCommentRanges(source.text, node.end))
      return
    }
    for (const child of node.getChildren(source)) walk(child)
  }

  walk(source)
  return found
}

function analyse(path: string, text: string): AnalysedSource {
  const ast = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKind(path),
  )

  const chars = [...text]
  for (const range of commentRanges(ast)) blank(chars, range.pos, range.end)

  const imports: ImportRef[] = []

  const walk = (node: ts.Node): void => {
    // ---------------------------------------------------------------- imports
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push({
        specifier: node.moduleSpecifier.text,
        kind: 'import',
        typeOnly: node.importClause?.isTypeOnly === true,
        names: boundNames(node.importClause),
      })
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push({
        specifier: node.moduleSpecifier.text,
        kind: 'export-from',
        typeOnly: node.isTypeOnly,
        names:
          node.exportClause && ts.isNamedExports(node.exportClause)
            ? node.exportClause.elements.map(
                (element) => (element.propertyName ?? element.name).text,
              )
            : [],
      })
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      imports.push({
        specifier: (node.arguments[0] as ts.StringLiteralLike).text,
        kind: 'dynamic',
        typeOnly: false,
        names: [],
      })
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      imports.push({
        specifier: (node.arguments[0] as ts.StringLiteralLike).text,
        kind: 'require',
        typeOnly: false,
        names: [],
      })
    }

    // ------------------------------------------------- literal and JSX content
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      // Inside the quotes only: the delimiters stay so `code` still parses as
      // a recognisable shape and an empty-string sentinel stays visible.
      blank(chars, node.getStart(ast) + 1, node.end - 1)
    } else if (
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      blank(chars, node.getStart(ast) + 1, node.end - 1)
    } else if (ts.isJsxText(node)) {
      blank(chars, node.getStart(ast), node.end)
    }

    ts.forEachChild(node, walk)
  }

  walk(ast)

  return {
    path,
    text,
    code: chars.join(''),
    imports,
    ast,
    isTest: /\.(test|spec)\.tsx?$/.test(path) || path.startsWith('test/'),
  }
}

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      listFiles(full, out)
    } else if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

let cached: AnalysedSource[] | null = null

/**
 * Every TypeScript source under `src/`, parsed once per process.
 *
 * Resolved from cwd rather than `import.meta.url`: under the jsdom environment
 * that URL is not a `file:` URL and `fileURLToPath` throws.
 */
export function loadTree(): readonly AnalysedSource[] {
  if (cached) return cached
  cached = listFiles(SRC).map((full) =>
    analyse(relative(SRC, full).split(sep).join('/'), readFileSync(full, 'utf8')),
  )
  return cached
}

/** Parses a source that is not on disk — the planted-violation fixtures. */
export function analyseFixture(path: string, text: string): AnalysedSource {
  return analyse(path, text)
}

/** Reads a repository file outside `src/`, such as a migration. */
export function readRepoFile(...segments: string[]): string {
  return readFileSync(join(SRC, '..', ...segments), 'utf8')
}
