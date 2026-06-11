import { useState } from "react";
import type { FormEvent } from "react";
import { Check, Loader2 } from "lucide-react";

export function AuthPage(props: {
  providers: string[];
  onExternal: (provider: string) => void;
  onLogin: (email: string, password: string) => void;
  onRegister: (email: string, password: string, displayName: string) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const actionLabel = mode === "login" ? "HYR" : "REGJISTROHU";

  function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "login") props.onLogin(email, password);
    else props.onRegister(email, password, displayName || email.split("@")[0]);
  }

  return (
    <section className="auth-card compact">
      {props.providers.includes("google") && (
        <>
          <button className="oauth-button" type="button" onClick={() => props.onExternal("google")}>
            <span className="google-mark">G</span>
            VAZHDO ME GOOGLE
          </button>
          <div className="auth-divider"><span>ose</span></div>
        </>
      )}
      <div className="tabs">
        <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>HYR</button>
        <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>REGJISTROHU</button>
      </div>
      <form className="auth-form" onSubmit={submitAuth}>
        {mode === "register" && (
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Emri publik"
            autoComplete="name"
          />
        )}
        <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" type="email" autoComplete="email" />
        <input
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Fjalekalimi"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />
        <button className="primary-button full auth-submit" type="submit">
          <Check size={16} /> {actionLabel}
        </button>
      </form>
    </section>
  );
}

export function AuthCallback(props: { status: "idle" | "loading" | "failed"; onAuth: () => void }) {
  return (
    <section className="auth-card auth-callback">
      {props.status !== "failed" ? <Loader2 size={22} className="spin" /> : null}
      <h1>{props.status === "failed" ? "Hyrja deshtoi" : "Duke hyre"}</h1>
      <p className="muted">
        {props.status === "failed"
          ? "Provo perseri ose hyr me email."
          : "Po lidhim llogarine tende me Sheshi."}
      </p>
      {props.status === "failed" && <button className="primary-button" onClick={props.onAuth}>KTHEHU TE HYRJA</button>}
    </section>
  );
}
