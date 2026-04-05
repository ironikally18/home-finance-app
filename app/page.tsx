"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient, User } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
};

type CategoryRow = {
  id: string;
  wallet_type: string | null;
  major_category: string;
  minor_category: string;
  category_kind: string;
};

type MerchantRow = {
  merchant_name: string | null;
};

type TransactionListRow = {
  id: string;
  txn_date: string;
  amount: number;
  wallet_id: string | null;
  category_id: string | null;
  payment_account_id: string | null;
  merchant_name: string | null;
  description: string | null;
  tax_mode: string | null;
  tax_rate: number | null;
  tax_amount: number | null;
  receipt_group_id: string | null;
  receipt_line_no: number | null;
  categories:
    | {
        major_category: string;
        minor_category: string;
      }
    | {
        major_category: string;
        minor_category: string;
      }[]
    | null;
  accounts:
    | {
        account_name: string;
      }
    | {
        account_name: string;
      }[]
    | null;
};

type ScreenMode = "entry" | "list" | "masters";

export default function Page() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");

  const [screenMode, setScreenMode] = useState<ScreenMode>("entry");

  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [merchantCandidates, setMerchantCandidates] = useState<string[]>([]);

  const [transactions, setTransactions] = useState<TransactionListRow[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [editAccountId, setEditAccountId] = useState("");
  const [editMerchantName, setEditMerchantName] = useState("");
  const [editMemo, setEditMemo] = useState("");

  const [listMonth, setListMonth] = useState(
    new Date().toISOString().slice(0, 7)
  );
  const [listWalletId, setListWalletId] = useState("");

  const [walletId, setWalletId] = useState("");
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [memo, setMemo] = useState("");
  const [message, setMessage] = useState("");

  const [taxMode, setTaxMode] = useState("none");
  const [taxRate, setTaxRate] = useState("10");
  const [taxAmount, setTaxAmount] = useState("");

  const [continueReceipt, setContinueReceipt] = useState(false);
  const [receiptGroupId, setReceiptGroupId] = useState("");
  const [receiptLineNo, setReceiptLineNo] = useState(1);

  const [masterMessage, setMasterMessage] = useState("");

  const [newAccountWalletId, setNewAccountWalletId] = useState("");
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountType, setNewAccountType] = useState("cash");

  const [newCategoryWalletType, setNewCategoryWalletType] = useState("household");
  const [newMajorCategory, setNewMajorCategory] = useState("");
  const [newMinorCategory, setNewMinorCategory] = useState("");
  const [newCategoryKind, setNewCategoryKind] = useState("expense_normal");

  useEffect(() => {
    setDate(new Date().toISOString().slice(0, 10));

    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      setUser(session?.user ?? null);
      setAuthLoading(false);
    };

    void init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (user) {
      void loadData();
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      void loadTransactions();
    }
  }, [user, listMonth, listWalletId]);

  const loadData = async () => {
    setMessage("");
    setMasterMessage("");

    const { data: w, error: wErr } = await supabase
      .from("wallets")
      .select("id, wallet_name, wallet_type")
      .order("display_order", { ascending: true });

    const { data: a, error: aErr } = await supabase
      .from("accounts")
      .select("id, account_name, account_type, wallet_id")
      .order("display_order", { ascending: true });

    const { data: c, error: cErr } = await supabase
      .from("categories")
      .select("id, wallet_type, major_category, minor_category, category_kind")
      .order("display_order", { ascending: true });

    const { data: m, error: mErr } = await supabase
      .from("transaction_records")
      .select("merchant_name")
      .not("merchant_name", "is", null)
      .order("merchant_name", { ascending: true })
      .limit(300);

    if (wErr || aErr || cErr || mErr) {
      setMessage(
        "読込エラー: " +
          [wErr?.message, aErr?.message, cErr?.message, mErr?.message]
            .filter(Boolean)
            .join(" / ")
      );
      return;
    }

    const walletsData = (w as WalletRow[]) || [];
    const accountsData = (a as AccountRow[]) || [];
    const categoriesData = (c as CategoryRow[]) || [];
    const merchantsData = (m as MerchantRow[]) || [];

    const merchantList = Array.from(
      new Set(
        merchantsData
          .map((x) => (x.merchant_name || "").trim())
          .filter((x) => x !== "")
      )
    );

    setWallets(walletsData);
    setAccounts(accountsData);
    setCategories(categoriesData);
    setMerchantCandidates(merchantList);

    if (walletsData.length > 0 && !walletId) {
      setWalletId(walletsData[0].id);
    }

    if (walletsData.length > 0 && !newAccountWalletId) {
      setNewAccountWalletId(walletsData[0].id);
    }
  };

  const loadTransactions = async () => {
    setListLoading(true);
    setMessage("");

    let query = supabase
      .from("transaction_records")
      .select(`
        id,
        txn_date,
        amount,
        wallet_id,
        category_id,
        payment_account_id,
        merchant_name,
        description,
        tax_mode,
        tax_rate,
        tax_amount,
        receipt_group_id,
        receipt_line_no,
        categories:category_id (
          major_category,
          minor_category
        ),
        accounts:payment_account_id (
          account_name
        )
      `)
      .order("txn_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200);

    if (listMonth) {
      const from = `${listMonth}-01`;
      const dt = new Date(`${listMonth}-01T00:00:00`);
      const nextMonth = new Date(dt.getFullYear(), dt.getMonth() + 1, 1);
      const to = nextMonth.toISOString().slice(0, 10);

      query = query.gte("txn_date", from).lt("txn_date", to);
    }

    if (listWalletId) {
      query = query.eq("wallet_id", listWalletId);
    }

    const { data, error } = await query;

    if (error) {
      setMessage("一覧読込エラー: " + error.message);
      setListLoading(false);
      return;
    }

    setTransactions((data as TransactionListRow[]) || []);
    setListLoading(false);
  };

  const signIn = async () => {
    setAuthMessage("");

    if (!email || !password) {
      setAuthMessage("メールアドレスとパスワードを入力してください");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setAuthMessage("ログイン失敗: " + error.message);
      return;
    }

    setAuthMessage("ログインしました");
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setMessage("");
    setMasterMessage("");
    setAuthMessage("ログアウトしました");
  };

  const selectedWallet = useMemo(() => {
    return wallets.find((w) => w.id === walletId) || null;
  }, [walletId, wallets]);

  const filteredAccounts = useMemo(() => {
    if (!walletId) return accounts;
    return accounts.filter((a) => a.wallet_id === walletId);
  }, [accounts, walletId]);

  const filteredCategories = useMemo(() => {
    const walletType = selectedWallet?.wallet_type || "household";
    return categories.filter((c) => c.wallet_type === walletType || c.wallet_type === null);
  }, [categories, selectedWallet]);

  const listTotalAmount = useMemo(() => {
    return transactions.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  }, [transactions]);

  const calcTaxAmount = () => {
    const amt = Number(amount || 0);
    const rate = Number(taxRate || 0);

    if (!amt || !rate || taxMode === "none") return null;

    if (taxMode === "inclusive") {
      return Math.round((amt * rate) / (100 + rate));
    }

    if (taxMode === "exclusive") {
      return Math.round((amt * rate) / 100);
    }

    return null;
  };

  const saveExpense = async () => {
    setMessage("");

    if (!user) {
      setMessage("ログインしてください");
      return;
    }

    if (!walletId) {
      setMessage("財布を選択してください");
      return;
    }

    if (!date) {
      setMessage("日付を入力してください");
      return;
    }

    if (!amount || Number(amount) <= 0) {
      setMessage("金額を入力してください");
      return;
    }

    const calculatedTax =
      taxAmount !== "" ? Number(taxAmount) : calcTaxAmount();

    const currentReceiptGroupId =
      continueReceipt && receiptGroupId ? receiptGroupId : crypto.randomUUID();

    const currentReceiptLineNo =
      continueReceipt && receiptGroupId ? receiptLineNo : 1;

    const { error } = await supabase.from("transaction_records").insert({
      user_id: user.id,
      wallet_id: walletId,
      txn_date: date,
      posting_date: date,
      amount: Number(amount),
      direction: "expense",
      category_id: categoryId || null,
      payment_account_id: accountId || null,
      receive_account_id: null,
      merchant_name: merchantName || null,
      description: memo || null,
      transaction_type: "cash_expense",
      import_source_id: null,
      external_row_key: null,
      statement_month: date.slice(0, 7),
      is_confirmed: true,
      is_manual: true,
      tax_mode: taxMode,
      tax_rate: taxMode === "none" ? null : Number(taxRate || 0),
      tax_amount: taxMode === "none" ? null : calculatedTax,
      receipt_group_id: currentReceiptGroupId,
      receipt_line_no: currentReceiptLineNo,
    });

    if (error) {
      setMessage("保存エラー: " + error.message);
      return;
    }

    if (merchantName.trim() && !merchantCandidates.includes(merchantName.trim())) {
      setMerchantCandidates((prev) =>
        [...prev, merchantName.trim()].sort((a, b) => a.localeCompare(b, "ja"))
      );
    }

    setMessage("保存しました");
    await loadTransactions();

    if (continueReceipt) {
      setReceiptGroupId(currentReceiptGroupId);
      setReceiptLineNo(currentReceiptLineNo + 1);

      setAmount("");
      setCategoryId("");
      setMemo("");
      setTaxMode("none");
      setTaxAmount("");
      return;
    }

    setAmount("");
    setCategoryId("");
    setAccountId("");
    setMerchantName("");
    setMemo("");
    setTaxMode("none");
    setTaxAmount("");
    setReceiptGroupId("");
    setReceiptLineNo(1);
  };

  const addAccount = async () => {
    setMasterMessage("");

    if (!user) {
      setMasterMessage("ログインしてください");
      return;
    }

    if (!newAccountWalletId) {
      setMasterMessage("財布を選択してください");
      return;
    }

    if (!newAccountName.trim()) {
      setMasterMessage("口座名・カード名を入力してください");
      return;
    }

    const { error } = await supabase.from("accounts").insert({
      user_id: user.id,
      wallet_id: newAccountWalletId,
      account_name: newAccountName.trim(),
      account_type: newAccountType,
      is_active: true,
      display_order: 999,
    });

    if (error) {
      setMasterMessage("口座追加エラー: " + error.message);
      return;
    }

    setMasterMessage("支払元を追加しました");
    setNewAccountName("");
    await loadData();
  };

  const addCategory = async () => {
    setMasterMessage("");

    if (!user) {
      setMasterMessage("ログインしてください");
      return;
    }

    if (!newMajorCategory.trim()) {
      setMasterMessage("大分類を入力してください");
      return;
    }

    if (!newMinorCategory.trim()) {
      setMasterMessage("中分類を入力してください");
      return;
    }

    const { error } = await supabase.from("categories").insert({
      user_id: user.id,
      wallet_type: newCategoryWalletType,
      major_category: newMajorCategory.trim(),
      minor_category: newMinorCategory.trim(),
      category_kind: newCategoryKind,
      budget_target_flag: true,
      is_active: true,
      display_order: 999,
    });

    if (error) {
      setMasterMessage("費目追加エラー: " + error.message);
      return;
    }

    setMasterMessage("費目を追加しました");
    setNewMajorCategory("");
    setNewMinorCategory("");
    await loadData();
  };

  const deleteAccount = async (id: string, name: string) => {
    const ok = window.confirm(`支払元「${name}」を削除しますか？`);
    if (!ok) return;

    const { error } = await supabase
    .from("accounts")
    .delete()
    .eq("id", id);

  if (error) {
    setMasterMessage("支払元削除エラー: " + error.message);
    return;
  }

  setMasterMessage("支払元を削除しました");
  await loadData();
};

  const deleteCategory = async (
    id: string,
    major: string,
    minor: string
  ) => {
    const ok = window.confirm(`費目「${major} / ${minor}」を削除しますか？`);
    if (!ok) return;

    const { error } = await supabase
      .from("categories")
      .delete()
      .eq("id", id);

    if (error) {
      setMasterMessage("費目削除エラー: " + error.message);
      return;
    }

    setMasterMessage("費目を削除しました");
    await loadData();
  };

  const startEditTransaction = (t: TransactionListRow) => {
    setEditingId(t.id);
    setEditDate(t.txn_date || "");
    setEditAmount(String(t.amount ?? ""));
    setEditCategoryId(t.category_id || "");
    setEditAccountId(t.payment_account_id || "");
    setEditMerchantName(t.merchant_name || "");
    setEditMemo(t.description || "");
  };

  const saveEditTransaction = async (id: string) => {
    if (!editDate) {
      setMessage("編集用の日付を入力してください");
      return;
    }

    if (!editAmount || Number(editAmount) <= 0) {
      setMessage("編集用の金額を入力してください");
      return;
    }

    const { error } = await supabase
      .from("transaction_records")
      .update({
        txn_date: editDate,
        posting_date: editDate,
        amount: Number(editAmount),
        category_id: editCategoryId || null,
        payment_account_id: editAccountId || null,
        merchant_name: editMerchantName || null,
        description: editMemo || null,
        statement_month: editDate.slice(0, 7),
      })
      .eq("id", id);

    if (error) {
      setMessage("更新エラー: " + error.message);
      return;
    }

    setMessage("更新しました");
    cancelEditTransaction();
    await loadTransactions();
  };

  const cancelEditTransaction = () => {
    setEditingId(null);
    setEditDate("");
    setEditAmount("");
    setEditCategoryId("");
    setEditAccountId("");
    setEditMerchantName("");
    setEditMemo("");
  };

  const deleteTransaction = async (id: string) => {
    const ok = window.confirm("この明細を削除しますか？");
    if (!ok) return;

    const { error } = await supabase
      .from("transaction_records")
      .delete()
      .eq("id", id);

    if (error) {
      setMessage("削除エラー: " + error.message);
      return;
    }

    setMessage("削除しました");
    await loadTransactions();
  };

  if (authLoading) {
    return (
      <div style={{ maxWidth: "560px", margin: "0 auto", padding: "16px" }}>
        読み込み中...
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ maxWidth: "560px", margin: "0 auto", padding: "16px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "16px" }}>
          家計簿ログイン
        </h1>

        <div style={{ display: "grid", gap: "12px" }}>
          <div>
            <div style={{ marginBottom: "4px" }}>メールアドレス</div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: "100%", padding: "8px" }}
            />
          </div>

          <div>
            <div style={{ marginBottom: "4px" }}>パスワード</div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: "100%", padding: "8px" }}
            />
          </div>

          <button
            onClick={signIn}
            style={{
              padding: "12px",
              background: "#111827",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
            }}
          >
            ログイン
          </button>

          <div>{authMessage}</div>
        </div>
      </div>
    );
  }

  const th: React.CSSProperties = {
    padding: "8px",
    textAlign: "left",
    borderBottom: "1px solid #ccc",
    whiteSpace: "nowrap",
  };

  const td: React.CSSProperties = {
    padding: "8px",
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ maxWidth: "560px", margin: "0 auto", padding: "16px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
          gap: "8px",
        }}
      >
        <h1 style={{ fontSize: "24px", fontWeight: "bold", margin: 0 }}>
          家計簿
        </h1>
        <button
          onClick={signOut}
          style={{
            padding: "8px 12px",
            background: "#e5e7eb",
            color: "#111827",
            border: "none",
            borderRadius: "8px",
          }}
        >
          ログアウト
        </button>
      </div>

      <div style={{ marginBottom: "12px", fontSize: "12px", color: "#555" }}>
        ログイン中: {user.email}
      </div>

      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        <button
          onClick={() => setScreenMode("entry")}
          style={{
            flex: 1,
            padding: "10px",
            borderRadius: "8px",
            border: "none",
            background: screenMode === "entry" ? "#111827" : "#e5e7eb",
            color: screenMode === "entry" ? "#fff" : "#111827",
          }}
        >
          入力
        </button>
        <button
          onClick={async () => {
            setScreenMode("list");
            await loadTransactions();
          }}
          style={{
            flex: 1,
            padding: "10px",
            borderRadius: "8px",
            border: "none",
            background: screenMode === "list" ? "#111827" : "#e5e7eb",
            color: screenMode === "list" ? "#fff" : "#111827",
          }}
        >
          一覧
        </button>
        <button
          onClick={() => setScreenMode("masters")}
          style={{
            flex: 1,
            padding: "10px",
            borderRadius: "8px",
            border: "none",
            background: screenMode === "masters" ? "#111827" : "#e5e7eb",
            color: screenMode === "masters" ? "#fff" : "#111827",
          }}
        >
          項目管理
        </button>
      </div>

      {screenMode === "entry" && (
        <div style={{ display: "grid", gap: "12px" }}>
          <div>
            <div style={{ marginBottom: "4px" }}>財布</div>
            <select
              value={walletId}
              onChange={(e) => setWalletId(e.target.value)}
              style={{ width: "100%", padding: "8px" }}
            >
              <option value="">選択してください</option>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.wallet_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={{ marginBottom: "4px" }}>日付</div>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{ width: "100%", padding: "8px" }}
            />
          </div>

          <div>
            <div style={{ marginBottom: "4px" }}>金額</div>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={{ width: "100%", padding: "8px" }}
            />
          </div>

          <div>
            <div style={{ marginBottom: "4px" }}>費目</div>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              style={{ width: "100%", padding: "8px" }}
            >
              <option value="">選択してください</option>
              {filteredCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.major_category} / {c.minor_category}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={{ marginBottom: "4px" }}>支払元</div>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              style={{ width: "100%", padding: "8px" }}
            >
              <option value="">選択してください</option>
              {filteredAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.account_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={{ marginBottom: "4px" }}>支払先（候補選択・自由入力）</div>
            <input
              list="merchant-candidates"
              value={merchantName}
              onChange={(e) => setMerchantName(e.target.value)}
              style={{ width: "100%", padding: "8px" }}
              placeholder="例: 西友 / セブンイレブン / ENEOS"
            />
            <datalist id="merchant-candidates">
              {merchantCandidates.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>

          <div>
            <div style={{ marginBottom: "4px" }}>メモ</div>
            <input
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              style={{ width: "100%", padding: "8px" }}
            />
          </div>

          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: "8px",
              padding: "12px",
              display: "grid",
              gap: "8px",
            }}
          >
            <div style={{ fontWeight: "bold" }}>税・レシート分割</div>

            <div>
              <div style={{ marginBottom: "4px" }}>税区分</div>
              <select
                value={taxMode}
                onChange={(e) => setTaxMode(e.target.value)}
                style={{ width: "100%", padding: "8px" }}
              >
                <option value="none">税なし</option>
                <option value="inclusive">内税</option>
                <option value="exclusive">外税</option>
              </select>
            </div>

            {taxMode !== "none" && (
              <>
                <div>
                  <div style={{ marginBottom: "4px" }}>税率(%)</div>
                  <input
                    type="number"
                    value={taxRate}
                    onChange={(e) => setTaxRate(e.target.value)}
                    style={{ width: "100%", padding: "8px" }}
                  />
                </div>

                <div>
                  <div style={{ marginBottom: "4px" }}>税額（空欄なら自動計算）</div>
                  <input
                    type="number"
                    value={taxAmount}
                    onChange={(e) => setTaxAmount(e.target.value)}
                    style={{ width: "100%", padding: "8px" }}
                    placeholder={
                      calcTaxAmount() === null ? "" : `自動計算: ${calcTaxAmount()}`
                    }
                  />
                </div>
              </>
            )}

            <label style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={continueReceipt}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setContinueReceipt(checked);
                  if (!checked) {
                    setReceiptGroupId("");
                    setReceiptLineNo(1);
                  }
                }}
              />
              同じレシートを続けて登録する
            </label>

            {continueReceipt && (
              <div style={{ fontSize: "12px", color: "#555" }}>
                {receiptGroupId
                  ? `同一レシート番号: ${receiptGroupId} / 行番号: ${receiptLineNo}`
                  : "最初の1件を保存すると同一レシート番号が付きます"}
              </div>
            )}
          </div>

          <button
            onClick={saveExpense}
            style={{
              padding: "12px",
              background: "#111827",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
            }}
          >
            保存
          </button>

          <div style={{ fontSize: "12px", color: "#555" }}>
            同じレシート内で「飲食費」と「日用品」を分けたい場合は、
            「同じレシートを続けて登録する」にチェックを入れて続けて保存してください。
          </div>

          <div>{message}</div>
        </div>
      )}

      {screenMode === "list" && (
  <div style={{ display: "grid", gap: "12px" }}>
    <div
      style={{
        display: "grid",
        gap: "10px",
        border: "1px solid #ddd",
        borderRadius: "8px",
        padding: "12px",
        background: "#fff",
      }}
    >
      <div style={{ fontWeight: "bold" }}>一覧条件</div>

      <div
        style={{
          display: "grid",
          gap: "10px",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        }}
      >
        <div>
          <div style={{ marginBottom: "4px" }}>月</div>
          <input
            type="month"
            value={listMonth}
            onChange={(e) => setListMonth(e.target.value)}
            style={{ width: "100%", padding: "8px" }}
          />
        </div>

        <div>
          <div style={{ marginBottom: "4px" }}>財布</div>
          <select
            value={listWalletId}
            onChange={(e) => setListWalletId(e.target.value)}
            style={{ width: "100%", padding: "8px" }}
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

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontWeight: "bold" }}>
          合計: {listTotalAmount.toLocaleString()}円
        </div>

        <button
          onClick={async () => {
            await loadTransactions();
          }}
          style={{
            padding: "8px 12px",
            background: "#e5e7eb",
            border: "none",
            borderRadius: "8px",
          }}
        >
          再読込
        </button>
      </div>
    </div>

    {listLoading && <div>読み込み中...</div>}

    {!listLoading && transactions.length === 0 && (
      <div>該当する明細がありません。</div>
    )}

    {!listLoading && transactions.length > 0 && (
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            borderCollapse: "collapse",
            width: "100%",
            minWidth: "980px",
            background: "#fff",
          }}
        >
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              <th style={th}>日付</th>
              <th style={th}>金額</th>
              <th style={th}>費目</th>
              <th style={th}>支払元</th>
              <th style={th}>支払先</th>
              <th style={th}>メモ</th>
              <th style={th}>税</th>
              <th style={th}>レシート</th>
              <th style={th}>操作</th>
            </tr>
          </thead>

          <tbody>
  {transactions.map((t) => {
    const category = Array.isArray(t.categories)
      ? t.categories[0]
      : t.categories;

    const account = Array.isArray(t.accounts)
      ? t.accounts[0]
      : t.accounts;

    const isEditing = editingId === t.id;

    return (
      <tr key={t.id} style={{ borderBottom: "1px solid #ddd" }}>
        <td style={td}>
          {isEditing ? (
            <input
              type="date"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
              style={{ width: "140px", padding: "6px" }}
            />
          ) : (
            t.txn_date
          )}
        </td>

        <td style={{ ...td, textAlign: "right" }}>
          {isEditing ? (
            <input
              type="number"
              value={editAmount}
              onChange={(e) => setEditAmount(e.target.value)}
              style={{ width: "100px", padding: "6px" }}
            />
          ) : (
            `${Number(t.amount).toLocaleString()}円`
          )}
        </td>

        <td style={td}>
          {isEditing ? (
            <select
              value={editCategoryId}
              onChange={(e) => setEditCategoryId(e.target.value)}
              style={{ width: "180px", padding: "6px" }}
            >
              <option value="">選択してください</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.major_category} / {c.minor_category}
                </option>
              ))}
            </select>
          ) : category ? (
            `${category.major_category} / ${category.minor_category}`
          ) : (
            "-"
          )}
        </td>

        <td style={td}>
          {isEditing ? (
            <select
              value={editAccountId}
              onChange={(e) => setEditAccountId(e.target.value)}
              style={{ width: "150px", padding: "6px" }}
            >
              <option value="">選択してください</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.account_name}
                </option>
              ))}
            </select>
          ) : (
            account ? account.account_name : "-"
          )}
        </td>

        <td style={td}>
          {isEditing ? (
            <>
              <input
                list="merchant-candidates"
                value={editMerchantName}
                onChange={(e) => setEditMerchantName(e.target.value)}
                style={{ width: "160px", padding: "6px" }}
              />
              <datalist id="merchant-candidates">
                {merchantCandidates.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </>
          ) : (
            t.merchant_name || "-"
          )}
        </td>

        <td style={td}>
          {isEditing ? (
            <input
              value={editMemo}
              onChange={(e) => setEditMemo(e.target.value)}
              style={{ width: "180px", padding: "6px" }}
            />
          ) : (
            t.description || "-"
          )}
        </td>

        <td style={td}>
          {t.tax_mode && t.tax_mode !== "none"
            ? `${t.tax_mode} ${t.tax_rate ?? ""}% (${t.tax_amount ?? ""})`
            : "-"}
        </td>

        <td style={td}>
          {t.receipt_group_id
            ? `${t.receipt_group_id.slice(0, 8)}...-${t.receipt_line_no ?? ""}`
            : "-"}
        </td>

        <td style={td}>
          <div style={{ display: "flex", gap: "6px" }}>
            {isEditing ? (
              <>
                <button
                  onClick={async () => {
                    await saveEditTransaction(t.id);
                  }}
                  style={{
                    padding: "6px 10px",
                    background: "#2563eb",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                  }}
                >
                  保存
                </button>
                <button
                  onClick={cancelEditTransaction}
                  style={{
                    padding: "6px 10px",
                    background: "#6b7280",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                  }}
                >
                  戻す
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => startEditTransaction(t)}
                  style={{
                    padding: "6px 10px",
                    background: "#2563eb",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                  }}
                >
                  編集
                </button>
                <button
                  onClick={async () => {
                    await deleteTransaction(t.id);
                  }}
                  style={{
                    padding: "6px 10px",
                    background: "#dc2626",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                  }}
                >
                  削除
                </button>
              </>
            )}
          </div>
        </td>
      </tr>
    );
  })}
