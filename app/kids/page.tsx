"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient, User } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

type Wallet = { id: string; wallet_name: string; wallet_type: string | null };
type Category = {
  id: string; wallet_type: string | null; major_category: string;
  minor_category: string; category_kind: string; display_order: number;
};
type Tx = {
  id: string; txn_date: string; amount: number; direction: string;
  wallet_id: string | null; category_id: string | null;
  merchant_name: string | null; description: string | null;
  categories?: { major_category: string; minor_category: string } | null;
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px", borderRadius: 8, border: "1px solid #475569",
  background: "#1e293b", color: "#f8fafc", boxSizing: "border-box"
};
const buttonStyle: React.CSSProperties = {
  padding: "10px 14px", border: 0, borderRadius: 8, cursor: "pointer",
  background: "#2563eb", color: "white", fontWeight: 600
};
const yen = (n: number) => `${Math.round(n).toLocaleString("ja-JP")}円`;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};

export default function KidsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");

  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [walletId, setWalletId] = useState("");
  const [month, setMonth] = useState(today().slice(0,7));
  const [mode, setMode] = useState<"input"|"list">("input");
  const [direction, setDirection] = useState<"income"|"expense">("income");
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [merchant, setMerchant] = useState("");
  const [memo, setMemo] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [editing, setEditing] = useState<Tx | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [editMerchant, setEditMerchant] = useState("");
  const [editMemo, setEditMemo] = useState("");

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (mounted) { setUser(session?.user ?? null); setAuthLoading(false); }
    };
    void init();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadMasterData();
  }, [user]);

  useEffect(() => {
    if (!user || !walletId) { setTransactions([]); return; }
    void loadTransactions();
  }, [user, walletId, month]);

  const childWallets = useMemo(
    // 家計共通財布（wallet_type = household）は子供画面に表示しない
    () => wallets.filter(w => (w.wallet_type || "").toLowerCase() !== "household"),
    [wallets]
  );

  const selectedWallet = childWallets.find(w => w.id === walletId) || null;

  const visibleCategories = useMemo(() => {
    const wt = selectedWallet?.wallet_type;
    return categories.filter(c =>
      (c.wallet_type === wt || c.wallet_type === null) &&
      c.major_category !== "資金移動" &&
      c.category_kind !== "exclude"
    );
  }, [categories, selectedWallet]);

  const balance = useMemo(() => transactions.reduce((sum, t) => {
    if (t.direction === "income") return sum + Number(t.amount || 0);
    if (t.direction === "expense") return sum - Number(t.amount || 0);
    return sum;
  }, 0), [transactions]);

  async function loadMasterData() {
    setMessage("");
    const [{ data: w, error: we }, { data: c, error: ce }] = await Promise.all([
      supabase.from("wallets").select("id,wallet_name,wallet_type").order("display_order"),
      supabase.from("categories").select("id,wallet_type,major_category,minor_category,category_kind,display_order").order("display_order")
    ]);
    if (we || ce) { setMessage(`読込エラー: ${we?.message || ce?.message}`); return; }
    const ws = (w || []) as Wallet[];
    setWallets(ws);
    setCategories((c || []) as Category[]);
    const children = ws.filter(x => (x.wallet_type || "").toLowerCase() !== "household");
    setWalletId(prev => prev && children.some(x => x.id === prev) ? prev : (children[0]?.id || ""));
  }

  async function loadTransactions() {
    if (!walletId) return;
    setLoading(true);
    const from = `${month}-01`;
    const [y,m] = month.split("-").map(Number);
    const to = `${m === 12 ? y+1 : y}-${String(m === 12 ? 1 : m+1).padStart(2,"0")}-01`;
    const { data, error } = await supabase.from("transaction_records").select(`
      id,txn_date,amount,direction,wallet_id,category_id,merchant_name,description,
      categories:category_id(major_category,minor_category)
    `).eq("wallet_id", walletId).gte("txn_date", from).lt("txn_date", to)
      .order("txn_date", { ascending: false }).order("created_at", { ascending: false }).limit(500);
    if (error) setMessage(`明細読込エラー: ${error.message}`);
    else setTransactions((data || []) as unknown as Tx[]);
    setLoading(false);
  }

  async function signIn() {
    setAuthMessage("");
    if (!email || !password) { setAuthMessage("メールアドレスとパスワードを入力してください"); return; }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthMessage(`ログイン失敗: ${error.message}`);
  }

  async function saveEntry() {
    setMessage("");
    if (!user) { setMessage("ログインしてください"); return; }
    if (!walletId) { setMessage("子供用の財布がありません。財布マスタで子供用財布を登録してください"); return; }
    if (!date || !amount || Number(amount) <= 0) { setMessage("日付と1円以上の金額を入力してください"); return; }
    const { error } = await supabase.from("transaction_records").insert({
      user_id: user.id, wallet_id: walletId, txn_date: date, posting_date: date,
      amount: Number(amount), direction, category_id: categoryId || null,
      payment_account_id: null, receive_account_id: null,
      merchant_name: merchant.trim() || null, description: memo.trim() || null,
      transaction_type: direction === "income" ? "income" : "cash_expense",
      import_source_id: null, external_row_key: null, statement_month: date.slice(0,7),
      is_confirmed: true, is_manual: true, tax_mode: "none", tax_rate: null, tax_amount: null,
      receipt_group_id: crypto.randomUUID(), receipt_line_no: 1
    });
    if (error) { setMessage(`保存エラー: ${error.message}`); return; }
    setMessage("保存しました");
    setAmount(""); setMemo("");
    await loadTransactions();
  }

  function startEdit(t: Tx) {
    setEditing(t); setEditDate(t.txn_date); setEditAmount(String(t.amount));
    setEditCategoryId(t.category_id || ""); setEditMerchant(t.merchant_name || "");
    setEditMemo(t.description || "");
  }

  async function saveEdit() {
    if (!editing) return;
    if (!editDate || !editAmount || Number(editAmount) <= 0) { setMessage("日付と金額を確認してください"); return; }
    const { error } = await supabase.from("transaction_records").update({
      txn_date: editDate, posting_date: editDate, amount: Number(editAmount),
      category_id: editCategoryId || null, merchant_name: editMerchant.trim() || null,
      description: editMemo.trim() || null, statement_month: editDate.slice(0,7)
    }).eq("id", editing.id);
    if (error) { setMessage(`更新エラー: ${error.message}`); return; }
    setEditing(null); setMessage("更新しました"); await loadTransactions();
  }

  async function deleteEntry(id: string) {
    if (!window.confirm("この明細を削除しますか？")) return;
    const { error } = await supabase.from("transaction_records").delete().eq("id", id);
    if (error) setMessage(`削除エラー: ${error.message}`);
    else { setMessage("削除しました"); await loadTransactions(); }
  }

  if (authLoading) return <main style={{padding:20, color:"#f8fafc", background:"#0f172a", minHeight:"100vh"}}>読み込み中...</main>;

  if (!user) return (
    <main style={{maxWidth:480, margin:"0 auto", padding:20, minHeight:"100vh", background:"#0f172a", color:"#f8fafc"}}>
      <h1 style={{fontSize:24,fontWeight:700,marginBottom:16}}>子供のおこづかい帳</h1>
      <div style={{display:"grid",gap:12}}>
        <label>メールアドレス<input style={inputStyle} type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
        <label>パスワード<input style={inputStyle} type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
        <button style={buttonStyle} onClick={signIn}>ログイン</button>
        {authMessage && <p>{authMessage}</p>}
      </div>
    </main>
  );

  return (
    <main style={{minHeight:"100vh",background:"#0f172a",color:"#f8fafc",padding:"16px",paddingBottom:90,maxWidth:900,margin:"0 auto"}}>
      <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <h1 style={{fontSize:24,fontWeight:800}}>子供のおこづかい帳</h1>
        <button style={{...buttonStyle,background:"#475569"}} onClick={()=>supabase.auth.signOut()}>ログアウト</button>
      </header>

      <section style={{display:"grid",gap:12,marginTop:16,background:"#1e293b",padding:14,borderRadius:12}}>
        <label>子供の財布<select style={inputStyle} value={walletId} onChange={e=>setWalletId(e.target.value)}>
          {childWallets.length===0 && <option value="">子供用財布がありません</option>}
          {childWallets.map(w=><option key={w.id} value={w.id}>{w.wallet_name}</option>)}
        </select></label>
        <div style={{fontSize:14,color:"#cbd5e1"}}>選択中の財布の当月収支</div>
        <div style={{fontSize:28,fontWeight:800,color:balance>=0?"#93c5fd":"#fca5a5"}}>{yen(balance)}</div>
        <label>対象月<input style={inputStyle} type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label>
      </section>

      <nav style={{display:"flex",gap:8,margin:"16px 0"}}>
        <button style={{...buttonStyle,background:mode==="input"?"#2563eb":"#334155"}} onClick={()=>setMode("input")}>入力</button>
        <button style={{...buttonStyle,background:mode==="list"?"#2563eb":"#334155"}} onClick={()=>setMode("list")}>明細・修正</button>
      </nav>

      {message && <p style={{background:"#334155",padding:10,borderRadius:8}}>{message}</p>}

      {mode==="input" ? (
        <section style={{display:"grid",gap:12,background:"#1e293b",padding:14,borderRadius:12}}>
          <div style={{display:"flex",gap:8}}>
            <button style={{...buttonStyle,flex:1,background:direction==="income"?"#15803d":"#334155"}} onClick={()=>setDirection("income")}>収入</button>
            <button style={{...buttonStyle,flex:1,background:direction==="expense"?"#b91c1c":"#334155"}} onClick={()=>setDirection("expense")}>支出</button>
          </div>
          <label>日付<input style={inputStyle} type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
          <label>金額<input style={inputStyle} type="number" min="1" inputMode="numeric" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="金額"/></label>
          <label>費目<select style={inputStyle} value={categoryId} onChange={e=>setCategoryId(e.target.value)}>
            <option value="">費目なし</option>
            {visibleCategories.map(c=><option key={c.id} value={c.id}>{c.major_category} / {c.minor_category}</option>)}
          </select></label>
          <label>支払先・もらった相手<input style={inputStyle} value={merchant} onChange={e=>setMerchant(e.target.value)} placeholder="任意"/></label>
          <label>メモ<input style={inputStyle} value={memo} onChange={e=>setMemo(e.target.value)} placeholder="任意"/></label>
          <button style={buttonStyle} onClick={saveEntry}>保存</button>
        </section>
      ) : (
        <section style={{background:"#1e293b",padding:12,borderRadius:12,overflowX:"auto"}}>
          {loading ? <p>読み込み中...</p> : transactions.length===0 ? <p>この月の明細はありません。</p> : (
            <table style={{width:"100%",minWidth:650,borderCollapse:"collapse",fontSize:14}}>
              <thead><tr style={{background:"#334155",textAlign:"left"}}>
                {["日付","区分","金額","費目","相手・支払先","メモ","操作"].map(x=><th key={x} style={{padding:10}}>{x}</th>)}
              </tr></thead>
              <tbody>{transactions.map(t=>{
                const cat=Array.isArray(t.categories)?t.categories[0]:t.categories;
                return <tr key={t.id} style={{borderBottom:"1px solid #475569"}}>
                  <td style={{padding:10,whiteSpace:"nowrap"}}>{t.txn_date}</td>
                  <td style={{padding:10,color:t.direction==="income"?"#86efac":"#fca5a5"}}>{t.direction==="income"?"収入":t.direction==="transfer"?"資金移動":"支出"}</td>
                  <td style={{padding:10,whiteSpace:"nowrap"}}>{yen(Number(t.amount))}</td>
                  <td style={{padding:10}}>{cat?`${cat.major_category} / ${cat.minor_category}`:"—"}</td>
                  <td style={{padding:10}}>{t.merchant_name||"—"}</td><td style={{padding:10}}>{t.description||"—"}</td>
                  <td style={{padding:10,whiteSpace:"nowrap"}}>
                    <button style={{...buttonStyle,padding:"6px 8px",marginRight:6}} onClick={()=>startEdit(t)}>修正</button>
                    <button style={{...buttonStyle,padding:"6px 8px",background:"#b91c1c"}} onClick={()=>deleteEntry(t.id)}>削除</button>
                  </td>
                </tr>;
              })}</tbody>
            </table>
          )}
        </section>
      )}

      {editing && <div style={{position:"fixed",inset:0,background:"#0009",display:"grid",placeItems:"center",padding:16,zIndex:20}}>
        <section style={{width:"100%",maxWidth:480,background:"#0f172a",border:"1px solid #475569",borderRadius:12,padding:16,display:"grid",gap:12}}>
          <h2 style={{fontSize:20,fontWeight:700}}>明細の修正</h2>
          <label>日付<input style={inputStyle} type="date" value={editDate} onChange={e=>setEditDate(e.target.value)}/></label>
          <label>金額<input style={inputStyle} type="number" min="1" value={editAmount} onChange={e=>setEditAmount(e.target.value)}/></label>
          <label>費目<select style={inputStyle} value={editCategoryId} onChange={e=>setEditCategoryId(e.target.value)}>
            <option value="">費目なし</option>{visibleCategories.map(c=><option key={c.id} value={c.id}>{c.major_category} / {c.minor_category}</option>)}
          </select></label>
          <label>相手・支払先<input style={inputStyle} value={editMerchant} onChange={e=>setEditMerchant(e.target.value)}/></label>
          <label>メモ<input style={inputStyle} value={editMemo} onChange={e=>setEditMemo(e.target.value)}/></label>
          <div style={{display:"flex",gap:8}}>
            <button style={{...buttonStyle,flex:1}} onClick={saveEdit}>更新</button>
            <button style={{...buttonStyle,flex:1,background:"#475569"}} onClick={()=>setEditing(null)}>キャンセル</button>
          </div>
        </section>
      </div>}
    </main>
  );
}
