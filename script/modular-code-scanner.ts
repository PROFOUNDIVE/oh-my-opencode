import ts from "typescript"

import { getLiteralTextRanges, getPromptTemplateTextRanges, type SourceRange } from "./prompt-template-owners"

export type ModularCodeScan = {
  readonly logicLines: number
  readonly hasAnyAssertion: boolean
  readonly hasSuppressionDirective: boolean
  readonly hasIndexBusinessLogic: boolean
}

const SUPPRESSION_DIRECTIVE = /@ts-(?:ignore|expect-error|nocheck)\b/
const WIRING_NAME = /(?:register|create|compose|configure|setup|install|wire|use|add)/i

function getCommentRanges(source: string): readonly SourceRange[] {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source)
  const ranges: SourceRange[] = []
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) {
      ranges.push({ start: scanner.getTokenPos(), end: scanner.getTextPos() })
    }
  }
  return ranges
}

function maskRanges(source: string, ranges: readonly SourceRange[]): string {
  const characters = source.split("")
  for (const range of ranges) {
    for (let index = range.start; index < range.end; index++) {
      if (characters[index] !== "\n") characters[index] = " "
    }
  }
  return characters.join("")
}

function hasAnyAssertion(sourceFile: ts.SourceFile): boolean {
  let found = false
  const visit = (node: ts.Node): void => {
    if (ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.AnyKeyword) found = true
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

function isWiringCall(expression: ts.Expression): boolean {
  if (!ts.isCallExpression(expression)) return false
  const callee = ts.isIdentifier(expression.expression)
    ? expression.expression.text
    : ts.isPropertyAccessExpression(expression.expression)
      ? expression.expression.name.text
      : ""
  return WIRING_NAME.test(callee)
}

function hasIndexBusinessLogic(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some((statement) => {
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) || ts.isEmptyStatement(statement)) return false
    if (ts.isExpressionStatement(statement)) return !isWiringCall(statement.expression)
    if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.some((declaration) => !declaration.initializer || !isWiringCall(declaration.initializer))
    return true
  })
}

export function scanTypeScript(path: string, source: string): ModularCodeScan {
  const scriptKind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind)
  const commentRanges = getCommentRanges(maskRanges(source, getLiteralTextRanges(sourceFile)))
  const code = maskRanges(source, [...commentRanges, ...getPromptTemplateTextRanges(sourceFile)])
  return {
    logicLines: code.split("\n").filter((line) => line.trim().length > 0).length,
    hasAnyAssertion: hasAnyAssertion(sourceFile),
    hasSuppressionDirective: commentRanges.some((range) => SUPPRESSION_DIRECTIVE.test(source.slice(range.start, range.end))),
    hasIndexBusinessLogic: hasIndexBusinessLogic(sourceFile),
  }
}
