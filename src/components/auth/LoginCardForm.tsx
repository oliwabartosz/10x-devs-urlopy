import React, { useState } from "react";
import { useFormStatus } from "react-dom";
import { User, Lock, ShieldCheck, CircleCheck, CircleX, Eye, EyeOff, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  serverError?: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputBase =
  "w-full rounded-xl border bg-slate-50 py-3 pl-11 pr-11 text-slate-900 placeholder-slate-400 outline-none transition-all focus:bg-white focus:ring-2";

function LightSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      disabled={pending}
      className="group flex w-full items-center justify-center gap-2 rounded-xl bg-[#072143] py-3.5 font-bold text-white shadow-lg shadow-[#072143]/25 transition-all hover:bg-[#c5ac75] active:scale-[0.98] disabled:opacity-70 disabled:active:scale-100"
    >
      {pending ? (
        <span className="flex items-center gap-2">
          <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          Logowanie...
        </span>
      ) : (
        <>
          Zaloguj się
          <ShieldCheck className="size-[18px] transition-transform group-hover:translate-x-1" />
        </>
      )}
    </Button>
  );
}

export default function LoginCardForm({ serverError }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const emailValid = EMAIL_RE.test(email);
  const emailStatus: "empty" | "valid" | "invalid" = !email.trim() ? "empty" : emailValid ? "valid" : "invalid";

  function validate() {
    const next: typeof errors = {};
    if (!email.trim()) {
      next.email = "Podaj adres email";
    } else if (!emailValid) {
      next.email = "Podaj poprawny adres email";
    }
    if (!password) {
      next.password = "Podaj hasło";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function clearError(field: keyof typeof errors) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  return (
    <form method="POST" action="/api/auth/signin" className="space-y-6" onSubmit={handleSubmit} noValidate>
      <div className="space-y-2">
        <label htmlFor="email" className="ml-1 block text-sm font-semibold text-slate-700">
          Użytkownik / ID
        </label>
        <div className="group relative">
          <span className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-[#072143]">
            <User className="size-5" />
          </span>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearError("email");
            }}
            placeholder="np. jan.kowalski@firma.pl"
            className={cn(
              inputBase,
              errors.email
                ? "border-red-300 focus:border-red-400 focus:ring-red-400/40"
                : "border-slate-200 focus:border-[#b4dceb] focus:ring-[#b4dceb]",
            )}
          />
          {emailStatus !== "empty" && (
            <span className="absolute top-1/2 right-3 -translate-y-1/2">
              {emailStatus === "valid" ? (
                <CircleCheck className="size-5 text-emerald-500" />
              ) : (
                <CircleX className="size-5 text-red-500" />
              )}
            </span>
          )}
        </div>
        {errors.email && (
          <p className="ml-1 flex items-center gap-1 text-xs text-red-600">
            <CircleAlert className="size-3" />
            {errors.email}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className="ml-1 block text-sm font-semibold text-slate-700">
          Hasło
        </label>
        <div className="group relative">
          <span className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-[#072143]">
            <Lock className="size-5" />
          </span>
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearError("password");
            }}
            placeholder="Wpisz hasło"
            className={cn(
              inputBase,
              errors.password
                ? "border-red-300 focus:border-red-400 focus:ring-red-400/40"
                : "border-slate-200 focus:border-[#b4dceb] focus:ring-[#b4dceb]",
            )}
          />
          <button
            type="button"
            onClick={() => {
              setShowPassword(!showPassword);
            }}
            className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-600"
            aria-label={showPassword ? "Ukryj hasło" : "Pokaż hasło"}
          >
            {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
        </div>
        {errors.password && (
          <p className="ml-1 flex items-center gap-1 text-xs text-red-600">
            <CircleAlert className="size-3" />
            {errors.password}
          </p>
        )}
      </div>

      {serverError && (
        <p className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">
          <CircleAlert className="size-4 shrink-0" />
          {serverError}
        </p>
      )}

      <LightSubmitButton />
    </form>
  );
}
