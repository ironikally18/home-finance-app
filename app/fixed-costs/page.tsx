"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient, User } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey
);

type WalletRow = {
  id: string;
  wallet_name: string;
};

type AccountRow = {
  id: string;
  account_name: string;
  wallet_id: string | null;
};

type CategoryRow = {
  id: string;
  wallet_type: string | null;
  major_category: string;
  minor_category: string;
  category_kind: string;
};

type FixedCostItem = {
  id: string;
  item_name: string;
  wallet_id: string | null;
  account_id: string | null;
  category_id: string | null;
  merchant_name: string | null;
  payment_day: number | null;
  display_order: number;
  is_active: boolean;
};

type FixedCostEntry = {
  id: string;
  fixed_cost_item_id: string;
  target_month: string;
  amount: number;
  transaction_id: string | null;
};

function getCurrentMonth() {
  const d = new Date();

  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0")
  );
}

function formatYen(value: number) {
  return new Intl.NumberFormat("ja-JP").format(value) + "円";
}

function getDaysInMonth(month: string) {
  const [year, monthNumber] = month
    .split("-")
    .map(Number);

  return new Date(
    year,
    monthNumber,
    0
  ).getDate();
}

function makeTransactionDate(
  month: string,
  paymentDay: number | null
) {
  const [year, monthNumber] = month
    .split("-")
    .map(Number);

  const lastDay = new Date(
    year,
    monthNumber,
    0
  ).getDate();

  const day = Math.min(
    paymentDay || 1,
    lastDay
  );

  return (
    month +
    "-" +
    String(day).padStart(2, "0")
  );
}

