"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
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

// direction の値（収入側の値がDBと違う場合はここだけ直す）
const DIRECTION_EXPENSE = "expense";
const DIRECTION_INCOME = "income";

type Tab = "expense" | "income";
type CategoryLevel = "major" | "minor";

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
  const [tab, setTab] = useState<Tab>("expense");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [categoryLevel, setCategoryLevel] = useState<CategoryLevel>("major");
  const [message, setMessage] = useState("");
  const [showSearchGraph, setShowSearchGraph] = useState(false);

  // 期間（初期値：今月を終了月とした直近12か月）
  const [preset, setPreset] = useState<Preset>("12");
  const [startMonth, setStartMonth] = useState(() => addMonths(currentYm(), -11));
  const [endMonth, setEndMonth] = useState(() => currentYm());

  const isIncome = tab === "income";
  const label = isIncome ? "収入" : "支出";
  const accent = isIncome ? "#34d399" : "#60a5fa";

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

  // 1000件ずつ .range() で繰り返し、全件読み込む（支出・収入の両方）
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
        .in("direction", [DIRECTION_EXPENSE, DIRECTION_INCOME])
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

  // 推移グラフ用の分類キー（大分類 or 「大分類 › 中分類」）
  const getCategoryKey = (r: Row, level: CategoryLevel) => {
    if (level === "major") return getCategoryName(r);
    const category = Array.isArray(r.categories)
      ? r.categories[0]
      : r.categories;
    return `${getCategoryName(r)} › ${category?.minor_category || "(中分類なし)"}`;
  };

  // タブに応じた行だけを使う
  const tabRows = useMemo(
    () =>
      rows.filter(
        (r) => r.direction === (isIncome ? DIRECTION_INCOME : DIRECTION_EXPENSE)
      ),
    [rows, isIncome]
  );

  const changeTab = (next: Tab) => {
    setTab(next);
    setSelectedCategory("");
  };

  const changeCategoryLevel = (next: CategoryLevel) => {
    setCategoryLevel(next);
    setSelectedCategory("");
  };

  // ---- 期間の操作 ----
  const applyPreset = (value: Preset) => {
    setPreset(value);
    const cur = currentYm();

    if (value === "custom") return;

    if (value === "all") {
      // rows は日付順。支出・収入どちらかの最古の月から表示
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
      tabRows.filter((r) => {
        const m = r.txn_date.slice(0, 7);
        return m >= rangeStart && m <= rangeEnd;
      }),
    [tabRows, rangeStart, rangeEnd]
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

  // 月ごとの合計（折れ線用）
  const totalData = useMemo(() => {
    const map = new Map<string, number>();
    monthList.forEach((month) => map.set(month, 0));
    rangeRows.forEach((r) => {
      const month = r.txn_date.slice(0, 7);
      map.set(month, (map.get(month) || 0) + Number(r.amount || 0));
    });
    return Array.from(map.entries()).map(([month, amount]) => ({
      month,
      amount,
    }));
  }, [rangeRows, monthList]);

  const grandTotal = useMemo(
    () => totalData.reduce((sum, row) => sum + row.amount, 0),
    [totalData]
  );

  // 月ごとの収入・支出・差額（タブに関係なく両方を集計）
  const balanceData = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>();
    monthList.forEach((month) => map.set(month, { income: 0, expense: 0 }));

    rows.forEach((r) => {
      const entry = map.get(r.txn_date.slice(0, 7));
      if (!entry) return;
      const amount = Number(r.amount || 0);
      if (r.direction === DIRECTION_INCOME) entry.income += amount;
      else if (r.direction === DIRECTION_EXPENSE) entry.expense += amount;
    });

    return Array.from(map.entries()).map(([month, v]) => ({
      month,
      income: v.income,
      expense: v.expense,
      diff: v.income - v.expense,
    }));
  }, [rows, monthList]);

  const incomeTotal = useMemo(
    () => balanceData.reduce((sum, d) => sum + d.income, 0),
    [balanceData]
  );
  const expenseTotal = useMemo(
    () => balanceData.reduce((sum, d) => sum + d.expense, 0),
    [balanceData]
  );
  const diffTotal = incomeTotal - expenseTotal;

  // 費目プルダウンの候補は、期間にかかわらずタブ内の全データの費目から作る
  const allCategoryNames = useMemo(() => {
    const set = new Set<string>();
    tabRows.forEach((r) => set.add(getCategoryKey(r, categoryLevel)));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ja"));
  }, [tabRows, categoryLevel]);

  const selectedCategoryData = useMemo(() => {
    if (!selectedCategory) return [];

    const map = new Map<string, number>();
    monthList.forEach((month) => map.set(month, 0));

    rangeRows.forEach((r) => {
      if (getCategoryKey(r, categoryLevel) !== selectedCategory) return;
      const month = r.txn_date.slice(0, 7);
      map.set(month, (map.get(month) || 0) + Number(r.amount || 0));
    });

    return Array.from(map.entries()).map(([month, amount]) => ({
      month,
      amount,
    }));
  }, [rangeRows, monthList, selectedCategory, categoryLevel]);

  const selectedCategoryTotal = useMemo(() => {
    return selectedCategoryData.reduce((sum, row) => sum + row.amount, 0);
  }, [selectedCategoryData]);

  if (authLoading) {
    return <div style={{ minHeight: "100vh", background: "#111827", color: "#f9fafb", display: "flex", alignItems: "center", justifyContent: "center" }}>読込中...</div>;
  }

  if (!user) {
    return <div style={{ minHeight: "100vh", background: "#111827", color: "#f9fafb", display: "flex", alignItems: "center", justifyContent: "center" }}>ログインしてください</div>;
  }

  if (showSearchGraph) {
    return <GraphSearchPanel onBack={() => setShowSearchGraph(false)} />;
  }

  const chartWidth = Math.max(chartData.length * 80, 600);

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
        月別{label}グラフ
      </h1>
      <button
        type="button"
        onClick={() => setShowSearchGraph(true)}
        style={{ padding: "10px 12px", marginTop: "8px", borderRadius: "8px", border: "1px solid #a78bfa", background: "#312e81", color: "#f9fafb", fontWeight: "bold", width: "100%" }}
      >
        🔎 検索グラフ（条件を指定して比較）
      </button>

      {/* 支出 / 収入 タブ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", margin: "12px 0" }}>
        <TabButton active={tab === "expense"} color="#60a5fa" onClick={() => changeTab("expense")}>
          支出
        </TabButton>
        <TabButton active={tab === "income"} color="#34d399" onClick={() => changeTab("income")}>
          収入
        </TabButton>
      </div>

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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
            <TabButton active={categoryLevel === "major"} color="#a78bfa" onClick={() => changeCategoryLevel("major")}>
              大分類
            </TabButton>
            <TabButton active={categoryLevel === "minor"} color="#a78bfa" onClick={() => changeCategoryLevel("minor")}>
              中分類
            </TabButton>
          </div>
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

      {/* 表示期間の合計（収入・支出・差額） */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "8px",
          marginBottom: "16px",
        }}
      >
        <SummaryBox label="収入合計" value={incomeTotal} color="#34d399" />
        <SummaryBox label="支出合計" value={expenseTotal} color="#60a5fa" />
        <SummaryBox
          label="差額合計（収入−支出）"
          value={diffTotal}
          color={diffTotal >= 0 ? "#34d399" : "#f87171"}
          signed
        />
      </div>

      {/* 合計の推移 */}
      <SectionTitle title={`${label}の月別合計`} />

      <div
        style={{
          marginBottom: "8px",
          color: "#d1d5db",
          fontSize: "14px",
        }}
      >
        表示期間合計: {grandTotal.toLocaleString()}円
      </div>

      <div style={scrollWrapStyle}>
        <LineChart
          width={chartWidth}
          height={320}
          data={totalData}
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
            formatter={(value) => [`${Number(value).toLocaleString()}円`, `${label}合計`]}
          />
          <Line
            type="monotone"
            dataKey="amount"
            name={`${label}合計`}
            stroke={accent}
            strokeWidth={3}
            dot={{ r: 5 }}
          />
        </LineChart>
      </div>

      {/* 収入 − 支出 の差額 */}
      <SectionTitle title="収入 − 支出 の月別差額" />

      <div
        style={{
          marginBottom: "8px",
          color: diffTotal >= 0 ? "#34d399" : "#f87171",
          fontSize: "14px",
        }}
      >
        表示期間の差額合計: {formatSigned(diffTotal)}
      </div>

      <div style={scrollWrapStyle}>
        <BarChart
          width={chartWidth}
          height={320}
          data={balanceData}
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
              Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(0)}万` : String(v)
            }
          />
          <Tooltip
            contentStyle={{ background: "#1f2937", border: "1px solid #374151", color: "#f9fafb" }}
            formatter={(value) => [formatSigned(Number(value)), "差額"]}
          />
          <ReferenceLine y={0} stroke="#9ca3af" />
          <Bar dataKey="diff" name="差額">
            {balanceData.map((d) => (
              <Cell key={d.month} fill={d.diff >= 0 ? "#34d399" : "#f87171"} />
            ))}
          </Bar>
        </BarChart>
      </div>

      {/* 費目別の積み上げ */}
      <SectionTitle title={`全体：費目別の月別${label}`} />

      <div style={scrollWrapStyle}>
        <div style={{ width: chartWidth, height: 420 }}>
          <BarChart
            width={chartWidth}
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
                stackId="total"
                fill={COLORS[index % COLORS.length]}
              />
            ))}
          </BarChart>
        </div>
      </div>

      {/* 選択した費目の推移 */}
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
                  stroke={accent}
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

const formatSigned = (n: number) =>
  `${n > 0 ? "+" : ""}${n.toLocaleString()}円`;

function SummaryBox({
  label,
  value,
  color,
  signed = false,
}: {
  label: string;
  value: number;
  color: string;
  signed?: boolean;
}) {
  return (
    <div
      style={{
        background: "#1f2937",
        border: "1px solid #374151",
        borderRadius: "12px",
        padding: "10px",
      }}
    >
      <div style={{ fontSize: "12px", color: "#d1d5db", marginBottom: "4px" }}>
        {label}
      </div>
      <div style={{ fontSize: "16px", fontWeight: "bold", color }}>
        {signed ? formatSigned(value) : `${value.toLocaleString()}円`}
      </div>
    </div>
  );
}

function TabButton({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "10px",
        borderRadius: "8px",
        border: `1px solid ${active ? color : "#374151"}`,
        background: active ? color : "#1f2937",
        color: active ? "#111827" : "#f9fafb",
        fontWeight: "bold",
        fontSize: "15px",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
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
      <Nav href="/fixed-costs" label="📌" />
      <Nav href="/summary" label="📊" />
      <Nav href="/graph" label="📈" />
      <Nav href="/calendar" label="📅" />
      <Nav href="/dashboard" label="🧭" />
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

// ===== 検索グラフ機能（graph-search_page.tsx から統合） =====
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient, User } from "@supabase/supabase-js";



type Wallet = { id: string; wallet_name: string };

type Category = {
  id: string;
  major_category: string;
  minor_category: string;
};

type Account = { id: string; account_name: string };

type Txn = {
  id: string;
  txn_date: string;
  amount: number;
  direction: string;
  wallet_id: string | null;
  category_id: string | null;
  payment_account_id: string | null;
  receive_account_id: string | null;
  merchant_name: string | null;
  description: string | null;
};

// 1本の系列（検索条件のセット）。項目ごとの条件はすべて満たす明細を集計する（AND）
type Condition = {
  id: string;
  major: string;
  minor: string;
  merchant: string;
  account: string;
  memo: string;
  free: string;
};

type SeriesResult = {
  id: string;
  label: string;
  color: string;
  monthly: number[];
  count: number;
  total: number;
  rows: Txn[];
};

const GS_COLORS = [
  "#60a5fa",
  "#f87171",
  "#34d399",
  "#fbbf24",
  "#a78bfa",
  "#f472b6",
];

const MAX_SERIES = 6;

// ===== 検索・集計の補助関数 =====
function normText(v: string | null | undefined) {
  return (v ?? "").normalize("NFKC").toLowerCase();
}

// スペース区切りの語に分ける（すべてを含むものに一致＝AND）
function splitWords(v: string) {
  return normText(v).split(/\s+/).filter(Boolean);
}

function hasAllWords(target: string | null | undefined, query: string) {
  const words = splitWords(query);

  if (words.length === 0) return true;

  const t = normText(target);

  return words.every((w) => t.includes(w));
}

function addMonthsYm(ym: string, delta: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthsBetween(start: string, end: string) {
  const list: string[] = [];

  for (let m = start; m <= end; m = addMonthsYm(m, 1)) {
    list.push(m);

    if (list.length > 120) break;
  }

  return list;
}

function thisMonth() {
  const d = new Date();

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function yen(n: number) {
  return `${Math.round(n).toLocaleString()}円`;
}

function axisLabel(v: number) {
  if (v >= 10000) return `${Math.round(v / 1000) / 10}万`;

  return String(v);
}

function directionLabel(d: string) {
  if (d === "income") return "収入";
  if (d === "transfer") return "資金移動";

  return "支出";
}

function conditionLabel(c: Condition) {
  const parts = [
    c.major && c.minor ? `${c.major}/${c.minor}` : c.major || c.minor,
    c.merchant && `支払先:${c.merchant}`,
    c.account && `支払元:${c.account}`,
    c.memo && `メモ:${c.memo}`,
    c.free && `「${c.free}」`,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" ") : "条件なし（全体）";
}

function matchesCondition(
  t: Txn,
  c: Condition,
  catMap: Map<string, Category>,
  accMap: Map<string, string>
) {
  const cat = t.category_id ? catMap.get(t.category_id) : undefined;

  if (c.major && cat?.major_category !== c.major) return false;
  if (c.minor && cat?.minor_category !== c.minor) return false;

  // 支払元：支出は支払元、収入は入金先の名前で検索する
  const accountId =
    t.direction === "income" ? t.receive_account_id : t.payment_account_id;
  const accountName = accountId ? accMap.get(accountId) ?? "" : "";

  if (!hasAllWords(t.merchant_name, c.merchant)) return false;
  if (!hasAllWords(accountName, c.account)) return false;
  if (!hasAllWords(t.description, c.memo)) return false;

  // フリーワード：支払先・支払元・メモ・費目名のどこかに含まれていればよい
  if (c.free.trim()) {
    const haystack = normText(
      [
        t.merchant_name,
        accountName,
        t.description,
        cat?.major_category,
        cat?.minor_category,
      ].join(" ")
    );

    if (!splitWords(c.free).every((w) => haystack.includes(w))) return false;
  }

  return true;
}

function buildSeries(
  txns: Txn[],
  conditions: Condition[],
  months: string[],
  direction: string,
  walletId: string,
  catMap: Map<string, Category>,
  accMap: Map<string, string>
): SeriesResult[] {
  const indexOf = new Map(months.map((m, i) => [m, i]));

  const base = txns.filter(
    (t) =>
      t.direction === direction && (!walletId || t.wallet_id === walletId)
  );

  return conditions.map((c, i) => {
    const monthly = months.map(() => 0);
    const rows: Txn[] = [];
    let total = 0;

    base.forEach((t) => {
      const idx = indexOf.get(t.txn_date.slice(0, 7));

      if (idx === undefined) return;
      if (!matchesCondition(t, c, catMap, accMap)) return;

      const amount = Number(t.amount || 0);

      monthly[idx] += amount;
      total += amount;
      rows.push(t);
    });

    return {
      id: c.id,
      label: conditionLabel(c),
      color: GS_COLORS[i % GS_COLORS.length],
      monthly,
      count: rows.length,
      total,
      rows,
    };
  });
}

function niceStep(max: number) {
  if (max <= 0) return 1;

  const raw = max / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const candidates = [1, 2, 5, 10].map((x) => x * mag);

  return candidates.find((c) => c >= raw) ?? mag * 10;
}

// ===== 画面 =====
function GraphSearchPanel({ onBack }: { onBack: () => void }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [endMonth, setEndMonth] = useState(thisMonth());
  const [startMonth, setStartMonth] = useState(addMonthsYm(thisMonth(), -11));
  const [direction, setDirection] = useState("expense");
  const [walletId, setWalletId] = useState("");
  const [chartType, setChartType] = useState<"bar" | "line">("bar");

  const newCondition = (): Condition => ({
    id: Math.random().toString(36).slice(2),
    major: "",
    minor: "",
    merchant: "",
    account: "",
    memo: "",
    free: "",
  });

  const [conditions, setConditions] = useState<Condition[]>(() => [
    newCondition(),
  ]);

  const [detailId, setDetailId] = useState("");

  useEffect(() => {
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      setUser(session?.user ?? null);
      setAuthLoading(false);

      if (!session?.user) window.location.href = "/";
    };

    void init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // マスタ（財布・費目・支払元）
  useEffect(() => {
    if (!user) return;

    const loadMasters = async () => {
      const [w, c, a] = await Promise.all([
        supabase
          .from("wallets")
          .select("id, wallet_name")
          .order("display_order", { ascending: true }),
        supabase
          .from("categories")
          .select("id, major_category, minor_category")
          .order("display_order", { ascending: true }),
        supabase.from("accounts").select("id, account_name"),
      ]);

      if (w.error || c.error || a.error) {
        setMessage(
          "マスタの読込エラー: " +
            (w.error?.message || c.error?.message || a.error?.message)
        );
        return;
      }

      setWallets((w.data as Wallet[]) || []);
      setCategories((c.data as Category[]) || []);
      setAccounts((a.data as Account[]) || []);
    };

    void loadMasters();
  }, [user]);

  // 明細（期間内の全件。1000件ずつ読む）
  useEffect(() => {
    if (!user) return;

    const loadTxns = async () => {
      if (startMonth > endMonth) {
        setMessage("開始月は終了月以前にしてください");
        setTxns([]);
        return;
      }

      if (addMonthsYm(startMonth, 60) <= endMonth) {
        setMessage("期間は最大60か月までです");
        setTxns([]);
        return;
      }

      setLoading(true);
      setMessage("");

      const from = `${startMonth}-01`;
      const to = `${addMonthsYm(endMonth, 1)}-01`;
      const all: Txn[] = [];

      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase
          .from("transaction_records")
          .select(
            "id, txn_date, amount, direction, wallet_id, category_id, payment_account_id, receive_account_id, merchant_name, description"
          )
          .eq("user_id", user.id)
          .gte("txn_date", from)
          .lt("txn_date", to)
          .order("txn_date", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + 999);

        if (error) {
          setMessage("読込エラー: " + error.message);
          setTxns([]);
          setLoading(false);
          return;
        }

        const rows = (data as Txn[]) || [];
        all.push(...rows);

        if (rows.length < 1000) break;
      }

      setTxns(all);
      setLoading(false);
    };

    void loadTxns();
  }, [user, startMonth, endMonth]);

  const catMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );

  const accMap = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.account_name])),
    [accounts]
  );

  const majors = useMemo(
    () => Array.from(new Set(categories.map((c) => c.major_category))),
    [categories]
  );

  const months = useMemo(
    () => monthsBetween(startMonth, endMonth),
    [startMonth, endMonth]
  );

  const series = useMemo(
    () =>
      buildSeries(
        txns,
        conditions,
        months,
        direction,
        walletId,
        catMap,
        accMap
      ),
    [txns, conditions, months, direction, walletId, catMap, accMap]
  );

  const detail = series.find((s) => s.id === detailId) ?? series[0];

  const updateCondition = (id: string, patch: Partial<Condition>) => {
    setConditions((list) =>
      list.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
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
        maxWidth: "820px",
        margin: "0 auto",
        padding: "16px",
        paddingBottom: "88px",
        background: "#111827",
        minHeight: "100vh",
        color: "#f9fafb",
      }}
    >
      <h1 style={{ fontSize: "24px", fontWeight: "bold" }}>検索グラフ</h1>
      <button type="button" onClick={onBack} style={buttonStyle}>通常のグラフに戻る</button>
      <p style={{ fontSize: "13px", color: "#9ca3af", marginTop: "4px" }}>
        大分類・中分類・支払先・支払元・メモで絞り込んで、月別の合計をグラフにします。
        複数の検索を並べて比較できます。
      </p>

      {/* 共通の設定 */}
      <section style={cardStyle}>
        <div style={gridStyle}>
          <div>
            <div style={labelStyle}>開始月</div>
            <input
              type="month"
              value={startMonth}
              onChange={(e) => setStartMonth(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div>
            <div style={labelStyle}>終了月</div>
            <input
              type="month"
              value={endMonth}
              onChange={(e) => setEndMonth(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div>
            <div style={labelStyle}>区分</div>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              style={inputStyle}
            >
              <option value="expense">支出</option>
              <option value="income">収入</option>
              <option value="transfer">資金移動</option>
            </select>
          </div>

          <div>
            <div style={labelStyle}>財布</div>
            <select
              value={walletId}
              onChange={(e) => setWalletId(e.target.value)}
              style={inputStyle}
            >
              <option value="">すべて</option>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.wallet_name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* 検索条件 */}
      {conditions.map((c, i) => {
        const minors = categories
          .filter((x) => x.major_category === c.major)
          .map((x) => x.minor_category);

        return (
          <section
            key={c.id}
            style={{ ...cardStyle, borderLeft: `4px solid ${GS_COLORS[i % GS_COLORS.length]}` }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "8px",
              }}
            >
              <div style={{ fontWeight: "bold" }}>
                検索 {i + 1}：{conditionLabel(c)}
              </div>

              {conditions.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setConditions((list) => list.filter((x) => x.id !== c.id))
                  }
                  style={smallButtonStyle}
                >
                  削除
                </button>
              )}
            </div>

            <div style={gridStyle}>
              <div>
                <div style={labelStyle}>大分類</div>
                <select
                  value={c.major}
                  onChange={(e) =>
                    updateCondition(c.id, { major: e.target.value, minor: "" })
                  }
                  style={inputStyle}
                >
                  <option value="">指定なし</option>
                  {majors.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div style={labelStyle}>中分類</div>
                <select
                  value={c.minor}
                  onChange={(e) =>
                    updateCondition(c.id, { minor: e.target.value })
                  }
                  disabled={!c.major}
                  style={inputStyle}
                >
                  <option value="">指定なし</option>
                  {minors.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div style={labelStyle}>支払先（部分一致）</div>
                <input
                  value={c.merchant}
                  onChange={(e) =>
                    updateCondition(c.id, { merchant: e.target.value })
                  }
                  placeholder="例: ガスト"
                  style={inputStyle}
                />
              </div>

              <div>
                <div style={labelStyle}>支払元（部分一致）</div>
                <input
                  value={c.account}
                  onChange={(e) =>
                    updateCondition(c.id, { account: e.target.value })
                  }
                  placeholder="例: 楽天カード"
                  style={inputStyle}
                />
              </div>

              <div>
                <div style={labelStyle}>メモ（部分一致）</div>
                <input
                  value={c.memo}
                  onChange={(e) =>
                    updateCondition(c.id, { memo: e.target.value })
                  }
                  placeholder="例: 学童"
                  style={inputStyle}
                />
              </div>

              <div>
                <div style={labelStyle}>フリーワード</div>
                <input
                  value={c.free}
                  onChange={(e) =>
                    updateCondition(c.id, { free: e.target.value })
                  }
                  placeholder="支払先・支払元・メモ・費目のどこでも"
                  style={inputStyle}
                />
              </div>
            </div>
          </section>
        );
      })}

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {conditions.length < MAX_SERIES && (
          <button
            type="button"
            onClick={() => setConditions((list) => [...list, newCondition()])}
            style={buttonStyle}
          >
            ＋ 検索を追加して比較
          </button>
        )}

        <button
          type="button"
          onClick={() => setChartType(chartType === "bar" ? "line" : "bar")}
          style={buttonStyle}
        >
          {chartType === "bar" ? "折れ線グラフにする" : "棒グラフにする"}
        </button>
      </div>

      <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "8px" }}>
        スペースで区切ると、すべての語を含む明細に絞ります。大文字・小文字と全角・半角の違いは区別しません。
        入力した条件はすべて満たす明細を集計します（AND）。
      </div>

      {message && <div style={{ marginTop: "12px" }}>{message}</div>}

      {/* グラフ */}
      <section style={cardStyle}>
        <div style={{ fontWeight: "bold", marginBottom: "8px" }}>
          月別の{directionLabel(direction)}
        </div>

        {loading ? (
          <div>読み込み中...</div>
        ) : (
          <>
            <Chart months={months} series={series} type={chartType} />

            <div
              style={{
                display: "flex",
                gap: "12px",
                flexWrap: "wrap",
                marginTop: "8px",
                fontSize: "12px",
              }}
            >
              {series.map((s) => (
                <span key={s.id}>
                  <span style={{ color: s.color }}>■</span> {s.label}
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      {/* 集計 */}
      <section style={cardStyle}>
        <div style={{ fontWeight: "bold", marginBottom: "8px" }}>集計</div>

        <div style={{ display: "grid", gap: "8px" }}>
          {series.map((s) => {
            const max = Math.max(...s.monthly, 0);
            const maxMonth = months[s.monthly.indexOf(max)] ?? "-";

            return (
              <div
                key={s.id}
                style={{
                  border: "1px solid #374151",
                  borderRadius: "8px",
                  padding: "10px",
                }}
              >
                <div style={{ fontWeight: "bold" }}>
                  <span style={{ color: s.color }}>■</span> {s.label}
                </div>
                <div style={{ fontSize: "14px", marginTop: "4px" }}>
                  合計 {yen(s.total)} / {s.count}件 / 月平均{" "}
                  {yen(months.length > 0 ? s.total / months.length : 0)} / 最大{" "}
                  {max > 0 ? `${maxMonth} ${yen(max)}` : "-"}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ overflowX: "auto", marginTop: "12px" }}>
          <table style={{ minWidth: "100%", fontSize: "13px", textAlign: "right" }}>
            <thead>
              <tr style={{ color: "#9ca3af" }}>
                <th style={{ textAlign: "left", padding: "4px 8px" }}>月</th>
                {series.map((s) => (
                  <th key={s.id} style={{ padding: "4px 8px", color: s.color }}>
                    検索{series.indexOf(s) + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.map((m, mi) => (
                <tr key={m} style={{ borderTop: "1px solid #374151" }}>
                  <td style={{ textAlign: "left", padding: "4px 8px" }}>{m}</td>
                  {series.map((s) => (
                    <td key={s.id} style={{ padding: "4px 8px" }}>
                      {s.monthly[mi] > 0 ? yen(s.monthly[mi]) : "-"}
                    </td>
                  ))}
                </tr>
              ))}
              <tr style={{ borderTop: "2px solid #374151", fontWeight: "bold" }}>
                <td style={{ textAlign: "left", padding: "4px 8px" }}>合計</td>
                {series.map((s) => (
                  <td key={s.id} style={{ padding: "4px 8px" }}>
                    {yen(s.total)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 明細 */}
      <section style={cardStyle}>
        <div style={{ fontWeight: "bold", marginBottom: "8px" }}>
          該当する明細（新しい順・最大200件）
        </div>

        <select
          value={detail?.id ?? ""}
          onChange={(e) => setDetailId(e.target.value)}
          style={inputStyle}
        >
          {series.map((s, i) => (
            <option key={s.id} value={s.id}>
              検索{i + 1}：{s.label}（{s.count}件）
            </option>
          ))}
        </select>

        <div style={{ display: "grid", gap: "6px", marginTop: "10px" }}>
          {detail && detail.rows.length === 0 && <div>該当する明細はありません。</div>}

          {detail &&
            [...detail.rows]
              .sort((a, b) => (a.txn_date < b.txn_date ? 1 : -1))
              .slice(0, 200)
              .map((t) => {
                const cat = t.category_id ? catMap.get(t.category_id) : undefined;
                const accId =
                  t.direction === "income"
                    ? t.receive_account_id
                    : t.payment_account_id;

                return (
                  <div
                    key={t.id}
                    style={{
                      border: "1px solid #374151",
                      borderRadius: "8px",
                      padding: "8px 10px",
                      fontSize: "13px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>{t.txn_date}</span>
                      <b>{yen(Number(t.amount))}</b>
                    </div>
                    <div style={{ color: "#d1d5db" }}>
                      {cat ? `${cat.major_category} / ${cat.minor_category}` : "（費目なし）"}
                      {t.merchant_name ? ` ・ ${t.merchant_name}` : ""}
                      {accId && accMap.get(accId) ? ` ・ ${accMap.get(accId)}` : ""}
                    </div>
                    {t.description && (
                      <div style={{ color: "#9ca3af" }}>{t.description}</div>
                    )}
                  </div>
                );
              })}
        </div>
      </section>

    </div>
  );
}

// ===== グラフ（SVG。外部ライブラリなし） =====
function Chart({
  months,
  series,
  type,
}: {
  months: string[];
  series: SeriesResult[];
  type: "bar" | "line";
}) {
  const left = 52;
  const right = 12;
  const top = 12;
  const bottom = 40;
  const height = 300;
  const groupW = Math.max(26, series.length * 10 + 14);
  const width = Math.max(640, months.length * groupW + left + right);
  const innerW = width - left - right;
  const innerH = height - top - bottom;

  const maxValue = Math.max(1, ...series.flatMap((s) => s.monthly));
  const step = niceStep(maxValue);
  const yMax = step * 5;
  const ticks = [0, 1, 2, 3, 4, 5].map((i) => i * step);

  const gw = innerW / Math.max(1, months.length);
  const x = (i: number) => left + gw * i + gw / 2;
  const y = (v: number) => top + innerH - (v / yMax) * innerH;
  const labelEvery = Math.max(1, Math.ceil(months.length / 14));

  const barW = Math.min(22, (gw * 0.8) / Math.max(1, series.length));

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        style={{ maxWidth: "none" }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={left}
              x2={width - right}
              y1={y(t)}
              y2={y(t)}
              stroke="#374151"
              strokeWidth={1}
            />
            <text x={left - 6} y={y(t) + 4} fontSize={11} textAnchor="end" fill="#9ca3af">
              {axisLabel(t)}
            </text>
          </g>
        ))}

        {months.map((m, i) =>
          i % labelEvery === 0 ? (
            <text
              key={m}
              x={x(i)}
              y={height - 18}
              fontSize={11}
              textAnchor="middle"
              fill="#9ca3af"
            >
              {m.slice(2).replace("-", "/")}
            </text>
          ) : null
        )}

        {type === "bar" &&
          series.map((s, si) =>
            s.monthly.map((v, i) => {
              if (v <= 0) return null;

              const bx = x(i) - (barW * series.length) / 2 + si * barW;

              return (
                <rect
                  key={`${s.id}-${i}`}
                  x={bx}
                  y={y(v)}
                  width={Math.max(2, barW - 1)}
                  height={top + innerH - y(v)}
                  fill={s.color}
                  rx={2}
                >
                  <title>{`${months[i]} ${s.label}: ${yen(v)}`}</title>
                </rect>
              );
            })
          )}

        {type === "line" &&
          series.map((s) => (
            <g key={s.id}>
              <polyline
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                points={s.monthly.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
              />
              {s.monthly.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r={3} fill={s.color}>
                  <title>{`${months[i]} ${s.label}: ${yen(v)}`}</title>
                </circle>
              ))}
            </g>
          ))}
      </svg>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  border: "1px solid #374151",
  borderRadius: "10px",
  padding: "12px",
  background: "#1f2937",
  marginTop: "12px",
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gap: "10px",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
};

const labelStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "#d1d5db",
  marginBottom: "4px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px",
  background: "#111827",
  color: "#f9fafb",
  border: "1px solid #374151",
  borderRadius: "8px",
};

const buttonStyle: React.CSSProperties = {
  padding: "8px 12px",
  background: "#e5e7eb",
  color: "#111827",
  border: "none",
  borderRadius: "8px",
  marginTop: "12px",
};

const smallButtonStyle: React.CSSProperties = {
  padding: "4px 10px",
  background: "#374151",
  color: "#f9fafb",
  border: "none",
  borderRadius: "6px",
  fontSize: "12px",
};

