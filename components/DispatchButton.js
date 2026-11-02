"use client";

import { useState, useTransition } from "react";
import { dispatchAction } from "../app/actions";
import CallButton from "./CallButton";
import styles from "./pages.module.css";

export default function DispatchButton({ invoiceId, dispatched = false }) {
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  function dispatch() {
    setError("");
    startTransition(async () => {
      try {
        const result = await dispatchAction(invoiceId);
        if (result?.error) setError(result.error);
        else if (result?.ok) setSent(true);
        else setError("Could not mark this bill dispatched. Please try again.");
      } catch {
        setError("Could not mark this bill dispatched. Please try again.");
      }
    });
  }

  return (
    <div className={styles.dispatch}>
      {dispatched || sent ? (
        <>
          <p className={styles.hand} role="status">Order dispatched. Ab customer ko bata dein?</p>
          <CallButton invoiceId={invoiceId} kind="dispatch" label="Call about dispatch" />
        </>
      ) : (
        <button type="button" className="btn btn--red" onClick={dispatch} disabled={pending}>
          {pending ? "Marking dispatched…" : "Mark dispatched"}
        </button>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}
