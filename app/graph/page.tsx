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
  wallet_id: string | null;
  categories:
    | { major_category: string; minor_category: string }
    | { major_category: string; minor_category: string }[]
    | null;
};

// レシート明細（receipt_items）。明細のあるレシートは、ヘッダー1行の代わりに品目ごとの行で集計する
type ReceiptItemRow = {
  id: string;
  transaction_id: string;
  item_name: string;
  amount: number;
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
type WalletScope = "household" | "kids" | "all";
// 区分：支出 / 収入 / 差額（収入−支出）
type Direction = "expense" | "income" | "balance";


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

// ---- 縦軸（金額）の目盛り設定 ----
// 最大値に応じて 1,000 / 2,000 / 5,000 / 10,000 / 20,000 / 50,000 ... の
// 切りの良い間隔を自動で選び、目盛りを固定する（目盛りは最大 AXIS_MAX_INTERVALS 区間）
const AXIS_MAX_INTERVALS = 6;
const AXIS_STEP_CANDIDATES: number[] = (() => {
  const list: number[] = [];
  for (let base = 1000; base <= 1e10; base *= 10) list.push(base, base * 2, base * 5);
  return list;
})();

function buildYAxis(values: number[]): { domain: [number, number]; ticks: number[] } {
  const finite = values.filter((v) => Number.isFinite(v));
  const minV = Math.min(0, ...finite);
  const maxV = Math.max(0, ...finite);
  const step =
    AXIS_STEP_CANDIDATES.find(
      (st) => Math.ceil(maxV / st) - Math.floor(minV / st) <= AXIS_MAX_INTERVALS
    ) ?? AXIS_STEP_CANDIDATES[AXIS_STEP_CANDIDATES.length - 1];
  const lower = Math.floor(minV / step) * step;
  let upper = Math.ceil(maxV / step) * step;
  if (upper === lower) upper = lower + step;
  const ticks: number[] = [];
  for (let t = lower; t <= upper; t += step) ticks.push(t);
  return { domain: [lower, upper], ticks };
}

// 目盛りラベルは円表示（例: 15,000）。万単位への丸めはしない
const formatYen = (v: number | string) => Number(v).toLocaleString();

// 積み上げ棒グラフ用：月ごとの「プラス合計」と「マイナス合計」を返す
function stackedExtents(data: Record<string, number | string>[]): number[] {
  const out: number[] = [];
  data.forEach((row) => {
    let pos = 0;
    let neg = 0;
    Object.entries(row).forEach(([k, v]) => {
      if (k === "month") return;
      const n = Number(v) || 0;
      if (n >= 0) pos += n;
      else neg += n;
    });
    out.push(pos, neg);
  });
  return out;
}

export default function GraphPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [allRows, setAllRows] = useState<Row[]>([]);
  // 子供財布（household以外）の id → 財布名
  const [kidsWalletNames, setKidsWalletNames] = useState<Record<string, string>>({});
  const [accounts, setAccounts] = useState<Account[]>([]);
  // 項目管理で登録した費目（大分類・中分類の候補に使う。取引が無い費目も選べるようにする）
  const [categoryMaster, setCategoryMaster] = useState<CategoryMaster[]>([]);
  const [message, setMessage] = useState("");

  // ---- 条件（画面上部に集約）----
  const [direction, setDirection] = useState<Direction>("expense");
  // 財布の範囲。初期は家計のみ（子供財布は選んだときだけ集計に含める）
  const [walletScope, setWalletScope] = useState<WalletScope>("household");
  const [major, setMajor] = useState("");
  const [minor, setMinor] = useState("");
  const [merchant, setMerchant] = useState("");
  const [account, setAccount] = useState("");
  const [memo, setMemo] = useState("");
  const [free, setFree] = useState("");
  const [showDetail, setShowDetail] = useState(false);
  const [chartType, setChartType] = useState<"bar" | "line">("bar");

  // 期間（初期値：今月を終了月とした直近12か月）
  const [preset, setPreset] = useState<Preset>("12");
  const [startMonth, setStartMonth] = useState(() => addMonths(currentYm(), -11));
  const [endMonth, setEndMonth] = useState(() => currentYm());

  const isBalance = direction === "balance";

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

  // 支払元（口座）のマスタ：支払元の名前での絞り込みに使う
  useEffect(() => {
    if (!user) return;
    const loadAccounts = async () => {
      const { data, error } = await supabase.from("accounts").select("id, account_name");
      if (error) {
        setMessage("マスタの読込エラー: " + error.message);
        return;
      }
      setAccounts((data as Account[]) || []);

      const { data: catData, error: catError } = await supabase
        .from("categories")
        .select("wallet_type, major_category, minor_category, category_kind, display_order")
        .order("display_order");
      if (catError) {
        setMessage("費目マスタの読込エラー: " + catError.message);
        return;
      }
      setCategoryMaster((catData as CategoryMaster[]) || []);
    };
    void loadAccounts();
  }, [user]);

  // 1000件ずつ .range() で繰り返し、全件読み込む（支出・収入・資金移動）
  const loadData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    setMessage("");

    // 子供財布を見分けるため、財布の一覧を読み込む
    const { data: walletData } = await supabase
      .from("wallets")
      .select("id, wallet_name, wallet_type");
    const kidsMap: Record<string, string> = {};
    ((walletData as { id: string; wallet_name: string; wallet_type: string | null }[]) ?? []).forEach((w) => {
      if ((w.wallet_type || "").toLowerCase() !== "household") {
        kidsMap[w.id] = w.wallet_name;
      }
    });
    setKidsWalletNames(kidsMap);

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
          wallet_id,
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

    // ---- レシート明細を読み込み、明細のあるレシートは品目ごとの行に置き換える ----
    const itemRows: ReceiptItemRow[] = [];
    let itemFrom = 0;
    let itemError = "";

    while (true) {
      const { data, error } = await supabase
        .from("receipt_items")
        .select(`
          id,
          transaction_id,
          item_name,
          amount,
          categories:category_id (
            major_category,
            minor_category
          )
        `)
        .eq("user_id", session.user.id)
        .order("id", { ascending: true })
        .range(itemFrom, itemFrom + PAGE_SIZE - 1);

      if (error) {
        itemError = error.message;
        break;
      }

      const chunk = (data as unknown as ReceiptItemRow[]) || [];
      itemRows.push(...chunk);

      if (chunk.length < PAGE_SIZE) break;
      itemFrom += PAGE_SIZE;
    }

    const itemsByTxn = new Map<string, ReceiptItemRow[]>();
    itemRows.forEach((it) => {
      const list = itemsByTxn.get(it.transaction_id) ?? [];
      list.push(it);
      itemsByTxn.set(it.transaction_id, list);
    });

    const expanded: Row[] = [];
    all.forEach((r) => {
      const items = itemsByTxn.get(r.id);
      if (!items || items.length === 0) {
        expanded.push(r);
        return;
      }
      // 日付・支払先などはレシートのものを引き継ぎ、金額・費目・メモ（品名）は品目のものを使う
      items.forEach((it) => {
        expanded.push({
          ...r,
          id: it.id,
          amount: Number(it.amount || 0),
          description: it.item_name,
          categories: it.categories,
        });
      });
    });

    setAllRows(expanded);

    if (itemError) {
      setMessage(
        "レシート明細の読込エラー（レシートは合計行の費目で集計しています）: " +
          itemError
      );
    }
  };

  const accMap = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.account_name])),
    [accounts]
  );

  const isKidRow = (r: Row) => !!(r.wallet_id && kidsWalletNames[r.wallet_id]);

  // ---- 期間の操作 ----
  const applyPreset = (value: Preset) => {
    setPreset(value);
    const cur = currentYm();

    if (value === "custom") return;

    if (value === "all") {
      // allRows は日付順。いちばん古い月から表示
      const first = allRows.length > 0 ? allRows[0].txn_date.slice(0, 7) : cur;
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

  const changeDirection = (next: Direction) => {
    setDirection(next);
    setMajor("");
    setMinor("");
  };

  const changeWallet = (next: WalletScope) => {
    setWalletScope(next);
    setMajor("");
    setMinor("");
  };

  const changeMajor = (v: string) => {
    setMajor(v);
    setMinor("");
  };

  const resetFilters = () => {
    setMajor("");
    setMinor("");
    setMerchant("");
    setAccount("");
    setMemo("");
    setFree("");
  };

  // ---- 集計 ----
  // 財布の範囲で絞る
  const scopedRows = useMemo(
    () =>
      allRows.filter((r) => {
        const kid = !!(r.wallet_id && kidsWalletNames[r.wallet_id]);
        if (walletScope === "all") return true;
        return walletScope === "kids" ? kid : !kid;
      }),
    [allRows, kidsWalletNames, walletScope]
  );

  const cond = useMemo<SearchCondition>(
    () => ({ id: "cond", major, minor, merchant, account, memo, free }),
    [major, minor, merchant, account, memo, free]
  );

  // 区分と条件に合う取引。差額は財布と期間だけで計算し、項目などの条件は使わない
  const matchedRows = useMemo(() => {
    if (isBalance) {
      return scopedRows.filter(
        (r) => r.direction === DIRECTION_INCOME || r.direction === DIRECTION_EXPENSE
      );
    }
    return scopedRows.filter(
      (r) => r.direction === direction && matchesCondition(r, cond, accMap)
    );
  }, [scopedRows, isBalance, direction, cond, accMap]);

  const rangeRows = useMemo(
    () =>
      matchedRows.filter((r) => {
        const m = r.txn_date.slice(0, 7);
        return m >= rangeStart && m <= rangeEnd;
      }),
    [matchedRows, rangeStart, rangeEnd]
  );

  // 大分類・中分類の候補（選んだ区分・財布の全期間のデータから作る）
  // 項目管理（マスタ）の費目のうち、選んだ区分・財布に当てはまるもの。
  // 入力画面と同じ考え方：収入は「収入」を含む／「受け取った」の大分類、支出はそれ以外（資金移動・対象外を除く）
  const masterCategories = useMemo(() => {
    if (isBalance) return [];
    return categoryMaster.filter((c) => {
      const wt = (c.wallet_type || "").toLowerCase();
      const walletOk =
        walletScope === "all"
          ? true
          : walletScope === "household"
            ? wt === "" || wt === "household"
            : wt !== "" && wt !== "household";
      if (!walletOk) return false;

      if (direction === "income") return isIncomeMajorName(c.major_category);
      return (
        !isIncomeMajorName(c.major_category) &&
        c.major_category !== "資金移動" &&
        c.category_kind !== "exclude"
      );
    });
  }, [categoryMaster, isBalance, walletScope, direction]);

  // 候補は「マスタの費目（登録順）」＋「取引データにだけある費目」
  const majorOptions = useMemo(() => {
    if (isBalance) return [];
    const set = new Set<string>();
    masterCategories.forEach((c) => {
      const m = (c.major_category || "").trim();
      if (m) set.add(m);
    });
    const dataOnly = new Set<string>();
    scopedRows.forEach((r) => {
      if (r.direction !== direction) return;
      const c = rowCategory(r);
      if (c.major && !set.has(c.major)) dataOnly.add(c.major);
    });
    return [
      ...Array.from(set),
      ...Array.from(dataOnly).sort((a, b) => a.localeCompare(b, "ja")),
    ];
  }, [masterCategories, scopedRows, isBalance, direction]);

  const minorOptions = useMemo(() => {
    if (isBalance) return [];
    const set = new Set<string>();
    masterCategories.forEach((c) => {
      if (major && (c.major_category || "").trim() !== major) return;
      const m = (c.minor_category || "").trim();
      if (m) set.add(m);
    });
    const dataOnly = new Set<string>();
    scopedRows.forEach((r) => {
      if (r.direction !== direction) return;
      const c = rowCategory(r);
      if (major && c.major !== major) return;
      if (c.minor && !set.has(c.minor)) dataOnly.add(c.minor);
    });
    return [
      ...Array.from(set),
      ...Array.from(dataOnly).sort((a, b) => a.localeCompare(b, "ja")),
    ];
  }, [masterCategories, scopedRows, isBalance, direction, major]);

  // 月ごとの収入・支出・グラフ1の値
  const monthly = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>();
    monthList.forEach((m) => map.set(m, { income: 0, expense: 0 }));

    rangeRows.forEach((r) => {
      const e = map.get(r.txn_date.slice(0, 7));
      if (!e) return;
      const amount = Number(r.amount || 0);
      if (r.direction === DIRECTION_INCOME) e.income += amount;
      else if (r.direction === DIRECTION_EXPENSE) e.expense += amount;
    });

    return Array.from(map.entries()).map(([month, v]) => ({
      month,
      income: v.income,
      expense: v.expense,
      amount:
        direction === "balance"
          ? v.income - v.expense
          : direction === "income"
            ? v.income
            : v.expense,
    }));
  }, [rangeRows, monthList, direction]);

  const total = useMemo(() => monthly.reduce((s, d) => s + d.amount, 0), [monthly]);
  const incomeTotal = useMemo(() => monthly.reduce((s, d) => s + d.income, 0), [monthly]);
  const expenseTotal = useMemo(() => monthly.reduce((s, d) => s + d.expense, 0), [monthly]);
  const average = monthList.length > 0 ? Math.round(total / monthList.length) : 0;

  // グラフ2（内訳）：大分類未指定→大分類別、大分類を指定→中分類別、中分類まで指定→支払先別
  const breakdown = useMemo(() => {
    if (isBalance) return null;

    const level: "major" | "minor" | "merchant" = !major
      ? "major"
      : !minor
        ? "minor"
        : "merchant";

    const keyOf = (r: Row) => {
      const c = rowCategory(r);
      const base =
        level === "major"
          ? c.major || "未分類"
          : level === "minor"
            ? c.minor || "(中分類なし)"
            : r.merchant_name?.trim() || "（支払先なし）";
      // 「すべて」の財布では、子供財布の分を家計の同名項目と分ける
      const kidName =
        walletScope === "all" && r.wallet_id ? kidsWalletNames[r.wallet_id] : undefined;
      return kidName ? `【${kidName}】${base}` : base;
    };

    const totals = new Map<string, number>();
    rangeRows.forEach((r) => {
      const k = keyOf(r);
      totals.set(k, (totals.get(k) || 0) + Number(r.amount || 0));
    });

    // 金額の大きい順に最大9項目まで。残りは「その他」にまとめる
    const sorted = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
    const MAX_KEYS = 9;
    const top = sorted.slice(0, MAX_KEYS).map(([k]) => k);
    const hasOther = sorted.length > MAX_KEYS;
    const keys = hasOther ? [...top, "その他"] : top;
    const indexOf = new Map(keys.map((k, i) => [k, i]));

    const dataMap = new Map<string, Record<string, number | string>>();
    monthList.forEach((m) => dataMap.set(m, { month: m }));

    rangeRows.forEach((r) => {
      const item = dataMap.get(r.txn_date.slice(0, 7));
      if (!item) return;
      const k = keyOf(r);
      const i = indexOf.get(k) ?? (hasOther ? keys.length - 1 : undefined);
      if (i === undefined) return;
      const dk = `k${i}`;
      item[dk] = Number(item[dk] || 0) + Number(r.amount || 0);
    });

    return { level, keys, data: Array.from(dataMap.values()) };
  }, [isBalance, major, minor, rangeRows, monthList, walletScope, kidsWalletNames]);

  if (authLoading) {
    return <div style={{ minHeight: "100vh", background: "#111827", color: "#f9fafb", display: "flex", alignItems: "center", justifyContent: "center" }}>読込中...</div>;
  }

  if (!user) {
    return <div style={{ minHeight: "100vh", background: "#111827", color: "#f9fafb", display: "flex", alignItems: "center", justifyContent: "center" }}>ログインしてください</div>;
  }

  const dirLabel = isBalance ? "差額" : direction === "income" ? "収入" : "支出";
  const accent = isBalance ? "#a78bfa" : direction === "income" ? "#34d399" : "#60a5fa";
  const walletLabel =
    walletScope === "household" ? "家計" : walletScope === "kids" ? "子供" : "すべての財布";
  const chartWidth = Math.max(monthList.length * 80, 600);
  const levelLabel =
    breakdown?.level === "major"
      ? "大分類別"
      : breakdown?.level === "minor"
        ? "中分類別"
        : "支払先別";

  const mainAxis = buildYAxis(monthly.map((d) => d.amount));
  const stackAxis = buildYAxis(breakdown ? stackedExtents(breakdown.data) : []);
  const balanceBreakdownAxis = buildYAxis(monthly.flatMap((d) => [d.income, d.expense]));

  const conditionText = isBalance ? "" : conditionLabel(cond);
  const hasDetailFilter = !!(merchant || account || memo || free);

  const tooltipStyle = { background: "#1f2937", border: "1px solid #374151", color: "#f9fafb" };
  const xAxisProps = {
    dataKey: "month",
    stroke: "#f9fafb",
    tick: { fontSize: 12 },
    angle: -40,
    textAnchor: "end" as const,
    interval: 0,
  };
  const chartMargin = { top: 8, right: 16, left: 8, bottom: 40 };

  const detailRows = [...rangeRows]
    .sort((a, b) => (a.txn_date < b.txn_date ? 1 : -1))
    .slice(0, 200);

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
      <h1 style={{ fontSize: "24px", fontWeight: "bold" }}>月別グラフ</h1>

      {/* ===== 条件（ここを変えると、下のグラフがすべて切り替わります） ===== */}
      <div style={{ ...searchCardStyle, display: "grid", gap: "12px" }}>
        <div>
          <div style={fieldLabelStyle}>区分</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
            <TabButton active={direction === "expense"} color="#60a5fa" onClick={() => changeDirection("expense")}>
              支出
            </TabButton>
            <TabButton active={direction === "income"} color="#34d399" onClick={() => changeDirection("income")}>
              収入
            </TabButton>
            <TabButton active={direction === "balance"} color="#a78bfa" onClick={() => changeDirection("balance")}>
              差額
            </TabButton>
          </div>
        </div>

        <div>
          <div style={fieldLabelStyle}>財布</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
            <TabButton active={walletScope === "household"} color="#fbbf24" onClick={() => changeWallet("household")}>
              家計
            </TabButton>
            <TabButton active={walletScope === "kids"} color="#fbbf24" onClick={() => changeWallet("kids")}>
              子供
            </TabButton>
            <TabButton active={walletScope === "all"} color="#fbbf24" onClick={() => changeWallet("all")}>
              すべて
            </TabButton>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px" }}>
          <div>
            <div style={fieldLabelStyle}>表示期間</div>
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
          <div>
            <div style={fieldLabelStyle}>開始月</div>
            <input
              type="month"
              value={startMonth}
              onChange={(e) => onChangeStart(e.target.value)}
              style={selectStyle}
            />
          </div>
          <div>
            <div style={fieldLabelStyle}>終了月</div>
            <input
              type="month"
              value={endMonth}
              onChange={(e) => onChangeEnd(e.target.value)}
              style={selectStyle}
            />
          </div>
        </div>

        {isBalance ? (
          <div style={{ fontSize: "13px", color: "#9ca3af" }}>
            差額は選んだ財布と期間だけで計算します（項目・支払先などの条件は使いません）。
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div>
                <div style={fieldLabelStyle}>大分類</div>
                <select
                  value={major}
                  onChange={(e) => changeMajor(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">指定なし</option>
                  {majorOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div style={fieldLabelStyle}>中分類</div>
                <select
                  value={minor}
                  onChange={(e) => setMinor(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">指定なし</option>
                  {minorOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setShowDetail((v) => !v)}
                style={searchButtonStyle}
              >
                {showDetail ? "詳細条件を閉じる" : "詳細条件（支払先・支払元・メモ）"}
                {!showDetail && hasDetailFilter ? "（設定あり）" : ""}
              </button>
              <button type="button" onClick={resetFilters} style={searchButtonStyle}>
                項目の条件をリセット
              </button>
            </div>

            {showDetail && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px" }}>
                <div>
                  <div style={fieldLabelStyle}>支払先（部分一致）</div>
                  <input
                    value={merchant}
                    onChange={(e) => setMerchant(e.target.value)}
                    placeholder="例: ガスト"
                    style={selectStyle}
                  />
                </div>
                <div>
                  <div style={fieldLabelStyle}>支払元（部分一致）</div>
                  <input
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                    placeholder="例: 楽天カード"
                    style={selectStyle}
                  />
                </div>
                <div>
                  <div style={fieldLabelStyle}>メモ（部分一致）</div>
                  <input
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    placeholder="例: 学童"
                    style={selectStyle}
                  />
                </div>
                <div>
                  <div style={fieldLabelStyle}>フリーワード</div>
                  <input
                    value={free}
                    onChange={(e) => setFree(e.target.value)}
                    placeholder="支払先・支払元・メモ・費目名"
                    style={selectStyle}
                  />
                </div>
              </div>
            )}
          </>
        )}

        <div style={{ fontSize: "12px", color: "#9ca3af" }}>
          表示中：{dirLabel}／{walletLabel}／{rangeStart}〜{rangeEnd}
          {conditionText && conditionText !== "条件なし（全体）" ? `／${conditionText}` : ""}
          。スペース区切りで複数の語に一致（AND）、大文字・小文字・全角・半角は区別しません。
        </div>
      </div>

      {message && <div style={{ marginBottom: "12px" }}>{message}</div>}

      {/* ===== 合計 ===== */}
      {isBalance ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginBottom: "16px" }}>
          <SummaryBox label="収入合計" value={incomeTotal} color="#34d399" />
          <SummaryBox label="支出合計" value={expenseTotal} color="#60a5fa" />
          <SummaryBox
            label="差額合計（収入−支出）"
            value={total}
            color={total >= 0 ? "#34d399" : "#f87171"}
            signed
          />
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginBottom: "16px" }}>
          <SummaryBox label={`${dirLabel}合計`} value={total} color={accent} />
          <SummaryBox label="月平均" value={average} color={accent} />
          <div
            style={{
              background: "#1f2937",
              border: "1px solid #374151",
              borderRadius: "12px",
              padding: "10px",
            }}
          >
            <div style={{ fontSize: "12px", color: "#d1d5db", marginBottom: "4px" }}>
              件数
            </div>
            <div style={{ fontSize: "16px", fontWeight: "bold", color: accent }}>
              {rangeRows.length.toLocaleString()}件
            </div>
          </div>
        </div>
      )}

      {/* ===== グラフ1：月別推移 ===== */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
        <SectionTitle title={`月別の${dirLabel}（${walletLabel}）`} />
        <div style={{ display: "flex", gap: "6px" }}>
          <button
            type="button"
            onClick={() => setChartType("bar")}
            style={{ ...smallButtonStyle, background: chartType === "bar" ? accent : "#374151", color: chartType === "bar" ? "#111827" : "#f9fafb" }}
          >
            棒
          </button>
          <button
            type="button"
            onClick={() => setChartType("line")}
            style={{ ...smallButtonStyle, background: chartType === "line" ? accent : "#374151", color: chartType === "line" ? "#111827" : "#f9fafb" }}
          >
            折れ線
          </button>
        </div>
      </div>

      <div style={{ marginBottom: "8px", color: "#d1d5db", fontSize: "14px" }}>
        表示期間合計: {isBalance ? formatSigned(total) : `${total.toLocaleString()}円`}
      </div>

      <div style={scrollWrapStyle}>
        {chartType === "bar" ? (
          <BarChart width={chartWidth} height={320} data={monthly} margin={chartMargin}>
            <CartesianGrid stroke="#374151" />
            <XAxis {...xAxisProps} />
            <YAxis
              stroke="#f9fafb"
              tick={{ fontSize: 12 }}
              domain={mainAxis.domain}
              ticks={mainAxis.ticks}
              tickFormatter={formatYen}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value) => [
                isBalance ? formatSigned(Number(value)) : `${Number(value).toLocaleString()}円`,
                dirLabel,
              ]}
            />
            {isBalance && <ReferenceLine y={0} stroke="#9ca3af" />}
            <Bar dataKey="amount" name={dirLabel} fill={accent}>
              {isBalance &&
                monthly.map((d) => (
                  <Cell key={d.month} fill={d.amount >= 0 ? "#34d399" : "#f87171"} />
                ))}
            </Bar>
          </BarChart>
        ) : (
          <LineChart width={chartWidth} height={320} data={monthly} margin={chartMargin}>
            <CartesianGrid stroke="#374151" />
            <XAxis {...xAxisProps} />
            <YAxis
              stroke="#f9fafb"
              tick={{ fontSize: 12 }}
              domain={mainAxis.domain}
              ticks={mainAxis.ticks}
              tickFormatter={formatYen}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value) => [
                isBalance ? formatSigned(Number(value)) : `${Number(value).toLocaleString()}円`,
                dirLabel,
              ]}
            />
            {isBalance && <ReferenceLine y={0} stroke="#9ca3af" />}
            <Line
              type="monotone"
              dataKey="amount"
              name={dirLabel}
              stroke={accent}
              strokeWidth={3}
              dot={{ r: 5 }}
            />
          </LineChart>
        )}
      </div>

      {/* ===== グラフ2：内訳 ===== */}
      <SectionTitle title={isBalance ? "収入と支出の月別比較" : `内訳（${levelLabel}）`} />

      {isBalance ? (
        <div style={scrollWrapStyle}>
          <BarChart width={chartWidth} height={320} data={monthly} margin={chartMargin}>
            <CartesianGrid stroke="#374151" />
            <XAxis {...xAxisProps} />
            <YAxis
              stroke="#f9fafb"
              tick={{ fontSize: 12 }}
              domain={balanceBreakdownAxis.domain}
              ticks={balanceBreakdownAxis.ticks}
              tickFormatter={formatYen}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value, name) => [`${Number(value).toLocaleString()}円`, name]}
            />
            <Legend wrapperStyle={{ paddingTop: "8px", color: "#f9fafb", fontSize: "13px" }} />
            <Bar dataKey="income" name="収入" fill="#34d399" />
            <Bar dataKey="expense" name="支出" fill="#60a5fa" />
          </BarChart>
        </div>
      ) : breakdown && breakdown.keys.length > 0 ? (
        <div style={scrollWrapStyle}>
          <BarChart width={chartWidth} height={340} data={breakdown.data} margin={chartMargin}>
            <CartesianGrid stroke="#374151" />
            <XAxis {...xAxisProps} />
            <YAxis
              stroke="#f9fafb"
              tick={{ fontSize: 12 }}
              domain={stackAxis.domain}
              ticks={stackAxis.ticks}
              tickFormatter={formatYen}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value, name) => [`${Number(value).toLocaleString()}円`, name]}
            />
            <Legend wrapperStyle={{ paddingTop: "8px", color: "#f9fafb", fontSize: "13px" }} />
            {breakdown.keys.map((k, i) => (
              <Bar
                key={k}
                dataKey={`k${i}`}
                name={k}
                stackId="a"
                fill={COLORS[i % COLORS.length]}
              />
            ))}
          </BarChart>
        </div>
      ) : (
        <div style={{ ...scrollWrapStyle, color: "#9ca3af" }}>該当するデータがありません。</div>
      )}

      {/* ===== 月別の表 ===== */}
      <details style={{ marginBottom: "16px" }}>
        <summary style={{ cursor: "pointer", marginBottom: "8px" }}>月別の表を表示</summary>
        <div style={{ ...scrollWrapStyle, padding: "8px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ color: "#9ca3af" }}>
                <th style={{ textAlign: "left", padding: "4px 8px" }}>月</th>
                {isBalance && <th style={{ textAlign: "right", padding: "4px 8px" }}>収入</th>}
                {isBalance && <th style={{ textAlign: "right", padding: "4px 8px" }}>支出</th>}
                <th style={{ textAlign: "right", padding: "4px 8px" }}>{dirLabel}</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((d) => (
                <tr key={d.month} style={{ borderTop: "1px solid #374151", textAlign: "right" }}>
                  <td style={{ textAlign: "left", padding: "4px 8px" }}>{d.month}</td>
                  {isBalance && (
                    <td style={{ padding: "4px 8px" }}>
                      {d.income !== 0 ? `${d.income.toLocaleString()}円` : "-"}
                    </td>
                  )}
                  {isBalance && (
                    <td style={{ padding: "4px 8px" }}>
                      {d.expense !== 0 ? `${d.expense.toLocaleString()}円` : "-"}
                    </td>
                  )}
                  <td style={{ padding: "4px 8px" }}>
                    {d.amount !== 0
                      ? isBalance
                        ? formatSigned(d.amount)
                        : `${d.amount.toLocaleString()}円`
                      : "-"}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: "2px solid #374151", fontWeight: "bold", textAlign: "right" }}>
                <td style={{ textAlign: "left", padding: "4px 8px" }}>合計</td>
                {isBalance && <td style={{ padding: "4px 8px" }}>{incomeTotal.toLocaleString()}円</td>}
                {isBalance && <td style={{ padding: "4px 8px" }}>{expenseTotal.toLocaleString()}円</td>}
                <td style={{ padding: "4px 8px" }}>
                  {isBalance ? formatSigned(total) : `${total.toLocaleString()}円`}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>

      {/* ===== 明細 ===== */}
      <SectionTitle title={`該当する明細（新しい順・最大200件／全${rangeRows.length.toLocaleString()}件）`} />

      <div style={{ display: "grid", gap: "6px", marginBottom: "16px" }}>
        {detailRows.length === 0 && <div>該当する明細はありません。</div>}

        {detailRows.map((r) => {
          const { major: mj, minor: mn } = rowCategory(r);
          const accId =
            r.direction === DIRECTION_INCOME ? r.receive_account_id : r.payment_account_id;
          const accName = accId ? accMap.get(accId) : "";
          const isIncomeRow = r.direction === DIRECTION_INCOME;

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
                <b style={isBalance ? { color: isIncomeRow ? "#86efac" : "#fca5a5" } : undefined}>
                  {isBalance ? (isIncomeRow ? "+" : "-") : ""}
                  {Number(r.amount).toLocaleString()}円
                </b>
              </div>
              <div style={{ color: "#d1d5db" }}>
                {isKidRow(r) && r.wallet_id ? `【${kidsWalletNames[r.wallet_id]}】 ` : ""}
                {mj || mn ? `${mj} / ${mn}` : "（費目なし）"}
                {r.merchant_name ? ` ・ ${r.merchant_name}` : ""}
                {accName ? ` ・ ${accName}` : ""}
              </div>
              {r.description && <div style={{ color: "#9ca3af" }}>{r.description}</div>}
            </div>
          );
        })}
      </div>

      <BottomNav />
    </div>
  );
}

// ===================== 検索条件のヘルパー =====================
type Account = { id: string; account_name: string };
type CategoryMaster = {
  wallet_type: string | null;
  major_category: string;
  minor_category: string;
  category_kind: string | null;
  display_order: number | null;
};

// 収入として扱う大分類の判定（入力画面と同じ）。「収入」を含む名前、または子供財布の「受け取った」
const isIncomeMajorName = (v: string | null | undefined) => {
  const m = (v || "").normalize("NFKC").trim();
  return ["収入", "受け取った"].some((k) => m.includes(k));
};

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
