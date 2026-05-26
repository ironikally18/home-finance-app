"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Txn = {
  id: string;
  txn_date: string;
  amount: number;
  direction: "income" | "expense";
  category_id: string | null;
  categories:
  | {
    major_category: string | null;
    minor_category: string | null;
  }
  | {
    major_category: string | null;
    minor_category: string | null;
  }[]
  | null;
};

const DASHBOARD_GROUPS = {
  food: {
    label: "食費",
    majorCategories: ["飲食費"],
  },

  utilities: {
    label: "水道光熱費",
    majorCategories: ["水道光熱費"],
  },

  communication: {
    label: "通信費",
    majorCategories: ["通信費"],
  },

  daily: {
    label: "日用品",
    majorCategories: ["日用品"],
  },

  medical: {
    label: "医療費",
    majorCategories: ["医療"],
  },

  transport: {
    label: "交通費",
    majorCategories: ["交通費"],
  },

  entertainment: {
    label: "娯楽",
    majorCategories: ["娯楽"],
  },

  education: {
    label: "教育・学び",
    majorCategories: ["果恩"],
  },

  car: {
    label: "車関連",
    majorCategories: ["車関連"],
  },

  bike: {
    label: "バイク関連",
    majorCategories: ["バイク関連"],
  },

  insurance: {
    label: "保険",
    majorCategories: ["保険"],
  },
};

const FIXED_GROUP_KEYS = [
  "utilities",
  "communication",
  "insurance",
];

function yen(n: number) {
  return `${Math.round(n).toLocaleString()}円`;
}

function pct(n: number) {
  if (!Number.isFinite(n)) return "0.0%";
  return `${n.toFixed(1)}%`;
}

function categoryLabel(x: Txn) {
  const raw = x.categories;

  const cat = Array.isArray(raw) ? raw[0] : raw;

  const major = cat?.major_category?.trim() ?? "";
  const minor = cat?.minor_category?.trim() ?? "";

  if (major && minor) return `${major} / ${minor}`;
  if (major) return major;
  if (minor) return minor;
  return "";
}

