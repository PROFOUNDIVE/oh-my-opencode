import { visit } from "jsonc-parser"

export function hasDuplicateJsonField(rawOutput: string): boolean {
  const fieldsByObject = new Map<string, Set<string>>()
  let duplicate = false
  visit(rawOutput, {
    onObjectProperty: (property, _offset, _length, _line, _character, pathSupplier) => {
      const objectPath = JSON.stringify(pathSupplier())
      const fields = fieldsByObject.get(objectPath) ?? new Set<string>()
      if (fields.has(property)) duplicate = true
      fields.add(property)
      fieldsByObject.set(objectPath, fields)
    },
  }, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false })
  return duplicate
}