export default function FixedCostsPage() {
  const [user, setUser] =
    useState<User | null>(null);

  const [authLoading, setAuthLoading] =
    useState(true);

  const [month, setMonth] =
    useState(getCurrentMonth());

  const [items, setItems] =
    useState<FixedCostItem[]>([]);

  const [entries, setEntries] =
    useState<FixedCostEntry[]>([]);

  const [wallets, setWallets] =
    useState<WalletRow[]>([]);

  const [accounts, setAccounts] =
    useState<AccountRow[]>([]);

  const [categories, setCategories] =
    useState<CategoryRow[]>([]);

  const [loading, setLoading] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [editingItemId, setEditingItemId] =
    useState<string | null>(null);

  const [editItemName, setEditItemName] =
    useState("");

  const [editWalletId, setEditWalletId] =
    useState("");

  const [editAccountId, setEditAccountId] =
    useState("");

  const [editCategoryId, setEditCategoryId] =
    useState("");

  const [editMerchantName, setEditMerchantName] =
    useState("");

  const [editPaymentDay, setEditPaymentDay] =
    useState("");

  const [newItemName, setNewItemName] =
    useState("");

  useEffect(() => {
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
    } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (user) {
      void loadAll();
    }
  }, [user, month]);

  const loadAll = async () => {
    if (!user) return;

    setLoading(true);
    setMessage("");

    const [
      itemsResult,
      entriesResult,
      walletsResult,
      accountsResult,
      categoriesResult,
    ] = await Promise.all([
      supabase
        .from("fixed_cost_items")
        .select(
          "id,item_name,wallet_id,account_id,category_id,merchant_name,payment_day,display_order,is_active"
        )
        .eq("user_id", user.id)
        .eq("is_active", true)
        .order("display_order", {
          ascending: true,
        }),

      supabase
        .from("fixed_cost_entries")
        .select(
          "id,fixed_cost_item_id,target_month,amount,transaction_id"
        )
        .eq("user_id", user.id)
        .eq(
          "target_month",
          `${month}-01`
        ),

      supabase
        .from("wallets")
        .select(
          "id,wallet_name"
        )
        .order("display_order", {
          ascending: true,
        }),

      supabase
        .from("accounts")
        .select(
          "id,account_name,wallet_id"
        )
        .order("display_order", {
          ascending: true,
        }),

      supabase
        .from("categories")
        .select(
          "id,wallet_type,major_category,minor_category,category_kind"
        )
        .order("display_order", {
          ascending: true,
        }),
    ]);

    if (itemsResult.error) {
      setMessage(
        "固定費項目の読込エラー: " +
          itemsResult.error.message
      );
      setLoading(false);
      return;
    }

    if (entriesResult.error) {
      setMessage(
        "固定費金額の読込エラー: " +
          entriesResult.error.message
      );
      setLoading(false);
      return;
    }

    setItems(
      (itemsResult.data as FixedCostItem[]) ||
        []
    );

    setEntries(
      (entriesResult.data as FixedCostEntry[]) ||
        []
    );

    setWallets(
      (walletsResult.data as WalletRow[]) ||
        []
    );

    setAccounts(
      (accountsResult.data as AccountRow[]) ||
        []
    );

    setCategories(
      (categoriesResult.data as CategoryRow[]) ||
        []
    );

    setLoading(false);
  };

  const entryMap = useMemo(() => {
    const map = new Map<
      string,
      FixedCostEntry
    >();

    entries.forEach((entry) => {
      map.set(
        entry.fixed_cost_item_id,
        entry
      );
    });

    return map;
  }, [entries]);

  const totalAmount = useMemo(() => {
    return items.reduce((sum, item) => {
      const entry = entryMap.get(item.id);

      return (
        sum +
        Number(entry?.amount || 0)
      );
    }, 0);
  }, [items, entryMap]);

  const enteredCount = useMemo(() => {
    return items.filter((item) => {
      const entry = entryMap.get(item.id);

      return (
        entry &&
        Number(entry.amount) > 0
      );
    }).length;
  }, [items, entryMap]);

  const unenteredCount =
    items.length - enteredCount;

  const getCategoryLabel = (
    id: string | null
  ) => {
    if (!id) return "未設定";

    const category =
      categories.find(
        (c) => c.id === id
      );

    if (!category) return "未設定";

    return (
      category.major_category +
      " / " +
      category.minor_category
    );
  };

  const saveAmount = async (
    item: FixedCostItem,
    value: string
  ) => {
    if (!user) return;

    const amount = Number(
      value.replace(/,/g, "")
    );

    if (
      value !== "" &&
      (!Number.isFinite(amount) ||
        amount < 0)
    ) {
      setMessage(
        "金額を正しく入力してください"
      );
      return;
    }

    const existing =
      entryMap.get(item.id);

    /*
     * 空欄なら、その月の固定費登録を削除
     */
    if (value === "") {
      if (existing) {
        const { error } =
          await supabase
            .from("fixed_cost_entries")
            .delete()
            .eq("id", existing.id)
            .eq(
              "user_id",
              user.id
            );

        if (error) {
          setMessage(
            "金額削除エラー: " +
              error.message
          );
          return;
        }
      }

      await loadAll();
      return;
    }

    /*
     * 財布・支払元・費目が必要
     */
    if (
      !item.wallet_id ||
      !item.account_id ||
      !item.category_id
    ) {
      setMessage(
        `「${item.item_name}」の財布・支払元・費目を設定してください。`
      );
      return;
    }

    /*
     * 支払日から実際の日付を作成
     *
     * 例：
     * 2026-08 + 25日
     * → 2026-08-25
     *
     * 31日がない月は月末日に調整
     */
    const transactionDate =
      makeTransactionDate(
        month,
        item.payment_day
      );

    /*
     * 既存の家計簿データがあれば更新
     */
    if (existing?.transaction_id) {
      const {
        error: transactionError,
      } = await supabase
        .from("transaction_records")
        .update({
          txn_date: transactionDate,
          posting_date:
            transactionDate,
          amount,
          wallet_id:
            item.wallet_id,
          category_id:
            item.category_id,
          payment_account_id:
            item.account_id,
          merchant_name:
            item.merchant_name ||
            null,
          description:
            `固定費: ${item.item_name}`,
          direction: "expense",
          transaction_type:
            "fixed_cost",
          statement_month: month,
          is_confirmed: true,
          is_manual: true,
        })
        .eq(
          "id",
          existing.transaction_id
        )
        .eq(
          "user_id",
          user.id
        );

      if (transactionError) {
        setMessage(
          "家計簿更新エラー: " +
            transactionError.message
        );
        return;
      }

      const {
        error: entryError,
      } = await supabase
        .from("fixed_cost_entries")
        .update({
          amount,
          updated_at:
            new Date().toISOString(),
        })
        .eq(
          "id",
          existing.id
        )
        .eq(
          "user_id",
          user.id
        );

      if (entryError) {
        setMessage(
          "固定費更新エラー: " +
            entryError.message
        );
        return;
      }

      setMessage(
        `${item.item_name}を更新しました`
      );

      await loadAll();
      return;
    }

    /*
     * 新規に通常家計簿へ登録
     */
    const {
      data: transactionData,
      error: transactionError,
    } = await supabase
      .from("transaction_records")
      .insert({
        user_id: user.id,

        wallet_id:
          item.wallet_id,

        txn_date:
          transactionDate,

        posting_date:
          transactionDate,

        amount,

        direction:
          "expense",

        category_id:
          item.category_id,

        payment_account_id:
          item.account_id,

        receive_account_id:
          null,

        merchant_name:
          item.merchant_name ||
          null,

        description:
          `固定費: ${item.item_name}`,

        transaction_type:
          "fixed_cost",

        import_source_id:
          null,

        external_row_key:
          null,

        statement_month:
          month,

        is_confirmed:
          true,

        is_manual:
          true,

        tax_mode:
          "none",

        tax_rate:
          null,

        tax_amount:
          null,

        receipt_group_id:
          null,

        receipt_line_no:
          null,
      })
      .select("id")
      .single();

    if (transactionError) {
      setMessage(
        "家計簿登録エラー: " +
          transactionError.message
      );
      return;
    }

    /*
     * 固定費月別データを保存
     */
    const {
      error: entryError,
    } = await supabase
      .from("fixed_cost_entries")
      .upsert(
        {
          user_id: user.id,

          fixed_cost_item_id:
            item.id,

          target_month:
            `${month}-01`,

          amount,

          transaction_id:
            transactionData?.id ||
            null,
        },
        {
          onConflict:
            "user_id,fixed_cost_item_id,target_month",
        }
      );

    if (entryError) {
      setMessage(
        "固定費保存エラー: " +
          entryError.message
      );
      return;
    }

    setMessage(
      `${item.item_name}を登録しました`
    );

    await loadAll();
  };

  const addItem = async () => {
    if (!user) return;

    const name =
      newItemName.trim();

    if (!name) {
      setMessage(
        "固定費項目名を入力してください"
      );
      return;
    }

    const maxOrder =
      items.length > 0
        ? Math.max(
            ...items.map(
              (x) =>
                x.display_order || 0
            )
          )
        : 0;

    const {
      error,
    } = await supabase
      .from("fixed_cost_items")
      .insert({
        user_id: user.id,
        item_name: name,
        payment_day: null,
        display_order:
          maxOrder + 1,
        is_active: true,
      });

    if (error) {
      setMessage(
        "固定費項目追加エラー: " +
          error.message
      );
      return;
    }

    setNewItemName("");

    setMessage(
      `${name}を追加しました`
    );

    await loadAll();
  };

  const startEditItem = (
    item: FixedCostItem
  ) => {
    setEditingItemId(
      item.id
    );

    setEditItemName(
      item.item_name
    );

    setEditWalletId(
      item.wallet_id || ""
    );

    setEditAccountId(
      item.account_id || ""
    );

    setEditCategoryId(
      item.category_id || ""
    );

    setEditMerchantName(
      item.merchant_name || ""
    );

    setEditPaymentDay(
      item.payment_day != null
        ? String(
            item.payment_day
          )
        : ""
    );
  };

  const saveEditItem =
    async () => {
      if (
        !user ||
        !editingItemId
      ) {
        return;
      }

      const name =
        editItemName.trim();

      if (!name) {
        setMessage(
          "固定費項目名を入力してください"
        );
        return;
      }

      let paymentDay:
        | number
        | null = null;

      if (
        editPaymentDay.trim() !==
        ""
      ) {
        const n = Number(
          editPaymentDay
        );

        if (
          !Number.isInteger(n) ||
          n < 1 ||
          n > 31
        ) {
          setMessage(
            "支払日は1～31の範囲で入力してください"
          );
          return;
        }

        paymentDay = n;
      }

      const {
        error,
      } = await supabase
        .from("fixed_cost_items")
        .update({
          item_name: name,

          wallet_id:
            editWalletId ||
            null,

          account_id:
            editAccountId ||
            null,

          category_id:
            editCategoryId ||
            null,

          merchant_name:
            editMerchantName.trim() ||
            null,

          payment_day:
            paymentDay,

          updated_at:
            new Date().toISOString(),
        })
        .eq(
          "id",
          editingItemId
        )
        .eq(
          "user_id",
          user.id
        );

      if (error) {
        setMessage(
          "固定費設定更新エラー: " +
            error.message
        );
        return;
      }

      setMessage(
        `${name}の設定を保存しました`
      );

      setEditingItemId(
        null
      );

      setEditItemName("");
      setEditWalletId("");
      setEditAccountId("");
      setEditCategoryId("");
      setEditMerchantName("");
      setEditPaymentDay("");

      await loadAll();
    };

  const deleteItem =
    async (
      item: FixedCostItem
    ) => {
      if (!user) return;

      const ok =
        window.confirm(
          `「${item.item_name}」を固定費一覧から削除しますか？\n\n過去の家計簿データは削除されません。`
        );

      if (!ok) return;

      const {
        error,
      } = await supabase
        .from("fixed_cost_items")
        .update({
          is_active: false,
          updated_at:
            new Date().toISOString(),
        })
        .eq(
          "id",
          item.id
        )
        .eq(
          "user_id",
          user.id
        );

      if (error) {
        setMessage(
          "固定費削除エラー: " +
            error.message
        );
        return;
      }

      setMessage(
        `${item.item_name}を固定費一覧から削除しました`
      );

      await loadAll();
    };

  const moveItem =
    async (
      itemId: string,
      direction:
        | "up"
        | "down"
    ) => {
      const index =
        items.findIndex(
          (x) =>
            x.id === itemId
        );

      if (index < 0) return;

      const targetIndex =
        direction ===
        "up"
          ? index - 1
          : index + 1;

      if (
        targetIndex < 0 ||
        targetIndex >=
          items.length
      ) {
        return;
      }

      const reordered =
        [...items];

      const [moved] =
        reordered.splice(
          index,
          1
        );

      reordered.splice(
        targetIndex,
        0,
        moved
      );

      for (
        let i = 0;
        i <
        reordered.length;
        i++
      ) {
        const {
          error,
        } =
          await supabase
            .from(
              "fixed_cost_items"
            )
            .update({
              display_order:
                i + 1,
            })
            .eq(
              "id",
              reordered[i].id
            )
            .eq(
              "user_id",
              user?.id
            );

        if (error) {
          setMessage(
            "並び替えエラー: " +
              error.message
          );
          return;
        }
      }

      await loadAll();
    };

  if (authLoading) {
    return (
      <main style={pageStyle}>
        読み込み中...
      </main>
    );
  }

  if (!user) {
    return (
      <main style={pageStyle}>
        <div
          style={contentStyle}
        >
          <h1
            style={titleStyle}
          >
            固定費チェック
          </h1>

          <div
            style={cardStyle}
          >
            ログインしてください。
          </div>
        </div>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <div
        style={contentStyle}
      >
        <h1
          style={titleStyle}
        >
          固定費チェック
        </h1>

        <div
          style={monthRowStyle}
        >
          <button
            type="button"
            onClick={() => {
              const [
                y,
                m,
              ] = month
                .split("-")
                .map(Number);

              const d =
                new Date(
                  y,
                  m - 2,
                  1
                );

              setMonth(
                `${d.getFullYear()}-${String(
                  d.getMonth() + 1
                ).padStart(2, "0")}`
              );
            }}
            style={
              monthButtonStyle
            }
          >
            ←
          </button>

          <input
            type="month"
            value={month}
            onChange={(e) =>
              setMonth(
                e.target.value
              )
            }
            style={
              monthInputStyle
            }
          />

          <button
            type="button"
            onClick={() => {
              const [
                y,
                m,
              ] = month
                .split("-")
                .map(Number);

              const d =
                new Date(
                  y,
                  m,
                  1
                );

              setMonth(
                `${d.getFullYear()}-${String(
                  d.getMonth() + 1
                ).padStart(2, "0")}`
              );
            }}
            style={
              monthButtonStyle
            }
          >
            →
          </button>
        </div>

        <div
          style={
            summaryCardStyle
          }
        >
          <div>
            <div
              style={
                summaryLabelStyle
              }
            >
              入力済み
            </div>

            <div
              style={
                summaryNumberStyle
              }
            >
              {enteredCount} /{" "}
              {items.length}
            </div>
          </div>

          <div>
            <div
              style={
                summaryLabelStyle
              }
            >
              未入力
            </div>

            <div
              style={{
                ...summaryNumberStyle,
                color:
                  unenteredCount >
                  0
                    ? "#fbbf24"
                    : "#86efac",
              }}
            >
              {
                unenteredCount
              }
            </div>
          </div>

          <div>
            <div
              style={
                summaryLabelStyle
              }
            >
              固定費合計
            </div>

            <div
              style={
                summaryAmountStyle
              }
            >
              {formatYen(
                totalAmount
              )}
            </div>
          </div>
        </div>

        {loading && (
          <div
            style={
              messageStyle
            }
          >
            読み込み中...
          </div>
        )}

        {items.map(
          (
            item,
            index
          ) => {
            const entry =
              entryMap.get(
                item.id
              );

            const amount =
              entry?.amount !=
              null
                ? String(
                    entry.amount
                  )
                : "";

            const editing =
              editingItemId ===
              item.id;

            return (
              <div
                key={
                  item.id
                }
                style={{
                  ...cardStyle,
                  border:
                    amount ===
                    ""
                      ? "1px solid #92400e"
                      : "1px solid #374151",
                }}
              >
                {!editing ? (
                  <>
                    <div
                      style={
                        itemHeaderStyle
                      }
                    >
                      <div>
                        <div
                          style={
                            itemNameStyle
                          }
                        >
                          {
                            item.item_name
                          }
                        </div>

                        <div
                          style={
                            smallTextStyle
                          }
                        >
                          支払日：
                          {item.payment_day
                            ? `${item.payment_day}日`
                            : "未設定"}
                        </div>

                        {item.category_id && (
                          <div
                            style={
                              smallTextStyle
                            }
                          >
                            {
                              getCategoryLabel(
                                item.category_id
                              )
                            }
                          </div>
                        )}
                      </div>

                      {amount ===
                        "" && (
                        <span
                          style={
                            warningBadgeStyle
                          }
                        >
                          未入力
                        </span>
                      )}
                    </div>

                    <div
                      style={
                        amountRowStyle
                      }
                    >
                      <input
                        type="number"
                        inputMode="numeric"
                        defaultValue={
                          amount
                        }
                        placeholder="金額を入力"
                        onBlur={(
                          e
                        ) =>
                          saveAmount(
                            item,
                            e.target
                              .value
                          )
                        }
                        style={
                          amountInputStyle
                        }
                      />

                      <span>
                        円
                      </span>
                    </div>

                    <div
                      style={
                        buttonRowStyle
                      }
                    >
                      <button
                        type="button"
                        onClick={() =>
                          startEditItem(
                            item
                          )
                        }
                        style={
                          secondaryButtonStyle
                        }
                      >
                        設定
                      </button>

                      <button
                        type="button"
                        disabled={
                          index ===
                          0
                        }
                        onClick={() =>
                          moveItem(
                            item.id,
                            "up"
                          )
                        }
                        style={
                          moveButtonStyle
                        }
                      >
                        上へ
                      </button>

                      <button
                        type="button"
                        disabled={
                          index ===
                          items.length -
                            1
                        }
                        onClick={() =>
                          moveItem(
                            item.id,
                            "down"
                          )
                        }
                        style={
                          moveButtonStyle
                        }
                      >
                        下へ
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          deleteItem(
                            item
                          )
                        }
                        style={
                          deleteButtonStyle
                        }
                      >
                        削除
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div
                      style={
                        itemNameStyle
                      }
                    >
                      固定費項目の設定
                    </div>

                    <label
                      style={
                        labelStyle
                      }
                    >
                      項目名
                    </label>

                    <input
                      value={
                        editItemName
                      }
                      onChange={(
                        e
                      ) =>
                        setEditItemName(
                          e.target
                            .value
                        )
                      }
                      style={
                        textInputStyle
                      }
                    />

                    <label
                      style={
                        labelStyle
                      }
                    >
                      支払日
                    </label>

                    <div
                      style={{
                        display:
                          "flex",
                        alignItems:
                          "center",
                        gap: "8px",
                      }}
                    >
                      <input
                        type="number"
                        min="1"
                        max="31"
                        inputMode="numeric"
                        value={
                          editPaymentDay
                        }
                        onChange={(
                          e
                        ) =>
                          setEditPaymentDay(
                            e.target
                              .value
                          )
                        }
                        placeholder="例：25"
                        style={{
                          ...textInputStyle,
                          width: "120px",
                        }}
                      />

                      <span>
                        日
                      </span>
                    </div>

                    <div
                      style={
                        smallTextStyle
                      }
                    >
                      ※31日がない月は、その月の末日に自動調整します。
                    </div>

                    <label
                      style={
                        labelStyle
                      }
                    >
                      財布
                    </label>

                    <select
                      value={
                        editWalletId
                      }
                      onChange={(
                        e
                      ) =>
                        setEditWalletId(
                          e.target
                            .value
                        )
                      }
                      style={
                        selectStyle
                      }
                    >
                      <option value="">
                        選択してください
                      </option>

                      {wallets.map(
                        (
                          wallet
                        ) => (
                          <option
                            key={
                              wallet.id
                            }
                            value={
                              wallet.id
                            }
                          >
                            {
                              wallet.wallet_name
                            }
                          </option>
                        )
                      )}
                    </select>

                    <label
                      style={
                        labelStyle
                      }
                    >
                      支払元
                    </label>

                    <select
                      value={
                        editAccountId
                      }
                      onChange={(
                        e
                      ) =>
                        setEditAccountId(
                          e.target
                            .value
                        )
                      }
                      style={
                        selectStyle
                      }
                    >
                      <option value="">
                        選択してください
                      </option>

                      {accounts
                        .filter(
                          (
                            a
                          ) =>
                            !editWalletId ||
                            a.wallet_id ===
                              editWalletId
                        )
                        .map(
                          (
                            account
                          ) => (
                            <option
                              key={
                                account.id
                              }
                              value={
                                account.id
                              }
                            >
                              {
                                account.account_name
                              }
                            </option>
                          )
                        )}
                    </select>

                    <label
                      style={
                        labelStyle
                      }
                    >
                      費目
                    </label>

                    <select
                      value={
                        editCategoryId
                      }
                      onChange={(
                        e
                      ) =>
                        setEditCategoryId(
                          e.target
                            .value
                        )
                      }
                      style={
                        selectStyle
                      }
                    >
                      <option value="">
                        選択してください
                      </option>

                      {categories
                        .filter(
                          (
                            c
                          ) =>
                            c.category_kind !==
                            "income"
                        )
                        .map(
                          (
                            category
                          ) => (
                            <option
                              key={
                                category.id
                              }
                              value={
                                category.id
                              }
                            >
                              {
                                category.major_category
                              }{" "}
                              /{" "}
                              {
                                category.minor_category
                              }
                            </option>
                          )
                        )}
                    </select>

                    <label
                      style={
                        labelStyle
                      }
                    >
                      支払先
                    </label>

                    <input
                      value={
                        editMerchantName
                      }
                      onChange={(
                        e
                      ) =>
                        setEditMerchantName(
                          e.target
                            .value
                        )
                      }
                      placeholder="例：東京電力"
                      style={
                        textInputStyle
                      }
                    />

                    <div
                      style={
                        buttonRowStyle
                      }
                    >
                      <button
                        type="button"
                        onClick={
                          saveEditItem
                        }
                        style={
                          saveButtonStyle
                        }
                      >
                        保存
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setEditingItemId(
                            null
                          )
                        }
                        style={
                          secondaryButtonStyle
                        }
                      >
                        キャンセル
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          }
        )}

        <div
          style={cardStyle}
        >
          <div
            style={
              itemNameStyle
            }
          >
            固定費項目を追加
          </div>

          <input
            value={
              newItemName
            }
            onChange={(e) =>
              setNewItemName(
                e.target.value
              )
            }
            placeholder="例：NHK受信料"
            style={
              textInputStyle
            }
          />

          <button
            type="button"
            onClick={
              addItem
            }
            style={{
              ...saveButtonStyle,
              marginTop: 10,
            }}
          >
            固定費項目を追加
          </button>
        </div>

        {message && (
          <div
            style={
              messageStyle
            }
          >
            {message}
          </div>
        )}
      </div>

      <BottomNav />
    </main>
  );
}


/* =========================================================
   下部固定メニュー
========================================================= */

function BottomNav() {
  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        background: "#020617",
        borderTop:
          "1px solid #374151",
        display: "grid",
        gridTemplateColumns:
          "repeat(6, 1fr)",
        padding: "4px 2px",
        zIndex: 50,
      }}
    >
      <Nav
        href="/"
        label="入力"
      />

      <Nav
        href="/fixed-costs"
        label="固定費"
      />

      <Nav
        href="/summary"
        label="集計"
      />

      <Nav
        href="/graph"
        label="グラフ"
      />

      <Nav
        href="/calendar"
        label="日別"
      />

      <Nav
        href="/kids"
        label="子供"
      />
    </div>
  );
}

