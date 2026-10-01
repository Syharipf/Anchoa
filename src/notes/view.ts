import type { PageNode } from "../api";

export interface TreeNode extends PageNode {
  readonly children: TreeNode[];
}

export interface SnippetPart {
  readonly text: string;
  readonly mark: boolean;
}

/**
 * Builds a hierarchical tree from a flat list of page nodes.
 * Children at each level are sorted case-insensitively by title, then by id.
 */
export function buildTree(nodes: readonly PageNode[]): TreeNode[] {
  const compare = (a: PageNode, b: PageNode): number => {
    const titleA = a.title.toLowerCase();
    const titleB = b.title.toLowerCase();
    const cmp = titleA.localeCompare(titleB);
    if (cmp !== 0) return cmp;
    return a.id.localeCompare(b.id);
  };

  const nodeMap = new Map<string, PageNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  const childrenMap = new Map<string, PageNode[]>();
  const roots: PageNode[] = [];

  for (const node of nodes) {
    if (node.parentId && nodeMap.has(node.parentId)) {
      const list = childrenMap.get(node.parentId);
      if (list) {
        list.push(node);
      } else {
        childrenMap.set(node.parentId, [node]);
      }
    } else {
      roots.push(node);
    }
  }

  function toTreeNode(node: PageNode): TreeNode {
    const children = childrenMap.get(node.id) ?? [];
    return {
      ...node,
      children: [...children].sort(compare).map(toTreeNode),
    };
  }

  return [...roots].sort(compare).map(toTreeNode);
}

/**
 * Traces the ancestor path from root down to the specified page id.
 * Returns an array [root, ..., targetPage], or [] if id is not found.
 */
export function breadcrumb(nodes: readonly PageNode[], id: string): PageNode[] {
  const map = new Map<string, PageNode>(nodes.map((n) => [n.id, n]));
  const path: PageNode[] = [];
  const visited = new Set<string>();

  let curr = map.get(id);
  while (curr && !visited.has(curr.id)) {
    visited.add(curr.id);
    path.unshift(curr);
    if (!curr.parentId) break;
    curr = map.get(curr.parentId);
  }

  return path;
}

/**
 * Returns a set of all descendant IDs (children, grandchildren, etc.) of a page,
 * excluding the page itself. Used to filter valid target destinations in MoveDialog.
 */
export function descendantIds(nodes: readonly PageNode[], id: string): Set<string> {
  const childrenMap = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parentId) {
      const list = childrenMap.get(node.parentId);
      if (list) {
        list.push(node.id);
      } else {
        childrenMap.set(node.parentId, [node.id]);
      }
    }
  }

  const result = new Set<string>();
  const directChildren = childrenMap.get(id);
  const queue: string[] = directChildren ? [...directChildren] : [];

  while (queue.length > 0) {
    const next = queue.shift()!;
    if (!result.has(next)) {
      result.add(next);
      const kids = childrenMap.get(next);
      if (kids) {
        queue.push(...kids);
      }
    }
  }

  return result;
}

/**
 * Splits a search snippet containing SQLite FTS \u0002 (start) and \u0003 (end) markers
 * into plain and marked parts for rendering.
 */
export function snippetParts(snippet: string): SnippetPart[] {
  if (!snippet) return [];
  const parts: SnippetPart[] = [];
  let currentText = "";
  let inMark = false;

  for (let i = 0; i < snippet.length; i++) {
    const char = snippet[i];
    if (char === "\u0002") {
      if (currentText.length > 0) {
        parts.push({ text: currentText, mark: inMark });
        currentText = "";
      }
      inMark = true;
    } else if (char === "\u0003") {
      if (currentText.length > 0) {
        parts.push({ text: currentText, mark: inMark });
        currentText = "";
      }
      inMark = false;
    } else {
      currentText += char;
    }
  }
  if (currentText.length > 0) {
    parts.push({ text: currentText, mark: inMark });
  }
  return parts;
}
