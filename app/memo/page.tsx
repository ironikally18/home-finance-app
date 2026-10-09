"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, User } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

type AliasRow = {
  id: string;
  alias_name: string;
  display_order: number;
};

type BalanceRow = {
  id: string;
  alias_id: string;
  balance_month: string; // YYYY-MM-01
  amount: number; // 円
};

// 1万円単位・小数1桁（1,000円まで）。単位や「円」は表示しない
const toMan = (yen: number) =>
  (yen / 10000).toLocaleString("ja-JP", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

const ym = (d: string) => d.slice(0, 7);

const COLORS = ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#fb923c", "#22d3ee", "#f87171"];

const card: React.CSSProperties = {
  background: "#111827",
  color: "#f9fafb",
  border: "1px solid #374151",
  borderRadius: "12px",
  padding: "12px",
};

const field: React.CSSProperties = {
  width: "100%",
  padding: "10px",
  borderRadius: "8px",
  border: "1px solid #4b5563",
  background: "#1f2937",
  color: "#f9fafb",
  fontSize: "16px",
};

const btn: React.CSSProperties = {
  padding: "10px 14px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: "8px",
};

const btnSub: React.CSSProperties = {
  ...btn,
  background: "#374151",
};

export default function Page() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [aliases, setAliases] = useState<AliasRow[]>([]);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [message, setMessage] = useState("");

  const [month, setMonth] = useState("");
  const [aliasId, setAliasId] = useState("");
  const [amount, setAmount] = useState("");

  const [newAlias, setNewAlias] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  useEffect(() => {
    setMonth(new Date().toISOString().slice(0, 7));

    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setUser(session?.user ?? null);
      setAuthLoading(false);
    };
    void init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      supabase
        .from("asset_aliases")
        .select("id, alias_name, display_order")
        .order("display_order", { ascending: true }),
      supabase
        .from("asset_balances")
        .select("id, alias_id, balance_month, amount")
        .order("balance_month", { ascending: true }),
    ]);

    if (a.error || b.error) {
      setMessage(`読み込みに失敗しました: ${(a.error || b.error)?.message}`);
      return;
    }
    const aliasRows = (a.data ?? []) as AliasRow[];
    setAliases(aliasRows);
    setBalances((b.data ?? []) as BalanceRow[]);
    setAliasId((prev) => prev || aliasRows[0]?.id || "");
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  // 別名ごとの最新残高（balances は月の昇順なので後勝ち）
  const latest = useMemo(() => {
    const m = new Map<string, BalanceRow>();
    for (const b of balances) m.set(b.alias_id, b);
    return m;
  }, [balances]);

  const handleSave = async () => {
    if (!user) return;
    if (!aliasId) {
      setMessage("項目を選んでください");
      return;
    }
    const yen = Number(amount.replace(/[,\s]/g, ""));
    if (!amount || !Number.isInteger(yen) || yen < 0) {
      setMessage("残高は0以上の整数で入力してください");
      return;
    }
    const { error } = await supabase.from("asset_balances").upsert(
      {
        user_id: user.id,
        alias_id: aliasId,
        balance_month: `${month}-01`,
        amount: yen,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "alias_id,balance_month" }
    );
    if (error) {
      setMessage(`保存に失敗しました: ${error.message}`);
      return;
    }
    setAmount("");
    setMessage("保存しました");
    await load();
  };

  const handleAddAlias = async () => {
    if (!user) return;
    const name = newAlias.trim();
    if (!name) return;
    const nextOrder = aliases.length ? Math.max(...aliases.map((a) => a.display_order)) + 1 : 1;
    const { error } = await supabase
      .from("asset_aliases")
      .insert({ user_id: user.id, alias_name: name, display_order: nextOrder });
    if (error) {
      setMessage(`追加に失敗しました: ${error.message}`);
      return;
    }
    setNewAlias("");
    await load();
  };

  const handleRename = async (id: string) => {
    const name = editName.trim();
    if (!name) return;
    const { error } = await supabase.from("asset_aliases").update({ alias_name: name }).eq("id", id);
    if (error) {
      setMessage(`変更に失敗しました: ${error.message}`);
      return;
    }
    setEditingId(null);
    await load();
  };

  const handleDelete = async (a: AliasRow) => {
    if (!window.confirm(`「${a.alias_name}」と、その残高の履歴をすべて削除します。よろしいですか？`)) return;
    const { error } = await supabase.from("asset_aliases").delete().eq("id", a.id);
    if (error) {
      setMessage(`削除に失敗しました: ${error.message}`);
      return;
    }
    setAliasId((prev) => (prev === a.id ? "" : prev));
    await load();
  };

  if (authLoading) {
    return <div style={{ maxWidth: "560px", margin: "0 auto", padding: "16px" }}>読み込み中...</div>;
  }

  if (!user) {
    return (
      <div style={{ maxWidth: "560px", margin: "0 auto", padding: "16px" }}>
        ログインが必要です。<a href="/">トップに戻る</a>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "560px", margin: "0 auto", padding: "16px", paddingBottom: "88px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: "bold", margin: 0 }}>メモ</h1>
        <button
          onClick={() => supabase.auth.signOut()}
          style={{ padding: "8px 12px", background: "#e5e7eb", color: "#111827", border: "none", borderRadius: "8px" }}
        >
          ログアウト
        </button>
      </div>

      {message && <div style={{ marginBottom: "12px", fontSize: "14px" }}>{message}</div>}

      <div style={{ display: "grid", gap: "16px" }}>
        {/* 別名ごとの最新残高 */}
        <section style={card}>
          <div style={{ display: "grid", gap: "8px" }}>
            {aliases.length === 0 && <div style={{ color: "#9ca3af" }}>下の「項目の管理」から項目を追加してください</div>}
            {aliases.map((a, i) => {
              const b = latest.get(a.id);
              return (
                <div
                  key={a.id}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px" }}
                >
                  <span>
                    <span style={{ color: COLORS[i % COLORS.length], marginRight: "6px" }}>●</span>
                    {a.alias_name}
                  </span>
                  <span style={{ fontVariantNumeric: "tabular-nums", fontSize: "20px" }}>
                    {b ? toMan(b.amount) : "-"}
                    {b && <span style={{ marginLeft: "8px", fontSize: "11px", color: "#9ca3af" }}>{ym(b.balance_month)}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* 推移グラフ */}
        <section style={card}>
          <TrendChart aliases={aliases} balances={balances} />
        </section>

        {/* 入力 */}
        <section style={card}>
          <div style={{ display: "grid", gap: "10px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={field} />
              <select value={aliasId} onChange={(e) => setAliasId(e.target.value)} style={field}>
                {aliases.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.alias_name}
                  </option>
                ))}
              </select>
            </div>
            <input
              inputMode="numeric"
              placeholder="残高（1円単位）"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={field}
            />
            <button onClick={handleSave} style={btn}>
              保存
            </button>
            <div style={{ fontSize: "12px", color: "#9ca3af" }}>同じ月・同じ項目は上書きされます</div>
          </div>
        </section>

        {/* 項目の管理 */}
        <section style={card}>
          <div style={{ marginBottom: "8px", fontWeight: "bold" }}>項目の管理</div>
          <div style={{ display: "grid", gap: "8px" }}>
            {aliases.map((a) => (
              <div key={a.id} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                {editingId === a.id ? (
                  <>
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ ...field, flex: 1 }} />
                    <button onClick={() => handleRename(a.id)} style={btn}>
                      保存
                    </button>
                    <button onClick={() => setEditingId(null)} style={btnSub}>
                      戻す
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ flex: 1 }}>{a.alias_name}</div>
                    <button
                      onClick={() => {
                        setEditingId(a.id);
                        setEditName(a.alias_name);
                      }}
                      style={btnSub}
                    >
                      編集
                    </button>
                    <button onClick={() => handleDelete(a)} style={{ ...btn, background: "#dc2626" }}>
                      削除
                    </button>
                  </>
                )}
              </div>
            ))}
            <div style={{ display: "flex", gap: "6px" }}>
              <input
                placeholder="新しい項目名（別名）"
                value={newAlias}
                onChange={(e) => setNewAlias(e.target.value)}
                style={{ ...field, flex: 1 }}
              />
              <button onClick={handleAddAlias} style={btn}>
                追加
              </button>
            </div>
          </div>
        </section>
      </div>

      <BottomNav />
    </div>
  );
}

