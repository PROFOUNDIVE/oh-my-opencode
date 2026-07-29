import ts from "typescript"

export type SourceRange = { readonly start: number; readonly end: number }

const PROMPT_TEMPLATE_OWNERS = new Set(["prompt", "instruction", "instructions", "documentation", "docs"])

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text
  return undefined
}

function templateOwnerName(node: ts.Node): string | undefined {
  let parent = node.parent
  while (!ts.isSourceFile(parent)) {
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text
    if (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) return propertyName(parent.name)
    parent = parent.parent
  }
  return undefined
}

function addLiteralTextRange(node: ts.TemplateLiteralLikeNode, sourceFile: ts.SourceFile, ranges: SourceRange[]): void {
  const start = node.getStart(sourceFile) + 1
  const end = node.getEnd() - (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) ? 2 : 1)
  if (start < end) ranges.push({ start, end })
}

function addStringTextRange(node: ts.StringLiteral, sourceFile: ts.SourceFile, ranges: SourceRange[]): void {
  const start = node.getStart(sourceFile) + 1
  const end = node.getEnd() - 1
  if (start < end) ranges.push({ start, end })
}

export function getLiteralTextRanges(sourceFile: ts.SourceFile): readonly SourceRange[] {
  const ranges: SourceRange[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node)) addStringTextRange(node, sourceFile, ranges)
    if (ts.isNoSubstitutionTemplateLiteral(node)) addLiteralTextRange(node, sourceFile, ranges)
    if (ts.isTemplateExpression(node)) {
      addLiteralTextRange(node.head, sourceFile, ranges)
      for (const span of node.templateSpans) addLiteralTextRange(span.literal, sourceFile, ranges)
    }
    if (ts.isTemplateLiteralTypeNode(node)) {
      addLiteralTextRange(node.head, sourceFile, ranges)
      for (const span of node.templateSpans) addLiteralTextRange(span.literal, sourceFile, ranges)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return ranges
}

export function getPromptTemplateTextRanges(sourceFile: ts.SourceFile): readonly SourceRange[] {
  const ranges: SourceRange[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isNoSubstitutionTemplateLiteral(node) && PROMPT_TEMPLATE_OWNERS.has(templateOwnerName(node) ?? "")) {
      addLiteralTextRange(node, sourceFile, ranges)
    }
    if (ts.isTemplateExpression(node) && PROMPT_TEMPLATE_OWNERS.has(templateOwnerName(node) ?? "")) {
      addLiteralTextRange(node.head, sourceFile, ranges)
      for (const span of node.templateSpans) addLiteralTextRange(span.literal, sourceFile, ranges)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return ranges
}
