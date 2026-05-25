// In-memory cache of codegen projects keyed by id so /api/codegen-app/export
// can re-emit a zip / HTML bundle without re-running the LLM. 50-entry LRU.

export type CodegenFile = {
  path: string;
  content: string;
  language?: string;
};

export type CodegenProject = {
  id: string;
  name: string;
  description?: string;
  stack?: string;
  files: CodegenFile[];
  createdAt: number;
};

const G = globalThis as unknown as { __delos_codegen_projects?: Map<string, CodegenProject> };
G.__delos_codegen_projects ??= new Map();
const store = G.__delos_codegen_projects;
const MAX_ENTRIES = 50;

export function storeProject(p: Omit<CodegenProject, "createdAt"> & { createdAt?: number }): CodegenProject {
  const proj: CodegenProject = { ...p, createdAt: p.createdAt ?? Date.now() };
  store.set(proj.id, proj);
  // LRU eviction · oldest first
  if (store.size > MAX_ENTRIES) {
    const oldest = [...store.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
    if (oldest) store.delete(oldest[0]);
  }
  return proj;
}

export function getProject(id: string): CodegenProject | undefined {
  return store.get(id);
}

export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "delos-app";
}
