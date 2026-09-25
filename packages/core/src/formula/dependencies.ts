import type { FormulaNode } from "./types";

/** Unique column keys referenced by `ast`, in first-seen (left-to-right) order. Never throws. */
export function dependencies(ast: FormulaNode): string[] {
  const seen = new Set<string>();
  const stack: unknown[] = [ast];
  // Iterative pre-order walk; children pushed in reverse so they pop left-to-right.
  while (stack.length > 0) {
    const node = stack.pop() as FormulaNode | null | undefined;
    if (typeof node !== "object" || node === null) continue;
    switch (node.type) {
      case "ref":
        if (typeof node.key === "string") seen.add(node.key);
        break;
      case "unary":
        stack.push(node.operand);
        break;
      case "binary":
        stack.push(node.right, node.left);
        break;
      case "call":
        if (Array.isArray(node.args)) {
          for (let i = node.args.length - 1; i >= 0; i--) stack.push(node.args[i]);
        }
        break;
      default:
        break;
    }
  }
  return [...seen];
}
