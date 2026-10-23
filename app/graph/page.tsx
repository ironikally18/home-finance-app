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
  id: string;
  txn_date: string;
  amount: number;
  direction: string;
  merchant_name: string | null;
  description: string | null;
  payment_account_id: string | null;
  receive_account_id: string | null;
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
const DIRECTION_TRANSFER = "transfer";

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

  // 1000件ずつ .range() で繰り返し、全件読み込む（支出・収入・資金移動）
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
          id,
          txn_date,
          amount,
          direction,
          merchant_name,
          description,
          payment_account_id,
          receive_account_id,
          categories:category_id (
            major_category,
            minor_category
          )
        `)
        .eq("user_id", session.user.id)
        // 検索の「資金移動」用に、transfer も読み込む（既存のグラフは支出・収入だけを集計する）
        .in("direction", [DIRECTION_EXPENSE, DIRECTION_INCOME, DIRECTION_TRANSFER])
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

      {/* 条件を指定して検索・集計 */}
      <SearchSection rows={rows} monthList={monthList} chartWidth={chartWidth} />

      <BottomNav />
    </div>
  );
}

// ===================== 条件を指定して検索・集計 =====================
type Category = { id: string; major_category: string; minor_category: string };
type Account = { id: string; account_name: string };

// 1本の検索条件。入力した項目はすべて満たす明細を集計する（AND）
type SearchCondition = {
  id: string;
  major: string;
  minor: string;
  merchant: string;
  account: string;
  memo: string;
  free: string;
};

type SearchSeries = {
  id: string;
  label: string;
  color: string;
  monthly: number[];
  count: number;
  total: number;
  rows: Row[];
};

const MAX_SERIES = 6;

const newSearchCondition = (): SearchCondition => ({
  id: Math.random().toString(36).slice(2),
  major: "",
  minor: "",
  merchant: "",
  account: "",
  memo: "",
  free: "",
});

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

function rowCategory(r: Row) {
  const c = Array.isArray(r.categories) ? r.categories[0] : r.categories;

  return { major: c?.major_category ?? "", minor: c?.minor_category ?? "" };
}

function conditionLabel(c: SearchCondition) {
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
  r: Row,
  c: SearchCondition,
  accMap: Map<string, string>
) {
  const { major, minor } = rowCategory(r);

  if (c.major && major !== c.major) return false;
  if (c.minor && minor !== c.minor) return false;

  // 支払元：支出は支払元、収入は入金先の名前で検索する
  const accountId =
    r.direction === DIRECTION_INCOME
      ? r.receive_account_id
      : r.payment_account_id;
  const accountName = accountId ? accMap.get(accountId) ?? "" : "";

  if (!hasAllWords(r.merchant_name, c.merchant)) return false;
  if (!hasAllWords(accountName, c.account)) return false;
  if (!hasAllWords(r.description, c.memo)) return false;

  // フリーワード：支払先・支払元・メモ・費目名のどこかに含まれていればよい
  if (c.free.trim()) {
    const haystack = normText(
      [r.merchant_name, accountName, r.description, major, minor].join(" ")
    );

    if (!splitWords(c.free).every((w) => haystack.includes(w))) return false;
  }

  return true;
}

function SearchSection({
  rows,
  monthList,
  chartWidth,
}: {
  rows: Row[];
  monthList: string[];
  chartWidth: number;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [direction, setDirection] = useState<string>(DIRECTION_EXPENSE);
  const [chartType, setChartType] = useState<"bar" | "line">("bar");
  const [conditions, setConditions] = useState<SearchCondition[]>(() => [
    newSearchCondition(),
  ]);
  const [detailId, setDetailId] = useState("");
  const [msg, setMsg] = useState("");

  // 費目・支払元のマスタ（選択肢と、支払元の名前の照合に使う）
  useEffect(() => {
    const loadMasters = async () => {
      const [c, a] = await Promise.all([
        supabase
          .from("categories")
          .select("id, major_category, minor_category")
          .order("display_order", { ascending: true }),
        supabase.from("accounts").select("id, account_name"),
      ]);

      if (c.error || a.error) {
        setMsg("マスタの読込エラー: " + (c.error?.message || a.error?.message));
        return;
      }

      setCategories((c.data as Category[]) || []);
      setAccounts((a.data as Account[]) || []);
    };

    void loadMasters();
  }, []);

  const accMap = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.account_name])),
    [accounts]
  );

  const majors = useMemo(
    () => Array.from(new Set(categories.map((c) => c.major_category))),
    [categories]
  );

  const series = useMemo<SearchSeries[]>(() => {
    const indexOf = new Map(monthList.map((m, i) => [m, i]));
    const base = rows.filter((r) => r.direction === direction);

    return conditions.map((c, i) => {
      const monthly = monthList.map(() => 0);
      const matched: Row[] = [];
      let total = 0;

      base.forEach((r) => {
        const idx = indexOf.get(r.txn_date.slice(0, 7));

        if (idx === undefined) return;
        if (!matchesCondition(r, c, accMap)) return;

        const amount = Number(r.amount || 0);

        monthly[idx] += amount;
        total += amount;
        matched.push(r);
      });

      return {
        id: c.id,
        label: conditionLabel(c),
        color: COLORS[i % COLORS.length],
        monthly,
        count: matched.length,
        total,
        rows: matched,
      };
    });
  }, [rows, monthList, direction, conditions, accMap]);

  const chartData = useMemo(
    () =>
      monthList.map((month, mi) => {
        const item: Record<string, number | string> = { month };
        series.forEach((s, i) => {
          item[`s${i}`] = s.monthly[mi];
        });
        return item;
      }),
    [monthList, series]
  );

  const detail = series.find((s) => s.id === detailId) ?? series[0];
  const dirLabel =
    direction === DIRECTION_INCOME
      ? "収入"
      : direction === DIRECTION_TRANSFER
        ? "資金移動"
        : "支出";

  const updateCondition = (id: string, patch: Partial<SearchCondition>) => {
    setConditions((list) =>
      list.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
  };

  const axisFormatter = (v: number) =>
    v >= 10000 ? `${(v / 10000).toFixed(0)}万` : String(v);

  const tooltipStyle = {
    background: "#1f2937",
    border: "1px solid #374151",
    color: "#f9fafb",
  };

  return (
    <div>
      <SectionTitle title="条件を指定して検索・集計" />

      <div style={{ fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
        大分類・中分類・支払先・支払元・メモで絞り込んで、月別の合計をグラフにします。
        期間は上の「表示期間」に従います。複数の検索を並べて比較できます。
        入力した条件はすべて満たす明細を集計します（AND）。スペースで区切ると、すべての語を含む明細に絞ります。
        大文字・小文字と全角・半角は区別しません。
      </div>

      <div style={searchCardStyle}>
        <div style={{ marginBottom: "4px" }}>区分</div>
        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          style={selectStyle}
        >
          <option value={DIRECTION_EXPENSE}>支出</option>
          <option value={DIRECTION_INCOME}>収入</option>
          <option value={DIRECTION_TRANSFER}>資金移動</option>
        </select>
      </div>

      {conditions.map((c, i) => {
        const minors = categories
          .filter((x) => x.major_category === c.major)
          .map((x) => x.minor_category);

        return (
          <div
            key={c.id}
            style={{
              ...searchCardStyle,
              borderLeft: `4px solid ${COLORS[i % COLORS.length]}`,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "8px",
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

            <div
              style={{
                display: "grid",
                gap: "10px",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              }}
            >
              <div>
                <div style={fieldLabelStyle}>大分類</div>
                <select
                  value={c.major}
                  onChange={(e) =>
                    updateCondition(c.id, { major: e.target.value, minor: "" })
                  }
                  style={selectStyle}
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
                <div style={fieldLabelStyle}>中分類</div>
                <select
                  value={c.minor}
                  onChange={(e) =>
                    updateCondition(c.id, { minor: e.target.value })
                  }
                  disabled={!c.major}
                  style={selectStyle}
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
                <div style={fieldLabelStyle}>支払先（部分一致）</div>
                <input
                  value={c.merchant}
                  onChange={(e) =>
                    updateCondition(c.id, { merchant: e.target.value })
                  }
                  placeholder="例: ガスト"
                  style={selectStyle}
                />
              </div>

              <div>
                <div style={fieldLabelStyle}>支払元（部分一致）</div>
                <input
                  value={c.account}
                  onChange={(e) =>
                    updateCondition(c.id, { account: e.target.value })
                  }
                  placeholder="例: 楽天カード"
                  style={selectStyle}
                />
              </div>

              <div>
                <div style={fieldLabelStyle}>メモ（部分一致）</div>
                <input
                  value={c.memo}
                  onChange={(e) =>
                    updateCondition(c.id, { memo: e.target.value })
                  }
                  placeholder="例: 学童"
                  style={selectStyle}
                />
              </div>

              <div>
                <div style={fieldLabelStyle}>フリーワード</div>
                <input
                  value={c.free}
                  onChange={(e) =>
                    updateCondition(c.id, { free: e.target.value })
                  }
                  placeholder="支払先・支払元・メモ・費目のどこでも"
                  style={selectStyle}
                />
              </div>
            </div>
          </div>
        );
      })}

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
        {conditions.length < MAX_SERIES && (
          <button
            type="button"
            onClick={() =>
              setConditions((list) => [...list, newSearchCondition()])
            }
            style={searchButtonStyle}
          >
            ＋ 検索を追加して比較
          </button>
        )}

        <button
          type="button"
          onClick={() => setChartType(chartType === "bar" ? "line" : "bar")}
          style={searchButtonStyle}
        >
          {chartType === "bar" ? "折れ線グラフにする" : "棒グラフにする"}
        </button>
      </div>

      {msg && <div style={{ marginBottom: "8px" }}>{msg}</div>}

      <SectionTitle title={`検索結果：月別の${dirLabel}`} />

      <div style={scrollWrapStyle}>
        {chartType === "bar" ? (
          <BarChart
            width={chartWidth}
            height={360}
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
              tickFormatter={axisFormatter}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value) => `${Number(value).toLocaleString()}円`}
            />
            <Legend
              wrapperStyle={{ paddingTop: "8px", color: "#f9fafb", fontSize: "13px" }}
            />
            {series.map((s, i) => (
              <Bar
                key={s.id}
                dataKey={`s${i}`}
                name={`検索${i + 1}：${s.label}`}
                fill={s.color}
              />
            ))}
          </BarChart>
        ) : (
          <LineChart
            width={chartWidth}
            height={360}
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
              tickFormatter={axisFormatter}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value) => `${Number(value).toLocaleString()}円`}
            />
            <Legend
              wrapperStyle={{ paddingTop: "8px", color: "#f9fafb", fontSize: "13px" }}
            />
            {series.map((s, i) => (
              <Line
                key={s.id}
                type="monotone"
                dataKey={`s${i}`}
                name={`検索${i + 1}：${s.label}`}
                stroke={s.color}
                strokeWidth={3}
                dot={{ r: 4 }}
              />
            ))}
          </LineChart>
        )}
      </div>

      <SectionTitle title="検索ごとの集計" />

      <div style={{ display: "grid", gap: "8px", marginBottom: "16px" }}>
        {series.map((s, i) => {
          const max = Math.max(...s.monthly, 0);
          const maxMonth = monthList[s.monthly.indexOf(max)] ?? "-";

          return (
            <div key={s.id} style={searchCardStyle}>
              <div style={{ fontWeight: "bold" }}>
                <span style={{ color: s.color }}>■</span> 検索{i + 1}：{s.label}
              </div>
              <div style={{ fontSize: "14px", marginTop: "4px", color: "#d1d5db" }}>
                合計 {s.total.toLocaleString()}円 / {s.count}件 / 月平均{" "}
                {Math.round(
                  monthList.length > 0 ? s.total / monthList.length : 0
                ).toLocaleString()}
                円 / 最大{" "}
                {max > 0 ? `${maxMonth} ${max.toLocaleString()}円` : "-"}
              </div>
            </div>
          );
        })}
      </div>

      <div style={scrollWrapStyle}>
        <table style={{ minWidth: "100%", fontSize: "13px", textAlign: "right" }}>
          <thead>
            <tr style={{ color: "#9ca3af" }}>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>月</th>
              {series.map((s, i) => (
                <th key={s.id} style={{ padding: "4px 8px", color: s.color }}>
                  検索{i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {monthList.map((m, mi) => (
              <tr key={m} style={{ borderTop: "1px solid #374151" }}>
                <td style={{ textAlign: "left", padding: "4px 8px" }}>{m}</td>
                {series.map((s) => (
                  <td key={s.id} style={{ padding: "4px 8px" }}>
                    {s.monthly[mi] > 0
                      ? `${s.monthly[mi].toLocaleString()}円`
                      : "-"}
                  </td>
                ))}
              </tr>
            ))}
            <tr style={{ borderTop: "2px solid #374151", fontWeight: "bold" }}>
              <td style={{ textAlign: "left", padding: "4px 8px" }}>合計</td>
              {series.map((s) => (
                <td key={s.id} style={{ padding: "4px 8px" }}>
                  {s.total.toLocaleString()}円
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <SectionTitle title="該当する明細（新しい順・最大200件）" />

      <select
        value={detail?.id ?? ""}
        onChange={(e) => setDetailId(e.target.value)}
        style={{ ...selectStyle, marginBottom: "8px" }}
      >
        {series.map((s, i) => (
          <option key={s.id} value={s.id}>
            検索{i + 1}：{s.label}（{s.count}件）
          </option>
        ))}
      </select>

      <div style={{ display: "grid", gap: "6px", marginBottom: "16px" }}>
        {detail && detail.rows.length === 0 && (
          <div>該当する明細はありません。</div>
        )}

        {detail &&
          [...detail.rows]
            .sort((a, b) => (a.txn_date < b.txn_date ? 1 : -1))
            .slice(0, 200)
            .map((r) => {
              const { major, minor } = rowCategory(r);
              const accId =
                r.direction === DIRECTION_INCOME
                  ? r.receive_account_id
                  : r.payment_account_id;
              const accName = accId ? accMap.get(accId) : "";

              return (
                <div
                  key={r.id}
                  style={{
                    border: "1px solid #374151",
                    borderRadius: "8px",
                    padding: "8px 10px",
                    fontSize: "13px",
                    background: "#1f2937",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{r.txn_date}</span>
                    <b>{Number(r.amount).toLocaleString()}円</b>
                  </div>
                  <div style={{ color: "#d1d5db" }}>
                    {major || minor ? `${major} / ${minor}` : "（費目なし）"}
                    {r.merchant_name ? ` ・ ${r.merchant_name}` : ""}
                    {accName ? ` ・ ${accName}` : ""}
                  </div>
                  {r.description && (
                    <div style={{ color: "#9ca3af" }}>{r.description}</div>
                  )}
                </div>
              );
            })}
      </div>
    </div>
  );
}

const searchCardStyle: React.CSSProperties = {
  border: "1px solid #374151",
  borderRadius: "12px",
  padding: "12px",
  background: "#1f2937",
  marginBottom: "12px",
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "#d1d5db",
  marginBottom: "4px",
};

const searchButtonStyle: React.CSSProperties = {
  padding: "10px 12px",
  background: "#e5e7eb",
  color: "#111827",
  border: "none",
  borderRadius: "8px",
  fontWeight: "bold",
};

const smallButtonStyle: React.CSSProperties = {
  padding: "4px 10px",
  background: "#374151",
  color: "#f9fafb",
  border: "none",
  borderRadius: "6px",
  fontSize: "12px",
};

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
