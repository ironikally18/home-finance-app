"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

type Row = {
  txn_date: string;
  amount: number;
  direction: string;
  categories:
    | { major_category: string; minor_category: string }
    | { major_category: string; minor_category: string }[]
    | null;
};

export default function SummaryPage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<Row[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void loadData();
  }, [month]);

  const loadData = async () => {
    setMessage("");

    const from = `${month}-01`;
    const dt = new Date(`${month}-01T00:00:00`);
    const nextMonth = new Date(dt.getFullYear(), dt.getMonth() + 1, 1);
    const to = nextMonth.toISOString().slice(0, 10);

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
      .gte("txn_date", from)
      .lt("txn_date", to);

    if (error) {
      setMessage("読込エラー: " + error.message);
      return;
    }

    setRows((data as Row[]) || []);
  };

  const summary = useMemo(() => {
    let income = 0;
    let expense = 0;
    const categoryMap = new Map<string, number>();

    rows.forEach((r) => {
      const amount = Number(r.amount || 0);

      if (r.direction === "income") {
        income += amount;
        return;
      }

      if (r.direction === "expense") {
        expense += amount;

        const cat = Array.isArray(r.categories)
          ? r.categories[0]
          : r.categories;

        const name = cat
          ? `${cat.major_category} / ${cat.minor_category}`
          : "未分類";

        categoryMap.set(name, (categoryMap.get(name) || 0) + amount);
      }
    });

    const categories = Array.from(categoryMap.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);

    return {
      income,
      expense,
      balance: income - expense,
      categories,
    };
  }, [rows]);

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

      {message && <div style={{ marginTop: "12px" }}>{message}</div>}

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
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        background: "#020617",
        borderTop: "1px solid #374151",
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        padding: "8px",
        zIndex: 50,
      }}
    >
      <Nav href="/" label="入力" />
      <Nav href="/summary" label="集計" />
      <Nav href="/graph" label="グラフ" />
      <Nav href="/kids" label="子供" />
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