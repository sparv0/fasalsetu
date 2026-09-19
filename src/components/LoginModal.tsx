"use client";

import { useState } from "react";
import { loginWithPhone, registerUser } from "@/lib/actions";

export default function LoginModal({ districts }: { districts: string[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<"login" | "register">("login");

  return (
    <>
      <div className="flex gap-2">
        <button
          onClick={() => {
            setTab("login");
            setIsOpen(true);
          }}
          className="bg-emerald-800 hover:bg-emerald-700 px-3 py-1 rounded text-xs font-medium text-white"
        >
          Log in
        </button>
        <button
          onClick={() => {
            setTab("register");
            setIsOpen(true);
          }}
          className="bg-emerald-600 hover:bg-emerald-500 px-3 py-1 rounded text-xs font-medium text-white"
        >
          Create Account
        </button>
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex border-b">
              <button
                onClick={() => setTab("login")}
                className={`flex-1 py-3 text-sm font-semibold transition ${
                  tab === "login" ? "text-emerald-800 border-b-2 border-emerald-800" : "text-stone-500 hover:bg-stone-50"
                }`}
              >
                Log In
              </button>
              <button
                onClick={() => setTab("register")}
                className={`flex-1 py-3 text-sm font-semibold transition ${
                  tab === "register" ? "text-emerald-800 border-b-2 border-emerald-800" : "text-stone-500 hover:bg-stone-50"
                }`}
              >
                Create Account
              </button>
            </div>

            <div className="p-5 overflow-y-auto">
              {tab === "login" ? (
                <form action={loginWithPhone} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-stone-700 mb-1">Phone Number</label>
                    <input
                      name="phone"
                      type="tel"
                      required
                      placeholder="e.g. 9800000001"
                      className="w-full border border-stone-300 rounded p-2 text-sm text-stone-900 bg-white"
                    />
                  </div>
                  <button type="submit" className="w-full bg-emerald-800 hover:bg-emerald-900 text-white rounded p-3 font-medium transition">
                    Log In
                  </button>
                </form>
              ) : (
                <form action={registerUser} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-stone-700 mb-1">Full Name</label>
                    <input name="name" type="text" required placeholder="Name" className="w-full border border-stone-300 rounded p-2 text-sm text-stone-900 bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-700 mb-1">Phone Number</label>
                    <input name="phone" type="tel" required placeholder="Phone Number" className="w-full border border-stone-300 rounded p-2 text-sm text-stone-900 bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-700 mb-1">Role</label>
                    <select name="role" required className="w-full border border-stone-300 rounded p-2 text-sm bg-white text-stone-900">
                      <option value="">Select Role</option>
                      <option value="FARMER">Farmer</option>
                      <option value="FPO">FPO</option>
                      <option value="BUYER">Buyer</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-700 mb-1">District</label>
                    <select name="district" required className="w-full border border-stone-300 rounded p-2 text-sm bg-white text-stone-900">
                      <option value="">Select District</option>
                      {districts.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button type="submit" className="w-full bg-emerald-800 hover:bg-emerald-900 text-white rounded p-3 font-medium transition">
                    Create & Log In
                  </button>
                </form>
              )}
            </div>
            
            <div className="border-t p-3 text-center">
              <button
                onClick={() => setIsOpen(false)}
                className="text-stone-500 text-xs font-medium hover:text-stone-800"
              >
                Close Window
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
