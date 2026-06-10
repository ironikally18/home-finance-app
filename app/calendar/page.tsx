"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient, User } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

type Row = {
  id: string;
  txn_date: string;
  amount: number;
  direction: string;
  merchant_name: string | null;
  description: string | null;
  categories:
  | { major_category: string; minor_category: string }
  | { major_category: string; minor_category: string }[]
  | null;
};

export default function CalendarPage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<Row[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [message, setMessage] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
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

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (user) {
      void loadData();
    }
  }, [user, month]);

  const loadData = async () => {
    setMessage("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user) {
      setMessage("ログインしてください");
      setRows([]);
      return;
    }

    const from = `${month}-01`;
    const dt = new Date(`${month}-01T00:00:00`);
    const nextMonth = new Date(dt.getFullYear(), dt.getMonth() + 1, 1);
    const to = nextMonth.toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from("transaction_records")
      .select(`
        id,
        txn_date,
        amount,
        direction,
        merchant_name,
        description,
        categories:category_id (
          major_category,
          minor_category
        )
      `)
      .eq("user_id", session.user.id)
      .gte("txn_date", from)
      .lt("txn_date", to)
      .order("txn_date", { ascending: true });

    if (error) {
      setMessage("読込エラー: " + error.message);
      return;
    }

    setRows((data as Row[]) || []);
  };

  const byDate = useMemo(() => {
    const map = new Map<string, Row[]>();
    rows.forEach((r) => {
      if (!map.has(r.txn_date)) map.set(r.txn_date, []);
      map.get(r.txn_date)!.push(r);
    });
    return map;
  }, [rows]);

  const calendarDays = useMemo(() => {
    const first = new Date(`${month}-01T00:00:00`);
    const year = first.getFullYear();
    const m = first.getMonth();
    const last = new Date(year, m + 1, 0);
    const startDay = first.getDay();

    const days: (string | null)[] = [];

    for (let i = 0; i < startDay; i++) days.push(null);

    for (let d = 1; d <= last.getDate(); d++) {
      days.push(`${month}-${String(d).padStart(2, "0")}`);
    }

    while (days.length % 7 !== 0) days.push(null);

    return days;
  }, [month]);

  const selectedRows = selectedDate ? byDate.get(selectedDate) || [] : [];

  const monthTotal = useMemo(() => {
    let income = 0;
    let expense = 0;

    rows.forEach((r) => {
      if (r.direction === "income") income += Number(r.amount || 0);
      if (r.direction === "expense") expense += Number(r.amount || 0);
    });

    return { income, expense, balance: income - expense };
  }, [rows]);

  const moveMonth = (diff: number) => {
    const dt = new Date(`${month}-01T00:00:00`);
    dt.setMonth(dt.getMonth() + diff);
    const next = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    setMonth(next);
    setSelectedDate("");
  };

  if (authLoading) {
    return <div style={{ padding: "16px" }}>読み込み中...</div>;
  }

  if (!user) {
    return <div style={{ padding: "16px" }}>ログインしてください</div>;
  }

  return (
    <div
      style={{
        maxWidth: "760px",
        margin: "0 auto",
        padding: "16px",
        paddingBottom: "88px",
        minHeight: "100vh",
        background: "#111827",
        color: "#f9fafb",
      }}
    >
      <h1 style={{ fontSize: "24px", fontWeight: "bold" }}>月間カレンダー</h1>

      <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
        <button onClick={() => moveMonth(-1)} style={buttonStyle}>◀</button>
        <input
          type="month"
          value={month}
          onChange={(e) => {
            setMonth(e.target.value);
            setSelectedDate("");
          }}
          style={inputStyle}
        />
        <button onClick={() => moveMonth(1)} style={buttonStyle}>▶</button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "8px",
          marginBottom: "12px",
        }}
      >
        <Box title="収入" value={monthTotal.income} />
        <Box title="支出" value={monthTotal.expense} />
        <Box title="差額" value={monthTotal.balance} />
      </div>

      {message && <div>{message}</div>}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: "4px",
          marginBottom: "8px",
          fontSize: "12px",
          color: "#d1d5db",
          textAlign: "center",
        }}
      >
        {["日", "月", "火", "水", "木", "金", "土"].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: "4px",
        }}
      >
        {calendarDays.map((date, idx) => {
          if (!date) {
            return <div key={idx} style={{ minHeight: "76px" }} />;
          }

          const dayRows = byDate.get(date) || [];
          const income = dayRows
            .filter((r) => r.direction === "income")
            .reduce((s, r) => s + Number(r.amount || 0), 0);
          const expense = dayRows
            .filter((r) => r.direction === "expense")
            .reduce((s, r) => s + Number(r.amount || 0), 0);

          const isSelected = selectedDate === date;

          return (
            <button
              key={date}
              onClick={() => setSelectedDate(date)}
              style={{
                minHeight: "76px",
                padding: "6px",
                borderRadius: "8px",
                border: isSelected ? "2px solid #60a5fa" : "1px solid #374151",
                background:
                  expense >= 10000
                    ? "#7f1d1d"
                    : expense > 0
                      ? "#1f2937"
                      : income > 0
                        ? "#064e3b"
                        : "#111827",
                color: "#f9fafb",
                textAlign: "left",
              }}
            >
              <div style={{ fontWeight: "bold" }}>{Number(date.slice(8))}</div>
              {income > 0 && (
                <div style={{ fontSize: "11px", color: "#86efac" }}>
                  +{income.toLocaleString()}
                </div>
              )}
              {expense > 0 && (
                <div style={{ fontSize: "11px", color: "#fca5a5" }}>
                  -{expense.toLocaleString()}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div
        style={{
          marginTop: "16px",
          border: "1px solid #374151",
          borderRadius: "10px",
          padding: "12px",
          background: "#1f2937",
        }}
      >
        <h2 style={{ fontSize: "18px", marginTop: 0 }}>
          {selectedDate || "日付を選んでください"}
        </h2>

        {selectedRows.length === 0 && selectedDate && <div>この日の記録はありません。</div>}

        <div style={{ display: "grid", gap: "8px" }}>
          {selectedRows.map((r) => {
            const cat = Array.isArray(r.categories) ? r.categories[0] : r.categories;

            return (
              <div
                key={r.id}
                style={{
                  border: "1px solid #374151",
                  borderRadius: "8px",
                  padding: "10px",
                  background: "#111827",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                  <div>
                    {cat
                      ? `${cat.major_category} / ${cat.minor_category}`
                      : "未分類"}
                  </div>
                  <div
                    style={{
                      fontWeight: "bold",
                      color: r.direction === "income" ? "#86efac" : "#fca5a5",
                    }}
                  >
                    {r.direction === "income" ? "+" : "-"}
                    {Number(r.amount).toLocaleString()}円
                  </div>
                </div>
                <div style={{ fontSize: "13px", color: "#d1d5db", marginTop: "4px" }}>
                  {r.merchant_name || r.description || "-"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

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

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "10px",
  background: "#1f2937",
  color: "#f9fafb",
  border: "1px solid #374151",
  borderRadius: "8px",
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 14px",
  background: "#374151",
  color: "#f9fafb",
  border: "none",
  borderRadius: "8px",
};

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
        gridTemplateColumns: "repeat(6, 1fr)",
        padding: "4px 2px",
        zIndex: 50,
      }}
    >
      <Nav href="/" label="🏠" />
      <Nav href="/summary" label="📊" />
      <Nav href="/graph" label="📈" />
      <Nav href="/calendar" label="📅" />
      <Nav href="/dashboard" label="指標" />
      <Nav href="/kids" label="👦" />
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
        fontSize: "12px",
        padding: "8px 2px",
      }}
    >
      {label}
    </a>
  );
}