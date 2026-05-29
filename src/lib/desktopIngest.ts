// Desktop file ingestion via File System Access API (Chromium).
// User grants directory access once. We index file metadata + small text content
// into localStorage + HydraDB. Re-pickable on revisit (handle is persisted via IndexedDB).
//
// Browser support: Chrome, Edge, Opera. Firefox/Safari fall back to <input type=file>.

export type IndexedFile = {
  path: string;
  name: string;
  size: number;
  kind: "file" | "directory";
  mime?: string;
  textPreview?: string;
  modifiedAt: number;
};

const TEXT_EXT = new Set(["txt", "md", "json", "ts", "tsx", "js", "jsx", "css", "html", "yml", "yaml", "csv", "log"]);
const MAX_PREVIEW_BYTES = 4000;
const MAX_FILES = 500; // safety cap so the indexer cannot lock the tab on a huge drive

export function supportsFsAccess(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!supportsFsAccess()) return null;
  try {
    const win = window as unknown as { showDirectoryPicker: (opts?: unknown) => Promise<FileSystemDirectoryHandle> };
    const handle = await win.showDirectoryPicker({ mode: "read", id: "delos-desktop" });
    return handle;
  } catch {
    return null; // user cancelled or denied
  }
}

async function getTextPreview(file: File): Promise<string | undefined> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ext || !TEXT_EXT.has(ext)) return undefined;
  try {
    const slice = file.slice(0, MAX_PREVIEW_BYTES);
    const t = await slice.text();
    return t.slice(0, MAX_PREVIEW_BYTES);
  } catch {
    return undefined;
  }
}

export async function indexDirectory(
  handle: FileSystemDirectoryHandle,
  onProgress?: (count: number, currentPath: string) => void,
): Promise<IndexedFile[]> {
  const out: IndexedFile[] = [];
  async function walk(dir: FileSystemDirectoryHandle, prefix: string) {
    if (out.length >= MAX_FILES) return;
    for await (const [name, child] of (dir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
      if (out.length >= MAX_FILES) break;
      const path = `${prefix}/${name}`;
      onProgress?.(out.length, path);
      if (child.kind === "directory") {
        out.push({ path, name, size: 0, kind: "directory", modifiedAt: 0 });
        try {
          await walk(child as FileSystemDirectoryHandle, path);
        } catch {}
      } else {
        try {
          const f = await (child as FileSystemFileHandle).getFile();
          const preview = await getTextPreview(f);
          out.push({
            path,
            name,
            size: f.size,
            kind: "file",
            mime: f.type || undefined,
            textPreview: preview,
            modifiedAt: f.lastModified,
          });
        } catch {
          out.push({ path, name, size: 0, kind: "file", modifiedAt: 0 });
        }
      }
    }
  }
  await walk(handle, "");
  return out;
}

const STORE_KEY = "delos.desktop.index.v1";

export function saveIndex(handleName: string, files: IndexedFile[]) {
  if (typeof window === "undefined") return;
  try {
    const payload = { root: handleName, indexedAt: Date.now(), files };
    localStorage.setItem(STORE_KEY, JSON.stringify(payload));
    // (A `delos-desktop-indexed` CustomEvent used to fire here, but no
    // surface ever listened for it — removed as a dead channel.)
  } catch {}
}

export function loadIndex(): { root: string; indexedAt: number; files: IndexedFile[] } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { root: string; indexedAt: number; files: IndexedFile[] };
  } catch {
    return null;
  }
}

export function searchIndex(query: string, limit = 50): IndexedFile[] {
  const idx = loadIndex();
  if (!idx) return [];
  const q = query.toLowerCase().trim();
  if (!q) return idx.files.slice(0, limit);
  return idx.files
    .filter((f) => f.name.toLowerCase().includes(q) || (f.textPreview ?? "").toLowerCase().includes(q))
    .slice(0, limit);
}

// Sync digest to HydraDB so cross-device DelOS shows what was indexed.
// We do NOT send file CONTENT, only names + paths + sizes (privacy preserving).
export async function syncDigestToServer(root: string, files: IndexedFile[], tenantId: string): Promise<{ ok: boolean }> {
  try {
    const digest = files.slice(0, 200).map((f) => ({
      path: f.path,
      name: f.name,
      size: f.size,
      kind: f.kind,
      modifiedAt: f.modifiedAt,
    }));
    const r = await fetch("/api/ingestion/desktop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root, count: files.length, digest, tenantId }),
    });
    return { ok: r.ok };
  } catch {
    return { ok: false };
  }
}
