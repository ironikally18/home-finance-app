"use client";

// かのん用キーワードの過去分一括設定（管理項目に表示）
// 配置先: page.tsx（メイン画面）と同じフォルダ。ReceiptScreen.tsx と同じ置き方です。
//
// 流れ: 条件で絞り込み → 一覧とプレビューを確認 → 一括更新
// 更新内容: 該当する取引のメモの先頭に、選んだキーワードを付ける（財布は家計共通のまま）。
// 対象: 家計共通の財布（財布なし含む）の取引だけ。子供財布の取引は対象外。

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type WalletRow = { id: string; wallet_name: string; wallet_type: string | null };
type CategoryRow = {
  id: string;
  wallet_type: string | null;
  major_category: string;
  minor_category: string;
  category_kind: string;
  display_order: number;
};
type CatRef = { major_category: string; minor_category: string };
type Hit = {
  id: string;
  txn_date: string;
  amount: number;
  direction: string;
  merchant_name: string | null;
  description: string | null;
  categories: CatRef | CatRef[] | null;
};
type Undo = { id: string; description: string | null }[];

const MAX_HITS = 1000;

const boxStyle: React.CSSProperties = { border: "1px solid #ddd", borderRadius: "8px", padding: "12px" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "8px", boxSizing: "border-box" };
const labelStyle: React.CSSProperties = { fontSize: "12px", color: "#666", marginBottom: "4px" };
const btnStyle: React.CSSProperties = {
  padding: "10px 14px",
  border: "none",
  borderRadius: "8px",
  background: "#111827",
  color: "#fff",
  cursor: "pointer",
};
const subBtnStyle: React.CSSProperties = { ...btnStyle, background: "#6b7280" };

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => "\\" + m);
const catOf = (t: Hit): CatRef | null => (Array.isArray(t.categories) ? t.categories[0] ?? null : t.categories);
const yen = (n: number) => Math.round(n).toLocaleString("ja-JP");

