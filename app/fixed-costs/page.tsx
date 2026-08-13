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
  payment_date: string | null;
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

function getDefaultPaymentDate(
  month: string,
  paymentDay: number | null
) {
  if (!paymentDay) return "";

  const [year, monthNumber] = month
    .split("-")
    .map(Number);

  const lastDay = new Date(
    year,
    monthNumber,
    0
  ).getDate();

  const day = Math.min(
    paymentDay,
    lastDay
  );

  return (
    month +
    "-" +
    String(day).padStart(2, "0")
  );
}

function getCategoryLabel(
  categories: CategoryRow[],
  id: string | null
) {
  if (!id) return "未設定";

  const category = categories.find(
    (c) => c.id === id
  );

  if (!category) return "未設定";

  return (
    category.major_category +
    " / " +
    category.minor_category
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

  /*
   * 月ごとの入力値
   */
  const [amountValues, setAmountValues] =
    useState<Record<string, string>>({});

  const [dateValues, setDateValues] =
    useState<Record<string, string>>({});

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
          "id,fixed_cost_item_id,target_month,amount,payment_date,transaction_id"
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

    const loadedItems =
      (itemsResult.data as FixedCostItem[]) ||
      [];

    const loadedEntries =
      (entriesResult.data as FixedCostEntry[]) ||
      [];

    setItems(loadedItems);
    setEntries(loadedEntries);

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

    /*
     * DBから読み込んだ値を画面にセット
     *
     * 金額：
     * その月の登録値
     *
     * 日付：
     * 登録済みの日付
     *
     * 未登録なら固定費マスターの
     * payment_dayを初期値として使用
     */
    const newAmounts: Record<
      string,
      string
    > = {};

    const newDates: Record<
      string,
      string
    > = {};

    loadedItems.forEach((item) => {
      const entry =
        loadedEntries.find(
          (e) =>
            e.fixed_cost_item_id ===
            item.id
        );

      newAmounts[item.id] =
        entry?.amount != null
          ? String(entry.amount)
          : "";

      newDates[item.id] =
        entry?.payment_date ||
        getDefaultPaymentDate(
          month,
          item.payment_day
        );
    });

    setAmountValues(newAmounts);
    setDateValues(newDates);

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
      return (
        sum +
        Number(
          amountValues[item.id] || 0
        )
      );
    }, 0);
  }, [items, amountValues]);

  const enteredCount = useMemo(() => {
    return items.filter((item) => {
      return (
        amountValues[item.id] !== "" &&
        amountValues[item.id] !== undefined
      );
    }).length;
  }, [items, amountValues]);

  const unenteredCount =
    items.length - enteredCount;

  /*
   * 金額と日付をまとめて保存
   */
  const saveAmountAndDate = async (
    item: FixedCostItem
  ) => {
    if (!user) return;

    const rawAmount =
      amountValues[item.id] ?? "";

    const paymentDate =
      dateValues[item.id] ?? "";

    /*
     * 金額チェック
     */
    if (rawAmount !== "") {
      const amount = Number(
        rawAmount.replace(/,/g, "")
      );

      if (
        !Number.isFinite(amount) ||
        amount < 0
      ) {
        setMessage(
          `「${item.item_name}」の金額を正しく入力してください。`
        );
        return;
      }
    }

    /*
     * 日付チェック
     */
    if (paymentDate !== "") {
      if (
        !paymentDate.startsWith(
          `${month}-`
        )
      ) {
        setMessage(
          `「${item.item_name}」の支払日は${month}の日付を指定してください。`
        );
        return;
      }
    }

    /*
     * 金額も日付も空欄
     * → その月の登録を削除
     */
    if (
      rawAmount === "" &&
      paymentDate === ""
    ) {
      const existing =
        entryMap.get(item.id);

      if (existing) {
        /*
         * 既存の通常家計簿データも削除
         */
        if (
          existing.transaction_id
        ) {
          const {
            error:
              transactionDeleteError,
          } = await supabase
            .from(
              "transaction_records"
            )
            .delete()
            .eq(
              "id",
              existing.transaction_id
            )
            .eq(
              "user_id",
              user.id
            );

          if (
            transactionDeleteError
          ) {
            setMessage(
              "家計簿データ削除エラー: " +
                transactionDeleteError.message
            );
            return;
          }
        }

        const {
          error,
        } = await supabase
          .from(
            "fixed_cost_entries"
          )
          .delete()
          .eq(
            "id",
            existing.id
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
      }

      setMessage(
        `${item.item_name}の${month}分を削除しました。`
      );

      await loadAll();
      return;
    }

    /*
     * 金額だけ入力されて日付が空欄の場合
     *
     * 固定費マスターの日を使う
     */
    const finalPaymentDate =
      paymentDate ||
      getDefaultPaymentDate(
        month,
        item.payment_day
      );

    if (!finalPaymentDate) {
      setMessage(
        `「${item.item_name}」の支払日を入力してください。`
      );
      return;
    }

    const amount = Number(
      rawAmount.replace(/,/g, "")
    );

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      setMessage(
        `「${item.item_name}」の金額を入力してください。`
      );
      return;
    }

    /*
     * 財布・支払元・費目チェック
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

    const existing =
      entryMap.get(item.id);

    /*
     * 既存の家計簿データを更新
     */
    if (existing?.transaction_id) {
      const {
        error:
          transactionError,
      } = await supabase
        .from(
          "transaction_records"
        )
        .update({
          txn_date:
            finalPaymentDate,

          posting_date:
            finalPaymentDate,

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

          direction:
            "expense",

          transaction_type:
            "fixed_cost",

          statement_month:
            month,

          is_confirmed:
            true,

          is_manual:
            true,
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
        .from(
          "fixed_cost_entries"
        )
        .update({
          amount,

          payment_date:
            finalPaymentDate,

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
        `${item.item_name}を更新しました。`
      );

      await loadAll();
      return;
    }

    /*
     * 新規家計簿登録
     */
    const {
      data: transactionData,
      error:
        transactionError,
    } = await supabase
      .from(
        "transaction_records"
      )
      .insert({
        user_id:
          user.id,

        wallet_id:
          item.wallet_id,

        txn_date:
          finalPaymentDate,

        posting_date:
          finalPaymentDate,

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
     * 固定費の月別データを保存
     */
    const {
      error: entryError,
    } = await supabase
      .from(
        "fixed_cost_entries"
      )
      .upsert(
        {
          user_id:
            user.id,

          fixed_cost_item_id:
            item.id,

          target_month:
            `${month}-01`,

          amount,

          payment_date:
            finalPaymentDate,

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
      `${item.item_name}を登録しました。`
    );

    await loadAll();
  };

  /*
   * 固定費項目追加
   */
  const addItem = async () => {
    if (!user) return;

    const name =
      newItemName.trim();

    if (!name) {
      setMessage(
        "固定費項目名を入力してください。"
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
      .from(
        "fixed_cost_items"
      )
      .insert({
        user_id:
          user.id,

        item_name:
          name,

        payment_day:
          null,

        display_order:
          maxOrder + 1,

        is_active:
          true,
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
      `${name}を追加しました。`
    );

    await loadAll();
  };

  /*
   * 固定費設定編集開始
   */
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

  /*
   * 固定費マスター保存
   *
   * payment_dayは
   * 「毎月の初期値」
   *
   * 実際の各月の日付は
   * fixed_cost_entries.payment_date
   * に保存される
   */
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
          "固定費項目名を入力してください。"
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
        const n =
          Number(
            editPaymentDay
          );

        if (
          !Number.isInteger(n) ||
          n < 1 ||
          n > 31
        ) {
          setMessage(
            "初期支払日は1～31の範囲で入力してください。"
          );
          return;
        }

        paymentDay = n;
      }

      const {
        error,
      } = await supabase
        .from(
          "fixed_cost_items"
        )
        .update({
          item_name:
            name,

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
        `${name}の設定を保存しました。`
      );

      setEditingItemId(null);

      setEditItemName("");
      setEditWalletId("");
      setEditAccountId("");
      setEditCategoryId("");
      setEditMerchantName("");
      setEditPaymentDay("");

      await loadAll();
    };

  /*
   * 固定費削除
   *
   * is_active=falseなので
   * 過去データは残る
   */
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
        .from(
          "fixed_cost_items"
        )
        .update({
          is_active:
            false,

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
        `${item.item_name}を固定費一覧から削除しました。`
      );

      await loadAll();
    };

  /*
   * 並び替え
   */
  const moveItem =
    async (
      itemId: string,
      direction:
        | "up"
        | "down"
    ) => {
      if (!user) return;

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
        } = await supabase
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
            user.id
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

  /*
   * 月変更
   */
  const changeMonth = (
    offset: number
  ) => {
    const [
      year,
      monthNumber,
    ] = month
      .split("-")
      .map(Number);

    const d =
      new Date(
        year,
        monthNumber - 1 + offset,
        1
      );

    setMonth(
      `${d.getFullYear()}-${String(
        d.getMonth() + 1
      ).padStart(2, "0")}`
    );
  };

  if (authLoading) {
    return (
      <main style={pageStyle}>
        <div
          style={contentStyle}
        >
          読み込み中...
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main style={pageStyle}>
        <div
          style={contentStyle}
        >
          <h1 style={titleStyle}>
            固定費チェック
          </h1>

          <div style={cardStyle}>
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
        <h1 style={titleStyle}>
          固定費チェック
        </h1>

        <div
          style={monthRowStyle}
        >
          <button
            type="button"
            onClick={() =>
              changeMonth(-1)
            }
            style={monthButtonStyle}
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
            style={monthInputStyle}
          />

          <button
            type="button"
            onClick={() =>
              changeMonth(1)
            }
            style={monthButtonStyle}
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
              amountValues[
                item.id
              ] ?? "";

            const paymentDate =
              dateValues[
                item.id
              ] ?? "";

            const editing =
              editingItemId ===
              item.id;

            return (
              <div
                key={item.id}
                style={{
                  ...cardStyle,
                  border:
                    amount === ""
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
                          {paymentDate
                            ? paymentDate.replace(
                                `${month}-`,
                                ""
                              ) + "日"
                            : "未設定"}
                        </div>

                        <div
                          style={
                            smallTextStyle
                          }
                        >
                          {
                            getCategoryLabel(
                              categories,
                              item.category_id
                            )
                          }
                        </div>
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
                      style={{
                        marginTop:
                          "12px",
                      }}
                    >
                      <label
                        style={
                          labelStyle
                        }
                      >
                        今月の支払日
                      </label>

                      <input
                        type="date"
                        value={
                          paymentDate
                        }
                        onChange={(
                          e
                        ) => {
                          setDateValues(
                            (
                              prev
                            ) => ({
                              ...prev,
                              [item.id]:
                                e.target
                                  .value,
                            })
                          );
                        }}
                        style={
                          dateInputStyle
                        }
                      />
                    </div>

                    <div
                      style={{
                        marginTop:
                          "8px",
                      }}
                    >
                      <label
                        style={
                          labelStyle
                        }
                      >
                        今月の金額
                      </label>

                      <div
                        style={
                          amountRowStyle
                        }
                      >
                        <input
                          type="number"
                          inputMode="numeric"
                          value={
                            amount
                          }
                          onChange={(
                            e
                          ) => {
                            setAmountValues(
                              (
                                prev
                              ) => ({
                                ...prev,
                                [item.id]:
                                  e.target
                                    .value,
                              })
                            );
                          }}
                          placeholder="金額を入力"
                          style={
                            amountInputStyle
                          }
                        />

                        <span>
                          円
                        </span>
                      </div>
                    </div>

                    <div
                      style={
                        buttonRowStyle
                      }
                    >
                      <button
                        type="button"
                        onClick={() =>
                          saveAmountAndDate(
                            item
                          )
                        }
                        style={
                          saveButtonStyle
                        }
                      >
                        今月分を保存
                      </button>

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
                      初期支払日
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
                      ※ここは各月の初期値です。
                      実際の支払日は毎月変更できます。
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
                        設定を保存
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
   下部メニュー
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
        textAlign:
          "center",
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
  background:
    "#020617",
  color: "#f9fafb",
  paddingBottom:
    "80px",
};

const contentStyle:
  React.CSSProperties = {
  width: "100%",
  maxWidth:
    "600px",
  margin:
    "0 auto",
  padding:
    "16px",
  boxSizing:
    "border-box",
};

const titleStyle:
  React.CSSProperties = {
  fontSize:
    "24px",
  fontWeight:
    "bold",
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
  padding:
    "14px",
  marginBottom:
    "12px",
};

const monthRowStyle:
  React.CSSProperties = {
  display:
    "flex",
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
  fontSize:
    "20px",
  fontWeight:
    "bold",
};

const monthInputStyle:
  React.CSSProperties = {
  flex: 1,
  minHeight:
    "44px",
  background:
    "#0f172a",
  color: "#fff",
  border:
    "1px solid #4b5563",
  borderRadius:
    "8px",
  padding:
    "8px",
  fontSize:
    "16px",
};

const summaryCardStyle:
  React.CSSProperties = {
  display:
    "grid",
  gridTemplateColumns:
    "repeat(3, 1fr)",
  gap: "8px",
  background:
    "#111827",
  border:
    "1px solid #374151",
  borderRadius:
    "12px",
  padding:
    "14px",
  marginBottom:
    "12px",
};

const summaryLabelStyle:
  React.CSSProperties = {
  fontSize:
    "11px",
  color:
    "#9ca3af",
  marginBottom:
    "4px",
};

const summaryNumberStyle:
  React.CSSProperties = {
  fontSize:
    "18px",
  fontWeight:
    "bold",
};

const summaryAmountStyle:
  React.CSSProperties = {
  fontSize:
    "16px",
  fontWeight:
    "bold",
};

const itemHeaderStyle:
  React.CSSProperties = {
  display:
    "flex",
  alignItems:
    "center",
  justifyContent:
    "space-between",
  gap: "8px",
};

const itemNameStyle:
  React.CSSProperties = {
  fontSize:
    "17px",
  fontWeight:
    "bold",
  marginBottom:
    "8px",
};

const smallTextStyle:
  React.CSSProperties = {
  fontSize:
    "11px",
  color:
    "#9ca3af",
};

const warningBadgeStyle:
  React.CSSProperties = {
  background:
    "#78350f",
  color:
    "#fcd34d",
  padding:
    "4px 8px",
  borderRadius:
    "999px",
  fontSize:
    "11px",
  fontWeight:
    "bold",
};

const labelStyle:
  React.CSSProperties = {
  display:
    "block",
  marginTop:
    "10px",
  marginBottom:
    "4px",
  fontSize:
    "13px",
  color:
    "#d1d5db",
};

const amountRowStyle:
  React.CSSProperties = {
  display:
    "flex",
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
  color:
    "#fff",
  border:
    "1px solid #4b5563",
  borderRadius:
    "8px",
  padding:
    "11px",
  fontSize:
    "18px",
  textAlign:
    "right",
  boxSizing:
    "border-box",
};

const dateInputStyle:
  React.CSSProperties = {
  width:
    "100%",
  boxSizing:
    "border-box",
  background:
    "#020617",
  color:
    "#fff",
  border:
    "1px solid #4b5563",
  borderRadius:
    "8px",
  padding:
    "11px",
  fontSize:
    "16px",
};

const textInputStyle:
  React.CSSProperties = {
  width:
    "100%",
  boxSizing:
    "border-box",
  background:
    "#020617",
  color:
    "#fff",
  border:
    "1px solid #4b5563",
  borderRadius:
    "8px",
  padding:
    "10px",
  fontSize:
    "15px",
};

const selectStyle:
  React.CSSProperties = {
  width:
    "100%",
  boxSizing:
    "border-box",
  background:
    "#020617",
  color:
    "#fff",
  border:
    "1px solid #4b5563",
  borderRadius:
    "8px",
  padding:
    "10px",
  fontSize:
    "15px",
};

const buttonRowStyle:
  React.CSSProperties = {
  display:
    "flex",
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
  color:
    "#fff",
  border:
    "none",
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
  color:
    "#fff",
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
  minWidth:
    "56px",
  background:
    "#374151",
  color:
    "#fff",
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
  color:
    "#fff",
  border:
    "1px solid #991b1b",
  borderRadius:
    "8px",
  fontWeight:
    "bold",
};

const messageStyle:
  React.CSSProperties = {
  background:
    "#1f2937",
  border:
    "1px solid #374151",
  borderRadius:
    "8px",
  padding:
    "10px",
  marginTop:
    "10px",
  fontSize:
    "13px",
};