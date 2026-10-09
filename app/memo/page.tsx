"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient, User } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

type AliasRow = {
  id: string;
  alias_name: string;
  display_order: number;
};

type BalanceRow = {
  id: string;
  alias_id: string;
  balance_date: string; // YYYY-MM-DD
  amount: number; // 円
};

type PinRow = {
  salt: string;
  pin_hash: string;
  iterations: number;
};

type PinState = "loading" | "error" | "setup" | "locked" | "unlocked";

const PIN_ITERATIONS = 100000;
const AUTO_LOCK_MS = 60 * 1000; // 画面を離れて1分以上でロック
const MAX_FAILS = 5;
const LOCKOUT_MS = 30 * 1000;

// 1万円単位・小数1桁（1,000円まで）。単位や「円」は表示しない
const toMan = (yen: number) =>
  (yen / 10000).toLocaleString("ja-JP", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

const pad2 = (n: number) => String(n).padStart(2, "0");
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const toTime = (d: string) => new Date(`${d}T00:00:00`).getTime();

// ---- PIN（PBKDF2-SHA256 でハッシュ化） ----
const bs = (u: Uint8Array) => u as unknown as BufferSource;
const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
const fromHex = (hex: string) =>
  new Uint8Array((hex.match(/.{2}/g) ?? []).map((h) => parseInt(h, 16)));

async function derivePin(pin: string, saltHex: string, iterations: number) {
  const key = await crypto.subtle.importKey("raw", bs(new TextEncoder().encode(pin)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: bs(fromHex(saltHex)), iterations },
    key,
    256
  );
  return toHex(bits);
}

const isValidPin = (pin: string) => /^\d{4,8}$/.test(pin);

const COLORS = ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#fb923c", "#22d3ee", "#f87171"];

const card: React.CSSProperties = {
  background: "#111827",
  color: "#f9fafb",
  border: "1px solid #374151",
  borderRadius: "12px",
  padding: "12px",
};

const field: React.CSSProperties = {
  width: "100%",
  padding: "10px",
  borderRadius: "8px",
  border: "1px solid #4b5563",
  background: "#1f2937",
  color: "#f9fafb",
  fontSize: "16px",
};

const btn: React.CSSProperties = {
  padding: "10px 14px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: "8px",
};

const btnSub: React.CSSProperties = {
  ...btn,
  background: "#374151",
};

export default function Page() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // PIN
  const [pinState, setPinState] = useState<PinState>("loading");
  const [pinRow, setPinRow] = useState<PinRow | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [pinInput2, setPinInput2] = useState("");
  const [pinMessage, setPinMessage] = useState("");
  const [failCount, setFailCount] = useState(0);
  const [lockUntil, setLockUntil] = useState(0);
  const [showPinChange, setShowPinChange] = useState(false);
  const [curPin, setCurPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const hiddenAt = useRef<number | null>(null);

  const [aliases, setAliases] = useState<AliasRow[]>([]);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [message, setMessage] = useState("");

  const [date, setDate] = useState("");
  const [aliasId, setAliasId] = useState("");
  const [amount, setAmount] = useState("");

  const [newAlias, setNewAlias] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  // 履歴の修正
  const [historyAlias, setHistoryAlias] = useState("");
  const [historyLimit, setHistoryLimit] = useState(20);
  const [editBalId, setEditBalId] = useState<string | null>(null);
  const [editBalDate, setEditBalDate] = useState("");
  const [editBalAlias, setEditBalAlias] = useState("");
  const [editBalAmount, setEditBalAmount] = useState("");

  useEffect(() => {
    setDate(todayLocal());

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
    return () => subscription.unsubscribe();
  }, []);

  // ---- PIN の読み込み ----
  const loadPin = useCallback(async () => {
    setPinState("loading");
    const { data, error } = await supabase.from("asset_pin").select("salt, pin_hash, iterations").maybeSingle();
    if (error) {
      setPinMessage(`PIN設定の読み込みに失敗しました: ${error.message}`);
      setPinState("error");
      return;
    }
    if (data) {
      setPinRow(data as PinRow);
      setPinState("locked");
    } else {
      setPinRow(null);
      setPinState("setup");
    }
  }, []);

  useEffect(() => {
    if (user) {
      void loadPin();
    } else {
      setPinState("loading");
    }
  }, [user, loadPin]);

  const lockNow = useCallback(() => {
    setAliases([]);
    setBalances([]);
    setPinInput("");
    setPinInput2("");
    setPinMessage("");
    setShowPinChange(false);
    setEditBalId(null);
    setEditBalAmount("");
    setPinState("locked");
  }, []);

  // 画面を離れて一定時間たったら自動ロック
  useEffect(() => {
    if (pinState !== "unlocked") return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
      } else if (hiddenAt.current && Date.now() - hiddenAt.current > AUTO_LOCK_MS) {
        hiddenAt.current = null;
        lockNow();
      } else {
        hiddenAt.current = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [pinState, lockNow]);

  const handleSetupPin = async () => {
    if (!user) return;
    if (!isValidPin(pinInput)) {
      setPinMessage("PINは4〜8桁の数字で入力してください");
      return;
    }
    if (pinInput !== pinInput2) {
      setPinMessage("確認用のPINが一致しません");
      return;
    }
    const salt = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
    const hash = await derivePin(pinInput, salt, PIN_ITERATIONS);
    const row = { salt, pin_hash: hash, iterations: PIN_ITERATIONS };
    const { error } = await supabase
      .from("asset_pin")
      .upsert({ user_id: user.id, ...row, updated_at: new Date().toISOString() });
    if (error) {
      setPinMessage(`PINの保存に失敗しました: ${error.message}`);
      return;
    }
    setPinRow(row);
    setPinInput("");
    setPinInput2("");
    setPinMessage("");
    setPinState("unlocked");
  };

  const verifyPin = async (pin: string) => {
    if (!pinRow) return false;
    const hash = await derivePin(pin, pinRow.salt, pinRow.iterations);
    return hash === pinRow.pin_hash;
  };

  const handleUnlock = async () => {
    const now = Date.now();
    if (now < lockUntil) {
      setPinMessage(`${Math.ceil((lockUntil - now) / 1000)}秒後にもう一度お試しください`);
      return;
    }
    if (await verifyPin(pinInput)) {
      setPinInput("");
      setPinMessage("");
      setFailCount(0);
      setPinState("unlocked");
      return;
    }
    const fails = failCount + 1;
    setPinInput("");
    if (fails >= MAX_FAILS) {
      setFailCount(0);
      setLockUntil(Date.now() + LOCKOUT_MS);
      setPinMessage(`${MAX_FAILS}回間違えました。30秒待ってからお試しください`);
    } else {
      setFailCount(fails);
      setPinMessage("PINが違います");
    }
  };

  const handleChangePin = async () => {
    if (!user) return;
    if (!(await verifyPin(curPin))) {
      setMessage("現在のPINが違います");
      return;
    }
    if (!isValidPin(newPin)) {
      setMessage("新しいPINは4〜8桁の数字で入力してください");
      return;
    }
    const salt = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
    const hash = await derivePin(newPin, salt, PIN_ITERATIONS);
    const row = { salt, pin_hash: hash, iterations: PIN_ITERATIONS };
    const { error } = await supabase
      .from("asset_pin")
      .upsert({ user_id: user.id, ...row, updated_at: new Date().toISOString() });
    if (error) {
      setMessage(`PINの変更に失敗しました: ${error.message}`);
      return;
    }
    setPinRow(row);
    setCurPin("");
    setNewPin("");
    setShowPinChange(false);
    setMessage("PINを変更しました");
  };

  // ---- データの読み込み（PINを解除した後だけ実行） ----
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      supabase
        .from("asset_aliases")
        .select("id, alias_name, display_order")
        .order("display_order", { ascending: true }),
      supabase
        .from("asset_balances")
        .select("id, alias_id, balance_date, amount")
        .order("balance_date", { ascending: true }),
    ]);

    if (a.error || b.error) {
      setMessage(`読み込みに失敗しました: ${(a.error || b.error)?.message}`);
      return;
    }
    const aliasRows = (a.data ?? []) as AliasRow[];
    setAliases(aliasRows);
    setBalances((b.data ?? []) as BalanceRow[]);
    setAliasId((prev) => prev || aliasRows[0]?.id || "");
  }, []);

  useEffect(() => {
    if (user && pinState === "unlocked") void load();
  }, [user, pinState, load]);

  // 別名ごとの最新残高（balances は日付の昇順なので後勝ち）
  const latest = useMemo(() => {
    const m = new Map<string, BalanceRow>();
    for (const b of balances) m.set(b.alias_id, b);
    return m;
  }, [balances]);

  const total = useMemo(() => {
    let sum = 0;
    for (const a of aliases) sum += latest.get(a.id)?.amount ?? 0;
    return sum;
  }, [aliases, latest]);

  // 履歴（新しい日付が上）
  const history = useMemo(
    () => balances.filter((b) => !historyAlias || b.alias_id === historyAlias).slice().reverse(),
    [balances, historyAlias]
  );

  const aliasName = (id: string) => aliases.find((a) => a.id === id)?.alias_name ?? "-";

  const startEditBalance = (b: BalanceRow) => {
    setEditBalId(b.id);
    setEditBalDate(b.balance_date);
    setEditBalAlias(b.alias_id);
    setEditBalAmount(String(b.amount));
  };

  const cancelEditBalance = () => {
    setEditBalId(null);
    setEditBalAmount("");
  };

  const handleUpdateBalance = async () => {
    if (!editBalId) return;
    if (!editBalDate) {
      setMessage("日付を入力してください");
      return;
    }
    const yen = Number(editBalAmount.replace(/[,\s]/g, ""));
    if (!editBalAmount || !Number.isInteger(yen) || yen < 0) {
      setMessage("残高は0以上の整数で入力してください");
      return;
    }
    const { error } = await supabase
      .from("asset_balances")
      .update({
        alias_id: editBalAlias,
        balance_date: editBalDate,
        amount: yen,
        updated_at: new Date().toISOString(),
      })
      .eq("id", editBalId);
    if (error) {
      setMessage(
        error.code === "23505"
          ? "同じ日付・同じ項目の記録がすでにあります。先にそちらを修正・削除してください"
          : `修正に失敗しました: ${error.message}`
      );
      return;
    }
    cancelEditBalance();
    setMessage("修正しました");
    await load();
  };

  const handleDeleteBalance = async (b: BalanceRow) => {
    if (!window.confirm(`${b.balance_date}「${aliasName(b.alias_id)}」の記録を削除します。よろしいですか？`)) return;
    const { error } = await supabase.from("asset_balances").delete().eq("id", b.id);
    if (error) {
      setMessage(`削除に失敗しました: ${error.message}`);
      return;
    }
    if (editBalId === b.id) cancelEditBalance();
    await load();
  };

  const handleSave = async () => {
    if (!user) return;
    if (!aliasId) {
      setMessage("項目を選んでください");
      return;
    }
    if (!date) {
      setMessage("日付を入力してください");
      return;
    }
    const yen = Number(amount.replace(/[,\s]/g, ""));
    if (!amount || !Number.isInteger(yen) || yen < 0) {
      setMessage("残高は0以上の整数で入力してください");
      return;
    }
    const { error } = await supabase.from("asset_balances").upsert(
      {
        user_id: user.id,
        alias_id: aliasId,
        balance_date: date,
        amount: yen,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "alias_id,balance_date" }
    );
    if (error) {
      setMessage(`保存に失敗しました: ${error.message}`);
      return;
    }
    setAmount("");
    setMessage("保存しました");
    await load();
  };

  const handleAddAlias = async () => {
    if (!user) return;
    const name = newAlias.trim();
    if (!name) return;
    const nextOrder = aliases.length ? Math.max(...aliases.map((a) => a.display_order)) + 1 : 1;
    const { error } = await supabase
      .from("asset_aliases")
      .insert({ user_id: user.id, alias_name: name, display_order: nextOrder });
    if (error) {
      setMessage(`追加に失敗しました: ${error.message}`);
      return;
    }
    setNewAlias("");
    await load();
  };

  const handleRename = async (id: string) => {
    const name = editName.trim();
    if (!name) return;
    const { error } = await supabase.from("asset_aliases").update({ alias_name: name }).eq("id", id);
    if (error) {
      setMessage(`変更に失敗しました: ${error.message}`);
      return;
    }
    setEditingId(null);
    await load();
  };

  const handleDelete = async (a: AliasRow) => {
    if (!window.confirm(`「${a.alias_name}」と、その残高の履歴をすべて削除します。よろしいですか？`)) return;
    const { error } = await supabase.from("asset_aliases").delete().eq("id", a.id);
    if (error) {
      setMessage(`削除に失敗しました: ${error.message}`);
      return;
    }
    setAliasId((prev) => (prev === a.id ? "" : prev));
    await load();
  };

  const wrap: React.CSSProperties = { maxWidth: "560px", margin: "0 auto", padding: "16px" };

  if (authLoading) {
    return <div style={wrap}>読み込み中...</div>;
  }

  if (!user) {
    return (
      <div style={wrap}>
        ログインが必要です。<a href="/">トップに戻る</a>
      </div>
    );
  }

  if (pinState === "loading") {
    return <div style={wrap}>読み込み中...</div>;
  }

  if (pinState === "error") {
    return (
      <div style={wrap}>
        <div style={{ marginBottom: "12px" }}>{pinMessage}</div>
        <button onClick={() => void loadPin()} style={btn}>
          再読み込み
        </button>
      </div>
    );
  }

  if (pinState === "setup" || pinState === "locked") {
    const isSetup = pinState === "setup";
    return (
      <div style={{ ...wrap, paddingBottom: "88px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "16px" }}>メモ</h1>
        <section style={card}>
          <div style={{ display: "grid", gap: "10px" }}>
            <div>{isSetup ? "このページ用のPINを設定してください（4〜8桁の数字）" : "PINを入力してください"}</div>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isSetup) void handleUnlock();
              }}
              placeholder={isSetup ? "PIN" : ""}
              style={field}
            />
            {isSetup && (
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={pinInput2}
                onChange={(e) => setPinInput2(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSetupPin();
                }}
                placeholder="PIN（確認）"
                style={field}
              />
            )}
            <button onClick={() => (isSetup ? void handleSetupPin() : void handleUnlock())} style={btn}>
              {isSetup ? "設定する" : "開く"}
            </button>
            {pinMessage && <div style={{ fontSize: "14px", color: "#fca5a5" }}>{pinMessage}</div>}
          </div>
        </section>
        <BottomNav />
      </div>
    );
  }

  return (
    <div style={{ ...wrap, paddingBottom: "88px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", gap: "8px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: "bold", margin: 0 }}>メモ</h1>
        <div style={{ display: "flex", gap: "6px" }}>
          <button onClick={lockNow} style={{ ...btnSub, padding: "8px 12px" }}>
            ロック
          </button>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{ padding: "8px 12px", background: "#e5e7eb", color: "#111827", border: "none", borderRadius: "8px" }}
          >
            ログアウト
          </button>
        </div>
      </div>

      {message && <div style={{ marginBottom: "12px", fontSize: "14px" }}>{message}</div>}

      <div style={{ display: "grid", gap: "16px" }}>
        {/* 別名ごとの最新残高 + 合計 */}
        <section style={card}>
          <div style={{ display: "grid", gap: "8px" }}>
            {aliases.length === 0 && <div style={{ color: "#9ca3af" }}>下の「項目の管理」から項目を追加してください</div>}
            {aliases.map((a, i) => {
              const b = latest.get(a.id);
              return (
                <div
                  key={a.id}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px" }}
                >
                  <span>
                    <span style={{ color: COLORS[i % COLORS.length], marginRight: "6px" }}>●</span>
                    {a.alias_name}
                  </span>
                  <span style={{ fontVariantNumeric: "tabular-nums", fontSize: "20px" }}>
                    {b ? toMan(b.amount) : "-"}
                    {b && <span style={{ marginLeft: "8px", fontSize: "11px", color: "#9ca3af" }}>{b.balance_date}</span>}
                  </span>
                </div>
              );
            })}
            {aliases.length > 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  borderTop: "1px solid #374151",
                  paddingTop: "8px",
                }}
              >
                <span>合計</span>
                <span style={{ fontVariantNumeric: "tabular-nums", fontSize: "22px", fontWeight: "bold" }}>
                  {toMan(total)}
                </span>
              </div>
            )}
          </div>
        </section>

        {/* 推移グラフ */}
        <section style={card}>
          <TrendChart aliases={aliases} balances={balances} />
        </section>

        {/* 入力 */}
        <section style={card}>
          <div style={{ display: "grid", gap: "10px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={field} />
              <select value={aliasId} onChange={(e) => setAliasId(e.target.value)} style={field}>
                {aliases.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.alias_name}
                  </option>
                ))}
              </select>
            </div>
            <input
              inputMode="numeric"
              placeholder="残高（1円単位）"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={field}
            />
            <button onClick={handleSave} style={btn}>
              保存
            </button>
            <div style={{ fontSize: "12px", color: "#9ca3af" }}>同じ日付・同じ項目は上書きされます</div>
          </div>
        </section>

        {/* 履歴（修正・削除） */}
        <section style={card}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "8px",
              marginBottom: "8px",
            }}
          >
            <span style={{ fontWeight: "bold" }}>履歴</span>
            <select
              value={historyAlias}
              onChange={(e) => {
                setHistoryAlias(e.target.value);
                setHistoryLimit(20);
              }}
              style={{ ...field, width: "auto" }}
            >
              <option value="">すべて</option>
              {aliases.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.alias_name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "grid", gap: "8px" }}>
            {history.length === 0 && <div style={{ color: "#9ca3af" }}>記録がありません</div>}
            {history.slice(0, historyLimit).map((b) =>
              editBalId === b.id ? (
                <div
                  key={b.id}
                  style={{ display: "grid", gap: "8px", padding: "8px", background: "#1f2937", borderRadius: "8px" }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <input type="date" value={editBalDate} onChange={(e) => setEditBalDate(e.target.value)} style={field} />
                    <select value={editBalAlias} onChange={(e) => setEditBalAlias(e.target.value)} style={field}>
                      {aliases.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.alias_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    inputMode="numeric"
                    placeholder="残高（1円単位）"
                    value={editBalAmount}
                    onChange={(e) => setEditBalAmount(e.target.value)}
                    style={field}
                  />
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button onClick={handleUpdateBalance} style={btn}>
                      修正を保存
                    </button>
                    <button onClick={cancelEditBalance} style={btnSub}>
                      戻す
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  key={b.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    borderBottom: "1px solid #1f2937",
                    paddingBottom: "6px",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "11px", color: "#9ca3af" }}>{b.balance_date}</div>
                    <div>
                      {aliasName(b.alias_id)}
                      <span style={{ marginLeft: "10px", fontVariantNumeric: "tabular-nums" }}>{toMan(b.amount)}</span>
                    </div>
                  </div>
                  <button onClick={() => startEditBalance(b)} style={{ ...btnSub, padding: "6px 10px" }}>
                    修正
                  </button>
                  <button onClick={() => handleDeleteBalance(b)} style={{ ...btn, background: "#dc2626", padding: "6px 10px" }}>
                    削除
                  </button>
                </div>
              )
            )}
            {history.length > historyLimit && (
              <button onClick={() => setHistoryLimit((n) => n + 20)} style={btnSub}>
                もっと見る
              </button>
            )}
          </div>
        </section>

        {/* 項目の管理 */}
        <section style={card}>
          <div style={{ marginBottom: "8px", fontWeight: "bold" }}>項目の管理</div>
          <div style={{ display: "grid", gap: "8px" }}>
            {aliases.map((a) => (
              <div key={a.id} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                {editingId === a.id ? (
                  <>
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ ...field, flex: 1 }} />
                    <button onClick={() => handleRename(a.id)} style={btn}>
                      保存
                    </button>
                    <button onClick={() => setEditingId(null)} style={btnSub}>
                      戻す
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ flex: 1 }}>{a.alias_name}</div>
                    <button
                      onClick={() => {
                        setEditingId(a.id);
                        setEditName(a.alias_name);
                      }}
                      style={btnSub}
                    >
                      編集
                    </button>
                    <button onClick={() => handleDelete(a)} style={{ ...btn, background: "#dc2626" }}>
                      削除
                    </button>
                  </>
                )}
              </div>
            ))}
            <div style={{ display: "flex", gap: "6px" }}>
              <input
                placeholder="新しい項目名（別名）"
                value={newAlias}
                onChange={(e) => setNewAlias(e.target.value)}
                style={{ ...field, flex: 1 }}
              />
              <button onClick={handleAddAlias} style={btn}>
                追加
              </button>
            </div>
          </div>
        </section>

        {/* PIN変更 */}
        <section style={card}>
          {showPinChange ? (
            <div style={{ display: "grid", gap: "8px" }}>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                placeholder="現在のPIN"
                value={curPin}
                onChange={(e) => setCurPin(e.target.value)}
                style={field}
              />
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                placeholder="新しいPIN（4〜8桁）"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                style={field}
              />
              <div style={{ display: "flex", gap: "6px" }}>
                <button onClick={handleChangePin} style={btn}>
                  変更する
                </button>
                <button
                  onClick={() => {
                    setShowPinChange(false);
                    setCurPin("");
                    setNewPin("");
                  }}
                  style={btnSub}
                >
                  戻す
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowPinChange(true)} style={btnSub}>
              PINを変更
            </button>
          )}
        </section>
      </div>

      <BottomNav />
    </div>
  );
}

