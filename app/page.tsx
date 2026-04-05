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

type ScreenMode = "entry" | "masters";

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

  const [walletId, setWalletId] = useState("");
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [memo, setMemo] = useState("");
  const [message, setMessage] = useState("");

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

    if (wErr || aErr || cErr) {
      setMessage(
        "読込エラー: " +
          [wErr?.message, aErr?.message, cErr?.message]
            .filter(Boolean)
            .join(" / ")
      );
      return;
    }

    const walletsData = (w as WalletRow[]) || [];
    const accountsData = (a as AccountRow[]) || [];
    const categoriesData = (c as CategoryRow[]) || [];

    setWallets(walletsData);
    setAccounts(accountsData);
    setCategories(categoriesData);

    if (walletsData.length > 0 && !walletId) {
      setWalletId(walletsData[0].id);
    }

    if (walletsData.length > 0 && !newAccountWalletId) {
      setNewAccountWalletId(walletsData[0].id);
    }
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
      return c.wallet_type === walletType || c.wallet_type === null;
    });
  }, [categories, selectedWallet]);

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
    });

    if (error) {
      setMessage("保存エラー: " + error.message);
      return;
    }

    setMessage("保存しました");
    setAmount("");
    setCategoryId("");
    setAccountId("");
    setMerchantName("");
    setMemo("");
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

    setMasterMessage("口座・カード・支払元を追加しました");
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

  if (authLoading) {
    return (
      <div style={{ maxWidth: "480px", margin: "0 auto", padding: "16px" }}>
        読み込み中...
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ maxWidth: "480px", margin: "0 auto", padding: "16px" }}>
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
            <div style={{ marginBottom: "4px" }}>支払先（店など）</div>
            <input
              value={merchantName}
              onChange={(e) => setMerchantName(e.target.value)}
              style={{ width: "100%", padding: "8px" }}
              placeholder="例: 西友 / セブンイレブン / ENEOS"
            />
          </div>

          <div>
            <div style={{ marginBottom: "4px" }}>メモ</div>
            <input
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              style={{ width: "100%", padding: "8px" }}
            />
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

          <div>{message}</div>
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
            <div style={{ fontSize: "14px", lineHeight: 1.7 }}>
              {accounts.map((a) => (
                <div key={a.id}>
                  ・{a.account_name} ({a.account_type})
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
            <div style={{ fontSize: "14px", lineHeight: 1.7 }}>
              {categories.map((c) => (
                <div key={c.id}>
                  ・[{c.wallet_type}] {c.major_category} / {c.minor_category}
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