"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";

// ===== レシート取込（スマートレシート／レシートスキャンのTSV）と、レシート詳細画面 =====
// ・レシート1枚 = transaction_records に1件（合計金額）
// ・品目ごとの費目は receipt_items に保存（グラフはこちらを使って集計する）

type WalletRow = {
  id: string;
  wallet_name: string;
  wallet_type: string | null;
};

type AccountRow = {
  id: string;
  account_name: string;
  account_type: string;
  wallet_id: string | null;
  display_order: number;
};

type CategoryRow = {
  id: string;
  wallet_type: string | null;
  major_category: string;
  minor_category: string;
  category_kind: string;
  display_order: number;
};

type Props = {
  supabase: SupabaseClient;
  user: User;
  wallets: WalletRow[];
  accounts: AccountRow[];
  categories: CategoryRow[];
  merchantCandidates: string[];
  onChanged?: () => void | Promise<void>;
};

type ParsedItem = {
  lineNo: number;
  name: string;
  unitPrice: number;
  quantity: number;
  amount: number;
  isTax: boolean;
  categoryId: string;
};

type DupLevel = "none" | "weak" | "strong";

type ParsedReceipt = {
  key: string;
  fileName: string;
  externalKey: string;
  date: string;
  merchant: string;
  total: number;
  diff: number; // 明細合計 - レシート合計（0なら一致）
  items: ParsedItem[];
  include: boolean;
  dupLevel: DupLevel;
  dupText: string;
};

type SavedItem = {
  id: string;
  line_no: number;
  item_name: string;
  unit_price: number | null;
  quantity: number | null;
  amount: number;
  category_id: string | null;
  is_tax_line: boolean;
};

type SavedReceipt = {
  id: string;
  txn_date: string;
  amount: number;
  wallet_id: string | null;
  payment_account_id: string | null;
  merchant_name: string | null;
  category_id: string | null;
  receipt_items: SavedItem[];
};

const EXTERNAL_KEY_PREFIX = "receiptscan:";

// ---------- 共通の補助関数 ----------

function decodeBuffer(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true })
      .decode(buf)
      .replace(/^\uFEFF/, "");
  } catch {
    // スマートレシートのTSVは Shift_JIS（CP932）
    return new TextDecoder("shift_jis").decode(buf);
  }
}