export default function KidsKeywordBulk({
  supabase,
  wallets,
  categories,
  onChanged,
}: {
  supabase: SupabaseClient;
  wallets: WalletRow[];
  categories: CategoryRow[];
  onChanged?: () => void;
}) {
  // 子供財布のID（これらは対象外にする）
  const childWalletIds = useMemo(
    () => wallets.filter((w) => (w.wallet_type || "").toLowerCase() !== "household").map((w) => w.id),
    [wallets]
  );

  // 登録済みキーワード（概算レポートの「家計共通」ルール）。権限がなければ空のまま、手入力で使える
  const [savedKeywords, setSavedKeywords] = useState<string[]>([]);
  const [keywordSel, setKeywordSel] = useState("");
  const [keywordInput, setKeywordInput] = useState("");

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [major, setMajor] = useState("");
  const [minor, setMinor] = useState("");
  const [direction, setDirection] = useState<"expense" | "income" | "all">("expense");
  const [memoWord, setMemoWord] = useState("");
  const [merchantWord, setMerchantWord] = useState("");

  const [hits, setHits] = useState<Hit[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [undo, setUndo] = useState<Undo | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("kids_report_rules")
        .select("keyword, source")
        .eq("source", "household");
      const list = Array.from(
        new Set(((data as { keyword: string }[] | null) || []).map((r) => r.keyword.trim()).filter(Boolean))
      );
      setSavedKeywords(list);
    };
    void load();
  }, [supabase]);

  const keyword = (keywordInput || keywordSel).trim();

  // 大分類・中分類の選択肢（家計の費目）
  const majors = useMemo(() => {
    const set = new Set<string>();
    categories.forEach((c) => {
      if ((c.wallet_type || "household").toLowerCase() === "household") set.add(c.major_category);
    });
    return Array.from(set);
  }, [categories]);
  const minors = useMemo(() => {
    const set = new Set<string>();
    categories.forEach((c) => {
      if ((c.wallet_type || "household").toLowerCase() !== "household") return;
      if (major && c.major_category !== major) return;
      set.add(c.minor_category);
    });
    return Array.from(set);
  }, [categories, major]);

  const search = async () => {
    setMessage("");
    setHits(null);
    setChecked(new Set());
    if (!keyword) {
      setMessage("付けるキーワードを選ぶか入力してください");
      return;
    }
    const hasCondition = from || to || major || minor || memoWord.trim() || merchantWord.trim();
    if (!hasCondition) {
      setMessage("絞り込みの条件を1つ以上指定してください（全件更新の事故を防ぐため）");
      return;
    }
    setBusy(true);

    let categoryIds: string[] | null = null;
    if (major || minor) {
      categoryIds = categories
        .filter(
          (c) =>
            (c.wallet_type || "household").toLowerCase() === "household" &&
            (!major || c.major_category === major) &&
            (!minor || c.minor_category === minor)
        )
        .map((c) => c.id);
      if (categoryIds.length === 0) {
        setBusy(false);
        setHits([]);
        return;
      }
    }

    const all: Hit[] = [];
    let offset = 0;
    for (;;) {
      let q = supabase
        .from("transaction_records")
        .select(
          `id, txn_date, amount, direction, merchant_name, description,
           categories:category_id ( major_category, minor_category )`
        )
        .order("txn_date", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + 999);

      if (childWalletIds.length > 0) {
        q = q.or(`wallet_id.is.null,wallet_id.not.in.(${childWalletIds.join(",")})`);
      }
      if (direction === "all") q = q.in("direction", ["expense", "income"]);
      else q = q.eq("direction", direction);
      if (from) q = q.gte("txn_date", from);
      if (to) q = q.lte("txn_date", to);
      if (categoryIds) q = q.in("category_id", categoryIds);
      if (memoWord.trim()) q = q.ilike("description", `%${escapeLike(memoWord.trim())}%`);
      if (merchantWord.trim()) q = q.ilike("merchant_name", `%${escapeLike(merchantWord.trim())}%`);

      const { data, error } = await q;
      if (error) {
        setMessage("検索エラー: " + error.message);
        setBusy(false);
        return;
      }
      const rows = (data as unknown as Hit[]) || [];
      all.push(...rows);
      if (rows.length < 1000 || all.length >= MAX_HITS + 1) break;
      offset += 1000;
    }

    // すでにそのキーワードで始まっているメモは対象から外す
    const kwLower = keyword.toLowerCase();
    let list = all.filter((t) => !(t.description || "").toLowerCase().startsWith(kwLower));
    const skipped = all.length - list.length;
    let note = "";
    if (list.length > MAX_HITS) {
      list = list.slice(0, MAX_HITS);
      note = `該当が${MAX_HITS}件を超えたため、先頭の${MAX_HITS}件だけを表示しています。条件を絞るか、更新後にもう一度検索してください。`;
    }
    setHits(list);
    setChecked(new Set(list.map((t) => t.id)));
    setMessage(
      [note, skipped > 0 ? `すでにキーワードが付いている${skipped}件は除外しました。` : ""].filter(Boolean).join(" ")
    );
    setBusy(false);
  };

  const toggle = (id: string) =>
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selected = useMemo(() => (hits || []).filter((t) => checked.has(t.id)), [hits, checked]);
  const selectedTotal = selected.reduce((s, t) => s + Number(t.amount || 0), 0);

  const apply = async () => {
    if (!keyword || selected.length === 0) return;
    if (!confirm(`${selected.length}件のメモの先頭に「${keyword}」を付けます。よろしいですか？`)) return;
    setBusy(true);
    setMessage("");

    const backup: Undo = selected.map((t) => ({ id: t.id, description: t.description }));
    const failed: string[] = [];
    const done: Undo = [];
    for (let i = 0; i < selected.length; i += 20) {
      const chunk = selected.slice(i, i + 20);
      const results = await Promise.all(
        chunk.map((t) =>
          supabase
            .from("transaction_records")
            .update({ description: keyword + (t.description || "") })
            .eq("id", t.id)
        )
      );
      results.forEach((r, idx) => {
        const t = chunk[idx];
        if (r.error) failed.push(`${t.txn_date} ${r.error.message}`);
        else done.push(backup.find((b) => b.id === t.id)!);
      });
    }

    setUndo(done.length > 0 ? done : null);
    setHits(null);
    setChecked(new Set());
    setMessage(
      `${done.length}件を更新しました。` +
        (failed.length > 0 ? ` 失敗${failed.length}件: ${failed.slice(0, 3).join(" / ")}` : "")
    );
    setBusy(false);
    onChanged?.();
  };

  // 直前の一括更新を元に戻す（この画面を開いている間だけ）
  const undoLast = async () => {
    if (!undo || undo.length === 0) return;
    if (!confirm(`直前に更新した${undo.length}件のメモを元に戻します。よろしいですか？`)) return;
    setBusy(true);
    const failed: string[] = [];
    for (let i = 0; i < undo.length; i += 20) {
      const chunk = undo.slice(i, i + 20);
      const results = await Promise.all(
        chunk.map((u) => supabase.from("transaction_records").update({ description: u.description }).eq("id", u.id))
      );
      results.forEach((r) => {
        if (r.error) failed.push(r.error.message);
      });
    }
    setMessage(
      failed.length === 0 ? `${undo.length}件を元に戻しました。` : `元に戻せなかった取引が${failed.length}件あります: ${failed[0]}`
    );
    setUndo(null);
    setBusy(false);
    onChanged?.();
  };

  return (
    <div style={boxStyle}>
      <h2 style={{ marginTop: 0, fontSize: "18px" }}>かのん用キーワードの一括設定（過去分）</h2>
      <div style={{ fontSize: "12px", color: "#888", marginBottom: "8px" }}>
        家計共通の財布の取引を条件で絞り込み、メモの先頭にキーワードを付けます（財布は変わりません）。更新前に一覧で確認できます。
      </div>

      <div style={{ display: "grid", gap: "8px" }}>
        <div>
          <div style={labelStyle}>付けるキーワード（概算レポートに登録済みのもの）</div>
          <select
            value={keywordSel}
            onChange={(e) => {
              setKeywordSel(e.target.value);
              setKeywordInput("");
            }}
            style={inputStyle}
          >
            <option value="">選択してください</option>
            {savedKeywords.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <input
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            placeholder="または手入力（例: かのん_教育_）。入力すると上の選択より優先"
            style={{ ...inputStyle, marginTop: "6px" }}
          />
          <div style={{ fontSize: "12px", color: "#888", marginTop: "4px" }}>
            手入力のキーワードを使う場合は、概算レポートの振り分けルール（対象＝家計共通）にも同じ語を登録してください。
          </div>
        </div>

        <div style={{ display: "grid", gap: "8px", gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <div style={labelStyle}>開始日</div>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={labelStyle}>終了日</div>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={labelStyle}>大分類</div>
            <select
              value={major}
              onChange={(e) => {
                setMajor(e.target.value);
                setMinor("");
              }}
              style={inputStyle}
            >
              <option value="">指定しない</option>
              {majors.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div style={labelStyle}>中分類</div>
            <select value={minor} onChange={(e) => setMinor(e.target.value)} style={inputStyle}>
              <option value="">指定しない</option>
              {minors.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div style={labelStyle}>メモに含む語</div>
            <input value={memoWord} onChange={(e) => setMemoWord(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={labelStyle}>支払先に含む語</div>
            <input value={merchantWord} onChange={(e) => setMerchantWord(e.target.value)} style={inputStyle} />
          </div>
        </div>

        <div>
          <div style={labelStyle}>区分</div>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as "expense" | "income" | "all")}
            style={inputStyle}
          >
            <option value="expense">支出のみ</option>
            <option value="income">収入のみ</option>
            <option value="all">支出と収入</option>
          </select>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button onClick={search} disabled={busy} style={btnStyle}>
            {busy ? "処理中..." : "条件で検索（プレビュー）"}
          </button>
          {undo && (
            <button onClick={undoLast} disabled={busy} style={subBtnStyle}>
              直前の一括更新を元に戻す（{undo.length}件）
            </button>
          )}
        </div>

        {message && <div style={{ fontSize: "14px" }}>{message}</div>}
      </div>

      {hits && (
        <div style={{ marginTop: "12px" }}>
          <div style={{ fontWeight: 600, marginBottom: "4px" }}>
            該当 {hits.length}件／更新する {selected.length}件（合計 {yen(selectedTotal)}円）
          </div>
          {hits.length > 0 && (
            <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
              <button style={{ ...subBtnStyle, padding: "6px 10px" }} onClick={() => setChecked(new Set(hits.map((t) => t.id)))}>
                すべて選択
              </button>
              <button style={{ ...subBtnStyle, padding: "6px 10px" }} onClick={() => setChecked(new Set())}>
                すべて解除
              </button>
            </div>
          )}
          <div style={{ maxHeight: "420px", overflowY: "auto", display: "grid", gap: "6px" }}>
            {hits.map((t) => {
              const cat = catOf(t);
              return (
                <label
                  key={t.id}
                  style={{
                    display: "flex",
                    gap: "8px",
                    alignItems: "flex-start",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    padding: "8px",
                    fontSize: "13px",
                  }}
                >
                  <input type="checkbox" checked={checked.has(t.id)} onChange={() => toggle(t.id)} />
                  <div style={{ flex: 1, overflowWrap: "anywhere" }}>
                    <div>
                      {t.txn_date}　{t.direction === "income" ? "+" : "-"}
                      {yen(Number(t.amount))}円　{cat ? `${cat.major_category} / ${cat.minor_category}` : "未分類"}
                      {t.merchant_name ? `　${t.merchant_name}` : ""}
                    </div>
                    <div style={{ color: "#6b7280" }}>前: {t.description || "（メモなし）"}</div>
                    <div>
                      後: <b>{keyword + (t.description || "")}</b>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
          {selected.length > 0 && (
            <div style={{ marginTop: "10px" }}>
              <button onClick={apply} disabled={busy} style={{ ...btnStyle, background: "#b91c1c" }}>
                {selected.length}件のメモにキーワードを付けて更新
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
