const MESSAGE =
  "The privileged official-ingestion client may only be imported by the official-import workflow boundary.";

function isPrivilegedImport(value) {
  return (
    value === "@/workflows/official-import/privileged" ||
    value.startsWith("@/workflows/official-import/privileged/") ||
    value.includes("workflows/official-import/privileged/")
  );
}

function isWorkflowOwnedFile(filename) {
  const normalized = filename.replaceAll("\\", "/");
  return (
    normalized.startsWith("src/workflows/official-import/") ||
    normalized.includes("/src/workflows/official-import/")
  );
}

function reportIfForbidden(context, node, source) {
  if (typeof source.value === "string" && isPrivilegedImport(source.value)) {
    context.report({ node, messageId: "forbidden" });
  }
}

export const noPrivilegedIngestionImport = {
  meta: {
    type: "problem",
    docs: {
      description: "Keep the privileged ingestion client workflow-only.",
    },
    schema: [],
    messages: { forbidden: MESSAGE },
  },
  create(context) {
    if (isWorkflowOwnedFile(context.filename)) return {};
    return {
      ImportDeclaration(node) {
        reportIfForbidden(context, node, node.source);
      },
      ExportNamedDeclaration(node) {
        if (node.source !== null) reportIfForbidden(context, node, node.source);
      },
      ExportAllDeclaration(node) {
        reportIfForbidden(context, node, node.source);
      },
      ImportExpression(node) {
        reportIfForbidden(context, node, node.source);
      },
    };
  },
};

export const officialIngestionBoundaryPlugin = {
  rules: { "no-privileged-import": noPrivilegedIngestionImport },
};
