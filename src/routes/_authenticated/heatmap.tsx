import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo, useCallback } from "react";
import {
  TICKER_CONFIG,
  formatChangePct,
  formatPrice,
  NIFTY50_TICKERS,
  BANK_NIFTY_STOCKS,
  SENSEX_TICKERS,
  ALL_TICKERS,
  NIFTY_NEXT50_TICKERS,
} from "@/lib/tickerConfig";
import { useLiveQuotes } from "@/hooks/useLiveQuotes";
import { PageShell } from "@/components/PageShell";
import { QueryError } from "@/components/QueryState";
import { useAuthStore } from "@/stores/authStore";
import { getLimits } from "@/lib/planLimits";
import { toast } from "sonner";
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  BarChart2,
  Search,
  X,
  Activity,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/heatmap")({
  component: HeatmapPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

type IndexFilter = "ALL" | "NIFTY 50" | "NIFTY NEXT 50" | "BANK NIFTY" | "SENSEX";
type SortMode = "change" | "gainers" | "losers" | "volume";

const PREMIUM_FILTERS: IndexFilter[] = ["NIFTY NEXT 50", "BANK NIFTY", "SENSEX"];

const FILTER_SETS: Record<IndexFilter, readonly string[]> = {
  ALL: ALL_TICKERS.filter((t) => t.endsWith(".NS")),
  "NIFTY 50": NIFTY50_TICKERS,
  "NIFTY NEXT 50": NIFTY_NEXT50_TICKERS,
  "BANK NIFTY": BANK_NIFTY_STOCKS,
  SENSEX: SENSEX_TICKERS.filter((t) => t.endsWith(".NS")),
};

// Unique sectors extracted from the ticker config
const ALL_SECTORS = Array.from(
  new Set(
    Object.values(TICKER_CONFIG)
      .map((c) => (c as { sector?: string }).sector ?? "")
      .filter((s) => s && s !== "Index"),
  ),
).sort();

// ─── Color helpers ────────────────────────────────────────────────────────────

/** Returns inline style background color for TradingView-style heatmap tiles. */
function getTileStyle(pct: number): React.CSSProperties {
  if (pct >= 4)
    return { background: "oklch(0.48 0.22 145)", color: "#fff" };
  if (pct >= 2)
    return { background: "oklch(0.58 0.2 150)", color: "#fff" };
  if (pct > 0)
    return { background: "oklch(0.68 0.16 155)", color: "oklch(0.15 0.05 165)" };
  if (pct === 0)
    return { background: "oklch(0.24 0.04 250)", color: "oklch(0.7 0.05 235)" };
  if (pct > -2)
    return { background: "oklch(0.5 0.18 25)", color: "#fff" };
  if (pct > -4)
    return { background: "oklch(0.42 0.22 25)", color: "#fff" };
  return { background: "oklch(0.32 0.25 20)", color: "#fff" };
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function HeatmapSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
      {Array.from({ length: 30 }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg min-h-[96px] animate-shimmer bg-secondary/60"
          style={{ animationDelay: `${i * 40}ms` }}
        />
      ))}
    </div>
  );
}

// ─── Market Status Badge ──────────────────────────────────────────────────────