function Nav({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <a
      href={href}
      style={{
        textAlign: "center",
        color: "#f9fafb",
        textDecoration:
          "none",
        fontSize: "11px",
        padding:
          "6px 1px",
        fontWeight:
          "bold",
      }}
    >
      {label}
    </a>
  );
}


/* =========================================================
   スタイル
========================================================= */

const pageStyle:
  React.CSSProperties = {
  minHeight: "100vh",
  background: "#020617",
  color: "#f9fafb",
  paddingBottom:
    "80px",
};

const contentStyle:
  React.CSSProperties = {
  width: "100%",
  maxWidth: "600px",
  margin: "0 auto",
  padding: "16px",
  boxSizing:
    "border-box",
};

const titleStyle:
  React.CSSProperties = {
  fontSize: "24px",
  fontWeight: "bold",
  marginBottom:
    "16px",
};

const cardStyle:
  React.CSSProperties = {
  background:
    "#111827",
  border:
    "1px solid #374151",
  borderRadius:
    "12px",
  padding: "14px",
  marginBottom:
    "12px",
};

const monthRowStyle:
  React.CSSProperties = {
  display: "flex",
  alignItems:
    "center",
  gap: "8px",
  marginBottom:
    "12px",
};

const monthButtonStyle:
  React.CSSProperties = {
  width: "44px",
  height: "44px",
  borderRadius:
    "8px",
  border:
    "1px solid #4b5563",
  background:
    "#1f2937",
  color: "#fff",
  fontSize: "20px",
  fontWeight: "bold",
};

