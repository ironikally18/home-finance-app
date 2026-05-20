"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function updatePassword() {
    setMessage("");

    const { error } = await supabase.auth.updateUser({
      password,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("パスワードを変更しました。ログイン画面に戻ってください。");
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5">
        <div className="rounded-2xl bg-neutral-900 p-6 shadow-lg">
          <h1 className="text-2xl font-bold">パスワード再設定</h1>

          <input
            className="mt-6 w-full rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-3 outline-none"
            placeholder="新しいパスワード"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button
            onClick={updatePassword}
            className="mt-4 w-full rounded-xl bg-blue-600 py-3 font-semibold"
          >
            パスワード変更
          </button>

          {message && (
            <div className="mt-5 rounded-xl bg-neutral-800 p-4 text-sm">
              {message}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}