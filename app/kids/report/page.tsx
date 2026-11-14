"use client";

// kids 概算レポート（妻のみ閲覧）
// 配置先: app/kids/report/page.tsx
// 事前に kids_report_setup.sql を Supabase で実行し、妻のアカウントを閲覧者に追加してください。

import { useEffect, useMemo, useState } from "react";
import { createClient, User } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

type Wallet = { id: string; wallet_name: string; wallet_type: string | null };
type Cat = { minor_category: string; display_order: number | null; wallet_type: string | null };
type CatRef = { major_category: string; minor_category: string };
type Tx = {
  id: string;
  txn_date: string;
  amount: number;
  direction: string;
  wallet_id: string | null;
  merchant_name: string | null;
  description: string | null;
  categories: CatRef | CatRef[] | null;
};
type Rule = {
  id: string;
  wallet_id: string;
  keyword: string;
  match_type: "prefix" | "contains" | null; // prefix=メモの最初が一致 / contains=メモ・支払先に含む
  minor_category: string | null;
  item_name: string;
  display_order: number;
};
type Unmatched = { minor: string; memo: string; count: number; total: number };
type Valuation = {
  id: string;
  wallet_id: string;
  as_of_month: string;
  minor_category: string;
  item_name: string;
  quantity: number | null;
  unit_price: number | null;
  amount: number;
  display_order: number;
};
type ReportRow = {
  minor: string;
  item: string;
  income: number;
  expense: number;
  valued: boolean;
  order: number;
};
type TabKey = "table" | "rules" | "valuations";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px",
  borderRadius: 8,
  border: "1px solid #475569",
  background: "#1e293b",
  color: "#f8fafc",
  boxSizing: "border-box",
};
const buttonStyle: React.CSSProperties = {
  padding: "10px 14px",
  border: 0,
  borderRadius: 8,
  cursor: "pointer",
  background: "#2563eb",
  color: "white",
  fontWeight: 600,
};
const subButtonStyle: React.CSSProperties = { ...buttonStyle, background: "#475569" };
const dangerButtonStyle: React.CSSProperties = { ...buttonStyle, background: "#dc2626", padding: "6px 10px" };
const cardStyle: React.CSSProperties = {
  border: "1px solid #334155",
  borderRadius: 10,
  padding: 12,
  background: "#0f172a",
  marginBottom: 12,
};
const labelStyle: React.CSSProperties = { fontSize: 12, color: "#cbd5e1", marginBottom: 4 };