const monthInputStyle:
  React.CSSProperties = {
  flex: 1,
  minHeight: "44px",
  background:
    "#0f172a",
  color: "#fff",
  border:
    "1px solid #4b5563",
  borderRadius:
    "8px",
  padding: "8px",
  fontSize: "16px",
};

const summaryCardStyle:
  React.CSSProperties = {
  display: "grid",
  gridTemplateColumns:
    "repeat(3, 1fr)",
  gap: "8px",
  background:
    "#111827",
  border:
    "1px solid #374151",
  borderRadius:
    "12px",
  padding: "14px",
  marginBottom:
    "12px",
};

const summaryLabelStyle:
  React.CSSProperties = {
  fontSize: "11px",
  color: "#9ca3af",
  marginBottom:
    "4px",
};

const summaryNumberStyle:
  React.CSSProperties = {
  fontSize: "18px",
  fontWeight:
    "bold",
};

const summaryAmountStyle:
  React.CSSProperties = {
  fontSize: "16px",
  fontWeight:
    "bold",
};

const itemHeaderStyle:
  React.CSSProperties = {
  display: "flex",
  alignItems:
    "center",
  justifyContent:
    "space-between",
  gap: "8px",
};

const itemNameStyle:
  React.CSSProperties = {
  fontSize: "17px",
  fontWeight:
    "bold",
  marginBottom:
    "8px",
};

