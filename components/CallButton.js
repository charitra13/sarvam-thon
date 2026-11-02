"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { callAction, orderGreetingAction, takeOrderAction, placeOrderAction } from "../app/actions.js";
import styles from "./CallButton.module.css";

const barHeights = [12, 22, 35, 19, 43, 28, 49, 34, 21, 41, 54, 30, 45, 23, 38, 50, 27, 42, 18, 32, 46, 24, 35, 16];
const RECORD_LIMIT_MS = 25_000; // Saaras' REST API takes clips under 30 seconds
const inr = (n) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function PhoneIcon({ ended = false }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true" className={ended ? styles.hangupIcon : undefined}><path d="M7.1 3.5 4.5 5.1c-.9.6-.9 2.4-.3 4 1.6 4.3 5 7.7 9.3 9.3 1.6.6 3.4.6 4-.3l1.6-2.6-4-2.1-1.6 1.6a11.8 11.8 0 0 1-5.5-5.5l1.6-1.6-2.5-4.4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>;
}

// Resolves to null when the browser has no mic or the user says no.
function openMic() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return Promise.resolve(null);
  return navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
}

// kind "order" takes a customerId: Simran greets, the caller speaks, and the order is read back for booking.
export default function CallButton({ invoiceId, customerId, kind, label, variant = "ghost" }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("ringing");
  const [result, setResult] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [needsPlay, setNeedsPlay] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [failure, setFailure] = useState("call");
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState(false);
  const [billId, setBillId] = useState(null);
  const trigger = useRef(null);
  const dialog = useRef(null);
  const closeButton = useRef(null);
  const audio = useRef(null);
  const mic = useRef(null);
  const recorder = useRef(null);
  const session = useRef(0);
  const opening = useRef(false);
  const loadedCall = useRef(false);
  const isPayment = kind === "payment";
  const isOrder = kind === "order";
  const name = typeof result?.customer === "string" ? result.customer : result?.customer?.name || "customer";
  const initials = name === "customer" ? "M" : name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const timer = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const ticking = status === "listening" || status === "thinking" || (status === "connected" && playing);
  const showOrder = isOrder && Array.isArray(result?.lines) && (status === "connected" || status === "placed");
  const total = showOrder ? result.lines.reduce((sum, line) => sum + line.qty * line.unit_price, 0) : 0;

  function stopAudio() {
    if (audio.current) {
      audio.current.pause();
      audio.current.currentTime = 0;
    }
    setPlaying(false);
  }

  function stopMic() {
    const active = recorder.current;
    recorder.current = null;
    if (active?.state === "recording") active.stop();
    mic.current?.getTracks().forEach((track) => track.stop());
    mic.current = null;
  }

  function close() {
    session.current += 1;
    opening.current = false;
    stopAudio();
    stopMic();
    setOpen(false);
    if (loadedCall.current) router.refresh();
  }

  async function startCall() {
    if (opening.current) return;
    opening.current = true;
    const currentSession = ++session.current;
    stopAudio();
    stopMic();
    loadedCall.current = false;
    setResult(null);
    setElapsed(0);
    setNeedsPlay(false);
    setAudioError(false);
    setBookError(false);
    setBillId(null);
    setStatus("ringing");
    setOpen(true);
    // Asked during the click so the mic prompt shows while the greeting loads.
    const micReady = isOrder ? openMic() : null;
    try {
      const data = isOrder ? await orderGreetingAction(customerId) : await callAction(invoiceId, kind);
      const stream = await micReady;
      if (currentSession !== session.current) {
        stream?.getTracks().forEach((track) => track.stop());
        if (data && !data.error) router.refresh();
        return;
      }
      if (data?.error || !data?.audio || !data.audio.startsWith("data:audio/")) throw new Error("call");
      if (isOrder && !stream) {
        setFailure("mic");
        setStatus("error");
        return;
      }
      mic.current = stream;
      loadedCall.current = true;
      setResult(data);
      setStatus("connected");
    } catch {
      micReady?.then((stream) => stream?.getTracks().forEach((track) => track.stop()));
      if (currentSession === session.current) {
        setFailure("call");
        setStatus("error");
      }
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
        stopMic();
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
      if (!isOrder) {
        setStatus("completed");
        router.refresh();
      } else if (!result.lines) listen(); // greeting over: the caller speaks next
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
  }, [open, result, router, isOrder]);

  useEffect(() => {
    if (!open || !ticking) return;
    const interval = setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => clearInterval(interval);
  }, [open, ticking]);

  useEffect(() => () => {
    session.current += 1;
    audio.current?.pause();
    stopMic();
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

  function listen() {
    const currentSession = session.current;
    const chunks = [];
    let active;
    try {
      active = new MediaRecorder(mic.current);
      active.start();
    } catch {
      setFailure("mic");
      setStatus("error");
      return;
    }
    const limit = setTimeout(() => { if (active.state === "recording") active.stop(); }, RECORD_LIMIT_MS);
    active.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    active.onstop = () => {
      clearTimeout(limit);
      if (currentSession === session.current && recorder.current === active) sendOrder(new Blob(chunks, { type: active.mimeType }), currentSession);
    };
    recorder.current = active;
    setBookError(false);
    setStatus("listening");
  }

  function stopListening() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  async function sendOrder(recording, currentSession) {
    setStatus("thinking");
    try {
      const form = new FormData();
      form.set("audio", recording, "order");
      const data = await takeOrderAction(form);
      if (currentSession !== session.current) return;
      if (data?.error || !Array.isArray(data?.lines) || !data.audio?.startsWith("data:audio/")) throw new Error("order");
      setResult((current) => ({ ...current, ...data }));
      setStatus("connected");
    } catch {
      if (currentSession === session.current) {
        setFailure("listen");
        setStatus("error");
      }
    }
  }

  function speakAgain() {
    stopAudio();
    listen();
  }

  async function bookOrder() {
    if (opening.current) return;
    opening.current = true;
    const currentSession = session.current;
    setBooking(true);
    setBookError(false);
    try {
      const data = await placeOrderAction({ customerId, lines: result.lines.map(({ item_id, qty }) => ({ item_id, qty })), transcript: result.transcript });
      if (currentSession !== session.current) {
        if (data?.id) router.refresh();
        return;
      }
      if (!data?.id) throw new Error("book");
      stopAudio();
      stopMic();
      setBillId(data.id);
      setStatus("placed");
      router.refresh();
    } catch {
      if (currentSession === session.current) setBookError(true);
    } finally {
      if (currentSession === session.current) opening.current = false;
      setBooking(false);
    }
  }

  function viewBill() {
    close();
    router.push(`/invoices/${billId}`);
  }

  function endCall() {
    stopAudio();
    setNeedsPlay(false);
    setStatus("ended");
    router.refresh();
  }

  return (
    <>
      <button ref={trigger} type="button" className={`btn ${variant === "red" || variant === "primary" ? "btn--red" : "btn--ghost"} ${styles.trigger}`} onClick={startCall} aria-haspopup="dialog"><PhoneIcon />{label || (isPayment ? "Payment reminder" : isOrder ? "Call to place order" : "Call for dispatch")}</button>
      {open && createPortal(
        <div className={styles.backdrop} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section ref={dialog} className={styles.phone} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}>
            <div className={styles.topbar}><span>MUNSHI / VOICE DESK</span><button ref={closeButton} type="button" className={styles.close} aria-label="Close call dialog" onClick={close}>×</button></div>
            <div className={styles.purpose}>{isPayment ? "A gentle payment reminder" : isOrder ? "A new order, by voice" : "Your order, on its way"}<span>SIMULATED CALL</span></div>
            <div className={`${styles.avatarWrap} ${status === "ringing" ? styles.ringing : ""}`}><span className={styles.ringOne} /><span className={styles.ringTwo} /><div className={styles.avatar}>{initials}</div></div>
            <h2 id={`${id}-title`} className={styles.customer}>{status === "ringing" ? (isOrder ? "Connecting customer" : "Calling customer") : status === "error" && failure !== "listen" ? "Couldn’t connect" : name}</h2>
            <p id={`${id}-description`} className={styles.description}>{result?.phone ? `${name} · ${result.phone}` : isPayment ? "Payment reminder · Hinglish" : isOrder ? "Phone order · Hinglish" : "Dispatch update · Hinglish"}</p>
            <div className={styles.status} role="status" aria-live="polite">
              {status === "ringing" && <><span className={styles.statusDot} /><span className={styles.hinglish}>Ring ho raha hai…</span></>}
              {status === "connected" && <><span className={`${styles.statusDot} ${styles.connectedDot}`} />Connected <span className={styles.timer} aria-label="Call duration" aria-live="off">{timer}</span></>}
              {status === "listening" && <><span className={`${styles.statusDot} ${styles.liveDot}`} />Listening <span className={styles.timer} aria-label="Call duration" aria-live="off">{timer}</span></>}
              {status === "thinking" && <><span className={styles.statusDot} /><span className={styles.hinglish}>Order likh rahi hoon…</span></>}
              {status === "placed" && <><span className={styles.completedTick}>✓</span>Order booked <span className={styles.timer}>Bill {billId}</span></>}
              {status === "completed" && <><span className={styles.completedTick}>✓</span>Call completed <span className={styles.timer}>{timer}</span></>}
              {status === "ended" && <>Call ended <span className={styles.timer}>{timer}</span></>}
              {status === "error" && <span>{failure === "mic" ? "Allow the microphone, then try again." : failure === "listen" ? "Couldn’t catch that. Please speak again." : "Please try the call again in a moment."}</span>}
            </div>

            <div className={`${styles.waveform} ${playing || status === "listening" ? styles.playing : ""}`} aria-hidden="true">{barHeights.map((height, index) => <span key={index} style={{ "--height": `${height}px`, "--delay": `${index * -0.13}s`, "--duration": `${0.55 + (index % 5) * 0.15}s` }} />)}</div>
            <p className={styles.voice}><span>◉</span> {status === "listening" ? "Customer" : "Simran"} <span className={styles.voiceDivider}>/</span> {status === "listening" ? "Saaras v3" : "Bulbul v4"}</p>

            {status === "ringing" && <p className={styles.connectingNote}>{isOrder ? <>Allow the microphone when the browser asks.<br /><span>Phir customer ban kar boliye.</span></> : <>Munshi is preparing a voice message.<br /><span>Aapki dukaan ki awaaz.</span></>}</p>}
            {status === "listening" && <p className={styles.connectingNote}>Speak the order, then tap Done speaking.<br /><span>“Bees classmate copy aur do box chalk”</span></p>}
            {status === "thinking" && <p className={styles.connectingNote}>Saaras is writing it down and Sarvam-105B is matching your stock.<br /><span>Bas ek pal…</span></p>}
            {needsPlay && status === "connected" && <div className={styles.playPrompt}><p>{audioError ? "Audio couldn’t start. Tap below to try playback again." : "Your browser needs a tap to start the voice."}</p><button type="button" className={styles.playButton} onClick={() => play()}>▶ Play message</button></div>}

            {showOrder && <div className={styles.transcript}><div className={styles.transcriptLabel}>CUSTOMER SAID <span>SAARAS V3</span></div><p lang="hi">{result.transcript || "Kuch sunai nahi diya."}</p></div>}
            {showOrder && result.lines.length > 0 && <ul className={styles.order} aria-label="Order items">{result.lines.map((line, index) => <li key={index}><span>{line.qty} × {line.name}</span><span>{inr(line.qty * line.unit_price)}</span></li>)}<li className={styles.orderTotal}><span>Total</span><span>{inr(total)}</span></li></ul>}
            {showOrder && result.missing?.length > 0 && <p className={styles.orderNote}>Not in inventory: {result.missing.join(", ")}</p>}
            {bookError && status === "connected" && <p className={styles.orderNote} role="alert">The order couldn’t be booked. Please try again.</p>}

            {result?.script && !(showOrder && result.lines.length) && <div className={styles.transcript}><div className={styles.transcriptLabel}>SIMRAN SAYS <span>HINGLISH</span></div><p lang="hi-Latn">{result.script}</p></div>}

            <div className={styles.callControls}>
              {status === "listening" ? <button type="button" className={styles.doneButton} onClick={stopListening}>Done speaking ✓</button> : status === "placed" ? <><button type="button" className={styles.replayButton} onClick={viewBill}>View bill →</button><button type="button" className={styles.doneButton} onClick={close}>Done ✓</button></> : showOrder ? <><button type="button" className={styles.replayButton} onClick={speakAgain} disabled={booking}>↻ Speak again</button>{result.lines.length > 0 && <button type="button" className={styles.doneButton} onClick={bookOrder} disabled={booking}>{booking ? "Booking…" : "Book order ✓"}</button>}</> : status === "ringing" || status === "connected" || status === "thinking" ? <button type="button" className={styles.endButton} onClick={status === "ringing" || isOrder ? close : endCall}><PhoneIcon ended /><span>End call</span></button> : status === "error" ? <button type="button" className={styles.playButton} onClick={failure === "listen" ? listen : startCall}>{failure === "listen" ? "Speak again" : "Try call again"}</button> : <><button type="button" className={styles.replayButton} onClick={() => play(true)}>↻ Replay</button><button type="button" className={styles.doneButton} onClick={close}>Done ✓</button></>}
            </div>
            <p className={styles.footerNote}>{isOrder ? "Your voice goes to Sarvam for transcription · no real phone call" : "Played here in your browser · no real phone call"}</p>
          </section>
        </div>, document.body,
      )}
    </>
  );
}
