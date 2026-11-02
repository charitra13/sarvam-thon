"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { callAction } from "../app/actions.js";
import styles from "./CallButton.module.css";

const barHeights = [12, 22, 35, 19, 43, 28, 49, 34, 21, 41, 54, 30, 45, 23, 38, 50, 27, 42, 18, 32, 46, 24, 35, 16];

function PhoneIcon({ ended = false }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true" className={ended ? styles.hangupIcon : undefined}><path d="M7.1 3.5 4.5 5.1c-.9.6-.9 2.4-.3 4 1.6 4.3 5 7.7 9.3 9.3 1.6.6 3.4.6 4-.3l1.6-2.6-4-2.1-1.6 1.6a11.8 11.8 0 0 1-5.5-5.5l1.6-1.6-2.5-4.4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>;
}

export default function CallButton({ invoiceId, kind, label, variant = "ghost" }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("ringing");
  const [result, setResult] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [needsPlay, setNeedsPlay] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const trigger = useRef(null);
  const dialog = useRef(null);
  const closeButton = useRef(null);
  const audio = useRef(null);
  const session = useRef(0);
  const opening = useRef(false);
  const loadedCall = useRef(false);
  const isPayment = kind === "payment";
  const name = typeof result?.customer === "string" ? result.customer : result?.customer?.name || "customer";
  const initials = name === "customer" ? "M" : name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const timer = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  function stopAudio() {
    if (audio.current) {
      audio.current.pause();
      audio.current.currentTime = 0;
    }
    setPlaying(false);
  }

  function close() {
    session.current += 1;
    opening.current = false;
    stopAudio();
    setOpen(false);
    if (loadedCall.current) router.refresh();
  }

  async function startCall() {
    if (opening.current) return;
    opening.current = true;
    const currentSession = ++session.current;
    stopAudio();
    loadedCall.current = false;
    setResult(null);
    setElapsed(0);
    setNeedsPlay(false);
    setAudioError(false);
    setStatus("ringing");
    setOpen(true);
    try {
      const data = await callAction(invoiceId, kind);
      if (currentSession !== session.current) {
        if (data && !data.error) router.refresh();
        return;
      }
      if (data?.error || !data?.audio || !data.audio.startsWith("data:audio/")) throw new Error("call");
      loadedCall.current = true;
      setResult(data);
      setStatus("connected");
    } catch {
      if (currentSession === session.current) setStatus("error");
    } finally {
      if (currentSession === session.current) opening.current = false;
    }
  }

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    function keydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        session.current += 1;
        opening.current = false;
        audio.current?.pause();
        setPlaying(false);
        setOpen(false);
        if (loadedCall.current) router.refresh();
      }
      if (event.key === "Tab") {
        const focusable = Array.from(dialog.current?.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]') || []);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) {
          event.preventDefault(); first?.focus();
        }
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keydown);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
      else trigger.current?.focus();
    };
  }, [open, router]);

  useEffect(() => {
    if (!open || !result?.audio) return;
    let live = true;
    const player = new Audio(result.audio);
    audio.current = player;
    player.onplaying = () => { setPlaying(true); setNeedsPlay(false); setAudioError(false); };
    player.onpause = () => setPlaying(false);
    player.onended = () => {
      setPlaying(false);
      setNeedsPlay(false);
      setStatus("completed");
      router.refresh();
    };
    player.onerror = () => { setPlaying(false); setAudioError(true); setNeedsPlay(true); };
    player.play().catch(() => { if (live) { setNeedsPlay(true); setPlaying(false); } });
    return () => {
      live = false;
      player.onplaying = null;
      player.onpause = null;
      player.onended = null;
      player.onerror = null;
      player.pause();
      player.removeAttribute("src");
      player.load();
      if (audio.current === player) audio.current = null;
    };
  }, [open, result, router]);

  useEffect(() => {
    if (!open || status !== "connected" || !playing) return;
    const interval = setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => clearInterval(interval);
  }, [open, status, playing]);

  useEffect(() => () => {
    session.current += 1;
    audio.current?.pause();
  }, []);

  async function play(replay = false) {
    const player = audio.current;
    if (!player) return;
    if (replay) {
      player.currentTime = 0;
      setElapsed(0);
    }
    setStatus("connected");
    setAudioError(false);
    try {
      await player.play();
    } catch {
      if (audio.current === player) {
        setNeedsPlay(true);
        setAudioError(true);
      }
    }
  }

  function endCall() {
    stopAudio();
    setNeedsPlay(false);
    setStatus("ended");
    router.refresh();
  }

  return (
    <>
      <button ref={trigger} type="button" className={`btn ${variant === "red" || variant === "primary" ? "btn--red" : "btn--ghost"} ${styles.trigger}`} onClick={startCall} aria-haspopup="dialog"><PhoneIcon />{label || (isPayment ? "Payment reminder" : "Call for dispatch")}</button>
      {open && createPortal(
        <div className={styles.backdrop} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section ref={dialog} className={styles.phone} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}>
            <div className={styles.topbar}><span>MUNSHI / VOICE DESK</span><button ref={closeButton} type="button" className={styles.close} aria-label="Close call dialog" onClick={close}>×</button></div>
            <div className={styles.purpose}>{isPayment ? "A gentle payment reminder" : "Your order, on its way"}<span>SIMULATED CALL</span></div>
            <div className={`${styles.avatarWrap} ${status === "ringing" ? styles.ringing : ""}`}><span className={styles.ringOne} /><span className={styles.ringTwo} /><div className={styles.avatar}>{initials}</div></div>
            <h2 id={`${id}-title`} className={styles.customer}>{status === "ringing" ? "Calling customer" : status === "error" ? "Couldn’t connect" : name}</h2>
            <p id={`${id}-description`} className={styles.description}>{result?.phone ? `${name} · ${result.phone}` : isPayment ? "Payment reminder · Hinglish" : "Dispatch update · Hinglish"}</p>
            <div className={styles.status} role="status" aria-live="polite">
              {status === "ringing" && <><span className={styles.statusDot} /><span className={styles.hinglish}>Ring ho raha hai…</span></>}
              {status === "connected" && <><span className={`${styles.statusDot} ${styles.connectedDot}`} />Connected <span className={styles.timer} aria-label="Call duration" aria-live="off">{timer}</span></>}
              {status === "completed" && <><span className={styles.completedTick}>✓</span>Call completed <span className={styles.timer}>{timer}</span></>}
              {status === "ended" && <>Call ended <span className={styles.timer}>{timer}</span></>}
              {status === "error" && <span>Please try the call again in a moment.</span>}
            </div>

            <div className={`${styles.waveform} ${playing ? styles.playing : ""}`} aria-hidden="true">{barHeights.map((height, index) => <span key={index} style={{ "--height": `${height}px`, "--delay": `${index * -0.13}s`, "--duration": `${0.55 + (index % 5) * 0.15}s` }} />)}</div>
            <p className={styles.voice}><span>◉</span> Simran <span className={styles.voiceDivider}>/</span> Bulbul v4</p>

            {status === "ringing" && <p className={styles.connectingNote}>Munshi is preparing a voice message.<br /><span>Aapki dukaan ki awaaz.</span></p>}
            {needsPlay && status === "connected" && <div className={styles.playPrompt}><p>{audioError ? "Audio couldn’t start. Tap below to try playback again." : "Your browser needs a tap to start the voice."}</p><button type="button" className={styles.playButton} onClick={() => play()}>▶ Play message</button></div>}

            {result?.script && <div className={styles.transcript}><div className={styles.transcriptLabel}>SIMRAN SAYS <span>HINGLISH</span></div><p lang="hi-Latn">{result.script}</p></div>}

            <div className={styles.callControls}>
              {status === "ringing" || status === "connected" ? <button type="button" className={styles.endButton} onClick={status === "ringing" ? close : endCall}><PhoneIcon ended /><span>End call</span></button> : status === "error" ? <button type="button" className={styles.playButton} onClick={startCall}>Try call again</button> : <><button type="button" className={styles.replayButton} onClick={() => play(true)}>↻ Replay</button><button type="button" className={styles.doneButton} onClick={close}>Done ✓</button></>}
            </div>
            <p className={styles.footerNote}>Played here in your browser · no real phone call</p>
          </section>
        </div>, document.body,
      )}
    </>
  );
}