const smallTextStyle:
  React.CSSProperties = {
  fontSize: "11px",
  color: "#9ca3af",
};

const warningBadgeStyle:
  React.CSSProperties = {
  background:
    "#78350f",
  color: "#fcd34d",
  padding:
    "4px 8px",
  borderRadius:
    "999px",
  fontSize: "11px",
  fontWeight:
    "bold",
};

const amountRowStyle:
  React.CSSProperties = {
  display: "flex",
  alignItems:
    "center",
  gap: "6px",
};

const amountInputStyle:
  React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background:
    "#020617",
  color: "#fff",
  border:
    "1px solid #4b5563",
  borderRadius:
    "8px",
  padding: "11px",
  fontSize: "18px",
  textAlign:
    "right",
  boxSizing:
    "border-box",
};

const buttonRowStyle:
  React.CSSProperties = {
  display: "flex",
  flexWrap:
    "wrap",
  gap: "6px",
  marginTop:
    "10px",
};

const saveButtonStyle:
  React.CSSProperties = {
  padding:
    "10px 14px",
  background:
    "#166534",
  color: "#fff",
  border: "none",
  borderRadius:
    "8px",
  fontWeight:
    "bold",
};

const secondaryButtonStyle:
  React.CSSProperties = {
  padding:
    "10px 14px",
  background:
    "#374151",
  color: "#fff",
  border:
    "1px solid #6b7280",
  borderRadius:
    "8px",
  fontWeight:
    "bold",
};