function TrendChart({ aliases, balances }: { aliases: AliasRow[]; balances: BalanceRow[] }) {
  const months = Array.from(new Set(balances.map((b) => ym(b.balance_month)))).sort().slice(-12);

  if (months.length === 0) {
    return <div style={{ color: "#9ca3af" }}>残高を保存すると推移が表示されます</div>;
  }

  const lookup = new Map<string, number>();
  for (const b of balances) lookup.set(`${b.alias_id}|${ym(b.balance_month)}`, b.amount / 10000);

  const vals = Array.from(lookup.entries())
    .filter(([k]) => months.includes(k.split("|")[1]))
    .map(([, v]) => v);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.1;
  lo -= pad;
  hi += pad;

  const W = 520;
  const H = 220;
  const L = 48;
  const R = 12;
  const T = 12;
  const B = 24;

  const x = (i: number) => (months.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (months.length - 1));
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const ticks = [0, 1, 2, 3].map((k) => lo + ((hi - lo) * k) / 3);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#374151" strokeWidth={1} />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#9ca3af">
              {t.toFixed(1)}
            </text>
          </g>
        ))}
        {months.map((m, i) =>
          i === 0 || i === months.length - 1 || i % 3 === 0 ? (
            <text key={m} x={x(i)} y={H - 6} textAnchor="middle" fontSize={11} fill="#9ca3af">
              {m.slice(2)}
            </text>
          ) : null
        )}
        {aliases.map((a, idx) => {
          const color = COLORS[idx % COLORS.length];
          const pts = months
            .map((m, i) => {
              const v = lookup.get(`${a.id}|${m}`);
              return v === undefined ? null : { x: x(i), y: y(v) };
            })
            .filter((p): p is { x: number; y: number } => p !== null);
          if (pts.length === 0) return null;
          return (
            <g key={a.id}>
              {pts.length > 1 && (
                <polyline
                  points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                />
              )}
              {pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={3} fill={color} />
              ))}
            </g>
          );
        })}
      </svg>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", fontSize: "12px" }}>
        {aliases.map((a, i) => (
          <span key={a.id}>
            <span style={{ color: COLORS[i % COLORS.length] }}>●</span> {a.alias_name}
          </span>
        ))}
      </div>
    </div>
  );
}

function BottomNav() {
  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        background: "#020617",
        borderTop: "1px solid #374151",
        display: "grid",
        gridTemplateColumns: "repeat(8, 1fr)",
        padding: "4px 2px",
        zIndex: 50,
      }}
    >
      <Nav href="/" label="🏠" />
      <Nav href="/fixed-costs" label="固定費" />
      <Nav href="/summary" label="📊" />
      <Nav href="/graph" label="📈" />
      <Nav href="/calendar" label="📅" />
      <Nav href="/dashboard" label="指標" />
      <Nav href="/kids" label="👦" />
      <Nav href="/memo" label="📝" />
    </div>
  );
}

function Nav({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      style={{
        textAlign: "center",
        color: "#f9fafb",
        textDecoration: "none",
        fontSize: "13px",
        padding: "8px 4px",
      }}
    >
      {label}
    </a>
  );
}
