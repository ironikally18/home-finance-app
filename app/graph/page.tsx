"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function GraphPage() {
  const [monthlyData, setMonthlyData] = useState<any[]>([]);
  const [categoryData, setCategoryData] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const { data } = await supabase
      .from("transaction_records")
      .select(`
        amount,
        direction,
        txn_date,
        categories:category_id (major_category)
      `);

    if (!data) return;

    // 月別集計
    const monthMap: any = {};

    data.forEach((t: any) => {
      const month = t.txn_date.slice(0, 7);

      if (!monthMap[month]) {
        monthMap[month] = { month, income: 0, expense: 0 };
      }

      if (t.direction === "income") {
        monthMap[month].income += t.amount;
      } else {
        monthMap[month].expense += t.amount;
      }
    });

    setMonthlyData(Object.values(monthMap));

    // 費目別
    const catMap: any = {};

    data.forEach((t: any) => {
      if (t.direction !== "expense") return;

      const cat =
        t.categories?.major_category || "その他";

      if (!catMap[cat]) catMap[cat] = 0;
      catMap[cat] += t.amount;
    });

    setCategoryData(
      Object.keys(catMap).map((k) => ({
        name: k,
        value: catMap[k],
      }))
    );
  };

  return (
    <div style={{ padding: 16 }}>
      <h1>グラフ</h1>

      {/* 月推移 */}
      <h2>月別推移</h2>
      <LineChart width={350} height={250} data={monthlyData}>
        <CartesianGrid stroke="#ccc" />
        <XAxis dataKey="month" />
        <YAxis />
        <Tooltip />
        <Line type="monotone" dataKey="income" stroke="#16a34a" />
        <Line type="monotone" dataKey="expense" stroke="#dc2626" />
      </LineChart>

      {/* 費目別 */}
      <h2>費目別支出</h2>
      <BarChart width={350} height={250} data={categoryData}>
        <CartesianGrid stroke="#ccc" />
        <XAxis dataKey="name" />
        <YAxis />
        <Tooltip />
        <Bar dataKey="value" fill="#2563eb" />
      </BarChart>
    </div>
  );
}