</tbody>
        </table>
      </div>
    )}
  </div>
)}

      {screenMode === "masters" && (
        <div style={{ display: "grid", gap: "20px" }}>
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: "8px",
              padding: "12px",
            }}
          >
            <h2 style={{ marginTop: 0, fontSize: "18px" }}>支払元追加</h2>

            <div style={{ display: "grid", gap: "8px" }}>
              <div>
                <div style={{ marginBottom: "4px" }}>財布</div>
                <select
                  value={newAccountWalletId}
                  onChange={(e) => setNewAccountWalletId(e.target.value)}
                  style={{ width: "100%", padding: "8px" }}
                >
                  <option value="">選択してください</option>
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.wallet_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div style={{ marginBottom: "4px" }}>名称</div>
                <input
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  style={{ width: "100%", padding: "8px" }}
                  placeholder="例: 三菱UFJ銀行 / VISAカード / 現金"
                />
              </div>

              <div>
                <div style={{ marginBottom: "4px" }}>種類</div>
                <select
                  value={newAccountType}
                  onChange={(e) => setNewAccountType(e.target.value)}
                  style={{ width: "100%", padding: "8px" }}
                >
                  <option value="cash">cash</option>
                  <option value="bank">bank</option>
                  <option value="credit_card">credit_card</option>
                  <option value="emoney">emoney</option>
                  <option value="prepaid">prepaid</option>
                </select>
              </div>

              <button
                onClick={addAccount}
                style={{
                  padding: "10px",
                  background: "#111827",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                }}
              >
                支払元を追加
              </button>
            </div>
          </div>

          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: "8px",
              padding: "12px",
            }}
          >
            <h2 style={{ marginTop: 0, fontSize: "18px" }}>費目追加</h2>

            <div style={{ display: "grid", gap: "8px" }}>
              <div>
                <div style={{ marginBottom: "4px" }}>対象</div>
                <select
                  value={newCategoryWalletType}
                  onChange={(e) => setNewCategoryWalletType(e.target.value)}
                  style={{ width: "100%", padding: "8px" }}
                >
                  <option value="household">household</option>
                  <option value="allowance">allowance</option>
                </select>
              </div>

              <div>
                <div style={{ marginBottom: "4px" }}>大分類</div>
                <input
                  value={newMajorCategory}
                  onChange={(e) => setNewMajorCategory(e.target.value)}
                  style={{ width: "100%", padding: "8px" }}
                  placeholder="例: 車関連 / バイク関連 / 飲食費"
                />
              </div>

              <div>
                <div style={{ marginBottom: "4px" }}>中分類</div>
                <input
                  value={newMinorCategory}
                  onChange={(e) => setNewMinorCategory(e.target.value)}
                  style={{ width: "100%", padding: "8px" }}
                  placeholder="例: ガソリン / 整備 / 外食"
                />
              </div>

              <div>
                <div style={{ marginBottom: "4px" }}>種類</div>
                <select
                  value={newCategoryKind}
                  onChange={(e) => setNewCategoryKind(e.target.value)}
                  style={{ width: "100%", padding: "8px" }}
                >
                  <option value="expense_normal">expense_normal</option>
                  <option value="expense_special">expense_special</option>
                  <option value="income">income</option>
                  <option value="transfer">transfer</option>
                  <option value="charge">charge</option>
                </select>
              </div>

              <button
                onClick={addCategory}
                style={{
                  padding: "10px",
                  background: "#111827",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                }}
              >
                費目を追加
              </button>
            </div>
          </div>

          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: "8px",
              padding: "12px",
            }}
          >
            <h2 style={{ marginTop: 0, fontSize: "18px" }}>現在の支払元</h2>

            <div style={{ display: "grid", gap: "8px" }}>
              {accounts.map((a) => (
                <div
                  key={a.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "8px",
                    borderBottom: "1px solid #eee",
                    paddingBottom: "6px",
                  }}
                >
                  <div style={{ fontSize: "14px" }}>
                    {a.account_name} ({a.account_type})
                  </div>

                  <button
                    onClick={async () => {
                      await deleteAccount(a.id, a.account_name);
                    }}
                    style={{
                      padding: "6px 10px",
                      background: "#dc2626",
                      color: "#fff",
                      border: "none",
                      borderRadius: "6px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: "8px",
              padding: "12px",
            }}
          >
            <h2 style={{ marginTop: 0, fontSize: "18px" }}>現在の費目</h2>

            <div style={{ display: "grid", gap: "8px" }}>
              {categories.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "8px",
                    borderBottom: "1px solid #eee",
                    paddingBottom: "6px",
                  }}
                >
                  <div style={{ fontSize: "14px" }}>
                    [{c.wallet_type}] {c.major_category} / {c.minor_category}
                  </div>

                  <button
                    onClick={async () => {
                      await deleteCategory(c.id, c.major_category, c.minor_category);
                    }}
                    style={{
                      padding: "6px 10px",
                      background: "#dc2626",
                      color: "#fff",
                      border: "none",
                      borderRadius: "6px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>{masterMessage}</div>
        </div>
      )}
    </div>
  );
}