const yen = (n: number) => Math.round(n).toLocaleString("ja-JP");
const norm = (v: string | null | undefined) => (v || "").normalize("NFKC").toLowerCase().trim();
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const toNum = (v: string): number | null => {
  const s = v.replace(/,/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const isPrefixMark = (v: string) => v.trim().startsWith("^");
const catOf = (t: Tx): CatRef | null => (Array.isArray(t.categories) ? t.categories[0] ?? null : t.categories);

export default function KidsReportPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");

  // null=確認中 / true=閲覧可 / false=権限なし
  const [allowed, setAllowed] = useState<boolean | null>(null);
  // admin=管理者（ルール・評価額を変更できる） / viewer=閲覧者（変更できない）
  const [role, setRole] = useState<"admin" | "viewer">("viewer");
  const isAdmin = role === "admin";
  const [message, setMessage] = useState("");

  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [valuations, setValuations] = useState<Valuation[]>([]);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(false);

  const [walletId, setWalletId] = useState("");
  const [startDate, setStartDate] = useState(""); // 空 = 最初の取引から
  const [month, setMonth] = useState(today());
  const [tab, setTab] = useState<TabKey>("table");

  // 振り分けルールのフォーム
  const [ruleId, setRuleId] = useState("");
  const [ruleKeyword, setRuleKeyword] = useState("");
  const [ruleMatch, setRuleMatch] = useState<"prefix" | "contains">("prefix");
  const [bulkText, setBulkText] = useState("");
  const [ruleMinor, setRuleMinor] = useState("");
  const [ruleItem, setRuleItem] = useState("");
  const [ruleOrder, setRuleOrder] = useState("0");

  // 評価額のフォーム
  const [valId, setValId] = useState("");
  const [valMinor, setValMinor] = useState("");
  const [valItem, setValItem] = useState("");
  const [valQty, setValQty] = useState("");
  const [valPrice, setValPrice] = useState("");
  const [valAmount, setValAmount] = useState("");
  const [valOrder, setValOrder] = useState("0");

  // ---------------- 認証 ----------------
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  const login = async () => {
    setAuthMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthMessage("ログインできません: " + error.message);
  };

  // 閲覧者かどうか（kids_report_members に登録されたアカウントだけ表示）
  useEffect(() => {
    if (!user) {
      setAllowed(null);
      return;
    }
    const check = async () => {
      const { data, error } = await supabase
        .from("kids_report_members")
        .select("user_id, role")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) {
        setMessage("閲覧権限の確認に失敗しました: " + error.message);
        setAllowed(false);
        return;
      }
      setRole((data as { role?: string } | null)?.role === "admin" ? "admin" : "viewer");
      setAllowed(!!data);
    };
    void check();
  }, [user]);

  // ---------------- データ読込 ----------------
  const loadMasters = async () => {
    const [w, c, r, v] = await Promise.all([
      supabase.from("wallets").select("id, wallet_name, wallet_type").order("display_order"),
      supabase.from("categories").select("minor_category, display_order, wallet_type"),
      supabase.from("kids_report_rules").select("*").order("display_order").order("created_at"),
      supabase.from("kids_report_valuations").select("*").order("display_order").order("created_at"),
    ]);
    const err = w.error || c.error || r.error || v.error;
    if (err) {
      setMessage("読込エラー: " + err.message);
      return;
    }
    const ws = ((w.data as Wallet[]) || []).filter(
      (x) => (x.wallet_type || "").toLowerCase() !== "household"
    );
    setWallets(ws);
    setCats((c.data as Cat[]) || []);
    setRules((r.data as Rule[]) || []);
    setValuations((v.data as Valuation[]) || []);
    setWalletId((cur) => cur || ws[0]?.id || "");
  };

  useEffect(() => {
    if (allowed) void loadMasters();
  }, [allowed]);

  useEffect(() => {
    if (!allowed || !walletId) return;
    const loadTxs = async () => {
      setLoading(true);
      const all: Tx[] = [];
      let offset = 0;
      for (;;) {
        const { data, error } = await supabase
          .from("transaction_records")
          .select(
            `id, txn_date, amount, direction, wallet_id, merchant_name, description,
             categories:category_id ( major_category, minor_category )`
          )
          .eq("wallet_id", walletId)
          .order("txn_date", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + 999);
        if (error) {
          setMessage("取引の読込エラー: " + error.message);
          break;
        }
        const rows = ((data as unknown as Tx[]) || []);
        all.push(...rows);
        if (rows.length < 1000) break;
        offset += 1000;
      }
      setTxs(all);
      setLoading(false);
    };
    void loadTxs();
  }, [allowed, walletId]);

  // ---------------- 集計 ----------------
  const walletRules = useMemo(
    () =>
      rules
        .filter((r) => r.wallet_id === walletId)
        .sort((a, b) => a.display_order - b.display_order),
    [rules, walletId]
  );

  const monthValuations = useMemo(
    () => valuations.filter((v) => v.wallet_id === walletId && v.as_of_month === month),
    [valuations, walletId, month]
  );

  // 中分類の並び順（項目管理の表示順）
  const catOrder = useMemo(() => {
    const m = new Map<string, number>();
    cats.forEach((c) => {
      const o = c.display_order ?? 9999;
      const cur = m.get(c.minor_category);
      if (cur === undefined || o < cur) m.set(c.minor_category, o);
    });
    return m;
  }, [cats]);

  const minorOptions = useMemo(() => {
    const set = new Set<string>();
    txs.forEach((t) => {
      const m = catOf(t)?.minor_category;
      if (m) set.add(m);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ja"));
  }, [txs]);

  const firstTxDate = txs.length > 0 ? txs[0].txn_date : "";
  const effectiveStart = startDate || firstTxDate;
  const endDate = `${month}-31`;

  const report = useMemo(() => {
    const map = new Map<string, ReportRow>();
    const unmatchedMap = new Map<string, Unmatched>();
    const get = (minor: string, item: string, order: number) => {
      const key = `${minor}\u0000${item}`;
      let row = map.get(key);
      if (!row) {
        row = { minor, item, income: 0, expense: 0, valued: false, order };
        map.set(key, row);
      } else if (order < row.order) {
        row.order = order;
      }
      return row;
    };

    txs.forEach((t) => {
      if (t.direction !== "income" && t.direction !== "expense") return;
      if (effectiveStart && t.txn_date < effectiveStart) return;
      if (t.txn_date > endDate) return;

      const minor = catOf(t)?.minor_category || "(中分類なし)";
      const memo = norm(t.description);
      const text = norm([t.description, t.merchant_name].join(" "));

      // 振り分けルール：表示順の若いものから、最初に当てはまったものを使う
      //  前方一致（prefix）…メモの最初がキーワードと一致（例: 保有_JP_）
      //  部分一致（contains）…メモまたは支払先にキーワードを含む
      const rule = walletRules.find((r) => {
        if (r.minor_category && r.minor_category !== minor) return false;
        const k = norm(r.keyword);
        if (k === "") return false;
        return r.match_type === "prefix" ? memo.startsWith(k) : text.includes(k);
      });

      // ルールに当てはまらなかった取引のメモを集めておく（ルール追加の手がかり）
      if (!rule) {
        const rawMemo = (t.description || "").trim();
        if (rawMemo) {
          const uk = `${minor}\u0000${rawMemo}`;
          const u = unmatchedMap.get(uk) || { minor, memo: rawMemo, count: 0, total: 0 };
          u.count += 1;
          u.total += Number(t.amount || 0);
          unmatchedMap.set(uk, u);
        }
      }

      const item = rule ? rule.item_name : minor;
      const order = rule ? rule.display_order : 1000 + (catOrder.get(minor) ?? 9999);
      const row = get(minor, item, order);
      const amount = Number(t.amount || 0);
      if (t.direction === "income") row.income += amount;
      else row.expense += amount;
    });

    // 評価額（塗潰しセル）は収入側に加える
    monthValuations.forEach((v) => {
      const row = get(v.minor_category, v.item_name, v.display_order);
      row.income += Number(v.amount || 0);
      row.valued = true;
    });

    const rows = Array.from(map.values()).sort(
      (a, b) =>
        a.order - b.order ||
        a.minor.localeCompare(b.minor, "ja") ||
        a.item.localeCompare(b.item, "ja")
    );
    const incomeTotal = rows.reduce((s, r) => s + r.income, 0);
    const expenseTotal = rows.reduce((s, r) => s + r.expense, 0);
    const unmatched = Array.from(unmatchedMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 30);
    return { rows, incomeTotal, expenseTotal, balance: incomeTotal - expenseTotal, unmatched };
  }, [txs, walletRules, monthValuations, catOrder, effectiveStart, endDate]);

  // ---------------- ルールの登録・編集 ----------------
  const resetRuleForm = () => {
    setRuleId("");
    setRuleKeyword("");
    setRuleMatch("prefix");
    setRuleMinor("");
    setRuleItem("");
    setRuleOrder("0");
  };

  const saveRule = async () => {
    setMessage("");
    if (!walletId || !isAdmin) return;
    if (!ruleKeyword.trim() || !ruleItem.trim()) {
      setMessage("語と項目名を入力してください");
      return;
    }
    const payload = {
      wallet_id: walletId,
      keyword: ruleKeyword.trim(),
      match_type: ruleMatch,
      minor_category: ruleMinor || null,
      item_name: ruleItem.trim(),
      display_order: toNum(ruleOrder) ?? 0,
    };
    const { error } = ruleId
      ? await supabase.from("kids_report_rules").update(payload).eq("id", ruleId)
      : await supabase.from("kids_report_rules").insert(payload);
    if (error) {
      setMessage("ルールの保存エラー: " + error.message);
      return;
    }
    resetRuleForm();
    await loadMasters();
  };

  const editRule = (r: Rule) => {
    setRuleId(r.id);
    setRuleKeyword(r.keyword);
    setRuleMatch(r.match_type === "prefix" ? "prefix" : "contains");
    setRuleMinor(r.minor_category || "");
    setRuleItem(r.item_name);
    setRuleOrder(String(r.display_order));
  };

  // 「ルールにする」：当てはまらなかったメモを、ルールの入力欄に入れる
  const prefillRule = (u: Unmatched) => {
    setRuleId("");
    setRuleKeyword(u.memo);
    setRuleMatch("prefix");
    setRuleMinor(u.minor);
    setRuleItem("");
    setRuleOrder("0");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // まとめて追加：1行に「キーワード,項目名[,中分類]」。キーワードの先頭に ^ を付けると「メモの最初が一致」
  const addBulkRules = async () => {
    setMessage("");
    if (!walletId || !isAdmin) return;
    const baseOrder =
      walletRules.reduce((m, r) => Math.max(m, r.display_order), 0) + 10;
    const rows: {
      wallet_id: string;
      keyword: string;
      match_type: "prefix" | "contains";
      minor_category: string | null;
      item_name: string;
      display_order: number;
    }[] = [];
    const bad: string[] = [];

    bulkText.split(/\r?\n/).forEach((line) => {
      const l = line.trim();
      if (!l) return;
      const parts = l.split(/\s*[,，\t]\s*/);
      const kw = (parts[0] || "").replace(/^\s*\^/, "").trim();
      const item = (parts[1] || "").trim();
      if (!kw || !item) {
        bad.push(l);
        return;
      }
      rows.push({
        wallet_id: walletId,
        keyword: kw,
        match_type: isPrefixMark(parts[0] || "") ? "prefix" : "contains",
        minor_category: (parts[2] || "").trim() || null,
        item_name: item,
        display_order: baseOrder + rows.length * 10,
      });
    });

    if (bad.length > 0) {
      setMessage(`形式が正しくない行があります（キーワードと項目名が必要）: ${bad.join(" / ")}`);
      return;
    }
    if (rows.length === 0) {
      setMessage("追加する行がありません");
      return;
    }
    const { error } = await supabase.from("kids_report_rules").insert(rows);
    if (error) {
      setMessage("まとめ追加のエラー: " + error.message);
      return;
    }
    setBulkText("");
    setMessage(`${rows.length}件のルールを追加しました`);
    await loadMasters();
  };

  const deleteRule = async (id: string) => {
    if (!isAdmin) return;
    if (!confirm("このルールを削除しますか？")) return;
    const { error } = await supabase.from("kids_report_rules").delete().eq("id", id);
    if (error) {
      setMessage("削除エラー: " + error.message);
      return;
    }
    if (ruleId === id) resetRuleForm();
    await loadMasters();
  };

  // ---------------- 評価額の登録・編集 ----------------
  const resetValForm = () => {
    setValId("");
    setValMinor("");
    setValItem("");
    setValQty("");
    setValPrice("");
    setValAmount("");
    setValOrder("0");
  };

  const qtyNum = toNum(valQty);
  const priceNum = toNum(valPrice);
  const autoAmount = qtyNum !== null && priceNum !== null ? Math.round(qtyNum * priceNum) : null;

  const saveValuation = async () => {
    setMessage("");
    if (!walletId || !isAdmin) return;
    const amount = autoAmount !== null ? autoAmount : toNum(valAmount);
    if (!valMinor.trim() || !valItem.trim() || amount === null) {
      setMessage("中分類・項目名と、（数量×参考売価 または 評価額）を入力してください");
      return;
    }
    const payload = {
      wallet_id: walletId,
      as_of_month: month,
      minor_category: valMinor.trim(),
      item_name: valItem.trim(),
      quantity: qtyNum,
      unit_price: priceNum,
      amount,
      display_order: toNum(valOrder) ?? 0,
    };
    const { error } = valId
      ? await supabase.from("kids_report_valuations").update(payload).eq("id", valId)
      : await supabase.from("kids_report_valuations").insert(payload);
    if (error) {
      setMessage("評価額の保存エラー: " + error.message);
      return;
    }
    resetValForm();
    await loadMasters();
  };

  const editVal = (v: Valuation) => {
    setValId(v.id);
    setValMinor(v.minor_category);
    setValItem(v.item_name);
    setValQty(v.quantity === null ? "" : String(v.quantity));
    setValPrice(v.unit_price === null ? "" : String(v.unit_price));
    setValAmount(String(v.amount));
    setValOrder(String(v.display_order));
  };

  const deleteVal = async (id: string) => {
    if (!isAdmin) return;
    if (!confirm("この評価額を削除しますか？")) return;
    const { error } = await supabase.from("kids_report_valuations").delete().eq("id", id);
    if (error) {
      setMessage("削除エラー: " + error.message);
      return;
    }
    if (valId === id) resetValForm();
    await loadMasters();
  };

  // 選択中の月より前で、いちばん新しい月の評価額を、選択中の月にコピーする
  const copyPrevValuations = async () => {
    setMessage("");
    if (!isAdmin) return;
    const prevMonths = Array.from(
      new Set(
        valuations
          .filter((v) => v.wallet_id === walletId && v.as_of_month < month)
          .map((v) => v.as_of_month)
      )
    ).sort();
    const prev = prevMonths[prevMonths.length - 1];
    if (!prev) {
      setMessage("コピーできる前月以前の評価額がありません");
      return;
    }
    if (monthValuations.length > 0 && !confirm(`${month} には登録済みの評価額があります。さらに ${prev} の分を追加しますか？`)) {
      return;
    }
    const rows = valuations
      .filter((v) => v.wallet_id === walletId && v.as_of_month === prev)
      .map((v) => ({
        wallet_id: v.wallet_id,
        as_of_month: month,
        minor_category: v.minor_category,
        item_name: v.item_name,
        quantity: v.quantity,
        unit_price: v.unit_price,
        amount: v.amount,
        display_order: v.display_order,
      }));
    const { error } = await supabase.from("kids_report_valuations").insert(rows);
    if (error) {
      setMessage("コピーエラー: " + error.message);
      return;
    }
    setMessage(`${prev} の評価額を ${month} にコピーしました。数量・参考売価を更新してください`);
    await loadMasters();
  };

  // ---------------- 画面 ----------------
  const pageStyle: React.CSSProperties = {
    maxWidth: 900,
    margin: "0 auto",
    padding: 16,
    minHeight: "100vh",
    background: "#020617",
    color: "#f8fafc",
  };

  if (authLoading) return <div style={pageStyle}>読込中...</div>;

  if (!user) {
    return (
      <div style={pageStyle}>
        <h1 style={{ fontSize: 22 }}>kids 概算レポート</h1>
        <div style={{ ...cardStyle, display: "grid", gap: 8 }}>
          <div>
            <div style={labelStyle}>メールアドレス</div>
            <input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <div style={labelStyle}>パスワード</div>
            <input
              style={inputStyle}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button style={buttonStyle} onClick={login}>
            ログイン
          </button>
          {authMessage && <div>{authMessage}</div>}
        </div>
      </div>
    );
  }

  if (allowed === null) return <div style={pageStyle}>権限を確認中...</div>;

  if (!allowed) {
    return (
      <div style={pageStyle}>
        <h1 style={{ fontSize: 22 }}>kids 概算レポート</h1>
        <div style={cardStyle}>このアカウントには、このページを表示する権限がありません。</div>
        {message && <div>{message}</div>}
        <button style={subButtonStyle} onClick={() => supabase.auth.signOut()}>
          ログアウト
        </button>
      </div>
    );
  }

  const wallet = wallets.find((w) => w.id === walletId);
  const titleMonth = `${month.slice(0, 4)}年${Number(month.slice(5))}月`;

  const tabButton = (key: TabKey, label: string) => (
    <button
      key={key}
      onClick={() => setTab(key)}
      style={{ ...buttonStyle, background: tab === key ? "#2563eb" : "#334155", flex: 1 }}
    >
      {label}
    </button>
  );

  const slash: React.CSSProperties = {
    background:
      "linear-gradient(to top right, transparent calc(50% - 1px), #64748b 50%, transparent calc(50% + 1px))",
  };
  const thStyle: React.CSSProperties = {
    border: "1px solid #475569",
    padding: "6px 8px",
    background: "#1e293b",
    whiteSpace: "nowrap",
  };
  const tdStyle: React.CSSProperties = { border: "1px solid #475569", padding: "6px 8px" };

  return (
    <div style={pageStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <h1 style={{ fontSize: 22, margin: "0 0 12px" }}>
          kids 概算レポート
          <span style={{ fontSize: 12, color: "#94a3b8", marginLeft: 8 }}>
            {isAdmin ? "管理者" : "閲覧のみ"}
          </span>
        </h1>
        <div style={{ display: "flex", gap: 8 }}>
          <a href="/kids" style={{ ...subButtonStyle, textDecoration: "none", display: "inline-block" }}>
            kidsへ
          </a>
          <button style={subButtonStyle} onClick={() => supabase.auth.signOut()}>
            ログアウト
          </button>
        </div>
      </div>

      <div style={{ ...cardStyle, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <div>
          <div style={labelStyle}>財布</div>
          <select style={inputStyle} value={walletId} onChange={(e) => setWalletId(e.target.value)}>
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.wallet_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div style={labelStyle}>集計の開始日（空欄＝最初の取引から）</div>
          <input style={inputStyle} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <div style={labelStyle}>対象月（月末までの累計）</div>
          <input style={inputStyle} type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {tabButton("table", "表")}
        {tabButton("rules", "振り分けルール")}
        {tabButton("valuations", "評価額（概算）")}
      </div>

      {message && <div style={{ ...cardStyle, color: "#fde68a" }}>{message}</div>}
      {loading && <div style={{ marginBottom: 8 }}>取引を読込中...</div>}

      {/* ========== 表 ========== */}
      {tab === "table" && (
        <div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", minWidth: 560, width: "100%", fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={thStyle} colSpan={2}>
                    {titleMonth}（{wallet?.wallet_name ?? ""}）
                  </th>
                  <th style={thStyle}>概算残高</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{yen(report.balance)}</th>
                </tr>
                <tr>
                  <th style={thStyle}>中分類</th>
                  <th style={thStyle}>項目</th>
                  <th style={thStyle}>収入</th>
                  <th style={thStyle}>支出</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={`${r.minor}\u0000${r.item}`}>
                    <td style={tdStyle}>{r.minor}</td>
                    <td style={tdStyle}>{r.item}</td>
                    <td
                      style={{
                        ...tdStyle,
                        textAlign: "right",
                        ...(r.valued ? { background: "#475569" } : r.income === 0 ? slash : {}),
                      }}
                    >
                      {r.income !== 0 ? yen(r.income) : ""}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", ...(r.expense === 0 ? slash : {}) }}>
                      {r.expense !== 0 ? yen(r.expense) : ""}
                    </td>
                  </tr>
                ))}
                <tr style={{ fontWeight: "bold" }}>
                  <td style={tdStyle} colSpan={2}>
                    合計
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{yen(report.incomeTotal)}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{yen(report.expenseTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>
            {effectiveStart ? `${effectiveStart} から ` : ""}
            {month} の月末までの累計です。灰色のセルは評価額（残量×参考売価）の概算で、実際の取引ではありません。
            概算残高 ＝ 収入合計 − 支出合計。資金移動は含みません。
          </div>
        </div>
      )}

      {/* ========== 振り分けルール ========== */}
      {tab === "rules" && (
        <div>
          {!isAdmin && (
            <div style={{ ...cardStyle, color: "#fde68a" }}>
              閲覧のみです。ルールの追加・変更は管理者だけができます。
            </div>
          )}

          {isAdmin && (
            <>
              <div style={{ ...cardStyle, display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 600 }}>{ruleId ? "ルールを編集" : "ルールを追加"}</div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>
                  メモ（または支払先）がキーワードに当てはまる取引を、指定した「項目名」にまとめます。
                  表示順の小さいルールから順に判定し、最初に当てはまったものを使います。どれにも当てはまらない取引は、中分類名がそのまま項目名になります。
                </div>
                <div>
                  <div style={labelStyle}>キーワード</div>
                  <input style={inputStyle} value={ruleKeyword} onChange={(e) => setRuleKeyword(e.target.value)} placeholder="例: 保有_JP_" />
                </div>
                <div>
                  <div style={labelStyle}>一致のしかた</div>
                  <select
                    style={inputStyle}
                    value={ruleMatch}
                    onChange={(e) => setRuleMatch(e.target.value as "prefix" | "contains")}
                  >
                    <option value="prefix">メモの最初が一致（例: 保有_JP_）</option>
                    <option value="contains">メモ・支払先に含む</option>
                  </select>
                </div>
                <div>
                  <div style={labelStyle}>中分類で限定（任意）</div>
                  <select style={inputStyle} value={ruleMinor} onChange={(e) => setRuleMinor(e.target.value)}>
                    <option value="">限定しない</option>
                    {minorOptions.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={labelStyle}>項目名</div>
                  <input style={inputStyle} value={ruleItem} onChange={(e) => setRuleItem(e.target.value)} placeholder="例: 楽天証券_国内保有" />
                </div>
                <div>
                  <div style={labelStyle}>表示順（小さいほど上）</div>
                  <input style={inputStyle} inputMode="numeric" value={ruleOrder} onChange={(e) => setRuleOrder(e.target.value)} />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={buttonStyle} onClick={saveRule}>
                    {ruleId ? "更新" : "追加"}
                  </button>
                  {ruleId && (
                    <button style={subButtonStyle} onClick={resetRuleForm}>
                      編集をやめる
                    </button>
                  )}
                </div>
              </div>

              <div style={{ ...cardStyle, display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 600 }}>まとめて追加</div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>
                  1行に「キーワード,項目名」または「キーワード,項目名,中分類」を書きます。キーワードの先頭に ^ を付けると「メモの最初が一致」、付けないと「メモ・支払先に含む」になります。行の順に表示順が付きます。
                </div>
                <textarea
                  style={{ ...inputStyle, minHeight: 110, fontFamily: "inherit" }}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={"^保有_JP_,楽天証券_国内保有,購入金\n^保有_ASE_,楽天証券_ASEAN保有,購入金"}
                />
                <div>
                  <button style={buttonStyle} onClick={addBulkRules}>
                    まとめて追加
                  </button>
                </div>
              </div>
            </>
          )}

          <div style={{ fontWeight: 600, margin: "8px 0" }}>登録済みのルール</div>
          {walletRules.length === 0 && <div>この財布のルールはまだありません。</div>}
          {walletRules.map((r) => (
            <div key={r.id} style={{ ...cardStyle, display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <div style={{ fontSize: 14 }}>
                <div>
                  {r.match_type === "prefix" ? "メモの最初が" : "メモ・支払先に"}「{r.keyword}」
                  {r.match_type === "prefix" ? "" : "を含む"}
                  {r.minor_category ? `（${r.minor_category}のみ）` : ""} → <b>{r.item_name}</b>
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>表示順 {r.display_order}</div>
              </div>
              {isAdmin && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button style={{ ...subButtonStyle, padding: "6px 10px" }} onClick={() => editRule(r)}>
                    編集
                  </button>
                  <button style={dangerButtonStyle} onClick={() => deleteRule(r.id)}>
                    削除
                  </button>
                </div>
              )}
            </div>
          ))}

          {isAdmin && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                ルールに当てはまらなかった取引のメモ（金額の大きい順・上位30）
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>
                項目名が中分類のままになっている取引のメモです。「ルールにする」で上の入力欄に入ります。新しい項目が増えたときは、ここから追加できます。
              </div>
              {report.unmatched.length === 0 && <div>該当する取引はありません。</div>}
              {report.unmatched.map((u) => (
                <div key={`${u.minor}\u0000${u.memo}`} style={{ ...cardStyle, display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", padding: 8 }}>
                  <div style={{ fontSize: 13, overflowWrap: "anywhere" }}>
                    <div>{u.memo}</div>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>
                      {u.minor}　{u.count}件　{yen(u.total)}円
                    </div>
                  </div>
                  <button style={{ ...subButtonStyle, padding: "6px 10px", whiteSpace: "nowrap" }} onClick={() => prefillRule(u)}>
                    ルールにする
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========== 評価額 ========== */}
      {tab === "valuations" && (
        <div>
          {!isAdmin && (
            <div style={{ ...cardStyle, color: "#fde68a" }}>
              閲覧のみです。評価額の追加・変更は管理者だけができます。
            </div>
          )}
          {isAdmin && (<div style={{ ...cardStyle, display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 600 }}>
              {titleMonth}の評価額を{valId ? "編集" : "追加"}
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>
              残量・残数に参考売価を掛けた概算を入れます。数量と参考売価を入れると評価額は自動計算され、どちらかを空にすると評価額を直接入力できます。中分類・項目名が表の行と同じなら、その行の収入欄（灰色）に入ります。
            </div>
            <div>
              <div style={labelStyle}>中分類</div>
              <input style={inputStyle} list="minor-list" value={valMinor} onChange={(e) => setValMinor(e.target.value)} placeholder="例: 購入金" />
              <datalist id="minor-list">
                {minorOptions.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
            <div>
              <div style={labelStyle}>項目名</div>
              <input style={inputStyle} value={valItem} onChange={(e) => setValItem(e.target.value)} placeholder="例: 楽天証券_国内保有" />
            </div>
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
              <div>
                <div style={labelStyle}>数量（残量・残数）</div>
                <input style={inputStyle} inputMode="decimal" value={valQty} onChange={(e) => setValQty(e.target.value)} />
              </div>
              <div>
                <div style={labelStyle}>参考売価</div>
                <input style={inputStyle} inputMode="decimal" value={valPrice} onChange={(e) => setValPrice(e.target.value)} />
              </div>
            </div>
            <div>
              <div style={labelStyle}>評価額（数量×参考売価が入っていれば自動）</div>
              <input
                style={inputStyle}
                inputMode="numeric"
                value={autoAmount !== null ? String(autoAmount) : valAmount}
                disabled={autoAmount !== null}
                onChange={(e) => setValAmount(e.target.value)}
              />
            </div>
            <div>
              <div style={labelStyle}>表示順（小さいほど上）</div>
              <input style={inputStyle} inputMode="numeric" value={valOrder} onChange={(e) => setValOrder(e.target.value)} />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={buttonStyle} onClick={saveValuation}>
                {valId ? "更新" : "追加"}
              </button>
              {valId && (
                <button style={subButtonStyle} onClick={resetValForm}>
                  編集をやめる
                </button>
              )}
              <button style={subButtonStyle} onClick={copyPrevValuations}>
                前回の評価額をコピー
              </button>
            </div>
          </div>)}

          {monthValuations.length === 0 && <div>{titleMonth}の評価額はまだありません。</div>}
          {monthValuations.map((v) => (
            <div key={v.id} style={{ ...cardStyle, display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <div style={{ fontSize: 14 }}>
                <div>
                  {v.minor_category} / <b>{v.item_name}</b>
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>
                  {v.quantity !== null && v.unit_price !== null
                    ? `${v.quantity.toLocaleString()} × ${v.unit_price.toLocaleString()} = `
                    : ""}
                  {yen(v.amount)}円　表示順 {v.display_order}
                </div>
              </div>
              {isAdmin && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button style={{ ...subButtonStyle, padding: "6px 10px" }} onClick={() => editVal(v)}>
                    編集
                  </button>
                  <button style={dangerButtonStyle} onClick={() => deleteVal(v.id)}>
                    削除
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
