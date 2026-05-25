"use client";
import { useEffect, useMemo, useState } from "react";
import * as Icons from "lucide-react";

// ====== CALCULATOR ======
export function CalculatorApp() {
  const [expr, setExpr] = useState("");
  const [history, setHistory] = useState<Array<{ q: string; a: string }>>([]);

  // Pure-JS recursive-descent arithmetic parser. Was Function(...) eval
  // which CSP-blocked under our strict script-src → always returned
  // "err" for basic ops (QA report 2026-05-25 P0). Hand-written shunting-
  // yard handles + - * / % ( ) precedence + decimals without eval.
  function safeEval(eRaw: string): string {
    const e = eRaw.replace(/\s+/g, "");
    if (!/^[\d+\-*/().%]+$/.test(e)) return "err";
    let i = 0;
    function peek() { return e[i]; }
    function consume() { return e[i++]; }
    function parseNumber(): number {
      let s = "";
      while (i < e.length && /[\d.]/.test(e[i])) s += e[i++];
      const v = Number(s);
      if (!Number.isFinite(v)) throw new Error("bad number");
      return v;
    }
    function parseFactor(): number {
      const c = peek();
      if (c === "(") { consume(); const v = parseExpr(); if (peek() !== ")") throw new Error("missing )"); consume(); return v; }
      if (c === "-") { consume(); return -parseFactor(); }
      if (c === "+") { consume(); return parseFactor(); }
      return parseNumber();
    }
    function parseTerm(): number {
      let v = parseFactor();
      while (peek() === "*" || peek() === "/" || peek() === "%") {
        const op = consume();
        const rhs = parseFactor();
        if (op === "*") v = v * rhs;
        else if (op === "/") {
          if (rhs === 0) throw new Error("div by zero");
          v = v / rhs;
        } else v = v * (rhs / 100); // % treated as percentage-of multiplier
      }
      return v;
    }
    function parseExpr(): number {
      let v = parseTerm();
      while (peek() === "+" || peek() === "-") {
        const op = consume();
        const rhs = parseTerm();
        v = op === "+" ? v + rhs : v - rhs;
      }
      return v;
    }
    try {
      const v = parseExpr();
      if (i !== e.length) return "err";
      if (typeof v !== "number" || !Number.isFinite(v)) return "err";
      return String(Number(v.toFixed(10)));
    } catch {
      return "err";
    }
  }

  function press(k: string) {
    if (k === "C") { setExpr(""); return; }
    if (k === "DEL") { setExpr((s) => s.slice(0, -1)); return; }
    if (k === "=") {
      const a = safeEval(expr);
      if (a !== "err") {
        setHistory((prev) => [{ q: expr, a }, ...prev].slice(0, 5));
        setExpr(a);
      } else {
        setExpr("err");
      }
      return;
    }
    setExpr((s) => (s === "err" ? k : s + k));
  }

  const live = useMemo(() => (expr && expr !== "err" ? safeEval(expr) : ""), [expr]);

  const KEYS = [
    ["C", "DEL", "%", "/"],
    ["7", "8", "9", "*"],
    ["4", "5", "6", "-"],
    ["1", "2", "3", "+"],
    ["0", ".", "(", ")"],
  ];

  return (
    <div className="p-3 space-y-2 text-xs">
      <div className="font-pixel text-sm tracking-wider" style={{ color: "var(--accent)" }}>★ CALCULATOR</div>
      <div className="card-pixel text-right" style={{ minHeight: 60 }}>
        <div className="font-mono text-[11px] text-[color:var(--muted)] break-all">{expr || "0"}</div>
        <div className="font-pixel text-2xl" style={{ color: "var(--accent)" }}>{live || "0"}</div>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {KEYS.flat().map((k) => (
          <button
            key={k}
            onClick={() => press(k)}
            className="btn-pixel"
            style={{
              padding: "10px 0",
              fontSize: 13,
              background: ["+", "-", "*", "/", "%"].includes(k)
                ? "var(--warn)"
                : ["C", "DEL"].includes(k)
                  ? "var(--danger)"
                  : "var(--surface)",
              color: ["C", "DEL"].includes(k) ? "var(--fg)" : ["+", "-", "*", "/", "%"].includes(k) ? "var(--surface)" : "var(--fg)",
            }}
          >
            {k}
          </button>
        ))}
        <button onClick={() => press("=")} className="btn-pixel col-span-4" style={{ padding: "12px 0", fontSize: 14 }}>
          =
        </button>
      </div>
      {history.length > 0 && (
        <div className="card-pixel">
          <div className="font-pixel text-[10px] tracking-wider mb-1" style={{ color: "var(--muted)" }}>HISTORY</div>
          {history.map((h, i) => (
            <div key={i} className="flex justify-between font-mono text-[11px]">
              <span className="text-[color:var(--muted)]">{h.q}</span>
              <span style={{ color: "var(--accent)" }}>= {h.a}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ====== CALENDAR ======
type CalEvent = { id: string; date: string; title: string; source?: string; startAt?: number };

// F01 · CalendarApp polls /api/calendar/events every 10s + on mount so
// events created by voice ("schedule meeting tomorrow 4pm") + scheduler
// templates land in the UI without manual refresh.
export function CalendarApp() {
  const [view, setView] = useState(new Date());
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // Sync from backend · merge with local-only entries (id starts with "e-").
  // Backend ids start with "evt-".
  async function syncFromBackend() {
    try {
      const r = await fetch("/api/calendar/events");
      if (!r.ok) return;
      const j = await r.json() as { events?: Array<{ id: string; title: string; startAt: number; source?: string }> };
      const backend: CalEvent[] = (j.events ?? []).map((e) => {
        const d = new Date(e.startAt);
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        return { id: e.id, date: ds, title: e.title, source: e.source ?? "backend", startAt: e.startAt };
      });
      setEvents((prev) => {
        const localOnly = prev.filter((e) => e.id.startsWith("e-"));
        return [...localOnly, ...backend];
      });
    } catch {}
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem("delos.calendar.v1");
      if (raw) setEvents(JSON.parse(raw));
    } catch {}
    syncFromBackend();
    const iv = setInterval(syncFromBackend, 10_000);
    const onVis = () => { if (document.visibilityState === "visible") syncFromBackend(); };
    document.addEventListener("visibilitychange", onVis);
    // VP-3 · refresh immediately after voice create_event fires
    const onRefresh = () => syncFromBackend();
    window.addEventListener("delos-calendar-refresh", onRefresh as EventListener);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("delos-calendar-refresh", onRefresh as EventListener);
    };
  }, []);
  useEffect(() => {
    // Only persist locally-created entries (backend syncs from server).
    const local = events.filter((e) => e.id.startsWith("e-"));
    try { localStorage.setItem("delos.calendar.v1", JSON.stringify(local)); } catch {}
  }, [events]);

  const year = view.getFullYear();
  const month = view.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = view.toLocaleString("default", { month: "long", year: "numeric" });

  function dateStr(d: number) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  function isToday(d: number) {
    const t = new Date();
    return t.getFullYear() === year && t.getMonth() === month && t.getDate() === d;
  }
  function eventsOn(d: number) {
    const ds = dateStr(d);
    return events.filter((e) => e.date === ds);
  }
  function addEvent() {
    if (!selected || !draft.trim()) return;
    setEvents((prev) => [...prev, { id: `e-${Date.now()}`, date: selected, title: draft.trim() }]);
    setDraft("");
  }
  function removeEvent(id: string) {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }

  const cells: Array<number | null> = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(i);
  while (cells.length % 7 !== 0) cells.push(null);

  const selectedEvents = selected ? events.filter((e) => e.date === selected) : [];

  return (
    <div className="p-3 space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <div className="font-pixel text-sm tracking-wider" style={{ color: "var(--accent)" }}>★ CALENDAR</div>
        <div className="flex gap-1">
          <button onClick={() => setView(new Date(year, month - 1, 1))} className="pill pill-muted cursor-pointer"><Icons.ChevronLeft size={12} /></button>
          <span className="font-pixel text-[11px] tracking-wider px-2 py-0.5" style={{ color: "var(--fg)" }}>{monthLabel}</span>
          <button onClick={() => setView(new Date(year, month + 1, 1))} className="pill pill-muted cursor-pointer"><Icons.ChevronRight size={12} /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="font-pixel text-[10px] tracking-wider text-[color:var(--muted)]">{d}</div>
        ))}
        {cells.map((d, i) => {
          if (d == null) return <div key={i} />;
          const has = eventsOn(d);
          const ds = dateStr(d);
          const today = isToday(d);
          const sel = selected === ds;
          return (
            <button
              key={i}
              onClick={() => setSelected(ds)}
              className="font-mono text-[11px] py-1 relative"
              style={{
                background: sel ? "var(--accent)" : today ? "var(--surface-2)" : "var(--surface)",
                color: sel ? "var(--surface)" : "var(--fg)",
                border: `1px solid ${today ? "var(--accent)" : "var(--surface-2)"}`,
              }}
            >
              {d}
              {has.length > 0 && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1" style={{ background: sel ? "var(--surface)" : "var(--accent)" }} />
              )}
            </button>
          );
        })}
      </div>
      {selected && (
        <div className="card-pixel space-y-2">
          <div className="font-pixel text-[11px] tracking-wider" style={{ color: "var(--accent)" }}>{selected}</div>
          {selectedEvents.length === 0 && <div className="text-[color:var(--muted)] font-mono">no events</div>}
          <ul className="space-y-1">
            {selectedEvents.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 font-mono text-[11px]">
                <span>{e.title}</span>
                <button onClick={() => removeEvent(e.id)} className="pill pill-bad cursor-pointer"><Icons.X size={9} /></button>
              </li>
            ))}
          </ul>
          <div className="flex gap-1">
            <input
              className="input-pixel"
              style={{ padding: "4px 8px", fontSize: 11 }}
              placeholder="add event…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addEvent()}
            />
            <button onClick={addEvent} className="btn-pixel" style={{ padding: "4px 8px", fontSize: 11 }}>ADD</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ====== FILE EXPLORER ======
type FsItem = { id: string; name: string; type: "folder" | "file"; parent: string; content?: string; createdAt: number };

const FS_KEY = "delos.fs.v1";

function loadFs(): FsItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(FS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [
    { id: "root-readme", name: "README.txt", type: "file", parent: "root", content: "Welcome to DelOS file explorer.\n\nClick a file to view + edit. New folder/file buttons to add. Deletes are permanent.", createdAt: Date.now() },
    { id: "f-docs", name: "Documents", type: "folder", parent: "root", createdAt: Date.now() },
    { id: "f-apps", name: "Apps", type: "folder", parent: "root", createdAt: Date.now() },
    { id: "doc-1", name: "ideas.txt", type: "file", parent: "f-docs", content: "* multi-agent CRM\n* voice-driven SQL\n* MCP-powered IDE", createdAt: Date.now() },
  ];
}

export function FileExplorerApp() {
  const [items, setItems] = useState<FsItem[]>([]);
  const [cwd, setCwd] = useState("root");
  const [selected, setSelected] = useState<FsItem | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setItems(loadFs());
  }, []);
  useEffect(() => {
    if (items.length === 0) return;
    try { localStorage.setItem(FS_KEY, JSON.stringify(items)); } catch {}
  }, [items]);

  const inCwd = items.filter((i) => i.parent === cwd);
  const path = useMemo(() => {
    const parts: string[] = [];
    let cur = items.find((i) => i.id === cwd);
    while (cur) {
      parts.unshift(cur.name);
      cur = items.find((i) => i.id === cur!.parent);
    }
    return cwd === "root" ? "/" : "/" + parts.join("/");
  }, [cwd, items]);

  function open(item: FsItem) {
    if (item.type === "folder") {
      setCwd(item.id);
      setSelected(null);
    } else {
      setSelected(item);
      setDraft(item.content ?? "");
    }
  }

  function up() {
    if (cwd === "root") return;
    const cur = items.find((i) => i.id === cwd);
    if (cur) {
      setCwd(cur.parent);
      setSelected(null);
    }
  }

  function newItem(type: "folder" | "file") {
    const name = prompt(`Name your new ${type}:`);
    if (!name) return;
    const id = `${type[0]}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setItems((prev) => [...prev, { id, name, type, parent: cwd, content: "", createdAt: Date.now() }]);
  }

  function del(id: string) {
    if (!confirm("Delete?")) return;
    setItems((prev) => {
      // Recursive delete: drop the item + any descendant
      const drop = new Set<string>([id]);
      let added = true;
      while (added) {
        added = false;
        for (const it of prev) {
          if (drop.has(it.parent) && !drop.has(it.id)) {
            drop.add(it.id);
            added = true;
          }
        }
      }
      return prev.filter((i) => !drop.has(i.id));
    });
    setSelected(null);
  }

  function saveDraft() {
    if (!selected) return;
    setItems((prev) => prev.map((i) => (i.id === selected.id ? { ...i, content: draft } : i)));
  }

  return (
    <div className="p-3 space-y-2 text-xs h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div className="font-pixel text-sm tracking-wider" style={{ color: "var(--accent)" }}>★ FILES</div>
        <code className="font-mono text-[10px] text-[color:var(--muted)]">{path}</code>
      </div>
      <div className="flex gap-1">
        <button onClick={up} disabled={cwd === "root"} className="pill pill-muted cursor-pointer"><Icons.ChevronUp size={12} /> up</button>
        <button onClick={() => newItem("folder")} className="pill pill-info cursor-pointer"><Icons.FolderPlus size={12} /> folder</button>
        <button onClick={() => newItem("file")} className="pill pill-info cursor-pointer"><Icons.FilePlus size={12} /> file</button>
      </div>
      <div className="card-pixel flex-1 overflow-y-auto" style={{ minHeight: 120 }}>
        {inCwd.length === 0 && <div className="text-[color:var(--muted)] font-mono">empty folder</div>}
        <ul className="space-y-1">
          {inCwd.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1)).map((it) => (
            <li key={it.id} className="flex items-center justify-between gap-2">
              <button onClick={() => open(it)} className="flex items-center gap-2 flex-1 text-left">
                {it.type === "folder" ? <Icons.Folder size={14} color="var(--accent)" /> : <Icons.FileText size={14} color="var(--muted)" />}
                <span className="font-mono text-[11px] truncate">{it.name}</span>
              </button>
              <button onClick={() => del(it.id)} className="pill pill-bad cursor-pointer" style={{ fontSize: 9 }}><Icons.X size={10} /></button>
            </li>
          ))}
        </ul>
      </div>
      {selected && selected.type === "file" && (
        <div className="card-pixel space-y-1" style={{ borderColor: "var(--accent)" }}>
          <div className="flex items-center justify-between">
            <span className="font-pixel text-[11px] tracking-wider" style={{ color: "var(--accent)" }}>{selected.name}</span>
            <div className="flex gap-1">
              <button onClick={saveDraft} className="pill pill-ok cursor-pointer" style={{ fontSize: 9 }}>save</button>
              <button onClick={() => setSelected(null)} className="pill pill-muted cursor-pointer" style={{ fontSize: 9 }}>close</button>
            </div>
          </div>
          <textarea className="input-pixel" rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} />
        </div>
      )}
    </div>
  );
}

// ====== SYSTEM INFO ======
type Battery = { charging: boolean; level: number };

export function SystemInfoApp() {
  const [battery, setBattery] = useState<Battery | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const navAny = navigator as unknown as { getBattery?: () => Promise<{ charging: boolean; level: number; addEventListener: (k: string, f: () => void) => void }> };
    let detach: (() => void) | undefined;
    if (typeof navAny.getBattery === "function") {
      navAny.getBattery().then((b) => {
        const sync = () => setBattery({ charging: b.charging, level: b.level });
        sync();
        b.addEventListener("chargingchange", sync);
        b.addEventListener("levelchange", sync);
        detach = () => {};
      }).catch(() => {});
    }
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(t);
      detach?.();
    };
  }, []);

  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  const conn = (navigator as unknown as { connection?: { effectiveType?: string; downlink?: number; rtt?: number } }).connection;
  const screen = typeof window === "undefined" ? null : { w: window.screen.width, h: window.screen.height, dpr: window.devicePixelRatio };
  const lang = typeof navigator === "undefined" ? "?" : navigator.language;
  const platform = typeof navigator === "undefined" ? "?" : navigator.platform;
  const cpu = typeof navigator === "undefined" ? "?" : String((navigator as unknown as { hardwareConcurrency?: number }).hardwareConcurrency ?? "?");

  return (
    <div className="p-3 space-y-2 text-xs">
      <div className="font-pixel text-sm tracking-wider" style={{ color: "var(--accent)" }}>★ SYSTEM INFO</div>
      <p className="text-[color:var(--muted)] font-mono">Reads only browser-exposed APIs. No tracking.</p>
      <div className="grid grid-cols-2 gap-2">
        <Stat icon="Battery" label="battery" value={battery ? `${Math.round(battery.level * 100)}%${battery.charging ? " ⚡" : ""}` : "—"} />
        <Stat icon="Clock" label="clock" value={new Date(now).toLocaleTimeString()} />
        <Stat icon="Cpu" label="cores" value={cpu} />
        <Stat icon="Wifi" label="network" value={conn?.effectiveType ?? "?"} />
        <Stat icon="MonitorSmartphone" label="screen" value={screen ? `${screen.w}×${screen.h}` : "?"} />
        <Stat icon="ZoomIn" label="dpr" value={screen ? `${screen.dpr}×` : "?"} />
        <Stat icon="Languages" label="lang" value={lang} />
        <Stat icon="HardDrive" label="platform" value={platform} />
        {mem && <Stat icon="Database" label="js heap" value={`${(mem.usedJSHeapSize / 1048576).toFixed(1)} / ${(mem.jsHeapSizeLimit / 1048576).toFixed(0)} MB`} />}
        {conn?.downlink && <Stat icon="ArrowDownToLine" label="downlink" value={`${conn.downlink} Mbps`} />}
        {conn?.rtt !== undefined && <Stat icon="Activity" label="rtt" value={`${conn.rtt} ms`} />}
      </div>
      <div className="card-pixel">
        <div className="font-pixel text-[11px] tracking-wider mb-1" style={{ color: "var(--accent)" }}>USER AGENT</div>
        <code className="font-mono text-[10px] text-[color:var(--muted)] break-all">{typeof navigator === "undefined" ? "?" : navigator.userAgent}</code>
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: string; label: string; value: string }) {
  const All = Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>;
  const Cmp = All[icon] ?? Icons.Activity;
  return (
    <div className="card-pixel">
      <div className="flex items-center gap-2">
        <Cmp size={12} color="var(--accent)" />
        <span className="text-[10px] text-[color:var(--muted)] uppercase tracking-wider">{label}</span>
      </div>
      <div className="font-pixel text-base mt-1" style={{ color: "var(--accent)" }}>{value}</div>
    </div>
  );
}
