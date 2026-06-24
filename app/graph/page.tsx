"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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

const COLORS = [
  "#60a5fa",
  "#34d399",
  "#fbbf24",
  "#f87171",
  "#a78bfa",
  "#fb923c",
  "#22d3ee",
  "#f472b6",
  "#c084fc",
  "#84cc16",
];

export default function GraphPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [months, setMonths] = useState(12);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    setMessage("");

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
      .eq("direction", "expense")
      .order("txn_date", { ascending: true });

    if (error) {
      setMessage("読込エラー: " + error.message);
      return;
    }

    setRows((data as Row[]) || []);
  };

  const getCategoryName = (r: Row) => {
    const category = Array.isArray(r.categories)
      ? r.categories[0]
      : r.categories;

    return category?.major_category || "未分類";
  };

  const { chartData, categoryNames } = useMemo(() => {
    const map = new Map<string, Record<string, number | string>>();
    const categorySet = new Set<string>();

    rows.forEach((r) => {
      const month = r.txn_date.slice(0, 7);
      const major = getCategoryName(r);
      const amount = Number(r.amount || 0);

      categorySet.add(major);

      if (!map.has(month)) {
        map.set(month, { month });
      }

      const item = map.get(month)!;
      item[major] = Number(item[major] || 0) + amount;
    });

    let data = Array.from(map.values()).sort((a, b) =>
      String(a.month).localeCompare(String(b.month))
    );

    if (months > 0) {
      data = data.slice(-months);
    }

    return {
      chartData: data,
      categoryNames: Array.from(categorySet).sort((a, b) =>
        a.localeCompare(b, "ja")
      ),
    };
  }, [rows, months]);

  const selectedCategoryData = useMemo(() => {
    if (!selectedCategory) return [];

    const map = new Map<string, number>();

    rows.forEach((r) => {
      const major = getCategoryName(r);
      if (major !== selectedCategory) return;

      const month = r.txn_date.slice(0, 7);
      map.set(month, (map.get(month) || 0) + Number(r.amount || 0));
    });

    let data = Array.from(map.entries())
      .map(([month, amount]) => ({ month, amount }))
      .sort((a, b) => a.month.localeCompare(b.month));

    if (months > 0) {
      data = data.slice(-months);
    }

    return data;
  }, [rows, selectedCategory, months]);

  const selectedCategoryTotal = useMemo(() => {
    return selectedCategoryData.reduce((sum, row) => sum + row.amount, 0);
  }, [selectedCategoryData]);

  return (
    <div
      style={{
        maxWidth: "900px",
        margin: "0 auto",
        padding: "16px",
        paddingBottom: "88px",
        background: "#111827",
        minHeight: "100vh",
        color: "#f9fafb",
      }}
    >
      <h1 style={{ fontSize: "24px", fontWeight: "bold" }}>
        月別支出グラフ
      </h1>

      <div
        style={{
          display: "grid",
          gap: "12px",
          marginBottom: "16px",
          border: "1px solid #374151",
          borderRadius: "12px",
          padding: "12px",
          background: "#1f2937",
        }}
      >
        <div>
          <div style={{ marginBottom: "4px" }}>表示月数</div>
          <select
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
            style={selectStyle}
          >
            <option value={6}>直近6か月</option>
            <option value={12}>直近12か月</option>
            <option value={24}>直近24か月</option>
            <option value={0}>すべて</option>
          </select>
        </div>

        <div>
          <div style={{ marginBottom: "4px" }}>費目を選んで推移を見る</div>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            style={selectStyle}
          >
            <option value="">選択なし</option>
            {categoryNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {message && <div>{message}</div>}

      <SectionTitle title="全体：費目別の月別支出" />

      <div style={scrollWrapStyle}>
        <div style={{ width: Math.max(chartData.length * 80, 600), height: 420 }}>
          <BarChart
            width={Math.max(chartData.length * 80, 600)}
            height={420}
            data={chartData}
            margin={{ top: 8, right: 16, left: 8, bottom: 40 }}
          >
            <CartesianGrid stroke="#374151" />
            <XAxis
              dataKey="month"
              stroke="#f9fafb"
              tick={{ fontSize: 12 }}
              angle={-40}
              textAnchor="end"
              interval={0}
            />
            <YAxis
              stroke="#f9fafb"
              tick={{ fontSize: 12 }}
              tickFormatter={(v) =>
                Number(v) >= 10000 ? `${(Number(v) / 10000).toFixed(0)}万` : String(v)
              }
            />
            <Tooltip
              contentStyle={{ background: "#1f2937", border: "1px solid #374151", color: "#f9fafb" }}
              formatter={(value) => [
                `${Number(value).toLocaleString()}円`,
              ]}
            />
            <Legend
              wrapperStyle={{ paddingTop: "8px", color: "#f9fafb", fontSize: "13px" }}
            />
            {categoryNames.map((name, index) => (
              <Bar
                key={name}
                dataKey={name}
                stackId="expense"
                fill={COLORS[index % COLORS.length]}
              />
            ))}
          </BarChart>
        </div>
      </div>

      {selectedCategory && (
        <>
          <SectionTitle title={`${selectedCategory} の月別推移`} />

          <div
            style={{
              marginBottom: "8px",
              color: "#d1d5db",
              fontSize: "14px",
            }}
          >
            表示期間合計: {selectedCategoryTotal.toLocaleString()}円
          </div>

          <div style={scrollWrapStyle}>
            <div style={{ width: Math.max(selectedCategoryData.length * 80, 600), height: 360 }}>
              <LineChart
                width={Math.max(selectedCategoryData.length * 80, 600)}
                height={360}
                data={selectedCategoryData}
                margin={{ top: 8, right: 16, left: 8, bottom: 40 }}
              >
                <CartesianGrid stroke="#374151" />
                <XAxis
                  dataKey="month"
                  stroke="#f9fafb"
                  tick={{ fontSize: 12 }}
                  angle={-40}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis
                  stroke="#f9fafb"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v: number) =>
                    v >= 10000 ? `${(v / 10000).toFixed(0)}万` : String(v)
                  }
                />
                <Tooltip
                  contentStyle={{ background: "#1f2937", border: "1px solid #374151", color: "#f9fafb" }}
                  formatter={(value) => [`${Number(value).toLocaleString()}円`, selectedCategory]}
                />
                <Legend wrapperStyle={{ paddingTop: "8px", color: "#f9fafb", fontSize: "13px" }} />
                <Line
                  type="monotone"
                  dataKey="amount"
                  name={selectedCategory}
                  stroke="#60a5fa"
                  strokeWidth={3}
                  dot={{ r: 5 }}
                />
              </LineChart>
            </div>
          </div>
        </>
      )}

      <BottomNav />
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h2 style={{ fontSize: "18px", marginTop: "20px", marginBottom: "8px" }}>
      {title}
    </h2>
  );
}

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px",
  background: "#111827",
  color: "#f9fafb",
  border: "1px solid #374151",
  borderRadius: "8px",
};

const scrollWrapStyle: React.CSSProperties = {
  overflowX: "auto",
  background: "#1f2937",
  border: "1px solid #374151",
  borderRadius: "12px",
  padding: "12px",
  marginBottom: "16px",
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
        fontSize: "13px",
        padding: "8px 4px",
      }}
    >
      {label}
    </a>
  );
}