function MarketStatusBadge() {
  const now = new Date();
  // IST offset = UTC+5:30
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset - now.getTimezoneOffset() * 60000);
  const day = ist.getDay(); // 0=Sun, 6=Sat
  const hours = ist.getHours();
  const minutes = ist.getMinutes();
  const totalMins = hours * 60 + minutes;
  const isWeekday = day >= 1 && day <= 5;
  const isOpen = isWeekday && totalMins >= 9 * 60 + 15 && totalMins < 15 * 60 + 30;

  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
        isOpen
          ? "bg-primary/15 text-primary border border-primary/30"
          : "bg-destructive/10 text-destructive/80 border border-destructive/20"
      }`}
    >
      <span
        className={`w-2 h-2 rounded-full ${isOpen ? "bg-primary animate-badge-pulse" : "bg-destructive/60"}`}
      />
      {isOpen ? "Market Open" : "Market Closed"}
    </div>
  );
}

// ─── Heatmap Tile ─────────────────────────────────────────────────────────────

interface TileData {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  pct: number;
  volume: number;
  source: "yahoo" | "fallback";
}

const HeatmapTile = ({ d }: { d: TileData }) => {
  const style = getTileStyle(d.pct);
  return (
    <Link
      to="/forecast"
      search={{ ticker: d.ticker, model: "Ensemble" }}
      style={style}
      className="p-3 rounded-lg transition-transform hover:scale-[1.03] active:scale-[0.97] flex flex-col justify-between min-h-[96px] select-none shadow-md border border-white/5"
    >
      <div className="min-w-0">
        <div className="font-bold text-sm tracking-tight truncate leading-tight">
          {d.ticker.replace(".NS", "").replace(".BO", "")}
        </div>
        <div className="text-[10px] opacity-80 truncate leading-tight mt-0.5">{d.name}</div>
        <div className="text-[9px] opacity-60 truncate leading-tight">{d.sector}</div>
      </div>
      <div className="mt-2">
        <div className="font-mono-nums font-bold text-sm text-right">{formatChangePct(d.pct)}</div>
        <div className="font-mono-nums text-[10px] opacity-90 text-right">{formatPrice(d.price)}</div>
        {d.source === "fallback" && (
          <div className="text-[8px] opacity-50 text-right mt-0.5">stale</div>
        )}
      </div>
    </Link>
  );
};

// ─── Summary Bar ─────────────────────────────────────────────────────────────

function SummaryBar({ tiles }: { tiles: TileData[] }) {
  const live = tiles.filter((t) => t.source === "yahoo" && t.price > 0);
  const gainers = live.filter((t) => t.pct > 0).length;
  const losers = live.filter((t) => t.pct < 0).length;
  const unchanged = live.length - gainers - losers;
  const avgPct = live.length ? live.reduce((s, t) => s + t.pct, 0) / live.length : 0;

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <span className="flex items-center gap-1 text-primary font-semibold">
        <TrendingUp className="size-3.5" />
        {gainers} Gainers
      </span>
      <span className="flex items-center gap-1 text-destructive font-semibold">
        <TrendingDown className="size-3.5" />
        {losers} Losers
      </span>
      <span className="text-muted-foreground">{unchanged} Unchanged</span>
      <span className="text-muted-foreground">
        Avg:{" "}
        <span className={avgPct >= 0 ? "text-primary" : "text-destructive"}>
          {formatChangePct(avgPct)}
        </span>
      </span>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function HeatmapPage() {
  const profile = useAuthStore((s) => s.profile);
  const limits = getLimits(profile?.plan);

  const [indexFilter, setIndexFilter] = useState<IndexFilter>("NIFTY 50");
  const [sectorFilter, setSectorFilter] = useState<string>("All");
  const [sortMode, setSortMode] = useState<SortMode>("change");
  const [search, setSearch] = useState("");

  const { quotes, isFetching, isLoading, isError, error, refetch } = useLiveQuotes();

  // Format last updated
  const lastUpdated = useMemo(() => {
    const q = quotes.find((q) => q.source === "yahoo");
    if (!q) return null;
    return new Date().toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "Asia/Kolkata",
    });
  }, [quotes, isFetching]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFilterClick = useCallback(
    (f: IndexFilter) => {
      const locked = !limits.canPremiumHeatmap && PREMIUM_FILTERS.includes(f);
      if (locked) {
        toast.error(`${f} heatmap requires Pro plan or higher`);
        return;
      }
      setIndexFilter(f);
    },
    [limits.canPremiumHeatmap],
  );

  const allTileData = useMemo<TileData[]>(() => {
    const allowed = new Set(FILTER_SETS[indexFilter]);
    return quotes
      .filter((q) => allowed.has(q.ticker))
      .map((q) => {
        const cfg = TICKER_CONFIG[q.ticker as keyof typeof TICKER_CONFIG] as
          | { name?: string; sector?: string }
          | undefined;
        return {
          ticker: q.ticker,
          name: cfg?.name ?? q.ticker.replace(".NS", ""),
          sector: cfg?.sector ?? "Equity",
          price: q.last,
          pct: q.changePct,
          volume: q.volume,
          source: q.source,
        };
      });
  }, [quotes, indexFilter]);

  const filteredTileData = useMemo<TileData[]>(() => {
    let data = allTileData;

    // Sector filter
    if (sectorFilter !== "All") {
      data = data.filter((d) => d.sector === sectorFilter);
    }

    // Search filter
    if (search.trim()) {
      const term = search.trim().toLowerCase();
      data = data.filter(
        (d) =>
          d.name.toLowerCase().includes(term) ||
          d.ticker.toLowerCase().includes(term) ||
          d.ticker.replace(".NS", "").toLowerCase().includes(term),
      );
    }

    // Sort
    switch (sortMode) {
      case "gainers":
        data = [...data].sort((a, b) => b.pct - a.pct);
        break;
      case "losers":
        data = [...data].sort((a, b) => a.pct - b.pct);
        break;
      case "volume":
        data = [...data].sort((a, b) => b.volume - a.volume);
        break;
      case "change":
      default:
        data = [...data].sort((a, b) => b.pct - a.pct);
        break;
    }

    return data;
  }, [allTileData, sectorFilter, search, sortMode]);

  // Sectors present in the current index filter
  const availableSectors = useMemo(() => {
    const sectors = new Set(allTileData.map((d) => d.sector));
    return ["All", ...Array.from(sectors).filter((s) => s !== "Equity").sort()];
  }, [allTileData]);

  return (
    <PageShell
      title="Market Heatmap"
      subtitle="Real-time Indian market performance — tap any tile to forecast."
      actions={
        <div className="flex items-center gap-2 flex-wrap">
          <MarketStatusBadge />
          {lastUpdated && (
            <span className="text-xs text-muted-foreground hidden sm:block">
              Updated {lastUpdated} IST
            </span>
          )}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary text-xs font-semibold hover:bg-secondary/70 transition disabled:opacity-50"
            title="Refresh quotes"
          >
            <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      }
    >
      {/* ── Controls ── */}
      <div className="glass-card p-4 sm:p-5 mb-5 space-y-4">
        {/* Row 1: Index Filters + Search */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Index filter buttons */}
          <div className="flex gap-1.5 flex-wrap flex-1">
            {(["NIFTY 50", "NIFTY NEXT 50", "BANK NIFTY", "SENSEX", "ALL"] as IndexFilter[]).map(
              (f) => {
                const locked = !limits.canPremiumHeatmap && PREMIUM_FILTERS.includes(f);
                return (
                  <button
                    key={f}
                    onClick={() => handleFilterClick(f)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition whitespace-nowrap ${
                      indexFilter === f
                        ? "bg-primary text-primary-foreground shadow-[0_0_12px_oklch(0.87_0.2_165/0.4)]"
                        : locked
                          ? "bg-secondary/40 text-muted-foreground/40 cursor-not-allowed"
                          : "bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/70"
                    }`}
                  >
                    {f}
                    {locked && " 🔒"}
                  </button>
                );
              },
            )}
          </div>
          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-input border border-border focus-within:border-primary/50 transition w-full sm:w-52 shrink-0">
            <Search className="size-3.5 text-muted-foreground shrink-0" />
            <input
              type="text"
              placeholder="Search name or ticker…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Sector filter + Sort */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Sector filter */}
          <div className="flex gap-1 flex-wrap flex-1 min-w-0">
            {availableSectors.slice(0, 10).map((s) => (
              <button
                key={s}
                onClick={() => setSectorFilter(s)}
                className={`px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-wider transition ${
                  sectorFilter === s
                    ? "bg-accent/20 text-accent border border-accent/40"
                    : "bg-secondary/50 text-muted-foreground hover:text-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          {/* Sort */}
          <div className="flex gap-1 shrink-0">
            {(
              [
                { mode: "change" as SortMode, icon: <Activity className="size-3" />, label: "Default" },
                { mode: "gainers" as SortMode, icon: <TrendingUp className="size-3" />, label: "Gainers" },
                { mode: "losers" as SortMode, icon: <TrendingDown className="size-3" />, label: "Losers" },
                { mode: "volume" as SortMode, icon: <BarChart2 className="size-3" />, label: "Volume" },
              ] as const
            ).map(({ mode, icon, label }) => (
              <button
                key={mode}
                onClick={() => setSortMode(mode)}
                title={`Sort by ${label}`}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition ${
                  sortMode === mode
                    ? "bg-primary/20 text-primary border border-primary/30"
                    : "bg-secondary text-muted-foreground hover:text-foreground"
                }`}
              >
                {icon}
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Data states ── */}
      {isError ? (
        <QueryError
          message={(error as Error)?.message ?? "Failed to load market data"}
          onRetry={() => refetch()}
          label="Could not load heatmap data"
        />
      ) : isLoading ? (
        <HeatmapSkeleton />
      ) : (
        <>
          {/* Summary bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <SummaryBar tiles={filteredTileData} />
            <span className="text-xs text-muted-foreground">
              {filteredTileData.length} stock{filteredTileData.length !== 1 ? "s" : ""}
              {isFetching && (
                <span className="ml-2 text-primary animate-pulse">● refreshing…</span>
              )}
            </span>
          </div>

          {/* Empty state */}
          {filteredTileData.length === 0 ? (
            <div className="glass-card p-10 text-center space-y-3">
              <Search className="size-8 mx-auto text-muted-foreground/40" />
              <p className="font-semibold text-sm">No stocks match your filters</p>
              <p className="text-xs text-muted-foreground">
                Try clearing the search or changing the sector filter.
              </p>
              <button
                onClick={() => {
                  setSearch("");
                  setSectorFilter("All");
                }}
                className="mt-2 px-4 py-1.5 rounded-md bg-secondary text-xs font-semibold hover:bg-secondary/70 transition"
              >
                Clear Filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
              {filteredTileData.map((d) => (
                <HeatmapTile key={d.ticker} d={d} />
              ))}
            </div>
          )}

          {/* Legend */}
          <div className="mt-6 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
            <span className="font-semibold uppercase tracking-wider">Legend:</span>
            {[
              { label: "> +4%", bg: "oklch(0.48 0.22 145)" },
              { label: "+2–4%", bg: "oklch(0.58 0.2 150)" },
              { label: "0–2%", bg: "oklch(0.68 0.16 155)" },
              { label: "0", bg: "oklch(0.24 0.04 250)" },
              { label: "0–2%", bg: "oklch(0.5 0.18 25)" },
              { label: "2–4%", bg: "oklch(0.42 0.22 25)" },
              { label: "> -4%", bg: "oklch(0.32 0.25 20)" },
            ].map(({ label, bg }, i) => (
              <span key={i} className="flex items-center gap-1">
                <span
                  className="w-3 h-3 rounded-sm inline-block"
                  style={{ background: bg }}
                />
                {label}
              </span>
            ))}
          </div>
        </>
      )}
    </PageShell>
  );
}