function TrendChart({ aliases, balances }: { aliases: AliasRow[]; balances: BalanceRow[] }) {
  const [showTotal, setShowTotal] = useState(false);

  if (balances.length === 0) {
    return <div style={{ color: "#9ca3af" }}>残高を保存すると推移が表示されます</div>;
  }

  // 直近12か月（最新の日付から365日）に表示範囲を絞る
  const allDates = Array.from(new Set(balances.map((b) => b.balance_date))).sort();
  const tLast = toTime(allDates[allDates.length - 1]);
  const dates = allDates.filter((d) => toTime(d) >= tLast - 365 * 24 * 60 * 60 * 1000);
  const tMin = toTime(dates[0]);
  const tMax = tLast;

  // 別名ごとの履歴（日付昇順）
  const byAlias = new Map<string, BalanceRow[]>();
  for (const b of balances) {
    const list = byAlias.get(b.alias_id) ?? [];
    list.push(b);
    byAlias.set(b.alias_id, list);
  }

  const lookup = new Map<string, number>();
  for (const b of balances) lookup.set(`${b.alias_id}|${b.balance_date}`, b.amount / 10000);

  // 合計: 各日付時点で、各項目の「その日以前の最新残高」を足す
  const totalSeries = dates.map((d) => {
    let sum = 0;
    for (const a of aliases) {
      const list = byAlias.get(a.id) ?? [];
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].balance_date <= d) {
          sum += list[i].amount;
          break;
        }
      }
    }
    return { date: d, value: sum / 10000 };
  });

  const vals: number[] = [];
  for (const [k, v] of lookup.entries()) if (dates.includes(k.split("|")[1])) vals.push(v);
  if (showTotal) for (const p of totalSeries) vals.push(p.value);

  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.1;
  lo -= pad;
  hi += pad;

  const W = 520;
  const H = 220;
  const L = 48;
  const R = 12;
  const T = 12;
  const B = 24;

  const x = (d: string) => (tMax === tMin ? (L + W - R) / 2 : L + ((toTime(d) - tMin) / (tMax - tMin)) * (W - L - R));
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const ticks = [0, 1, 2, 3].map((k) => lo + ((hi - lo) * k) / 3);

  // X軸ラベル: 最初・最後と、その間の等間隔の日付
  const labelDates = Array.from(
    new Set([0, 0.33, 0.66, 1].map((r) => dates[Math.round(r * (dates.length - 1))]))
  );
  const fmtDate = (d: string) => d.slice(2).replace(/-/g, "/");

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#374151" strokeWidth={1} />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#9ca3af">
              {t.toFixed(1)}
            </text>
          </g>
        ))}
        {labelDates.map((d, i) => (
          <text
            key={d}
            x={x(d)}
            y={H - 6}
            textAnchor={i === 0 && labelDates.length > 1 ? "start" : i === labelDates.length - 1 && labelDates.length > 1 ? "end" : "middle"}
            fontSize={10}
            fill="#9ca3af"
          >
            {fmtDate(d)}
          </text>
        ))}
        {aliases.map((a, idx) => {
          const color = COLORS[idx % COLORS.length];
          const pts = dates
            .map((d) => {
              const v = lookup.get(`${a.id}|${d}`);
              return v === undefined ? null : { x: x(d), y: y(v) };
            })
            .filter((p): p is { x: number; y: number } => p !== null);
          if (pts.length === 0) return null;
          return (
            <g key={a.id}>
              {pts.length > 1 && (
                <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={color} strokeWidth={2} />
              )}
              {pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={3} fill={color} />
              ))}
            </g>
          );
        })}
        {showTotal && (
          <g>
            {totalSeries.length > 1 && (
              <polyline
                points={totalSeries.map((p) => `${x(p.date)},${y(p.value)}`).join(" ")}
                fill="none"
                stroke="#f9fafb"
                strokeWidth={2.5}
                strokeDasharray="6 3"
              />
            )}
            {totalSeries.map((p, i) => (
              <circle key={i} cx={x(p.date)} cy={y(p.value)} r={3} fill="#f9fafb" />
            ))}
          </g>
        )}
      </svg>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", fontSize: "12px", alignItems: "center" }}>
        {aliases.map((a, i) => (
          <span key={a.id}>
            <span style={{ color: COLORS[i % COLORS.length] }}>●</span> {a.alias_name}
          </span>
        ))}
        <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "4px" }}>
          <input type="checkbox" checked={showTotal} onChange={(e) => setShowTotal(e.target.checked)} />
          合計を重ねる
        </label>
      </div>
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
        gridTemplateColumns: "repeat(8, 1fr)",
        padding: "4px 2px",
        zIndex: 50,
      }}
    >
      <Nav href="/" label="🏠" />
      <Nav href="/fixed-costs" label="固定費" />
      <Nav href="/summary" label="📊" />
      <Nav href="/graph" label="📈" />
      <Nav href="/calendar" label="📅" />
      <Nav href="/dashboard" label="指標" />
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
