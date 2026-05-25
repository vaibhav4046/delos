"use client";
import Link from "next/link";
import { Wordmark } from "@/components/Logo";
import { useTenantId } from "@/lib/useTenant";
import { MemoryDashboard } from "@/components/memory/MemoryDashboard";

export default function MemoryPage() {
  const [tenant] = useTenantId();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 glass-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/"><Wordmark size={26} /></Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/os" className="btn-pixel success">★ DelOS</Link>
            <Link href="/" className="btn-pixel ghost hidden sm:inline-flex">Home</Link>
            <Link href="/play" className="btn-pixel ghost hidden sm:inline-flex">Play</Link>
            <Link href="/docs" className="btn-pixel ghost hidden md:inline-flex">Docs</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div>
          <span className="pill pill-muted" style={{ fontSize: 10 }}>★ SAVE STATE</span>
          <h1 className="font-pixel text-3xl sm:text-4xl mt-3 mb-2 tracking-wider">
            memory <span style={{ color: "var(--accent)" }}>browser</span>.
          </h1>
          <p className="text-[color:var(--muted)] text-sm">
            Long-term memory across runs. Semantic recall via HydraDB, lexical fallback locally, live-synced every 8 seconds.
          </p>
        </div>

        <div className="card-pixel" style={{ padding: 0, overflow: "hidden" }}>
          <MemoryDashboard tenant={tenant ?? null} defaultQuery="" autoRefreshMs={8000} />
        </div>

        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/memory/export${tenant ? `?tenantId=${encodeURIComponent(tenant)}` : ""}`}
            download
            className="btn-pixel ghost"
          >
            ↓ EXPORT JSON
          </a>
          <label className="btn-pixel ghost cursor-pointer">
            ↑ IMPORT JSON
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const txt = await f.text();
                  const data = JSON.parse(txt);
                  const r = await fetch("/api/memory/import", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...data, tenantId: tenant || undefined }),
                  });
                  const j = await r.json();
                  alert(j.ok ? `Imported ${j.imported}/${j.total} memories` : `Import failed: ${j.error}`);
                  if (j.ok) window.location.reload();
                } catch (err) {
                  alert("Import failed: " + (err as Error).message);
                }
              }}
            />
          </label>
        </div>
      </main>
    </div>
  );
}
