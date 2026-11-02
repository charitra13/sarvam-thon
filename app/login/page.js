"use client";

import { useActionState } from "react";
import { loginAction } from "../actions.js";
import styles from "./login.module.css";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, null);
  return (
    <div className={styles.cover}>
      <div className={styles.book}>
        <div className={styles.title}>
          <span className={styles.auspice}>॥ शुभ लाभ ॥</span>
          <h1 className="foil">Munshi</h1>
          <p>Handwritten slips, straight into the bahi.</p>
        </div>

        <form action={formAction} className={`sheet ${styles.page}`}>
          <p className="eyebrow">Track Desk Stationery · Khata 2026–27</p>
          <h2>Open the ledger</h2>
          <label className="field">
            Username
            <input name="username" autoComplete="username" required defaultValue="admin" />
          </label>
          <label className="field">
            Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {state?.error && <p className="error" role="alert">{state.error}</p>}
          <button className="btn btn--red" disabled={pending}>
            {pending ? "Opening…" : "Open bahi"}
          </button>
          <p className={`hand ${styles.hint}`}>demo login: admin / admin</p>
        </form>
      </div>
    </div>
  );
}
