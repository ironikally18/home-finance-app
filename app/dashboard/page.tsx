"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

type CostClass = "fixed" | "semi" | "variable" | "special" | "exclude";

type Txn = {
  id: string;
  txn_date: string;
  amount: number;
  direction: "income" | "expense";
  category_id: string | null;
  categories:
  | {
    id: string;
    major_category: string | null;
    minor_category: string | null;
    category_kind: CostClass | null;
  }
  | {
    id: string;
    major_category: string | null;
    minor_category: string | null;
    category_kind: CostClass | null;
  }[]
  | null;
};

const DASHBOARD_GROUPS = {
  food: {
    label: "食費",
    majorCategories: ["飲食費"],
  },

  housing: {
    label: "住居費",
    majorCategories: ["住居費"],
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

  clothing: {
    label: "衣類",
    majorCategories: ["衣類"],
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
    label: "趣味・娯楽",
    majorCategories: ["趣味・娯楽"],
  },

  gadget: {
    label: "家電・ガジェット",
    majorCategories: ["家電・ガジェット"],
  },

  subscription: {
    label: "サブスク・ソフト",
    majorCategories: ["サブスク・ソフト"],
  },

  education: {
    label: "教育・子ども",
    // 「果恩」は旧マスタの大分類名（過去データ用に残している）
    majorCategories: ["教育", "子ども", "果恩"],
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

  tax: {
    label: "税・寄附",
    majorCategories: ["税・寄附"],
  },

  other: {
    label: "その他",
    majorCategories: ["その他"],
  },
};

// 実費の家賃として扱う費目（この費目がある月は、仮想家賃を加算しない）
const RENT_MAJOR = "住居費";
const RENT_MINOR = "家賃";

// 収入の費目の判定
// ・大分類が「定期収入」なら定期収入、「臨時収入」なら臨時収入として扱う
// ・大分類が従来の「収入」の場合は、中分類の名前で判定する
//   （定期収入の名前に載っていない収入は、臨時収入として扱う）
const REGULAR_INCOME_MAJORS = ["定期収入"];
const TEMP_INCOME_MAJORS = ["臨時収入"];
const INCOME_MAJOR_LEGACY = "収入";
const REGULAR_INCOME_MINORS = ["給料", "手当・給付"];

// 臨時収入の費目の名前（従来の「収入」の場合に、この費目がある月を「通常月」から除く）
const TEMP_INCOME_MINORS = ["賞与", "持株・配当", "年金", "還付・利息"];
// 臨時収入の費目ごとの月合計がこの金額以上の月だけ、通常月から除く
// （数千〜数万円の利息・立替精算などで、通常月が除外されないようにするため）
const TEMP_INCOME_MIN = 50000;

function yen(n: number) {
  return `${Math.round(n).toLocaleString()}円`;
}

function costKindLabel(value: string | null | undefined) {
  if (value === "fixed") return "固定費";
  if (value === "semi") return "準固定費";
  if (value === "variable") return "変動費";
  if (value === "special") return "特別費";
  if (value === "exclude") return "対象外";
  return "未設定";
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

function minorCategory(x: Txn) {
  const raw = x.categories;

  const cat = Array.isArray(raw) ? raw[0] : raw;

  return cat?.minor_category?.trim() ?? "";
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

function costClassOf(x: Txn): CostClass {
  const raw = x.categories;
  const cat = Array.isArray(raw) ? raw[0] : raw;

  return cat?.category_kind ?? "variable";
}

function isRegularIncome(x: Txn) {
  const major = majorCategory(x);

  return (
    REGULAR_INCOME_MAJORS.includes(major) ||
    (major === INCOME_MAJOR_LEGACY &&
      REGULAR_INCOME_MINORS.includes(minorCategory(x)))
  );
}

function isTempIncomeCategory(x: Txn) {
  const major = majorCategory(x);

  return (
    TEMP_INCOME_MAJORS.includes(major) ||
    (major === INCOME_MAJOR_LEGACY &&
      TEMP_INCOME_MINORS.includes(minorCategory(x)))
  );
}

// 1か月分の集計
function summarizeMonth(items: Txn[], virtualRent: number) {
  const income = items
    .filter((x) => x.direction === "income")
    .reduce((s, x) => s + Number(x.amount || 0), 0);

  // 定期収入（給料・手当・給付）と、それ以外の臨時収入（通勤手当は臨時収入として扱う）
  const regularIncome = items
    .filter((x) => x.direction === "income" && isRegularIncome(x))
    .reduce((s, x) => s + Number(x.amount || 0), 0);

  const irregularIncome = income - regularIncome;

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

  // 固定費は、費目マスタの区分が「固定費」の費目の合計（下の classifiedTotals）

  const engel = expense > 0 ? (foodExpense / expense) * 100 : 0;
  // 率は定期収入を基準にする（賞与などの臨時収入の月でも率が歪まないように）
  const regularBalance = regularIncome - expense;
  const savingRate =
    regularIncome > 0 ? (regularBalance / regularIncome) * 100 : 0;

  // 実費の家賃（住居費 / 家賃）
  const actualRent = items
    .filter(
      (x) =>
        x.direction === "expense" &&
        majorCategory(x) === RENT_MAJOR &&
        minorCategory(x) === RENT_MINOR
    )
    .reduce((s, x) => s + Number(x.amount || 0), 0);

  // 実費の家賃がある月は仮想家賃を加算しない
  const effectiveVirtualRent = actualRent > 0 ? 0 : virtualRent;

  const simulatedExpense = expense + effectiveVirtualRent;
  const simulatedBalance = income - simulatedExpense;

  const simulatedEngel =
    simulatedExpense > 0 ? (foodExpense / simulatedExpense) * 100 : 0;

  const simulatedRegularBalance = regularIncome - simulatedExpense;

  const simulatedSavingRate =
    regularIncome > 0
      ? (simulatedRegularBalance / regularIncome) * 100
      : 0;

  const classifiedTotals = items
    .filter((x) => x.direction === "expense")
    .reduce(
      (acc, x) => {
        const cls = costClassOf(x);
        const amount = Number(x.amount || 0);

        if (cls === "fixed") acc.fixed += amount;
        if (cls === "semi") acc.semi += amount;
        if (cls === "variable") acc.variable += amount;
        if (cls === "special") acc.special += amount;

        return acc;
      },
      { fixed: 0, semi: 0, variable: 0, special: 0 }
    );

  const fixedExpenseByClass = classifiedTotals.fixed;
  const semiFixedExpense = classifiedTotals.semi;
  const variableExpense = classifiedTotals.variable;
  const specialExpense = classifiedTotals.special;

  // 経常支出＝特別費（年払い・単発）を除いた支出
  const recurringExpense =
    fixedExpenseByClass + semiFixedExpense + variableExpense;
  const recurringBalance = regularIncome - recurringExpense;
  const simulatedRecurringBalance = recurringBalance - effectiveVirtualRent;

  const fixedRateByClass =
    regularIncome > 0 ? (fixedExpenseByClass / regularIncome) * 100 : 0;

  const specialRate =
    regularIncome > 0 ? (specialExpense / regularIncome) * 100 : 0;

  const semiFixedRate =
    regularIncome > 0 ? (semiFixedExpense / regularIncome) * 100 : 0;

  const variableRate =
    regularIncome > 0 ? (variableExpense / regularIncome) * 100 : 0;

  const livingCostRate =
    regularIncome > 0
      ? ((fixedExpenseByClass + semiFixedExpense) / regularIncome) * 100
      : 0;

  return {
    income,
    regularIncome,
    irregularIncome,
    regularBalance,
    simulatedRegularBalance,
    expense,
    balance,
    foodExpense,
    engel,
    savingRate,
    actualRent,
    effectiveVirtualRent,
    specialExpense,
    specialRate,
    recurringExpense,
    recurringBalance,
    simulatedRecurringBalance,
    groupTotals,
    simulatedExpense,
    simulatedBalance,
    simulatedEngel,
    simulatedSavingRate,
    fixedExpenseByClass,
    semiFixedExpense,
    variableExpense,
    fixedRateByClass,
    semiFixedRate,
    variableRate,
    livingCostRate,
  };
}

function addMonthsYm(ym: string, delta: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// 臨時収入の費目（賞与・持株・年金など）がある月か
function hasTempIncome(items: Txn[]) {
  const byCategory = new Map<string, number>();

  items
    .filter((x) => x.direction === "income" && isTempIncomeCategory(x))
    .forEach((x) => {
      const key = `${majorCategory(x)}/${minorCategory(x)}`;
      byCategory.set(key, (byCategory.get(key) ?? 0) + Number(x.amount || 0));
    });

  return Array.from(byCategory.values()).some((v) => v >= TEMP_INCOME_MIN);
}

type MonthRow = {
  month: string;
  count: number;
  partial: boolean;
  tempIncome: boolean;
  // 給料の入金がない（定期収入が極端に少ない）月。データ不足の可能性があるため平均から除く
  lowIncome: boolean;
  s: ReturnType<typeof summarizeMonth>;
};

function sumOf(rows: MonthRow[], pick: (r: MonthRow) => number) {
  return rows.reduce((a, r) => a + pick(r), 0);
}

function avgOf(rows: MonthRow[], pick: (r: MonthRow) => number) {
  return rows.length > 0 ? sumOf(rows, pick) / rows.length : 0;
}

// 期間（複数月）の集計：月別の表・期間合計・月平均・通常月の平均
function summarizePeriod(
  items: Txn[],
  startMonth: string,
  endMonth: string,
  virtualRent: number,
  currentMonth: string
) {
  const byMonth = new Map<string, Txn[]>();

  items.forEach((x) => {
    const m = x.txn_date.slice(0, 7);
    const list = byMonth.get(m);

    if (list) list.push(x);
    else byMonth.set(m, [x]);
  });

  const rows: MonthRow[] = [];

  for (let m = startMonth; m <= endMonth; m = addMonthsYm(m, 1)) {
    const its = byMonth.get(m) ?? [];

    rows.push({
      month: m,
      count: its.length,
      // 当月（と未来の月）は途中なので、平均から除く
      partial: m >= currentMonth,
      tempIncome: hasTempIncome(its),
      lowIncome: false,
      s: summarizeMonth(its, virtualRent),
    });
  }

  const active = rows.filter((r) => r.count > 0);
  const completeAll = active.filter((r) => !r.partial);

  // 定期収入が、完了した月の中央値の半分未満の月は「給料の入金がない月」とみなし、平均から除く
  const regularSorted = completeAll
    .map((r) => r.s.regularIncome)
    .sort((a, b) => a - b);

  const medianRegular =
    regularSorted.length === 0
      ? 0
      : regularSorted.length % 2 === 1
        ? regularSorted[(regularSorted.length - 1) / 2]
        : (regularSorted[regularSorted.length / 2 - 1] +
            regularSorted[regularSorted.length / 2]) /
          2;

  completeAll.forEach((r) => {
    r.lowIncome = medianRegular > 0 && r.s.regularIncome < medianRegular * 0.5;
  });

  const complete = completeAll.filter((r) => !r.lowIncome);
  // 通常月：給料の入金がある、完了した月すべて。
  // 臨時収入は定期収入の評価に含めないだけで、その月を除外はしない
  const normal = complete;

  const totals = {
    income: sumOf(active, (r) => r.s.income),
    regularIncome: sumOf(active, (r) => r.s.regularIncome),
    irregularIncome: sumOf(active, (r) => r.s.irregularIncome),
    expense: sumOf(active, (r) => r.s.expense),
    fixed: sumOf(active, (r) => r.s.fixedExpenseByClass),
    semi: sumOf(active, (r) => r.s.semiFixedExpense),
    variable: sumOf(active, (r) => r.s.variableExpense),
    special: sumOf(active, (r) => r.s.specialExpense),
    food: sumOf(active, (r) => r.s.foodExpense),
  };

  const monthlyAvg = {
    income: avgOf(complete, (r) => r.s.income),
    regularIncome: avgOf(complete, (r) => r.s.regularIncome),
    expense: avgOf(complete, (r) => r.s.expense),
    recurringExpense: avgOf(complete, (r) => r.s.recurringExpense),
    special: avgOf(complete, (r) => r.s.specialExpense),
  };

  const normalAvg = {
    // 定期収入の平均
    income: avgOf(normal, (r) => r.s.regularIncome),
    fixed: avgOf(normal, (r) => r.s.fixedExpenseByClass),
    semi: avgOf(normal, (r) => r.s.semiFixedExpense),
    variable: avgOf(normal, (r) => r.s.variableExpense),
    recurringExpense: avgOf(normal, (r) => r.s.recurringExpense),
    recurringBalance: avgOf(normal, (r) => r.s.recurringBalance),
    virtualRent: avgOf(normal, (r) => r.s.effectiveVirtualRent),
    simulatedRecurringBalance: avgOf(
      normal,
      (r) => r.s.simulatedRecurringBalance
    ),
  };

  // 特別費の月割り（完了した月の平均）と、それを含めた通常月の収支
  const specialPerMonth = monthlyAvg.special;
  const specialAnnual = specialPerMonth * 12;
  const normalAfterSpecial =
    normalAvg.simulatedRecurringBalance - specialPerMonth;

  const groupTotals = Object.fromEntries(
    Object.keys(DASHBOARD_GROUPS).map((key) => [
      key,
      sumOf(active, (r) => r.s.groupTotals?.[key] ?? 0),
    ])
  ) as Record<string, number>;

  const specialMap = new Map<string, number>();

  items
    .filter((x) => x.direction === "expense" && costClassOf(x) === "special")
    .forEach((x) => {
      const name = `${majorCategory(x)} / ${minorCategory(x)}`;
      specialMap.set(name, (specialMap.get(name) ?? 0) + Number(x.amount || 0));
    });

  const specialByCategory = Array.from(specialMap.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);

  // 定期収入が突出している月（給料に賞与・持株分配などが混ざっている可能性）
  const incomes = complete.map((r) => r.s.regularIncome).sort((a, b) => a - b);
  const median =
    incomes.length === 0
      ? 0
      : incomes.length % 2 === 1
        ? incomes[(incomes.length - 1) / 2]
        : (incomes[incomes.length / 2 - 1] + incomes[incomes.length / 2]) / 2;

  const suspicious = complete
    .filter((r) => median > 0 && r.s.regularIncome > median * 1.5)
    .map((r) => r.month);

  return {
    rows,
    activeCount: active.length,
    completeCount: complete.length,
    normalCount: normal.length,
    excludedTempMonths: complete.filter((r) => r.tempIncome).map((r) => r.month),
    partialMonths: active.filter((r) => r.partial).map((r) => r.month),
    lowIncomeMonths: completeAll.filter((r) => r.lowIncome).map((r) => r.month),
    totals,
    monthlyAvg,
    normalAvg,
    specialPerMonth,
    specialAnnual,
    normalAfterSpecial,
    groupTotals,
    specialByCategory,
    suspicious,
  };
}

type PeriodSummary = ReturnType<typeof summarizePeriod>;

function buildPeriodReport(
  p: PeriodSummary,
  startMonth: string,
  endMonth: string
) {
  const lines = p.rows
    .filter((r) => r.count > 0)
    .map(
      (r) =>
        `${r.month} | 定期収入 ${yen(r.s.regularIncome)} | 臨時収入 ${yen(r.s.irregularIncome)} | 固定費 ${yen(r.s.fixedExpenseByClass)} | 準固定費 ${yen(r.s.semiFixedExpense)} | 変動費 ${yen(r.s.variableExpense)} | 特別費 ${yen(r.s.specialExpense)} | 経常収支 ${yen(r.s.recurringBalance)} | 仮想家賃込みの経常収支 ${yen(r.s.simulatedRecurringBalance)}${
          r.tempIncome ? " | 臨時収入あり" : ""
        }${r.s.actualRent > 0 ? " | 実費の家賃あり" : ""}${
          r.partial ? " | 月の途中" : ""}${r.lowIncome ? " | 給料入金なし（平均から除外）" : ""
        }`
    )
    .join("\n");

  const special = p.specialByCategory
    .slice(0, 10)
    .map((x) => `${x.name}: ${yen(x.amount)}`)
    .join("\n");

  const groups = Object.entries(DASHBOARD_GROUPS)
    .map(([key, g]) => `${g.label}: ${yen(p.groupTotals[key] ?? 0)}`)
    .join("\n");

  return `
家計分析をお願いします。

【対象期間】
${startMonth} 〜 ${endMonth}（データのある${p.activeCount}か月。平均は完了した${p.completeCount}か月で計算${
    p.partialMonths.length > 0 ? `。途中の月（${p.partialMonths.join("、")}）は平均から除外` : ""
  }${
    p.lowIncomeMonths.length > 0 ? `。給料の入金がない月（${p.lowIncomeMonths.join("、")}）も平均から除外` : ""
  }）

【期間合計】
収入: ${yen(p.totals.income)}（定期収入 ${yen(p.totals.regularIncome)} / 臨時収入 ${yen(p.totals.irregularIncome)}）
支出: ${yen(p.totals.expense)}
収支: ${yen(p.totals.income - p.totals.expense)}
特別費: ${yen(p.totals.special)}

【月平均（完了した${p.completeCount}か月）】
収入: ${yen(p.monthlyAvg.income)}（うち定期収入 ${yen(p.monthlyAvg.regularIncome)}）
経常支出（特別費を除く）: ${yen(p.monthlyAvg.recurringExpense)}
特別費の月割り: ${yen(p.specialPerMonth)}（年換算 ${yen(p.specialAnnual)}）

【通常月の平均（給料の入金がある完了した${p.normalCount}か月。臨時収入は含めない）】
定期収入: ${yen(p.normalAvg.income)}
固定費: ${yen(p.normalAvg.fixed)}
準固定費: ${yen(p.normalAvg.semi)}
変動費: ${yen(p.normalAvg.variable)}
経常支出: ${yen(p.normalAvg.recurringExpense)}
経常収支: ${yen(p.normalAvg.recurringBalance)}
仮想家賃（平均）: ${yen(p.normalAvg.virtualRent)}
仮想家賃込みの経常収支: ${yen(p.normalAvg.simulatedRecurringBalance)}
特別費の月割りを含む通常月収支（仮想家賃込み）: ${yen(p.normalAfterSpecial)}

【月別】
${lines}

【特別費の内訳（期間合計）】
${special || "なし"}

【費目グループ別（期間合計）】
${groups}

【お願いしたい分析】
1. 支出が多い月・原因（月ごとの傾向）
2. 無駄遣いの可能性がある項目
3. 固定費・準固定費・変動費で見直す順番
4. 特別費の年間予算の立て方（月割り・積立）
5. 仮想家賃込みで通常月を黒字化するための改善案
6. 来月からできる具体的な対策
`.trim();
}

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [month, setMonth] = useState(thisMonth());
  const [items, setItems] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [virtualRent, setVirtualRent] = useState(120000);

  // 表示形式：単月 / 期間（初期値は、先月までの12か月）
  const [viewMode, setViewMode] = useState<"month" | "period">("month");
  const [endMonth, setEndMonth] = useState(() => addMonthsYm(thisMonth(), -1));
  const [startMonth, setStartMonth] = useState(() =>
    addMonthsYm(addMonthsYm(thisMonth(), -1), -11)
  );
  const [periodItems, setPeriodItems] = useState<Txn[]>([]);
  const [periodLoading, setPeriodLoading] = useState(false);

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

  async function load() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

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
      id,
      major_category,
      minor_category,
      category_kind
    )
  `)
      .eq("user_id", session.user.id)
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
    if (viewMode === "month") load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, viewMode]);

  useEffect(() => {
    if (viewMode === "period") loadPeriod();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startMonth, endMonth, viewMode]);

  const summary = useMemo(
    () => summarizeMonth(items, virtualRent),
    [items, virtualRent]
  );

  async function copyAiReport() {
    const report = `
家計分析をお願いします。

【対象月】
${month}

【実家計】
収入: ${yen(summary.income)}（定期収入 ${yen(summary.regularIncome)} / 臨時収入 ${yen(summary.irregularIncome)}）
支出: ${yen(summary.expense)}
収支: ${yen(summary.balance)}
貯蓄率（定期収入基準）: ${pct(summary.savingRate)}

【仮想家賃込み】
仮想家賃: ${yen(summary.effectiveVirtualRent)}${
      summary.actualRent > 0 ? "（実費の家賃があるため加算なし）" : ""
    }
仮想家賃込み支出: ${yen(summary.simulatedExpense)}
補正後収支: ${yen(summary.simulatedBalance)}
補正貯蓄率（定期収入基準）: ${pct(summary.simulatedSavingRate)}
補正エンゲル係数: ${pct(summary.simulatedEngel)}

【支出分類】
食費: ${yen(summary.foodExpense)}
固定費: ${yen(summary.fixedExpenseByClass)}
準固定費: ${yen(summary.semiFixedExpense)}
変動費: ${yen(summary.variableExpense)}
特別費: ${yen(summary.specialExpense)}
経常支出（特別費を除く）: ${yen(summary.recurringExpense)}
経常収支（特別費を除く）: ${yen(summary.recurringBalance)}
仮想家賃込みの経常収支: ${yen(summary.simulatedRecurringBalance)}
生活維持費率（定期収入基準）: ${pct(summary.livingCostRate)}

【お願いしたい分析】
1. 支出が多い原因
2. 無駄遣いの可能性がある項目
3. 固定費・準固定費・変動費で見直す順番
4. 仮想家賃込みで黒字化するための改善案
5. 来月からできる具体的な対策
`.trim();

    await navigator.clipboard.writeText(report);
    alert("AI分析用レポートをコピーしました。ChatGPTに貼り付けてください。");
  }

  async function loadPeriod() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    if (startMonth > endMonth) {
      setMessage("開始月は終了月以前にしてください");
      setPeriodItems([]);
      return;
    }

    if (addMonthsYm(startMonth, 60) <= endMonth) {
      setMessage("期間は最大60か月までです");
      setPeriodItems([]);
      return;
    }

    setPeriodLoading(true);
    setMessage("");

    const from = `${startMonth}-01`;
    const to = `${nextMonthYm(endMonth)}-01`;

    // 1回の取得は1000件までなので、1000件ずつ全件読む
    const all: Txn[] = [];

    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("transaction_records")
        .select(`
    id,
    txn_date,
    amount,
    direction,
    category_id,
    categories (
      id,
      major_category,
      minor_category,
      category_kind
    )
  `)
        .eq("user_id", session.user.id)
        .gte("txn_date", from)
        .lt("txn_date", to)
        .order("txn_date", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + 999);

      if (error) {
        setMessage(error.message);
        setPeriodItems([]);
        setPeriodLoading(false);
        return;
      }

      const rows = (data as unknown as Txn[]) ?? [];
      all.push(...rows);

      if (rows.length < 1000) break;
    }

    setPeriodItems(all);
    setPeriodLoading(false);
  }

  const periodSummary = useMemo(
    () =>
      viewMode === "period"
        ? summarizePeriod(periodItems, startMonth, endMonth, virtualRent, thisMonth())
        : null,
    [viewMode, periodItems, startMonth, endMonth, virtualRent]
  );

  async function copyPeriodAiReport() {
    if (!periodSummary) return;

    await navigator.clipboard.writeText(
      buildPeriodReport(periodSummary, startMonth, endMonth)
    );
    alert("期間のAI分析用レポートをコピーしました。ChatGPTに貼り付けてください。");
  }


  const engelTone =
    summary.engel <= 25 ? "good" : summary.engel <= 35 ? "warn" : "bad";

  const fixedTone =
    summary.fixedRateByClass <= 35
      ? "good"
      : summary.fixedRateByClass <= 50
        ? "warn"
        : "bad";

  const savingTone =
    summary.savingRate >= 20 ? "good" : summary.savingRate >= 0 ? "warn" : "bad";

  const simulatedSavingTone =
    summary.simulatedSavingRate >= 20
      ? "good"
      : summary.simulatedSavingRate >= 0
        ? "warn"
        : "bad";

  if (authLoading) {
    return <div style={{ minHeight: "100vh", background: "#111827", color: "#f9fafb", display: "flex", alignItems: "center", justifyContent: "center" }}>読込中...</div>;
  }

  if (!user) {
    return <div style={{ minHeight: "100vh", background: "#111827", color: "#f9fafb", display: "flex", alignItems: "center", justifyContent: "center" }}>ログインしてください</div>;
  }

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
          <div className="mb-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setViewMode("month")}
              className={`rounded-xl px-3 py-2 text-sm font-bold ${
                viewMode === "month" ? "bg-gray-800 text-white" : "bg-gray-200"
              }`}
            >
              単月
            </button>
            <button
              type="button"
              onClick={() => setViewMode("period")}
              className={`rounded-xl px-3 py-2 text-sm font-bold ${
                viewMode === "period" ? "bg-gray-800 text-white" : "bg-gray-200"
              }`}
            >
              期間
            </button>
          </div>

          {viewMode === "month" ? (
            <>
              <label className="text-sm font-bold">表示月</label>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="mt-2 w-full rounded-xl border px-3 py-2 text-lg"
              />
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-sm font-bold">開始月</label>
                  <input
                    type="month"
                    value={startMonth}
                    onChange={(e) => setStartMonth(e.target.value)}
                    className="mt-2 w-full rounded-xl border px-3 py-2 text-lg"
                  />
                </div>
                <div>
                  <label className="text-sm font-bold">終了月</label>
                  <input
                    type="month"
                    value={endMonth}
                    onChange={(e) => setEndMonth(e.target.value)}
                    className="mt-2 w-full rounded-xl border px-3 py-2 text-lg"
                  />
                </div>
              </div>
              <p className="mt-1 text-xs text-gray-600">
                初期値は先月までの12か月です。当月と、給料の入金がない月は、平均には含めません。
              </p>
            </>
          )}
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
            <p className="mt-1 text-xs text-gray-600">
              {viewMode === "period"
                ? "実費の家賃（住居費 / 家賃）がある月は、仮想家賃を加算しません。"
                : summary.actualRent > 0
                  ? `この月は実費の家賃（${yen(summary.actualRent)}）があるため、仮想家賃は加算しません。`
                  : "この月は実費の家賃がないため、仮想家賃を加算して試算します。"}
            </p>
          </div>
        </div>

        {message && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {message}
          </div>
        )}

        {viewMode === "period" ? (
          periodLoading || !periodSummary ? (
            <div className="rounded-2xl border bg-white p-6 text-center">
              読み込み中...
            </div>
          ) : (
            <>
              {periodSummary.lowIncomeMonths.length > 0 && (
                <div className="mb-4 rounded-xl border bg-gray-50 p-3 text-sm text-gray-700">
                  給料の入金がない（定期収入が極端に少ない）月は、データ不足の可能性があるため、平均から除外しています（
                  {periodSummary.lowIncomeMonths.join("、")}
                  ）。月別の表には表示されます。
                </div>
              )}

              {periodSummary.suspicious.length > 0 && (
                <div className="mb-4 rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
                  定期収入が突出している月があります（
                  {periodSummary.suspicious.join("、")}
                  ）。給料に賞与・持株分配などが混ざっていないか確認してください。このままだと、平均に混ざります。
                </div>
              )}

              <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Card
                  title="通常月の経常収支（平均）"
                  value={yen(periodSummary.normalAvg.recurringBalance)}
                  note={`給料の入金がある${periodSummary.normalCount}か月の平均。臨時収入は含めない。定期収入 ${yen(periodSummary.normalAvg.income)} − 経常支出 ${yen(periodSummary.normalAvg.recurringExpense)}`}
                  tone={periodSummary.normalAvg.recurringBalance >= 0 ? "good" : "bad"}
                />

                <Card
                  title="仮想家賃込みの経常収支（通常月）"
                  value={yen(periodSummary.normalAvg.simulatedRecurringBalance)}
                  note={`仮想家賃（平均）${yen(periodSummary.normalAvg.virtualRent)}。特別費は除く`}
                  tone={periodSummary.normalAvg.simulatedRecurringBalance >= 0 ? "good" : "bad"}
                />

                <Card
                  title="特別費の月割り"
                  value={yen(periodSummary.specialPerMonth)}
                  note={`年換算 ${yen(periodSummary.specialAnnual)} / 期間合計 ${yen(periodSummary.totals.special)}`}
                />

                <Card
                  title="特別費の月割りを含む通常月収支"
                  value={yen(periodSummary.normalAfterSpecial)}
                  note="仮想家賃込みの経常収支 − 特別費の月割り"
                  tone={periodSummary.normalAfterSpecial >= 0 ? "good" : "bad"}
                />

                <Card
                  title="期間の収入合計"
                  value={yen(periodSummary.totals.income)}
                  note={`定期 ${yen(periodSummary.totals.regularIncome)} / 臨時 ${yen(periodSummary.totals.irregularIncome)}`}
                />

                <Card
                  title="期間の支出合計"
                  value={yen(periodSummary.totals.expense)}
                  note={`月平均 ${yen(periodSummary.monthlyAvg.expense)}`}
                />

                <Card
                  title="期間の収支"
                  value={yen(periodSummary.totals.income - periodSummary.totals.expense)}
                  note="臨時収入・特別費を含む"
                  tone={periodSummary.totals.income - periodSummary.totals.expense >= 0 ? "good" : "bad"}
                />

                <Card
                  title="通常月の固定費・準固定費・変動費"
                  value={yen(periodSummary.normalAvg.recurringExpense)}
                  note={`固定費 ${yen(periodSummary.normalAvg.fixed)} / 準固定費 ${yen(periodSummary.normalAvg.semi)} / 変動費 ${yen(periodSummary.normalAvg.variable)}`}
                />
              </section>

              <section className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
                <h2 className="text-lg font-bold">月別の推移</h2>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-right text-sm">
                    <thead>
                      <tr className="border-b text-gray-600">
                        <th className="px-2 py-2 text-left">月</th>
                        <th className="px-2 py-2">定期収入</th>
                        <th className="px-2 py-2">臨時収入</th>
                        <th className="px-2 py-2">経常支出</th>
                        <th className="px-2 py-2">特別費</th>
                        <th className="px-2 py-2">経常収支</th>
                        <th className="px-2 py-2">仮想家賃込み</th>
                        <th className="px-2 py-2 text-left">備考</th>
                      </tr>
                    </thead>
                    <tbody>
                      {periodSummary.rows.map((r) => (
                        <tr
                          key={r.month}
                          className={`border-b ${r.count === 0 ? "text-gray-400" : ""}`}
                        >
                          <td className="px-2 py-2 text-left font-bold">{r.month}</td>
                          <td className="px-2 py-2">{yen(r.s.regularIncome)}</td>
                          <td className="px-2 py-2">{yen(r.s.irregularIncome)}</td>
                          <td className="px-2 py-2">{yen(r.s.recurringExpense)}</td>
                          <td className="px-2 py-2">{yen(r.s.specialExpense)}</td>
                          <td className="px-2 py-2">{yen(r.s.recurringBalance)}</td>
                          <td className="px-2 py-2">{yen(r.s.simulatedRecurringBalance)}</td>
                          <td className="px-2 py-2 text-left text-xs text-gray-600">
                            {[
                              r.count === 0 ? "データなし" : "",
                              r.tempIncome ? "臨時収入あり" : "",
                              r.lowIncome ? "給料入金なし（平均から除外）" : "",
                              r.s.actualRent > 0 ? "実費の家賃あり" : "",
                              r.partial && r.count > 0 ? "月の途中" : "",
                            ]
                              .filter(Boolean)
                              .join(" / ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
                <h2 className="text-lg font-bold">特別費の内訳（期間合計）</h2>
                <div className="mt-3 grid gap-2">
                  {periodSummary.specialByCategory.length === 0 && (
                    <div className="text-sm text-gray-600">特別費はありません。</div>
                  )}
                  {periodSummary.specialByCategory.map((x) => (
                    <div
                      key={x.name}
                      className="flex items-center justify-between rounded-xl border bg-gray-50 px-3 py-2"
                    >
                      <span className="font-bold">{x.name}</span>
                      <span>{yen(x.amount)}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
                <h2 className="text-lg font-bold">指標用グループ集計（期間合計）</h2>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {Object.entries(DASHBOARD_GROUPS).map(([key, group]) => (
                    <div
                      key={key}
                      className="flex items-center justify-between rounded-xl border bg-gray-50 px-3 py-2"
                    >
                      <span className="font-bold">{group.label}</span>
                      <span>{yen(periodSummary.groupTotals[key] ?? 0)}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
                <h2 className="text-lg font-bold">AI分析（期間）</h2>
                <p className="mt-1 text-sm text-gray-600">
                  月別の表・期間合計・通常月の平均をまとめて、ChatGPTへ貼り付けやすい形でコピーします。
                </p>
                <button
                  type="button"
                  onClick={copyPeriodAiReport}
                  className="mt-3 rounded-xl bg-gray-800 px-4 py-2 text-sm font-bold text-white"
                >
                  期間のAI分析用レポートをコピー
                </button>
              </section>
            </>
          )
        ) : loading ? (
          <div className="rounded-2xl border bg-white p-6 text-center">
            読み込み中...
          </div>
        ) : (
          <>
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Card
                title="今月の収入"
                value={yen(summary.income)}
                note="定期収入 + 臨時収入"
              />
              <Card
                title="定期収入"
                value={yen(summary.regularIncome)}
                note="給料・手当・給付。率の基準"
              />
              <Card
                title="臨時収入"
                value={yen(summary.irregularIncome)}
                note="賞与・持株・配当・年金・還付・利息など"
              />
              <Card title="今月の支出" value={yen(summary.expense)} />
              <Card
                title="今月の収支"
                value={yen(summary.balance)}
                tone={summary.balance >= 0 ? "good" : "bad"}
              />

              <Card
                title="固定費"
                value={yen(summary.fixedExpenseByClass)}
                note={`定期収入比 ${pct(summary.fixedRateByClass)}`}
              />

              <Card
                title="準固定費"
                value={yen(summary.semiFixedExpense)}
                note={`収入比 ${pct(summary.semiFixedRate)}`}
              />

              <Card
                title="変動費"
                value={yen(summary.variableExpense)}
                note={`収入比 ${pct(summary.variableRate)}`}
              />

              <Card
                title="特別費"
                value={yen(summary.specialExpense)}
                note={`年払い・単発など / 定期収入比 ${pct(summary.specialRate)}`}
              />

              <Card
                title="経常収支"
                value={yen(summary.recurringBalance)}
                note="定期収入 − (固定費 + 準固定費 + 変動費)。特別費を除く"
                tone={summary.recurringBalance >= 0 ? "good" : "bad"}
              />

              <Card
                title="仮想家賃込みの経常収支"
                value={yen(summary.simulatedRecurringBalance)}
                note="経常収支 − 仮想家賃。特別費を除く"
                tone={summary.simulatedRecurringBalance >= 0 ? "good" : "bad"}
              />

              <Card
                title="生活維持費率"
                value={pct(summary.livingCostRate)}
                note="固定費 + 準固定費 ÷ 定期収入"
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
                value={pct(summary.fixedRateByClass)}
                note={`固定費 ${yen(summary.fixedExpenseByClass)} ÷ 定期収入 ${yen(
                  summary.regularIncome
                )}`}
                tone={fixedTone}
              />

              <Card
                title="貯蓄率（定期収入基準）"
                value={pct(summary.savingRate)}
                note={`(定期収入 − 支出) ${yen(summary.regularBalance)} ÷ 定期収入 ${yen(
                  summary.regularIncome
                )}`}
                tone={savingTone}
              />
              <Card
                title="仮想家賃込み支出"
                value={yen(summary.simulatedExpense)}
                note={`実支出 ${yen(summary.expense)} + 仮想家賃 ${yen(summary.effectiveVirtualRent)}`}
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
                title="補正貯蓄率（定期収入基準）"
                value={pct(summary.simulatedSavingRate)}
                note={`(定期収入 − 仮想家賃込み支出) ${yen(summary.simulatedRegularBalance)} ÷ 定期収入 ${yen(
                  summary.regularIncome
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
              <h2 className="text-lg font-bold">AI分析</h2>
              <p className="mt-1 text-sm text-gray-600">
                今月の家計データをChatGPTへ貼り付けやすい形でコピーします。
              </p>

              <button
                onClick={copyAiReport}
                className="mt-3 w-full rounded-xl bg-gray-900 px-4 py-3 font-bold text-white"
              >
                AI分析用レポートをコピー
              </button>
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
                <div className="text-sm font-bold">固定費・準固定費・変動費・特別費</div>
                <p className="mt-1 text-sm text-gray-600">
                  費目マスタの「区分」で集計しています。費目の区分は、
                  管理項目の画面で変更できます。
                </p>
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