const moveButtonStyle:
  React.CSSProperties = {
  padding:
    "10px 12px",
  minWidth: "56px",
  background:
    "#374151",
  color: "#fff",
  border:
    "1px solid #6b7280",
  borderRadius:
    "8px",
  fontWeight:
    "bold",
};

const deleteButtonStyle:
  React.CSSProperties = {
  padding:
    "10px 12px",
  background:
    "#7f1d1d",
  color: "#fff",
  border:
    "1px solid #991b1b",
  borderRadius:
    "8px",
  fontWeight:
    "bold",
};

const labelStyle:
  React.CSSProperties = {
  display: "block",
  marginTop:
    "10px",
  marginBottom:
    "4px",
  fontSize: "13px",
  color: "#d1d5db",
};

const textInputStyle:
  React.CSSProperties = {
  width: "100%",
  boxSizing:
    "border-box",
  background:
    "#020617",
  color: "#fff",
  border:
    "1px solid #4b5563",
  borderRadius:
    "8px",
  padding: "10px",
  fontSize: "15px",
};

const selectStyle:
  React.CSSProperties = {
  width: "100%",
  boxSizing:
    "border-box",
  background:
    "#020617",
  color: "#fff",
  border:
    "1px solid #4b5563",
  borderRadius:
    "8px",
  padding: "10px",
  fontSize: "15px",
};

const messageStyle:
  React.CSSProperties = {
  background:
    "#1f2937",
  border:
    "1px solid #374151",
  borderRadius:
    "8px",
  padding: "10px",
  marginTop:
    "10px",
  fontSize: "13px",
};