function majorCategory(x: Txn) {
  const raw = x.categories;

  const cat = Array.isArray(raw) ? raw[0] : raw;

  return cat?.major_category?.trim() ?? "";
}

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function nextMonthYm(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function Card({
  title,
  value,
  note,
  tone = "normal",
}: {
  title: string;
  value: string;
  note?: string;
  tone?: "normal" | "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "border-blue-200 bg-blue-50"
      : tone === "warn"
        ? "border-yellow-200 bg-yellow-50"
        : tone === "bad"
          ? "border-red-200 bg-red-50"
          : "border-gray-200 bg-white";

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${toneClass}`}>
      <div className="text-sm text-gray-600">{title}</div>
      <div className="mt-2 text-2xl font-bold text-gray-900">{value}</div>
      {note && <div className="mt-1 text-xs text-gray-600">{note}</div>}
    </div>
  );
}

export default function DashboardPage() {


  const [month, setMonth] = useState(thisMonth());
  const [items, setItems] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [virtualRent, setVirtualRent] = useState(120000);

  async function load() {
    setLoading(true);
    setMessage("");

    const from = `${month}-01`;
    const to = `${nextMonthYm(month)}-01`;

    const { data, error } = await supabase
      .from("transaction_records")
      .select(`
    id,
    txn_date,
    amount,
    direction,
    category_id,
    categories (
      major_category,
      minor_category
    )
  `)
      .gte("txn_date", from)
      .lt("txn_date", to)
      .order("txn_date", { ascending: false });

    if (error) {
      setMessage(error.message);
      setItems([]);
    } else {
      setItems((data as unknown as Txn[]) ?? []);
    }

    setLoading(false);
  }

  function saveVirtualRent(value: number) {
    setVirtualRent(value);
    localStorage.setItem("dashboard_virtual_rent", String(value));
  }

  useEffect(() => {
    const saved = localStorage.getItem("dashboard_virtual_rent");
    if (saved !== null) {
      setVirtualRent(Number(saved) || 0);
    }
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const summary = useMemo(() => {
    const income = items
      .filter((x) => x.direction === "income")
      .reduce((s, x) => s + Number(x.amount || 0), 0);

    const expense = items
      .filter((x) => x.direction === "expense")
      .reduce((s, x) => s + Number(x.amount || 0), 0);

    const balance = income - expense;

    const groupTotals = Object.fromEntries(
      Object.entries(DASHBOARD_GROUPS).map(([key, group]) => {
        const total = items
          .filter(
            (x) =>
              x.direction === "expense" &&
              group.majorCategories.includes(majorCategory(x))
          )
          .reduce((s, x) => s + Number(x.amount || 0), 0);

        return [key, total];
      })
    ) as Record<string, number>;

    const foodExpense = groupTotals.food ?? 0;

    const fixedExpense = FIXED_GROUP_KEYS.reduce(
      (sum, key) => sum + (groupTotals[key] ?? 0),
      0
    );

    const engel = expense > 0 ? (foodExpense / expense) * 100 : 0;
    const fixedRate = income > 0 ? (fixedExpense / income) * 100 : 0;
    const savingRate = income > 0 ? (balance / income) * 100 : 0;

    const simulatedExpense = expense + virtualRent;
    const simulatedBalance = income - simulatedExpense;

    const simulatedEngel =
      simulatedExpense > 0 ? (foodExpense / simulatedExpense) * 100 : 0;

    const simulatedSavingRate =
      income > 0 ? (simulatedBalance / income) * 100 : 0;

    return {
      income,
      expense,
      balance,
      foodExpense,
      fixedExpense,
      engel,
      fixedRate,
      savingRate,
      groupTotals,
      simulatedExpense,
      simulatedBalance,
      simulatedEngel,
      simulatedSavingRate,
    };
  }, [items]);


  const engelTone =
    summary.engel <= 25 ? "good" : summary.engel <= 35 ? "warn" : "bad";

  const fixedTone =
    summary.fixedRate <= 35 ? "good" : summary.fixedRate <= 50 ? "warn" : "bad";

  const savingTone =
    summary.savingRate >= 20 ? "good" : summary.savingRate >= 0 ? "warn" : "bad";

  const simulatedSavingTone =
    summary.simulatedSavingRate >= 20
      ? "good"
      : summary.simulatedSavingRate >= 0
        ? "warn"
        : "bad";

  return (
    <main className="min-h-screen bg-gray-100 px-3 py-4 pb-24 text-gray-900">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">家計ダッシュボード</h1>
            <p className="mt-1 text-sm text-gray-600">
              月別の収支・エンゲル係数・固定費率・貯蓄率
            </p>
          </div>

          <Link
            href="/"
            className="rounded-xl bg-gray-800 px-4 py-2 text-sm font-bold text-white"
          >
            戻る
          </Link>
        </div>

        <div className="mb-4 rounded-2xl border bg-white p-4 shadow-sm">
          <label className="text-sm font-bold">表示月</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="mt-2 w-full rounded-xl border px-3 py-2 text-lg"
          />
          <div className="mt-4">
            <label className="text-sm font-bold">仮想家賃</label>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                value={virtualRent}
                onChange={(e) => saveVirtualRent(Number(e.target.value) || 0)}
                className="w-full rounded-xl border px-3 py-2 text-lg"
                placeholder="例：120000"
              />
              <span className="whitespace-nowrap text-sm">円</span>
            </div>
            <p className="mt-1 text-xs text-gray-600">
              実際には払っていない家賃を入れて、社宅解除後の生活コストを試算します。
            </p>
          </div>
        </div>

        {message && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {message}
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border bg-white p-6 text-center">
            読み込み中...
          </div>
        ) : (
          <>
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Card title="今月の収入" value={yen(summary.income)} />
              <Card title="今月の支出" value={yen(summary.expense)} />
              <Card
                title="今月の収支"
                value={yen(summary.balance)}
                tone={summary.balance >= 0 ? "good" : "bad"}
              />

              <Card
                title="エンゲル係数"
                value={pct(summary.engel)}
                note={`食費 ${yen(summary.foodExpense)} ÷ 支出 ${yen(
                  summary.expense
                )}`}
                tone={engelTone}
              />

              <Card
                title="固定費率"
                value={pct(summary.fixedRate)}
                note={`固定費 ${yen(summary.fixedExpense)} ÷ 収入 ${yen(
                  summary.income
                )}`}
                tone={fixedTone}
              />

              <Card
                title="貯蓄率"
                value={pct(summary.savingRate)}
                note={`収支 ${yen(summary.balance)} ÷ 収入 ${yen(
                  summary.income
                )}`}
                tone={savingTone}
              />
              <Card
                title="仮想家賃込み支出"
                value={yen(summary.simulatedExpense)}
                note={`実支出 ${yen(summary.expense)} + 仮想家賃 ${yen(virtualRent)}`}
              />

              <Card
                title="補正後収支"
                value={yen(summary.simulatedBalance)}
                note="仮想家賃を払った場合の収支"
                tone={summary.simulatedBalance >= 0 ? "good" : "bad"}
              />

              <Card
                title="補正エンゲル係数"
                value={pct(summary.simulatedEngel)}
                note={`食費 ${yen(summary.foodExpense)} ÷ 仮想家賃込み支出 ${yen(
                  summary.simulatedExpense
                )}`}
              />

              <Card
                title="補正貯蓄率"
                value={pct(summary.simulatedSavingRate)}
                note={`補正後収支 ${yen(summary.simulatedBalance)} ÷ 収入 ${yen(
                  summary.income
                )}`}
                tone={simulatedSavingTone}
              />
            </section>

            <section className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
              <h2 className="text-lg font-bold">指標用グループ集計</h2>

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {Object.entries(DASHBOARD_GROUPS).map(([key, group]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-xl border bg-gray-50 px-3 py-2"
                  >
                    <span className="font-bold">{group.label}</span>
                    <span>{yen(summary.groupTotals?.[key] ?? 0)}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
              <h2 className="text-lg font-bold">判定目安</h2>
              <div className="mt-3 grid gap-2 text-sm">
                <div>エンゲル係数：25%以下 良好 / 35%超 注意</div>
                <div>固定費率：35%以下 良好 / 50%超 注意</div>
                <div>貯蓄率：20%以上 良好 / 0%未満 赤字</div>
              </div>
            </section>

            <section className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
              <h2 className="text-lg font-bold">対象カテゴリ</h2>

              <div className="mt-3">
                <div className="text-sm font-bold">食費扱い</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {DASHBOARD_GROUPS.food.majorCategories.map((c) => (
                    <span
                      key={c}
                      className="rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-700"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-4">
                <div className="text-sm font-bold">固定費扱い</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {FIXED_GROUP_KEYS.map((key) =>
                    DASHBOARD_GROUPS[
                      key as keyof typeof DASHBOARD_GROUPS
                    ].majorCategories.map((c) => (
                      <span
                        key={c}
                        className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700"
                      >
                        {c}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </section>
          </>
        )}
      </div>

      <BottomNav />
    </main>
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