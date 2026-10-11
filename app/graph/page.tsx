"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
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

const PAGE_SIZE = 1000;

// ---- 年月ヘルパー（"YYYY-MM" 形式） ----
const pad2 = (n: number) => String(n).padStart(2, "0");

const currentYm = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
};

const addMonths = (ym: string, diff: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + diff, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
};

// start〜end（両端含む）の月を全部並べる
const listMonths = (start: string, end: string) => {
  const result: string[] = [];
  let cur = start;
  // 念のため上限（約40年）
  for (let i = 0; i < 480 && cur <= end; i++) {
    result.push(cur);
    cur = addMonths(cur, 1);
  }
  return result;
};

type Preset = "6" | "12" | "24" | "all" | "custom";

export default function GraphPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [message, setMessage] = useState("");

  // 期間（初期値：今月を終了月とした直近12か月）
  const [preset, setPreset] = useState<Preset>("12");
  const [startMonth, setStartMonth] = useState(() => addMonths(currentYm(), -11));
  const [endMonth, setEndMonth] = useState(() => currentYm());

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user) void loadData();
  }, [user]);

  // 1000件ずつ .range() で繰り返し、全件読み込む
  const loadData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    setMessage("");

    const all: Row[] = [];
    let from = 0;

    while (true) {
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
        .eq("user_id", session.user.id)
        .eq("direction", "expense")
        // 同じ日付の行がページ境界で重複・欠落しないよう id でも並べる
        .order("txn_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        setMessage("読込エラー: " + error.message);
        return;
      }

      const chunk = (data as unknown as Row[]) || [];
      all.push(...chunk);

      if (chunk.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    setRows(all);
  };

  const getCategoryName = (r: Row) => {
    const category = Array.isArray(r.categories)
      ? r.categories[0]
      : r.categories;

    return category?.major_category || "未分類";
  };

  // ---- 期間の操作 ----
  const applyPreset = (value: Preset) => {
    setPreset(value);
    const cur = currentYm();

    if (value === "custom") return;

    if (value === "all") {
      const first = rows.length > 0 ? rows[0].txn_date.slice(0, 7) : cur;
      setStartMonth(first);
      setEndMonth(cur);
      return;
    }

    setStartMonth(addMonths(cur, -(Number(value) - 1)));
    setEndMonth(cur);
  };

  const onChangeStart = (v: string) => {
    if (!v) return;
    setStartMonth(v);
    setPreset("custom");
  };

  const onChangeEnd = (v: string) => {
    if (!v) return;
    setEndMonth(v);
    setPreset("custom");
  };

  // 開始と終了が逆でも動くようにする
  const rangeStart = startMonth <= endMonth ? startMonth : endMonth;
  const rangeEnd = startMonth <= endMonth ? endMonth : startMonth;

  const monthList = useMemo(
    () => listMonths(rangeStart, rangeEnd),
    [rangeStart, rangeEnd]
  );

  // 期間内の行だけに絞る
  const rangeRows = useMemo(
    () =>
      rows.filter((r) => {
        const m = r.txn_date.slice(0, 7);
        return m >= rangeStart && m <= rangeEnd;
      }),
    [rows, rangeStart, rangeEnd]
  );

  const { chartData, categoryNames } = useMemo(() => {
    // 期間内の全ての月を最初に0円で用意しておく
    const map = new Map<string, Record<string, number | string>>();
    monthList.forEach((month) => map.set(month, { month }));

    const categorySet = new Set<string>();

    rangeRows.forEach((r) => {
      const month = r.txn_date.slice(0, 7);
      const major = getCategoryName(r);
      const amount = Number(r.amount || 0);

      categorySet.add(major);

      const item = map.get(month);
      if (!item) return;
      item[major] = Number(item[major] || 0) + amount;
    });

    return {
      chartData: Array.from(map.values()),
      categoryNames: Array.from(categorySet).sort((a, b) =>
        a.localeCompare(b, "ja")
      ),
    };
  }, [rangeRows, monthList]);

  // 費目プルダウンの候補は、期間にかかわらず全データの費目から作る
  const allCategoryNames = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add(getCategoryName(r)));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ja"));
  }, [rows]);

  const selectedCategoryData = useMemo(() => {
    if (!selectedCategory) return [];

    const map = new Map<string, number>();
    monthList.forEach((month) => map.set(month, 0));

    rangeRows.forEach((r) => {
      if (getCategoryName(r) !== selectedCategory) return;
      const month = r.txn_date.slice(0, 7);
      map.set(month, (map.get(month) || 0) + Number(r.amount || 0));
    });

    return Array.from(map.entries()).map(([month, amount]) => ({
      month,
      amount,
    }));
  }, [rangeRows, monthList, selectedCategory]);

  const selectedCategoryTotal = useMemo(() => {
    return selectedCategoryData.reduce((sum, row) => sum + row.amount, 0);
  }, [selectedCategoryData]);

  if (authLoading) {
    return <div style={{ minHeight: "100vh", background: "#111827", color: "#f9fafb", display: "flex", alignItems: "center", justifyContent: "center" }}>読込中...</div>;
  }

  if (!user) {
    return <div style={{ minHeight: "100vh", background: "#111827", color: "#f9fafb", display: "flex", alignItems: "center", justifyContent: "center" }}>ログインしてください</div>;
  }

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
          <div style={{ marginBottom: "4px" }}>表示期間（クイック選択）</div>
          <select
            value={preset}
            onChange={(e) => applyPreset(e.target.value as Preset)}
            style={selectStyle}
          >
            <option value="6">直近6か月</option>
            <option value="12">直近12か月</option>
            <option value="24">直近24か月</option>
            <option value="all">すべて</option>
            <option value="custom">指定期間</option>
          </select>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <div>
            <div style={{ marginBottom: "4px" }}>開始月</div>
            <input
              type="month"
              value={startMonth}
              onChange={(e) => onChangeStart(e.target.value)}
              style={selectStyle}
            />
          </div>
          <div>
            <div style={{ marginBottom: "4px" }}>終了月</div>
            <input
              type="month"
              value={endMonth}
              onChange={(e) => onChangeEnd(e.target.value)}
              style={selectStyle}
            />
          </div>
        </div>

        <div>
          <div style={{ marginBottom: "4px" }}>費目を選んで推移を見る</div>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            style={selectStyle}
          >
            <option value="">選択なし</option>
            {allCategoryNames.map((name) => (
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
  boxSizing: "border-box",
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
