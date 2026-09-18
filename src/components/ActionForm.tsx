"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import type { ActionResult } from "@/lib/action-result";
import { useT } from "./I18nProvider";

const VARIANTS = {
  primary: "bg-emerald-700 text-white hover:bg-emerald-800",
  secondary: "bg-stone-200 text-stone-800 hover:bg-stone-300",
  danger: "bg-rose-700 text-white hover:bg-rose-800",
  warning: "bg-amber-600 text-white hover:bg-amber-700",
  info: "bg-sky-700 text-white hover:bg-sky-800",
} as const;

type Props = {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
  pendingLabel?: string;
  variant?: keyof typeof VARIANTS;
  hidden?: Record<string, string>;
  className?: string;
  buttonClassName?: string;
  resetOnSuccess?: boolean;
  onSuccess?: () => void;
  encType?: "multipart/form-data";
  children?: React.ReactNode;
};

export default function ActionForm({
  action,
  submitLabel,
  pendingLabel,
  variant = "primary",
  hidden,
  className = "flex flex-wrap items-end gap-2",
  buttonClassName = "",
  resetOnSuccess = false,
  onSuccess,
  encType,
  children,
}: Props) {
  const t = useT();
  const [state, formAction, isPending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);

  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  });
  useEffect(() => {
    if (!state?.ok) return;
    if (resetOnSuccess) formRef.current?.reset();
    onSuccessRef.current?.();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={formRef}
      encType={encType}
      onSubmit={(e) => {
        // Submit manually so a validation error doesn't wipe what the user typed.
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <div className={className}>
        {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        {children}
        <button
          type="submit"
          disabled={isPending}
          className={`text-sm px-3 py-1.5 rounded-lg font-medium transition disabled:opacity-60 disabled:cursor-wait ${VARIANTS[variant]} ${buttonClassName}`}
        >
          {isPending ? (pendingLabel ?? t("Working…", "काम हो रहा है…")) : submitLabel}
        </button>
      </div>
      {state && !state.ok && (
        <p role="alert" className="mt-1.5 text-xs text-rose-700">
          {state.error}
        </p>
      )}
      {state?.ok && state.message && (
        <p role="status" className="mt-1.5 text-xs text-emerald-700">
          {state.message}
        </p>
      )}
    </form>
  );
}
