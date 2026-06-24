"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, User } from "@supabase/supabase-js";

// ① モジュールスコープで一度だけ生成（再レンダリングのたびに再生成されない）
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ② direction を union 型で厳密化
type Direction = "income" | "expense" | "transfer" | "charge";

type Category = {
  major_category: string;
  minor_category: string;
};

type Row = {
  txn_date: string;
  amount: number;
  direction: Direction;
  // ③ Supabase join は常に単一オブジェクトまたは null（配列にはならない）
  categories: Category | null;
};

// ④ 月の開始日・終了日を純粋関数で算出（loadData 内に埋め込まない）
function getMonthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return {
    from: `${month}-01`,
    to: `${nextY}-${String(nextM).padStart(2, "0")}-01`,
  };
}

export default function SummaryPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<Row[]>([]);
  const [message, setMessage] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  // ⑤ データ取得中のローディング状態を追加
  const [dataLoading, setDataLoading] = useState(false);

  // 認証初期化
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      // ⑥ アンマウント後の state 更新を防ぐ
      if (!cancelled) {
        setUser(session?.user ?? null);
        setAuthLoading(false);
      }
    };

    void init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) {
        setUser(session?.user ?? null);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  // ⑦ useCallback で関数を安定化（useEffect の依存配列に安全に含められる）
  const loadData = useCallback(async () => {
    if (!user) return;

    setMessage("");
    setDataLoading(true);

    try {
      // ⑧ user は既に state から取得済みのため getSession 二重呼び出しを削除
      const { from, to } = getMonthRange(month);

      const { data, error } = await supabase
        .from("transaction_records")
        .select(`
          txn_date,
          amount,
          direction,
          categories:category_id (
            major_category,
            minor_category
          )
        `)
        .eq("user_id", user.id)
        .gte("txn_date", from)
        .lt("txn_date", to)
        .order("txn_date", { ascending: true });

      if (error) {
        setMessage("読込エラー: " + error.message);
        return;
      }

      setRows(data ? (data as Row[]) : []);
    } finally {
      setDataLoading(false);
    }
  }, [user, month]);

  useEffect(() => {
    if (user) {
      void loadData();
    }
  }, [user, month, loadData]);

  const summary = useMemo(() => {
    let income = 0;
    let expense = 0;
    const categoryMap = new Map<string, number>();

    for (const r of rows) {
      // ⑨ NaN ガード（amount が文字列や undefined の場合も安全に処理）
      const amount = Number(r.amount);
      if (!Number.isFinite(amount) || amount < 0) continue;

      if (r.direction === "income") {
        income += amount;
        continue;
      }

      if (r.direction === "expense") {
        expense += amount;

        // ⑩ 配列チェックを削除（型定義を Category | null に修正済み）
        const cat = r.categories;
        const name = cat
          ? `${cat.major_category} / ${cat.minor_category}`
          : "未分類";

        categoryMap.set(name, (categoryMap.get(name) ?? 0) + amount);
      }
    }

    const categories = Array.from(categoryMap.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);

    return { income, expense, balance: income - expense, categories };
  }, [rows]);

  if (authLoading) {
    return <div style={{ padding: "16px" }}>読み込み中...</div>;
  }

  if (!user) {
    return <div style={{ padding: "16px" }}>ログインしてください</div>;
  }

  return (
    <div
      style={{
        maxWidth: "720px",
        margin: "0 auto",
        padding: "16px",
        paddingBottom: "88px",
        background: "#111827",
        minHeight: "100vh",
        color: "#f9fafb",
      }}
    >
      <h1 style={{ fontSize: "24px", fontWeight: "bold" }}>月別集計</h1>

      <div style={{ marginBottom: "16px" }}>
        <div style={{ marginBottom: "4px" }}>対象月</div>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={{
            width: "100%",
            padding: "10px",
            background: "#1f2937",
            color: "#f9fafb",
            border: "1px solid #374151",
            borderRadius: "8px",
          }}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "8px",
          marginBottom: "16px",
        }}
      >
        <Box title="収入" value={summary.income} />
        <Box title="支出" value={summary.expense} />
        <Box title="差額" value={summary.balance} />
      </div>

      <h2 style={{ fontSize: "18px", marginTop: "20px" }}>費目別支出</h2>

      {/* ⑪ データ取得中のローディング表示 */}
      {dataLoading ? (
        <div>読み込み中...</div>
      ) : (
        <div style={{ display: "grid", gap: "8px" }}>
          {summary.categories.length === 0 && <div>データがありません。</div>}

          {summary.categories.map((c) => (
            <div
              key={c.name}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "12px",
                border: "1px solid #374151",
                borderRadius: "8px",
                padding: "10px",
                background: "#1f2937",
              }}
            >
              <div>{c.name}</div>
              <div style={{ fontWeight: "bold", whiteSpace: "nowrap" }}>
                {c.amount.toLocaleString()}円
              </div>
            </div>
          ))}
        </div>
      )}

      {message && (
        // ⑫ エラーメッセージに role="alert" を付与（アクセシビリティ向上）
        <div role="alert" style={{ marginTop: "12px", color: "#f87171" }}>
          {message}
        </div>
      )}

      <BottomNav />
    </div>
  );
}

function Box({ title, value }: { title: string; value: number }) {
  return (
    <div
      style={{
        border: "1px solid #374151",
        borderRadius: "8px",
        padding: "10px",
        background: "#1f2937",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "12px", color: "#d1d5db" }}>{title}</div>
      <div style={{ fontWeight: "bold" }}>{value.toLocaleString()}円</div>
    </div>
  );
}

function BottomNav() {
  return (
    // ⑬ nav 要素 + aria-label でセマンティクス向上
    <nav
      aria-label="メインナビゲーション"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        background: "#020617",
        borderTop: "1px solid #374151",
        display: "grid",
        gridTemplateColumns: "repeat(6, 1fr)",
        padding: "4px 2px",
        zIndex: 50,
      }}
    >
      <Nav href="/" label="🏠" ariaLabel="ホーム" />
      <Nav href="/summary" label="📊" ariaLabel="月別集計" />
      <Nav href="/graph" label="📈" ariaLabel="グラフ" />
      <Nav href="/calendar" label="📅" ariaLabel="カレンダー" />
      <Nav href="/dashboard" label="指標" ariaLabel="指標ダッシュボード" />
      <Nav href="/kids" label="👦" ariaLabel="こども" />
    </nav>
  );
}

function Nav({ href, label, ariaLabel }: { href: string; label: string; ariaLabel: string }) {
  return (
    <a
      href={href}
      aria-label={ariaLabel}
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
