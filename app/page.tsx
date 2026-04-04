"use client";

import React, { useEffect, useState } from "react";
import { createClient, User } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

type WalletRow = {
  id: string;
  wallet_name: string;
};

type AccountRow = {
  id: string;
  account_name: string;
};

type CategoryRow = {
  id: string;
  major_category: string;
  minor_category: string;
};

export default function Page() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");

  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);

  const [walletId, setWalletId] = useState("");
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [memo, setMemo] = useState("");
  const [message, setMessage] = useState("");

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

    const { data: w, error: wErr } = await supabase
      .from("wallets")
      .select("id, wallet_name")
      .order("display_order", { ascending: true });

    const { data: a, error: aErr } = await supabase
      .from("accounts")
      .select("id, account_name")
      .order("display_order", { ascending: true });

    const { data: c, error: cErr } = await supabase
      .from("categories")
      .select("id, major_category, minor_category")
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

    if (walletsData.length > 0) {
      setWalletId(walletsData[0].id);
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
    setAuthMessage("ログアウトしました");
  };

  const save = async () => {
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
      merchant_name: null,
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
    setMemo("");
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
    <div style={{ maxWidth: "480px", margin: "0 auto", padding: "16px" }}>
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
          家計簿入力
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
            {categories.map((c) => (
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
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.account_name}
              </option>
            ))}
          </select>
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
          onClick={save}
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
    </div>
  );
}