function toNum(s: string | undefined): number {
  const n = Number(String(s ?? "").replace(/[,，\s円]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function normalizeDate(s: string | undefined): string {
  const m = String(s ?? "")
    .trim()
    .match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function yen(n: number | string | null | undefined) {
  return `${Number(n || 0).toLocaleString()}円`;
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function nextMonthOf(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

// 大分類ごとにまとめた費目（支出用）。入力画面の支出の絞り込みと同じ条件
function buildCategoryGroups(
  categories: CategoryRow[],
  walletType: string
): [string, CategoryRow[]][] {
  const map = new Map<string, CategoryRow[]>();
  categories.forEach((c) => {
    const walletOk = c.wallet_type === walletType || c.wallet_type === null;
    if (!walletOk) return;
    if (
      c.major_category === "収入" ||
      c.major_category === "おこづかい収入" ||
      c.major_category === "資金移動" ||
      c.category_kind === "exclude"
    ) {
      return;
    }
    const list = map.get(c.major_category) ?? [];
    list.push(c);
    map.set(c.major_category, list);
  });
  return Array.from(map.entries());
}

// レシート全体の代表費目＝税以外で金額が最大の品目の費目
function representativeCategory(
  items: { amount: number; isTax: boolean; categoryId: string }[]
): string {
  let bestAmount = -Infinity;
  let bestCategory = "";
  for (const it of items) {
    if (it.isTax) continue;
    if (it.amount > bestAmount) {
      bestAmount = it.amount;
      bestCategory = it.categoryId;
    }
  }
  return bestCategory;
}

// ---------- TSVの解析 ----------

function parseReceiptTsv(
  text: string,
  fileName: string
): { receipts: ParsedReceipt[]; error?: string } {
  const lines = text
    .split(/\r\n|\n|\r/)
    .map((l) => l.split("\t"))
    .filter((cells) => cells.some((c) => c.trim() !== ""));

  if (lines.length < 2) {
    return { receipts: [], error: "データ行がありません" };
  }

  const header = lines[0].map((h) => h.replace(/^\uFEFF/, "").trim());
  const col = (name: string) => header.indexOf(name);
  const iDate = col("日付");
  const iCompany = col("企業名");
  const iShop = col("お店");
  const iPhone = col("電話番号");
  const iOut = col("出金");
  const iName = col("品名");
  const iUnit = col("単価");
  const iQty = col("数量");

  if (iDate < 0 || iOut < 0 || iName < 0 || iUnit < 0 || iQty < 0) {
    return {
      receipts: [],
      error:
        "レシートのTSVではないようです（日付・出金・品名・単価・数量の列が見つかりません）",
    };
  }

  const get = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");
  const stem = fileName.replace(/\.[^.]+$/, "");

  const receipts: ParsedReceipt[] = [];
  let curSig = "";
  let cur: ParsedReceipt | null = null;

  for (const row of lines.slice(1)) {
    const name = get(row, iName);

    // 品名が空の行は「支払い（入金）行」。ここでレシートが1枚終わる
    if (!name) {
      cur = null;
      curSig = "";
      continue;
    }

    const date = normalizeDate(get(row, iDate));
    const company = get(row, iCompany);
    const shop = get(row, iShop);
    const merchant =
      company && shop && !company.includes(shop)
        ? `${company} ${shop}`
        : company || shop;
    const total = toNum(row[iOut]);
    const sig = `${date}|${merchant}|${get(row, iPhone)}|${total}`;

    if (!cur || sig !== curSig) {
      const n = receipts.length + 1;
      cur = {
        key: `${stem}#${n}`,
        fileName,
        externalKey: `${EXTERNAL_KEY_PREFIX}${stem}:${n}`,
        date,
        merchant,
        total,
        diff: 0,
        items: [],
        include: true,
        dupLevel: "none",
        dupText: "",
      };
      curSig = sig;
      receipts.push(cur);
    }

    const unit = toNum(row[iUnit]);
    const rawQty = get(row, iQty);
    const qty = rawQty === "" ? 1 : toNum(rawQty);

    cur.items.push({
      lineNo: cur.items.length + 1,
      name,
      unitPrice: unit,
      quantity: qty,
      amount: Math.round(unit * qty),
      isTax: name === "外税",
      categoryId: "",
    });
  }

  receipts.forEach((r) => {
    const sum = r.items.reduce((s, it) => s + it.amount, 0);
    r.diff = sum - r.total;
  });

  if (receipts.length === 0) {
    return { receipts: [], error: "レシートの明細行が見つかりません" };
  }

  return { receipts };
}

// ---------- 費目プルダウン ----------

function CategorySelect(props: {
  value: string;
  onChange: (v: string) => void;
  groups: [string, CategoryRow[]][];
  allCategories: CategoryRow[];
  emptyLabel: string;
  disabled?: boolean;
}) {
  const { value, onChange, groups, allCategories, emptyLabel, disabled } = props;
  const inGroups = groups.some(([, list]) => list.some((c) => c.id === value));
  const missing =
    value && !inGroups ? allCategories.find((c) => c.id === value) : undefined;

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={{ width: "100%", padding: "6px" }}
    >
      <option value="">{emptyLabel}</option>
      {missing && (
        <option value={missing.id}>
          {missing.major_category} / {missing.minor_category}
        </option>
      )}
      {groups.map(([major, list]) => (
        <optgroup key={major} label={major}>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.minor_category}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// ---------- 本体 ----------

export default function ReceiptScreen({
  supabase,
  user,
  wallets,
  accounts,
  categories,
  merchantCandidates,
  onChanged,
}: Props) {
  const [tab, setTab] = useState<"import" | "list">("import");

  // 取込
  const [walletId, setWalletId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [receipts, setReceipts] = useState<ParsedReceipt[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [fileKey, setFileKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  // 詳細（登録済みレシート）
  const [listMonth, setListMonth] = useState(currentMonth());
  const [listTick, setListTick] = useState(0);
  const [saved, setSaved] = useState<SavedReceipt[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listMessage, setListMessage] = useState("");
  const [openIds, setOpenIds] = useState<string[]>([]);

  useEffect(() => {
    if (!walletId && wallets.length > 0) setWalletId(wallets[0].id);
  }, [wallets, walletId]);

  const walletType =
    wallets.find((w) => w.id === walletId)?.wallet_type || "household";

  const importGroups = useMemo(
    () => buildCategoryGroups(categories, walletType),
    [categories, walletType]
  );

  const accountOptions = useMemo(
    () => accounts.filter((a) => !walletId || a.wallet_id === walletId),
    [accounts, walletId]
  );

  const accountNameOf = (id: string | null) =>
    id ? accounts.find((a) => a.id === id)?.account_name ?? "" : "";

  const categoryLabelOf = (id: string | null) => {
    if (!id) return "未分類";
    const c = categories.find((x) => x.id === id);
    return c ? `${c.major_category} / ${c.minor_category}` : "未分類";
  };

  // ---------- 取込：ファイル読み込み・プレビュー ----------

  const updateReceipt = (key: string, patch: Partial<ParsedReceipt>) => {
    setReceipts((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const updateItemCategory = (key: string, lineNo: number, categoryId: string) => {
    setReceipts((prev) =>
      prev.map((r) =>
        r.key === key
          ? {
              ...r,
              items: r.items.map((it) =>
                it.lineNo === lineNo ? { ...it, categoryId } : it
              ),
            }
          : r
      )
    );
  };

  // 過去に登録した「品名 → 費目」（新しい順で最初に出たものを採用）
  const loadPastCategoryMap = async () => {
    const map = new Map<string, string>();
    const { data } = await supabase
      .from("receipt_items")
      .select("item_name, category_id")
      .eq("user_id", user.id)
      .eq("is_tax_line", false)
      .not("category_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1000);

    ((data as { item_name: string; category_id: string }[] | null) ?? []).forEach(
      (row) => {
        if (!map.has(row.item_name)) map.set(row.item_name, row.category_id);
      }
    );
    return map;
  };

  const markDuplicates = async (list: ParsedReceipt[]) => {
    const dates = list
      .map((r) => r.date)
      .filter(Boolean)
      .sort();
    if (dates.length === 0) return;

    const { data, error } = await supabase
      .from("transaction_records")
      .select("txn_date, amount, merchant_name, external_row_key")
      .eq("user_id", user.id)
      .eq("direction", "expense")
      .gte("txn_date", dates[0])
      .lte("txn_date", dates[dates.length - 1])
      .range(0, 4999);

    if (error) {
      setMessage("重複チェックの読込エラー: " + error.message);
      return;
    }

    const existing =
      (data as {
        txn_date: string;
        amount: number;
        merchant_name: string | null;
        external_row_key: string | null;
      }[]) ?? [];

    list.forEach((r) => {
      const stemKey = r.externalKey.replace(/:\d+$/, ":");
      const sameFile = existing.some((e) =>
        (e.external_row_key ?? "").startsWith(stemKey)
      );
      const sameAll = existing.some(
        (e) =>
          e.txn_date === r.date &&
          Number(e.amount) === r.total &&
          (e.merchant_name ?? "") === r.merchant
      );
      const sameDateAmount = existing.some(
        (e) => e.txn_date === r.date && Number(e.amount) === r.total
      );

      if (sameFile) {
        r.dupLevel = "strong";
        r.dupText = "このファイルは取込済みです。";
        r.include = false;
      } else if (sameAll) {
        r.dupLevel = "strong";
        r.dupText = "同じ日付・支払先・金額の明細がすでにあります。";
        r.include = false;
      } else if (sameDateAmount) {
        r.dupLevel = "weak";
        r.dupText =
          "同じ日付・金額の明細がすでにあります（支払先は異なります）。手入力済みのレシートでないか確認してください。";
      }
    });
  };

  const loadFiles = async (files: FileList) => {
    setBusy(true);
    setMessage("");
    setFileErrors([]);
    setReceipts([]);

    try {
      const pastMap = await loadPastCategoryMap();
      const validIds = new Set(categories.map((c) => c.id));

      const errors: string[] = [];
      const parsed: ParsedReceipt[] = [];

      for (const file of Array.from(files)) {
        const text = decodeBuffer(await file.arrayBuffer());
        const res = parseReceiptTsv(text, file.name);
        if (res.error) {
          errors.push(`${file.name}: ${res.error}`);
          continue;
        }
        parsed.push(...res.receipts);
      }

      parsed.forEach((r) => {
        r.items.forEach((it) => {
          if (it.isTax) return;
          const past = pastMap.get(it.name);
          if (past && validIds.has(past)) it.categoryId = past;
        });
        if (r.diff !== 0) r.include = false;
        if (!r.date) r.include = false;
      });

      await markDuplicates(parsed);

      setReceipts(parsed);
      setFileErrors(errors);
    } catch (e) {
      setMessage("ファイルの読込エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  // ---------- 取込：登録 ----------

  const hasBlockingError = (r: ParsedReceipt) => !r.date || r.diff !== 0;

  const targets = receipts.filter((r) => r.include && !hasBlockingError(r));

  const registerAll = async () => {
    setMessage("");

    if (!walletId) {
      setMessage("財布を選択してください");
      return;
    }
    if (targets.length === 0) {
      setMessage("登録するレシートを選んでください");
      return;
    }

    const noCategory = targets.reduce(
      (n, r) => n + r.items.filter((it) => !it.isTax && !it.categoryId).length,
      0
    );
    const dupCount = targets.filter((r) => r.dupLevel === "strong").length;

    const lines = [`${targets.length}件のレシートを登録します。`];
    if (noCategory > 0) {
      lines.push(`費目が未選択の品目が${noCategory}点あります（未分類で登録されます）。`);
    }
    if (dupCount > 0) {
      lines.push(`重複の可能性があるレシートが${dupCount}件含まれています。`);
    }
    lines.push("よろしいですか？");
    if (!window.confirm(lines.join("\n"))) return;

    setBusy(true);
    let done = 0;

    for (const r of targets) {
      const rep = representativeCategory(r.items);
      const items = r.items.map((it) => ({
        ...it,
        // 税の行は、費目を選ばなければ「最大金額の品目」と同じ費目にする
        categoryId: it.isTax && !it.categoryId ? rep : it.categoryId,
      }));
      const headCategory = representativeCategory(items);

      const normalCount = items.filter((it) => !it.isTax).length;
      const firstName = items.find((it) => !it.isTax)?.name ?? items[0]?.name ?? "";
      const description =
        normalCount > 1
          ? `レシート: ${firstName} ほか${normalCount - 1}点`
          : `レシート: ${firstName}`;

      const externalKey =
        r.dupLevel === "strong"
          ? `${r.externalKey}:dup-${crypto.randomUUID().slice(0, 6)}`
          : r.externalKey;

      const { data: head, error: headErr } = await supabase
        .from("transaction_records")
        .insert({
          user_id: user.id,
          wallet_id: walletId,
          txn_date: r.date,
          posting_date: r.date,
          amount: r.total,
          direction: "expense",
          category_id: headCategory || null,
          payment_account_id: accountId || null,
          receive_account_id: null,
          merchant_name: r.merchant || null,
          description,
          transaction_type: "cash_expense",
          import_source_id: null,
          external_row_key: externalKey,
          statement_month: r.date.slice(0, 7),
          is_confirmed: true,
          is_manual: true,
          tax_mode: "none",
          tax_rate: null,
          tax_amount: null,
          receipt_group_id: crypto.randomUUID(),
          receipt_line_no: 1,
        })
        .select("id")
        .single();

      if (headErr || !head) {
        setMessage(
          `登録エラー（${done}件まで登録済み）: ${headErr?.message ?? "不明なエラー"}`
        );
        setBusy(false);
        await onChanged?.();
        setListTick((t) => t + 1);
        return;
      }

      const { error: itemErr } = await supabase.from("receipt_items").insert(
        items.map((it) => ({
          user_id: user.id,
          transaction_id: head.id,
          line_no: it.lineNo,
          item_name: it.name,
          unit_price: it.unitPrice,
          quantity: it.quantity,
          amount: it.amount,
          category_id: it.categoryId || null,
          is_tax_line: it.isTax,
        }))
      );

      if (itemErr) {
        // 明細が入らなかった場合は、合計だけが残らないよう元に戻す
        await supabase.from("transaction_records").delete().eq("id", head.id);
        setMessage(
          `明細の登録エラー（${done}件まで登録済み）: ${itemErr.message}。receipt_items テーブルを作成済みか確認してください。`
        );
        setBusy(false);
        await onChanged?.();
        setListTick((t) => t + 1);
        return;
      }

      done++;
    }

    setReceipts([]);
    setFileErrors([]);
    setFileKey((k) => k + 1);
    setMessage(`${done}件のレシートを登録しました`);
    setBusy(false);
    await onChanged?.();
    setListTick((t) => t + 1);
  };

  // ---------- 詳細：登録済みレシートの読み込み ----------

  useEffect(() => {
    if (tab !== "list") return;

    let cancelled = false;

    const load = async () => {
      setListLoading(true);
      setListMessage("");

      const from = `${listMonth}-01`;
      const to = `${nextMonthOf(listMonth)}-01`;

      const { data, error } = await supabase
        .from("transaction_records")
        .select(
          `id, txn_date, amount, wallet_id, payment_account_id, merchant_name, category_id,
           receipt_items ( id, line_no, item_name, unit_price, quantity, amount, category_id, is_tax_line )`
        )
        .eq("user_id", user.id)
        .eq("direction", "expense")
        .gte("txn_date", from)
        .lt("txn_date", to)
        .order("txn_date", { ascending: false })
        .limit(500);

      if (cancelled) return;

      if (error) {
        setListMessage(
          "読込エラー: " +
            error.message +
            "（receipt_items テーブルを作成済みか確認してください）"
        );
        setListLoading(false);
        return;
      }

      const rows = ((data as unknown as SavedReceipt[]) ?? [])
        .filter((r) => (r.receipt_items ?? []).length > 0)
        .map((r) => ({
          ...r,
          receipt_items: [...r.receipt_items].sort((a, b) => a.line_no - b.line_no),
        }));

      setSaved(rows);
      setListLoading(false);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [tab, listMonth, listTick, supabase, user.id]);

  const groupsByWallet = useMemo(() => {
    const m = new Map<string, [string, CategoryRow[]][]>();
    wallets.forEach((w) =>
      m.set(w.id, buildCategoryGroups(categories, w.wallet_type || "household"))
    );
    return m;
  }, [wallets, categories]);

  const fallbackGroups = useMemo(
    () => buildCategoryGroups(categories, "household"),
    [categories]
  );

  const toggleOpen = (id: string) => {
    setOpenIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const changeSavedItemCategory = async (
    rec: SavedReceipt,
    item: SavedItem,
    newCategoryId: string
  ) => {
    setListMessage("");

    const { error } = await supabase
      .from("receipt_items")
      .update({ category_id: newCategoryId || null })
      .eq("id", item.id);

    if (error) {
      setListMessage("費目の更新エラー: " + error.message);
      return;
    }

    const newItems = rec.receipt_items.map((it) =>
      it.id === item.id ? { ...it, category_id: newCategoryId || null } : it
    );

    // レシート全体の代表費目（他の画面で使われる）も更新する
    const newHead = representativeCategory(
      newItems.map((it) => ({
        amount: Number(it.amount),
        isTax: it.is_tax_line,
        categoryId: it.category_id ?? "",
      }))
    );

    let headCategory = rec.category_id;
    if ((newHead || null) !== (rec.category_id || null)) {
      const { error: headErr } = await supabase
        .from("transaction_records")
        .update({ category_id: newHead || null })
        .eq("id", rec.id);

      if (headErr) {
        setListMessage("レシート全体の費目の更新エラー: " + headErr.message);
      } else {
        headCategory = newHead || null;
        await onChanged?.();
      }
    }

    setSaved((prev) =>
      prev.map((r) =>
        r.id === rec.id
          ? { ...r, category_id: headCategory, receipt_items: newItems }
          : r
      )
    );
  };

  const deleteSavedReceipt = async (rec: SavedReceipt) => {
    if (
      !window.confirm(
        `${rec.txn_date} ${rec.merchant_name ?? ""} ${yen(rec.amount)} のレシートを削除しますか？（明細もすべて削除されます）`
      )
    ) {
      return;
    }

    const { error } = await supabase
      .from("transaction_records")
      .delete()
      .eq("id", rec.id);

    if (error) {
      setListMessage("削除エラー: " + error.message);
      return;
    }

    setSaved((prev) => prev.filter((r) => r.id !== rec.id));
    await onChanged?.();
  };

  const monthTotal = saved.reduce((s, r) => s + Number(r.amount || 0), 0);

  // この月の費目別合計（品目ベース・大分類）
  const monthByMajor = useMemo(() => {
    const m = new Map<string, number>();
    saved.forEach((r) =>
      r.receipt_items.forEach((it) => {
        const c = it.category_id
          ? categories.find((x) => x.id === it.category_id)
          : undefined;
        const label = c ? c.major_category : "未分類";
        m.set(label, (m.get(label) ?? 0) + Number(it.amount || 0));
      })
    );
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [saved, categories]);

  // ---------- 画面 ----------

  const boxStyle: React.CSSProperties = {
    display: "grid",
    gap: "12px",
    background: "#111827",
    color: "#fff",
    border: "1px solid #374151",
    borderRadius: "8px",
    padding: "12px",
  };

  const subBtn = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "8px",
    borderRadius: "8px",
    border: "none",
    background: active ? "#e5e7eb" : "#374151",
    color: active ? "#111827" : "#fff",
  });

  return (
    <div style={boxStyle}>
      <h2 style={{ margin: 0, fontSize: "18px" }}>レシート</h2>

      <div style={{ display: "flex", gap: "8px" }}>
        <button onClick={() => setTab("import")} style={subBtn(tab === "import")}>
          取り込み
        </button>
        <button onClick={() => setTab("list")} style={subBtn(tab === "list")}>
          詳細（登録済み）
        </button>
      </div>

      {tab === "import" && (
        <div style={{ display: "grid", gap: "12px" }}>
          <div style={{ fontSize: "12px", color: "#9ca3af" }}>
            スマートレシート／レシートスキャンのTSVファイルを選びます（Shift_JIS・UTF-8どちらも可、複数選択可）。
            レシート1枚が1件として登録され、品目ごとの費目は詳細画面とグラフの集計に使われます。
          </div>

          <div>
            <div style={{ marginBottom: "4px" }}>財布</div>
            <select
              value={walletId}
              onChange={(e) => {
                setWalletId(e.target.value);
                setAccountId("");
              }}
              style={{ width: "100%", padding: "8px" }}
            >
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.wallet_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={{ marginBottom: "4px" }}>支払元（すべてのレシートに共通）</div>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              style={{ width: "100%", padding: "8px" }}
            >
              <option value="">選択しない</option>
              {accountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.account_name}
                </option>
              ))}
            </select>
          </div>

          <label
            style={{
              display: "block",
              padding: "12px",
              background: "#e5e7eb",
              color: "#111827",
              borderRadius: "8px",
              textAlign: "center",
              fontWeight: "bold",
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.5 : 1,
            }}
          >
            📄 TSVファイルを選ぶ（複数可）
            <input
              key={fileKey}
              type="file"
              accept=".tsv,.txt,.csv,text/tab-separated-values,text/plain"
              multiple
              disabled={busy}
              style={{ display: "none" }}
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length > 0) void loadFiles(files);
              }}
            />
          </label>

          {busy && <div style={{ fontSize: "14px" }}>処理中...</div>}

          {fileErrors.map((m) => (
            <div key={m} style={{ color: "#f87171", fontSize: "14px" }}>
              {m}
            </div>
          ))}

          {receipts.length > 0 && (
            <div style={{ display: "grid", gap: "12px" }}>
              <div style={{ fontWeight: "bold" }}>
                読み込んだレシート: {receipts.length}件（登録対象 {targets.length}件）
              </div>

              <datalist id="receipt-merchant-candidates">
                {merchantCandidates.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>

              {receipts.map((r) => {
                const blocked = hasBlockingError(r);
                const rep = representativeCategory(r.items);
                return (
                  <div
                    key={r.key}
                    style={{
                      display: "grid",
                      gap: "8px",
                      border: `1px solid ${
                        r.dupLevel === "strong" || blocked ? "#f59e0b" : "#374151"
                      }`,
                      borderRadius: "8px",
                      padding: "10px",
                      background: "#1f2937",
                      opacity: r.include ? 1 : 0.8,
                    }}
                  >
                    <label
                      style={{
                        display: "flex",
                        gap: "8px",
                        alignItems: "center",
                        fontWeight: "bold",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={r.include}
                        disabled={blocked}
                        onChange={(e) =>
                          updateReceipt(r.key, { include: e.target.checked })
                        }
                      />
                      このレシートを登録する（合計 {yen(r.total)}）
                    </label>

                    {r.dupLevel !== "none" && (
                      <div style={{ color: "#fbbf24", fontSize: "13px" }}>
                        ⚠ {r.dupText}
                        {r.dupLevel === "strong" &&
                          " 登録する場合は、上のチェックを入れてください。"}
                      </div>
                    )}

                    {!r.date && (
                      <div style={{ color: "#f87171", fontSize: "13px" }}>
                        日付を読み取れませんでした。日付を入力してください。
                      </div>
                    )}

                    {r.diff !== 0 && (
                      <div style={{ color: "#f87171", fontSize: "13px" }}>
                        明細の合計がレシート合計と {yen(Math.abs(r.diff))}{" "}
                        {r.diff > 0 ? "多く" : "少なく"}
                        なっています。このレシートは取り込めません。
                      </div>
                    )}

                    <div
                      style={{
                        display: "grid",
                        gap: "8px",
                        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: "12px", color: "#9ca3af" }}>日付</div>
                        <input
                          type="date"
                          value={r.date}
                          onChange={(e) => {
                            updateReceipt(r.key, {
                              date: e.target.value,
                              include: e.target.value ? r.include : false,
                            });
                          }}
                          style={{ width: "100%", padding: "6px" }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: "12px", color: "#9ca3af" }}>
                          支払先
                        </div>
                        <input
                          list="receipt-merchant-candidates"
                          value={r.merchant}
                          onChange={(e) =>
                            updateReceipt(r.key, { merchant: e.target.value })
                          }
                          style={{ width: "100%", padding: "6px" }}
                        />
                      </div>
                    </div>

                    {r.items.map((it) => (
                      <div
                        key={it.lineNo}
                        style={{
                          display: "grid",
                          gap: "4px",
                          borderTop: "1px solid #374151",
                          paddingTop: "6px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: "8px",
                            fontSize: "14px",
                          }}
                        >
                          <span>
                            {it.name}
                            {it.quantity !== 1 ? ` ×${it.quantity}` : ""}
                          </span>
                          <span>{yen(it.amount)}</span>
                        </div>
                        <CategorySelect
                          value={it.categoryId}
                          onChange={(v) => updateItemCategory(r.key, it.lineNo, v)}
                          groups={importGroups}
                          allCategories={categories}
                          emptyLabel={
                            it.isTax
                              ? `（最大金額の品目と同じ${
                                  rep ? "：" + categoryLabelOf(rep) : ""
                                }）`
                              : "費目を選択"
                          }
                        />
                      </div>
                    ))}
                  </div>
                );
              })}

              <button
                onClick={() => void registerAll()}
                disabled={busy || targets.length === 0}
                style={{
                  padding: "10px 12px",
                  background: "#e5e7eb",
                  border: "none",
                  borderRadius: "8px",
                  opacity: busy || targets.length === 0 ? 0.5 : 1,
                }}
              >
                選んだレシートを登録する（{targets.length}件）
              </button>
            </div>
          )}

          {message && <div style={{ fontSize: "14px" }}>{message}</div>}
        </div>
      )}

      {tab === "list" && (
        <div style={{ display: "grid", gap: "12px" }}>
          <div>
            <div style={{ marginBottom: "4px" }}>月</div>
            <input
              type="month"
              value={listMonth}
              onChange={(e) => e.target.value && setListMonth(e.target.value)}
              style={{ width: "100%", padding: "8px" }}
            />
          </div>

          {listLoading && <div style={{ fontSize: "14px" }}>読み込み中...</div>}
          {listMessage && (
            <div style={{ fontSize: "14px", color: "#fbbf24" }}>{listMessage}</div>
          )}

          {!listLoading && saved.length === 0 && !listMessage && (
            <div style={{ fontSize: "14px" }}>この月に取り込んだレシートはありません。</div>
          )}

          {saved.length > 0 && (
            <div style={{ fontSize: "14px" }}>
              {saved.length}件 / 合計 {yen(monthTotal)}
              <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "4px" }}>
                {monthByMajor
                  .map(([name, sum]) => `${name} ${Number(sum).toLocaleString()}円`)
                  .join(" ／ ")}
              </div>
            </div>
          )}

          {saved.map((rec) => {
            const isOpen = openIds.includes(rec.id);
            const groups =
              (rec.wallet_id ? groupsByWallet.get(rec.wallet_id) : undefined) ??
              fallbackGroups;
            return (
              <div
                key={rec.id}
                style={{
                  border: "1px solid #374151",
                  borderRadius: "8px",
                  background: "#1f2937",
                  padding: "10px",
                  display: "grid",
                  gap: "8px",
                }}
              >
                <button
                  onClick={() => toggleOpen(rec.id)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "8px",
                    background: "transparent",
                    border: "none",
                    color: "#fff",
                    textAlign: "left",
                    padding: 0,
                    fontSize: "14px",
                  }}
                >
                  <span>
                    {isOpen ? "▼" : "▶"} {rec.txn_date} {rec.merchant_name ?? ""}
                    <span style={{ color: "#9ca3af" }}>
                      {" "}
                      （{rec.receipt_items.filter((it) => !it.is_tax_line).length}点
                      {accountNameOf(rec.payment_account_id)
                        ? ` / ${accountNameOf(rec.payment_account_id)}`
                        : ""}
                      ）
                    </span>
                  </span>
                  <span style={{ fontWeight: "bold" }}>{yen(rec.amount)}</span>
                </button>

                {isOpen && (
                  <div style={{ display: "grid", gap: "8px" }}>
                    {rec.receipt_items.map((it) => (
                      <div
                        key={it.id}
                        style={{
                          display: "grid",
                          gap: "4px",
                          borderTop: "1px solid #374151",
                          paddingTop: "6px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: "8px",
                            fontSize: "14px",
                          }}
                        >
                          <span>
                            {it.item_name}
                            {Number(it.quantity ?? 1) !== 1
                              ? ` ×${Number(it.quantity)}`
                              : ""}
                            {it.unit_price !== null && Number(it.quantity ?? 1) !== 1
                              ? `（単価 ${Number(it.unit_price).toLocaleString()}円）`
                              : ""}
                          </span>
                          <span>{yen(it.amount)}</span>
                        </div>
                        <CategorySelect
                          value={it.category_id ?? ""}
                          onChange={(v) => void changeSavedItemCategory(rec, it, v)}
                          groups={groups}
                          allCategories={categories}
                          emptyLabel="未分類"
                        />
                      </div>
                    ))}

                    <button
                      onClick={() => void deleteSavedReceipt(rec)}
                      style={{
                        padding: "6px 10px",
                        background: "#7f1d1d",
                        color: "#fff",
                        border: "none",
                        borderRadius: "8px",
                        justifySelf: "start",
                      }}
                    >
                      このレシートを削除
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
