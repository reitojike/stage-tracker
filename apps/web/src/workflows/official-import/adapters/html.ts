import { parse, type DefaultTreeAdapterTypes } from "parse5";

export type HtmlNode = DefaultTreeAdapterTypes.Node;

export function parseHtml(html: string): HtmlNode {
  return parse(html);
}

export function descendants(
  node: HtmlNode,
  predicate: (candidate: HtmlNode) => boolean,
): HtmlNode[] {
  const matches: HtmlNode[] = [];
  const visit = (candidate: HtmlNode) => {
    if (predicate(candidate)) matches.push(candidate);
    if ("childNodes" in candidate) {
      for (const child of candidate.childNodes) visit(child);
    }
  };
  visit(node);
  return matches;
}

export function attribute(node: HtmlNode, name: string): string | null {
  if (!("attrs" in node)) return null;
  return node.attrs.find((candidate) => candidate.name === name)?.value ?? null;
}

export function elementName(node: HtmlNode): string | null {
  return "tagName" in node ? node.tagName : null;
}

export function hasClass(node: HtmlNode, className: string): boolean {
  return (attribute(node, "class") ?? "").split(/\s+/u).includes(className);
}

export function textContent(node: HtmlNode): string {
  if (node.nodeName === "#text" && "value" in node) return node.value;
  return "childNodes" in node ? node.childNodes.map(textContent).join("") : "";
}

export function normalizedText(node: HtmlNode): string {
  return textContent(node).replace(/\s+/gu, " ").trim();
}

export function firstDescendant(
  node: HtmlNode,
  predicate: (candidate: HtmlNode) => boolean,
): HtmlNode | null {
  return descendants(node, predicate)[0] ?? null;
}
