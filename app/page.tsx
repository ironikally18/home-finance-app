"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient, User } from "@supabase/supabase-js";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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

type MerchantMasterRow = {
  id: string;
  merchant_name: string;
  display_order: number;
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
  direction: string;
};

type ScreenMode = "entry" | "list" | "masters";

function costKindLabel(value: string | null | undefined) {
  if (value === "fixed") return "固定費";
  if (value === "semi") return "準固定費";
  if (value === "variable") return "変動費";
  if (value === "exclude") return "対象外";
  return "未設定";
}

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

  const [merchantMasters, setMerchantMasters] = useState<MerchantMasterRow[]>([]);
  const [newMerchantName, setNewMerchantName] = useState("");

  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingMerchantMasterId, setEditingMerchantMasterId] = useState<string | null>(null);

  const [editAccountName, setEditAccountName] = useState("");
  const [editAccountType, setEditAccountType] = useState("cash");

  const [editCategoryMajor, setEditCategoryMajor] = useState("");
  const [editCategoryMinor, setEditCategoryMinor] = useState("");
  const [editCategoryKind, setEditCategoryKind] = useState("expense_normal");
  const [editCategoryWalletType, setEditCategoryWalletType] = useState("household");

  const [editMerchantMasterName, setEditMerchantMasterName] = useState("");

  const [transactions, setTransactions] = useState<TransactionListRow[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [editAccountId, setEditAccountId] = useState("");
  const [editMerchantName, setEditMerchantName] = useState("");
  const [editMemo, setEditMemo] = useState("");
  const [editDirection, setEditDirection] =
    useState<"expense" | "income" | "transfer">("expense");

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
  const [newCategoryKind, setNewCategoryKind] = useState("variable");

  const [keepPreviousInput, setKeepPreviousInput] = useState(true);
  const [entryDirection, setEntryDirection] =
    useState<"expense" | "income" | "transfer">("expense");

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
      .select("id, account_name, account_type, wallet_id, display_order")
      .order("display_order", { ascending: true });

    const { data: c, error: cErr } = await supabase
      .from("categories")
      .select("id, wallet_type, major_category, minor_category, category_kind, display_order")
      .order("display_order", { ascending: true });

    const { data: mm, error: mmErr } = await supabase
      .from("merchant_masters")
      .select("id, merchant_name, display_order")
      .eq("is_active", true)
      .order("display_order", { ascending: true });

    if (wErr || aErr || cErr || mmErr) {
      setMessage(
        "読込エラー: " +
        [wErr?.message, aErr?.message, cErr?.message, mmErr?.message]
          .filter(Boolean)
          .join(" / ")
      );
      return;
    }

    const walletsData = (w as WalletRow[]) || [];
    const accountsData = (a as AccountRow[]) || [];
    const categoriesData = (c as CategoryRow[]) || [];
    const merchantMasterData = (mm as MerchantMasterRow[]) || [];

    setWallets(walletsData);
    setAccounts(accountsData);
    setCategories(categoriesData);
    setMerchantMasters(merchantMasterData);
    setMerchantCandidates(merchantMasterData.map((x) => x.merchant_name));

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
        direction,
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

      const [y, m] = listMonth.split("-").map(Number);
      const nextY = m === 12 ? y + 1 : y;
      const nextM = m === 12 ? 1 : m + 1;

      const to = `${nextY}-${String(nextM).padStart(2, "0")}-01`;

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

    return categories.filter((c) => {
      const walletOk = c.wallet_type === walletType || c.wallet_type === null;

      if (entryDirection === "income") {
        return (
          walletOk &&
          (c.major_category === "収入" ||
            c.major_category === "おこづかい収入")
        );
      }

      if (entryDirection === "transfer") {
        return walletOk && c.major_category === "資金移動";
      }

      return (
        walletOk &&
        c.major_category !== "収入" &&
        c.major_category !== "おこづかい収入" &&
        c.major_category !== "資金移動" &&
        c.category_kind !== "exclude"
      );
    });
  }, [categories, selectedWallet, entryDirection]);

  const listTotalAmount = useMemo(() => {
    return transactions.reduce((sum, row) => {
      if (row.direction === "income") {
        return sum + Number(row.amount || 0);
      }

      if (row.direction === "expense") {
        return sum - Number(row.amount || 0);
      }

      return sum;
    }, 0);
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

      direction:
        entryDirection === "transfer" ? "transfer" : entryDirection,

      category_id: categoryId || null,

      payment_account_id:
        entryDirection === "expense"
          ? accountId || null
          : null,

      receive_account_id:
        entryDirection === "income"
          ? accountId || null
          : null,

      merchant_name: merchantName || null,
      description: memo || null,

      transaction_type:
        entryDirection === "income"
          ? "income"
          : entryDirection === "transfer"
            ? "transfer"
            : "cash_expense",
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
    setMemo("");

    if (!keepPreviousInput) {
      setCategoryId("");
      setAccountId("");
      setMerchantName("");
    }
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
    setEditDirection(
      (t.direction as "expense" | "income") || "expense"
    );
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
        direction: editDirection,
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

  const reorderAccounts = async (reordered: AccountRow[]) => {
    for (let i = 0; i < reordered.length; i++) {
      const { error } = await supabase
        .from("accounts")
        .update({ display_order: i + 1 })
        .eq("id", reordered[i].id);
      if (error) { setMasterMessage("支払元並び替えエラー: " + error.message); return; }
    }
    setMasterMessage("支払元の並び順を変更しました");
    await loadData();
  };

  const reorderCategories = async (reordered: CategoryRow[]) => {
    for (let i = 0; i < reordered.length; i++) {
      const { error } = await supabase
        .from("categories")
        .update({ display_order: i + 1 })
        .eq("id", reordered[i].id);
      if (error) { setMasterMessage("費目並び替えエラー: " + error.message); return; }
    }
    setMasterMessage("費目の並び順を変更しました");
    await loadData();
  };

  const addMerchantMaster = async () => {
    setMasterMessage("");

    if (!user) {
      setMasterMessage("ログインしてください");
      return;
    }

    if (!newMerchantName.trim()) {
      setMasterMessage("支払先名を入力してください");
      return;
    }

    const maxOrder =
      merchantMasters.length > 0
        ? Math.max(...merchantMasters.map((x) => x.display_order ?? 0))
        : 0;

    const { error } = await supabase.from("merchant_masters").insert({
      user_id: user.id,
      merchant_name: newMerchantName.trim(),
      is_active: true,
      display_order: maxOrder + 1,
    });

    if (error) {
      setMasterMessage("支払先追加エラー: " + error.message);
      return;
    }

    setMasterMessage("支払先候補を追加しました");
    setNewMerchantName("");
    await loadData();
  };

  const deleteMerchantMaster = async (id: string, name: string) => {
    const ok = window.confirm(`支払先候補「${name}」を削除しますか？`);
    if (!ok) return;

    const { error } = await supabase
      .from("merchant_masters")
      .delete()
      .eq("id", id);

    if (error) {
      setMasterMessage("支払先削除エラー: " + error.message);
      return;
    }

    setMasterMessage("支払先候補を削除しました");
    await loadData();
  };

  const reorderMerchantMasters = async (reordered: MerchantMasterRow[]) => {
    for (let i = 0; i < reordered.length; i++) {
      const { error } = await supabase
        .from("merchant_masters")
        .update({ display_order: i + 1 })
        .eq("id", reordered[i].id);
      if (error) { setMasterMessage("支払先並び替えエラー: " + error.message); return; }
    }
    setMasterMessage("支払先候補の並び順を変更しました");
    await loadData();
  };

  const startEditAccount = (a: AccountRow) => {
    setEditingAccountId(a.id);
    setEditAccountName(a.account_name);
    setEditAccountType(a.account_type);
  };

  const saveEditAccount = async (id: string) => {
    const name = editAccountName.trim();

    if (!name) {
      setMasterMessage("支払元名を入力してください");
      return;
    }

    const { error } = await supabase
      .from("accounts")
      .update({
        account_name: name,
        account_type: editAccountType,
      })
      .eq("id", id);

    if (error) {
      setMasterMessage("支払元更新エラー: " + error.message);
      return;
    }

    setMasterMessage(`支払元を更新しました: ${name}`);
    setEditingAccountId(null);
    setEditAccountName("");
    setEditAccountType("cash");
    await loadData();
  };

  const startEditCategory = (c: CategoryRow) => {
    setEditingCategoryId(c.id);
    setEditCategoryWalletType(c.wallet_type || "household");
    setEditCategoryMajor(c.major_category);
    setEditCategoryMinor(c.minor_category);
    setEditCategoryKind(c.category_kind || "variable");
  };

  const saveEditCategory = async (id: string) => {
    const major = editCategoryMajor.trim();
    const minor = editCategoryMinor.trim();

    if (!major || !minor) {
      setMasterMessage("大分類と中分類を入力してください");
      return;
    }

    const { error } = await supabase
      .from("categories")
      .update({
        wallet_type: editCategoryWalletType,
        major_category: major,
        minor_category: minor,
        category_kind: editCategoryKind,
      })
      .eq("id", id);

    if (error) {
      setMasterMessage("費目更新エラー: " + error.message);
      return;
    }

    setMasterMessage(`費目を更新しました: ${major} / ${minor}`);

    setEditingCategoryId(null);
    setEditCategoryWalletType("household");
    setEditCategoryMajor("");
    setEditCategoryMinor("");
    setEditCategoryKind("expense_normal");
    await loadData();
  };

  const startEditMerchantMaster = (m: MerchantMasterRow) => {
    setEditingMerchantMasterId(m.id);
    setEditMerchantMasterName(m.merchant_name);
  };

  const saveEditMerchantMaster = async (id: string) => {
    const { error } = await supabase
      .from("merchant_masters")
      .update({
        merchant_name: editMerchantMasterName.trim(),
      })
      .eq("id", id);

    if (error) {
      setMasterMessage("支払先更新エラー: " + error.message);
      return;
    }

    setMasterMessage("支払先候補を更新しました");
    setEditingMerchantMasterId(null);
    setEditMerchantMasterName("");
    await loadData();
  };

  const directionLabel = (direction: string | null) => {
    if (direction === "income") return "収入";
    if (direction === "transfer") return "資金移動";
    return "支出";
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
    borderBottom: "1px solid #374151",
    whiteSpace: "nowrap",
    color: "#f9fafb",
    background: "#1f2937",
  };

  const td: React.CSSProperties = {
    padding: "8px",
    whiteSpace: "nowrap",
    color: "#f9fafb",
    background: "#111827",
    borderBottom: "1px solid #374151",
  };


  return (
    <div style={{ maxWidth: "560px", margin: "0 auto", padding: "16px", paddingBottom: "88px" }}>
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
        <a href="/graph">
          <button
            style={{
              padding: "10px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
            }}
          >
            📊
          </button>
        </a>
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
            <div style={{ marginBottom: "4px" }}>区分</div>
            <select
              value={entryDirection}
              onChange={(e) => {
                setEntryDirection(e.target.value as "expense" | "income" | "transfer");
                setCategoryId("");
              }}
              style={{ width: "100%", padding: "8px" }}
            >
              <option value="expense">支出</option>
              <option value="income">収入</option>
              <option value="transfer">資金移動</option>
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
            <div style={{ marginBottom: "4px" }}>
              {entryDirection === "income" ? "入金先" : "支払元"}
            </div>
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

          <label style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={keepPreviousInput}
              onChange={(e) => setKeepPreviousInput(e.target.checked)}
            />
            前回の費目・支払元・支払先を残す
          </label>

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
        <div
          style={{
            display: "grid",
            gap: "12px",
            background: "#111827",
            color: "#f9fafb",
            minHeight: "100vh",
            padding: "8px",
            borderRadius: "8px",
          }}
        >
          <div
            style={{
              display: "grid",
              gap: "10px",
              border: "1px solid #374151",
              borderRadius: "8px",
              padding: "12px",
              background: "#1f2937",
              color: "#f9fafb",
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
                差額: {listTotalAmount.toLocaleString()}円
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
            <div
              style={{
                overflowX: "auto",
                background: "#111827",
                borderRadius: "8px",
                border: "1px solid #374151",
              }}
            >
              <table
                style={{
                  borderCollapse: "collapse",
                  width: "100%",
                  minWidth: "980px",
                  background: "#111827",
                  color: "#f9fafb",
                }}
              >
                <thead>
                  <tr style={{ background: "#1f2937" }}>
                    <th style={th}>日付</th>
                    <th style={th}>区分</th>
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

                        <td style={td}>
                          {isEditing ? (
                            <select
                              value={editDirection}
                              onChange={(e) =>
                                setEditDirection(
                                  e.target.value as
                                  | "expense"
                                  | "income"
                                  | "transfer"
                                )
                              }
                              style={{ padding: "6px" }}
                            >
                              <option value="expense">支出</option>
                              <option value="income">収入</option>
                              <option value="transfer">資金移動</option>
                            </select>
                          ) : (
                            directionLabel(t.direction)
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
                                list="merchant-candidates-edit"
                                value={editMerchantName}
                                onChange={(e) => setEditMerchantName(e.target.value)}
                                style={{ width: "160px", padding: "6px" }}
                              />
                              <datalist id="merchant-candidates-edit">
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
                  width: "100%",
                  padding: "8px",
                  background: "#111827",
                  color: "#f9fafb",
                  border: "1px solid #374151",
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
                <div style={{ marginBottom: "4px" }}>指標分類</div>
                <select
                  value={newCategoryKind}
                  onChange={(e) => setNewCategoryKind(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px",
                    borderRadius: "10px",
                    border: "1px solid #d1d5db",
                    background: "#fff",
                  }}
                >
                  <option value="fixed">固定費</option>
                  <option value="semi">準固定費</option>
                  <option value="variable">変動費</option>
                  <option value="exclude">対象外</option>
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

          <SortableAccountList
            accounts={accounts}
            editingAccountId={editingAccountId}
            editAccountName={editAccountName}
            editAccountType={editAccountType}
            setEditAccountName={setEditAccountName}
            setEditAccountType={setEditAccountType}
            onSave={(id) => saveEditAccount(id)}
            onCancel={() => setEditingAccountId(null)}
            onEdit={startEditAccount}
            onDelete={(id, name) => deleteAccount(id, name)}
            onReorder={reorderAccounts}
          />

          <SortableCategoryList
            categories={categories}
            editingCategoryId={editingCategoryId}
            editCategoryWalletType={editCategoryWalletType}
            editCategoryMajor={editCategoryMajor}
            editCategoryMinor={editCategoryMinor}
            editCategoryKind={editCategoryKind}
            setEditCategoryWalletType={setEditCategoryWalletType}
            setEditCategoryMajor={setEditCategoryMajor}
            setEditCategoryMinor={setEditCategoryMinor}
            setEditCategoryKind={setEditCategoryKind}
            onSave={(id) => saveEditCategory(id)}
            onCancel={() => setEditingCategoryId(null)}
            onEdit={startEditCategory}
            onDelete={(id, major, minor) => deleteCategory(id, major, minor)}
            onReorder={reorderCategories}
          />

          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: "8px",
              padding: "12px",
            }}
          >
            <h2 style={{ marginTop: 0, fontSize: "18px" }}>支払先候補追加</h2>

            <div style={{ display: "grid", gap: "8px" }}>
              <div>
                <div style={{ marginBottom: "4px" }}>支払先名</div>
                <input
                  value={newMerchantName}
                  onChange={(e) => setNewMerchantName(e.target.value)}
                  style={{ width: "100%", padding: "8px" }}
                  placeholder="例: 西友 / セブンイレブン"
                />
              </div>
              <button
                onClick={addMerchantMaster}
                style={{
                  padding: "10px",
                  background: "#111827",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                }}
              >
                支払先候補を追加
              </button>
            </div>
          </div>

          <SortableMerchantList
            merchantMasters={merchantMasters}
            editingMerchantMasterId={editingMerchantMasterId}
            editMerchantMasterName={editMerchantMasterName}
            setEditMerchantMasterName={setEditMerchantMasterName}
            onSave={(id) => saveEditMerchantMaster(id)}
            onCancel={() => setEditingMerchantMasterId(null)}
            onEdit={startEditMerchantMaster}
            onDelete={(id, name) => deleteMerchantMaster(id, name)}
            onReorder={reorderMerchantMasters}
          />

          <div>{masterMessage}</div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}

const dragHandleStyle: React.CSSProperties = {
  cursor: "grab",
  padding: "4px 8px",
  color: "#9ca3af",
  fontSize: "18px",
  touchAction: "none",
  userSelect: "none",
};

function SortableItem({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        display: "flex",
        alignItems: "center",
        gap: "8px",
        borderBottom: "1px solid #eee",
        paddingBottom: "6px",
      }}
    >
      <span {...attributes} {...listeners} style={dragHandleStyle}>⠿</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

function SortableAccountList({
  accounts, editingAccountId, editAccountName, editAccountType,
  setEditAccountName, setEditAccountType,
  onSave, onCancel, onEdit, onDelete, onReorder,
}: {
  accounts: AccountRow[];
  editingAccountId: string | null;
  editAccountName: string;
  editAccountType: string;
  setEditAccountName: (v: string) => void;
  setEditAccountType: (v: string) => void;
  onSave: (id: string) => void;
  onCancel: () => void;
  onEdit: (a: AccountRow) => void;
  onDelete: (id: string, name: string) => void;
  onReorder: (reordered: AccountRow[]) => void;
}) {
  const [local, setLocal] = useState(accounts);
  useEffect(() => { setLocal(accounts); }, [accounts]);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(TouchSensor));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = local.findIndex((a) => a.id === active.id);
    const newIndex = local.findIndex((a) => a.id === over.id);
    const reordered = arrayMove(local, oldIndex, newIndex);
    setLocal(reordered);
    onReorder(reordered);
  };

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: "8px", padding: "12px" }}>
      <h2 style={{ marginTop: 0, fontSize: "18px" }}>現在の支払元</h2>
      <div style={{ fontSize: "12px", color: "#888", marginBottom: "8px" }}>⠿ をドラッグして並び替え</div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={local.map((a) => a.id)} strategy={verticalListSortingStrategy}>
          <div style={{ display: "grid", gap: "4px" }}>
            {local.map((a) => {
              const isEditing = editingAccountId === a.id;
              return (
                <SortableItem key={a.id} id={a.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <div style={{ fontSize: "14px", flex: 1 }}>
                      {isEditing ? (
                        <div style={{ display: "grid", gap: "6px" }}>
                          <input value={editAccountName} onChange={(e) => setEditAccountName(e.target.value)} style={{ width: "100%", padding: "6px" }} />
                          <select value={editAccountType} onChange={(e) => setEditAccountType(e.target.value)} style={{ width: "100%", padding: "6px" }}>
                            <option value="cash">cash</option>
                            <option value="bank">bank</option>
                            <option value="credit_card">credit_card</option>
                            <option value="emoney">emoney</option>
                            <option value="prepaid">prepaid</option>
                          </select>
                        </div>
                      ) : `${a.account_name} (${a.account_type})`}
                    </div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      {isEditing ? (
                        <><button onClick={() => onSave(a.id)}>保存</button><button onClick={onCancel}>戻す</button></>
                      ) : (
                        <button onClick={() => onEdit(a)}>編集</button>
                      )}
                      <button onClick={() => onDelete(a.id, a.account_name)} style={{ background: "#dc2626", color: "#fff", border: "none", borderRadius: "6px", padding: "6px 10px" }}>削除</button>
                    </div>
                  </div>
                </SortableItem>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableCategoryList({
  categories, editingCategoryId,
  editCategoryWalletType, editCategoryMajor, editCategoryMinor, editCategoryKind,
  setEditCategoryWalletType, setEditCategoryMajor, setEditCategoryMinor, setEditCategoryKind,
  onSave, onCancel, onEdit, onDelete, onReorder,
}: {
  categories: CategoryRow[];
  editingCategoryId: string | null;
  editCategoryWalletType: string;
  editCategoryMajor: string;
  editCategoryMinor: string;
  editCategoryKind: string;
  setEditCategoryWalletType: (v: string) => void;
  setEditCategoryMajor: (v: string) => void;
  setEditCategoryMinor: (v: string) => void;
  setEditCategoryKind: (v: string) => void;
  onSave: (id: string) => void;
  onCancel: () => void;
  onEdit: (c: CategoryRow) => void;
  onDelete: (id: string, major: string, minor: string) => void;
  onReorder: (reordered: CategoryRow[]) => void;
}) {
  const [local, setLocal] = useState(categories);
  useEffect(() => { setLocal(categories); }, [categories]);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(TouchSensor));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = local.findIndex((c) => c.id === active.id);
    const newIndex = local.findIndex((c) => c.id === over.id);
    const reordered = arrayMove(local, oldIndex, newIndex);
    setLocal(reordered);
    onReorder(reordered);
  };

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: "8px", padding: "12px" }}>
      <h2 style={{ marginTop: 0, fontSize: "18px" }}>現在の費目</h2>
      <div style={{ fontSize: "12px", color: "#888", marginBottom: "8px" }}>⠿ をドラッグして並び替え</div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={local.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <div style={{ display: "grid", gap: "4px" }}>
            {local.map((c) => {
              const isEditing = editingCategoryId === c.id;
              return (
                <SortableItem key={c.id} id={c.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <div style={{ fontSize: "14px", flex: 1 }}>
                      {isEditing ? (
                        <div style={{ display: "grid", gap: "6px" }}>
                          <select value={editCategoryWalletType} onChange={(e) => setEditCategoryWalletType(e.target.value)} style={{ width: "100%", padding: "6px" }}>
                            <option value="household">household</option>
                            <option value="allowance">allowance</option>
                          </select>
                          <input value={editCategoryMajor} onChange={(e) => setEditCategoryMajor(e.target.value)} style={{ width: "100%", padding: "6px" }} />
                          <input value={editCategoryMinor} onChange={(e) => setEditCategoryMinor(e.target.value)} style={{ width: "100%", padding: "6px" }} />
                          <select value={editCategoryKind} onChange={(e) => setEditCategoryKind(e.target.value)} style={{ width: "100%", padding: "8px", borderRadius: "10px", border: "1px solid #d1d5db", background: "#fff" }}>
                            <option value="fixed">固定費</option>
                            <option value="semi">準固定費</option>
                            <option value="variable">変動費</option>
                            <option value="exclude">対象外</option>
                          </select>
                        </div>
                      ) : `[${c.wallet_type}] ${c.major_category} / ${c.minor_category}（${costKindLabel(c.category_kind)}）`}
                    </div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      {isEditing ? (
                        <><button onClick={() => onSave(c.id)}>保存</button><button onClick={onCancel}>戻す</button></>
                      ) : (
                        <button onClick={() => onEdit(c)}>編集</button>
                      )}
                      <button onClick={() => onDelete(c.id, c.major_category, c.minor_category)} style={{ background: "#dc2626", color: "#fff", border: "none", borderRadius: "6px", padding: "6px 10px" }}>削除</button>
                    </div>
                  </div>
                </SortableItem>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableMerchantList({
  merchantMasters, editingMerchantMasterId, editMerchantMasterName,
  setEditMerchantMasterName, onSave, onCancel, onEdit, onDelete, onReorder,
}: {
  merchantMasters: MerchantMasterRow[];
  editingMerchantMasterId: string | null;
  editMerchantMasterName: string;
  setEditMerchantMasterName: (v: string) => void;
  onSave: (id: string) => void;
  onCancel: () => void;
  onEdit: (m: MerchantMasterRow) => void;
  onDelete: (id: string, name: string) => void;
  onReorder: (reordered: MerchantMasterRow[]) => void;
}) {
  const [local, setLocal] = useState(merchantMasters);
  useEffect(() => { setLocal(merchantMasters); }, [merchantMasters]);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(TouchSensor));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = local.findIndex((m) => m.id === active.id);
    const newIndex = local.findIndex((m) => m.id === over.id);
    const reordered = arrayMove(local, oldIndex, newIndex);
    setLocal(reordered);
    onReorder(reordered);
  };

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: "8px", padding: "12px" }}>
      <h2 style={{ marginTop: 0, fontSize: "18px" }}>現在の支払先候補</h2>
      <div style={{ fontSize: "12px", color: "#888", marginBottom: "8px" }}>⠿ をドラッグして並び替え</div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={local.map((m) => m.id)} strategy={verticalListSortingStrategy}>
          <div style={{ display: "grid", gap: "4px" }}>
            {local.map((m) => {
              const isEditing = editingMerchantMasterId === m.id;
              return (
                <SortableItem key={m.id} id={m.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <div style={{ fontSize: "14px", flex: 1 }}>
                      {isEditing ? (
                        <input value={editMerchantMasterName} onChange={(e) => setEditMerchantMasterName(e.target.value)} style={{ width: "100%", padding: "6px" }} />
                      ) : m.merchant_name}
                    </div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      {isEditing ? (
                        <><button onClick={() => onSave(m.id)}>保存</button><button onClick={onCancel}>戻す</button></>
                      ) : (
                        <button onClick={() => onEdit(m)}>編集</button>
                      )}
                      <button onClick={() => onDelete(m.id, m.merchant_name)} style={{ background: "#dc2626", color: "#fff", border: "none", borderRadius: "6px", padding: "6px 10px" }}>削除</button>
                    </div>
                  </div>
                </SortableItem>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
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
