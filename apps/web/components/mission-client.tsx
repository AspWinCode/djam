"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { GameStep, GameVersion, ParticipantProgress, ParticipantStepProgress, StepHint } from "@game-game/shared";
import { completeParticipantStep, getParticipantProgress, requestParticipantHelp, requestParticipantHintOpen, requestParticipantReview } from "../lib/api";
import { ChildAttemptHistoryPanel } from "./child-attempt-history-panel";
import { saveChildAttempt } from "./child-attempt-history";
import { clearChildSession, readChildSession } from "./child-session-sync";

import { STEP_HINTS_ENABLED } from "../lib/features";

const GDEVELOP_URL = "https://gdevelop.tirskix.space/";

// ── Theme helpers ─────────────────────────────────────────────────────────────
function adjustHex(hex: string, amount: number): string {
  if (!hex || hex[0] !== "#" || hex.length < 7) return hex;
  const r = Math.max(0, Math.min(255, parseInt(hex.slice(1, 3), 16) + amount));
  const g = Math.max(0, Math.min(255, parseInt(hex.slice(3, 5), 16) + amount));
  const b = Math.max(0, Math.min(255, parseInt(hex.slice(5, 7), 16) + amount));
  return `rgb(${r},${g},${b})`;
}

const THEME_BG: Record<string, string> = {
  "cyber-it":  "radial-gradient(ellipse at 15% 50%, rgba(0,200,255,0.05) 0%, transparent 65%)",
  "space":     "radial-gradient(ellipse at 85% 20%, rgba(138,43,226,0.06) 0%, transparent 65%)",
  "nature":    "radial-gradient(ellipse at 10% 80%, rgba(34,197,94,0.06) 0%, transparent 65%)",
  "retro":     "radial-gradient(ellipse at 50% 50%, rgba(245,158,11,0.06) 0%, transparent 65%)",
  "adventure": "radial-gradient(ellipse at 30% 70%, rgba(234,88,12,0.06) 0%, transparent 65%)",
  "science":   "radial-gradient(ellipse at 70% 30%, rgba(20,184,166,0.06) 0%, transparent 65%)",
  "art":       "radial-gradient(ellipse at 40% 60%, rgba(236,72,153,0.06) 0%, transparent 65%)",
};

const ACCENT_PATTERN: Record<string, React.CSSProperties> = {
  "neon-grid": {
    backgroundImage: "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
    backgroundSize: "32px 32px",
  },
  "dots": {
    backgroundImage: "radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)",
    backgroundSize: "20px 20px",
  },
  "geometry": {
    backgroundImage: "linear-gradient(45deg, rgba(255,255,255,0.02) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.02) 25%, transparent 25%)",
    backgroundSize: "24px 24px",
  },
  "gradient": {
    background: "linear-gradient(180deg, rgba(255,255,255,0.015) 0%, transparent 60%)",
  },
};

type PanelMode = "split" | "info-only" | "editor-full";

// ── Confetti ──────────────────────────────────────────────────────────────────
const CONFETTI_COLORS = ["#6366F1","#818CF8","#22C55E","#F59E0B","#EC4899","#38BDF8","#a78bfa","#fb923c"];

function launchConfetti(canvas: HTMLCanvasElement, accentColor?: string) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const colors = accentColor ? [...CONFETTI_COLORS, accentColor] : CONFETTI_COLORS;

  type Particle = { x: number; y: number; vx: number; vy: number; r: number; color: string; angle: number; spin: number; shape: "rect" | "circle" };
  const particles: Particle[] = Array.from({ length: 130 }, () => ({
    x: Math.random() * canvas.width,
    y: -10 - Math.random() * 120,
    vx: (Math.random() - 0.5) * 4,
    vy: 2.5 + Math.random() * 4,
    r: 5 + Math.random() * 7,
    color: colors[Math.floor(Math.random() * colors.length)],
    angle: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 0.2,
    shape: Math.random() > 0.5 ? "rect" : "circle"
  }));

  let frame = 0;
  function draw() {
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy;
      p.vy += 0.12;
      p.vx *= 0.99;
      p.angle += p.spin;
      ctx!.save();
      ctx!.translate(p.x, p.y);
      ctx!.rotate(p.angle);
      ctx!.fillStyle = p.color;
      ctx!.globalAlpha = Math.max(0, 1 - frame / 90);
      if (p.shape === "rect") ctx!.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
      else { ctx!.beginPath(); ctx!.arc(0, 0, p.r / 2, 0, Math.PI * 2); ctx!.fill(); }
      ctx!.restore();
    }
    frame++;
    if (frame < 100) requestAnimationFrame(draw);
    else ctx!.clearRect(0, 0, canvas.width, canvas.height);
  }
  draw();
}

// ── Animated counter ──────────────────────────────────────────────────────────
function useCountUp(target: number, duration = 600) {
  const [display, setDisplay] = useState(target);
  const prevRef = useRef(target);
  useEffect(() => {
    const from = prevRef.current;
    if (from === target) return;
    const diff = target - from;
    const start = performance.now();
    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + diff * ease));
      if (t < 1) requestAnimationFrame(tick);
      else prevRef.current = target;
    }
    requestAnimationFrame(tick);
  }, [target, duration]);
  return display;
}

function renderMedia(url: string, type: "image" | "video", label: string) {
  if (type === "image") {
    return <img src={url} alt={label} style={{ width: "100%", height: "auto", objectFit: "contain", borderRadius: 8 }} />;
  }
  return (
    <video style={{ width: "100%", maxHeight: 200, borderRadius: 8 }} controls preload="metadata">
      <source src={url} />
    </video>
  );
}

function HintCard({ hint }: { hint: StepHint }) {
  return (
    <div style={{ background: "var(--bg-tertiary)", borderRadius: 8, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--primary-hover)" }}>Подсказка L{hint.level}</span>
        <span className="pill" style={{ fontSize: 10 }}>{hint.hintType}</span>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{hint.text}</p>
      {hint.mediaUrl && hint.hintType !== "text" ? (
        <div style={{ marginTop: 8 }}>
          {renderMedia(hint.mediaUrl, hint.hintType === "image" ? "image" : "video", `Hint L${hint.level}`)}
        </div>
      ) : null}
    </div>
  );
}

// ── Inline hint-block spoiler (from TipTap editor) ────────────────────────────

function InlineHintSpoiler({
  index,
  innerHtml,
  isRevealed,
  isPending,
  isNext,
  onRequest,
}: {
  index: number;
  innerHtml: string;
  isRevealed: boolean;
  isPending: boolean;
  isNext: boolean;
  onRequest: () => void;
}) {
  if (isRevealed) {
    return (
      <div style={{
        margin: "12px 0",
        border: "1px solid rgba(245,158,11,0.35)",
        borderRadius: 10,
        overflow: "hidden",
        background: "rgba(245,158,11,0.06)",
      }}>
        <div style={{
          padding: "5px 12px",
          fontSize: 11,
          fontWeight: 700,
          color: "#f59e0b",
          letterSpacing: "0.04em",
          borderBottom: "1px solid rgba(245,158,11,0.2)",
        }}>
          💡 Подсказка {index}
        </div>
        <div
          className="rich-editor-content"
          style={{ padding: "10px 14px", fontSize: 14, lineHeight: 1.6 }}
          dangerouslySetInnerHTML={{ __html: innerHtml }}
        />
      </div>
    );
  }

  return (
    <div style={{
      margin: "12px 0",
      border: "1px dashed rgba(245,158,11,0.3)",
      borderRadius: 10,
      padding: "10px 14px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      background: "rgba(245,158,11,0.04)",
    }}>
      <span style={{ fontSize: 13, color: "var(--muted)" }}>
        💡 Подсказка {index} — скрыта
      </span>
      {isNext ? (
        <button
          type="button"
          className="button-secondary"
          style={{ fontSize: 12, padding: "4px 12px", whiteSpace: "nowrap" }}
          disabled={isPending}
          onClick={onRequest}
        >
          {isPending ? "⏳ Ожидаем тренера..." : "Запросить"}
        </button>
      ) : (
        <span style={{ fontSize: 11, color: "var(--muted)" }}>сначала предыдущая</span>
      )}
    </div>
  );
}

/** Parse `<hint-block>` elements out of a description HTML string.
 *  Returns an array of innerHtml strings in document order. */
function extractInlineHints(html: string): string[] {
  if (typeof window === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks = doc.querySelectorAll("hint-block");
  return Array.from(blocks).map((el) => el.innerHTML);
}

/** Render a description HTML string, replacing <hint-block> with spoiler components. */
function DescriptionWithHints({
  html,
  openedCount,
  hintPending,
  onRequest,
}: {
  html: string;
  openedCount: number;
  hintPending: boolean;
  onRequest: () => void;
}) {
  if (!html?.trimStart().startsWith("<")) {
    return <p style={{ margin: 0, color: "var(--muted)", fontSize: 14, lineHeight: 1.6 }}>{html}</p>;
  }

  // Split description by hint-block tags
  const parts = html.split(/(<hint-block[^>]*>[\s\S]*?<\/hint-block>)/gi);
  let hintIndex = 0;

  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^<hint-block[^>]*>([\s\S]*?)<\/hint-block>$/i);
        if (match) {
          if (!STEP_HINTS_ENABLED) return null;
          hintIndex += 1;
          const idx = hintIndex;
          return (
            <InlineHintSpoiler
              key={`hint-${i}`}
              index={idx}
              innerHtml={match[1]}
              isRevealed={idx <= openedCount}
              isPending={hintPending}
              isNext={idx === openedCount + 1}
              onRequest={onRequest}
            />
          );
        }
        if (!part.trim()) return null;
        return (
          <div
            key={`text-${i}`}
            className="rich-editor-content"
            style={{ margin: 0, color: "var(--muted)", fontSize: 14, lineHeight: 1.6 }}
            dangerouslySetInnerHTML={{ __html: part }}
          />
        );
      })}
    </>
  );
}

function ensureLocalStepProgress(
  version: GameVersion,
  provided: ParticipantStepProgress[],
  participantId: string,
  gameVersionId: string
): ParticipantStepProgress[] {
  return version.snapshotJson.steps.map((step, index) => {
    const existing = provided.find((item) => item.stepId === step.id);
    if (existing) return existing;
    return {
      id: `local-${step.id}`,
      participantId,
      gameVersionId,
      stepId: step.id,
      status: index === 0 ? "active" : "locked",
      hintsOpenedCount: 0,
      lastHintLevelOpened: 0,
      needsHelpFlag: false
    };
  });
}

function getHardestStep(stepProgress: ParticipantStepProgress[]) {
  return [...stepProgress]
    .sort((l, r) => {
      const ls = l.hintsOpenedCount + (l.needsHelpAt ? 3 : 0);
      const rs = r.hintsOpenedCount + (r.needsHelpAt ? 3 : 0);
      return rs - ls;
    })
    .find((item) => item.hintsOpenedCount > 0 || item.needsHelpAt);
}

export function MissionClient({
  version,
  initialProgress,
  initialStepProgress,
  participantId
}: {
  version: GameVersion;
  initialProgress: ParticipantProgress;
  initialStepProgress: ParticipantStepProgress[];
  participantId: string;
}) {
  const router = useRouter();
  const childSession = readChildSession();
  const attemptSavedRef = useRef(false);

  const [completedStepsCount, setCompletedStepsCount] = useState(initialProgress.completedStepsCount);
  const [xpTotal, setXpTotal] = useState(initialProgress.xpTotal);
  const [stepProgress, setStepProgress] = useState<ParticipantStepProgress[]>(
    ensureLocalStepProgress(version, initialStepProgress, participantId, version.id)
  );
  const [pending, setPending] = useState<"complete" | "hint" | "help" | "review" | null>(null);
  const [reviewRequestedAt, setReviewRequestedAt] = useState(initialProgress.reviewRequestedAt);
  const [reviewedAt, setReviewedAt] = useState(initialProgress.reviewedAt);
  const actionInFlight = useRef(false);
  const [hintPending, setHintPending] = useState(false); // waiting for trainer approval
  const [error, setError] = useState<string | null>(null);
  const [successStep, setSuccessStep] = useState<GameStep | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>("split");
  const [editorLoaded, setEditorLoaded] = useState(false);
  const [leftWidth, setLeftWidth] = useState(380);
  const [dragging, setDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [floatingXp, setFloatingXp] = useState<{ id: number; amount: number } | null>(null);
  const floatIdRef = useRef(0);

  const xpDisplay = useCountUp(xpTotal);

  const steps = version.snapshotJson.steps;

  // ── Per-game theming ──────────────────────────────────────────────────────
  const gameData = version.snapshotJson.game as typeof version.snapshotJson.game & {
    themeCode?: string;
    accentStyle?: string;
    accentColor?: string;
  };
  const themeCode   = gameData.themeCode   ?? "";
  const accentStyle = gameData.accentStyle ?? "";
  const accentColor = gameData.accentColor ?? "";
  const isValidHex  = /^#[0-9a-fA-F]{6}$/.test(accentColor);

  const accentVars: React.CSSProperties = isValidHex ? {
    "--accent":        accentColor,
    "--accent-hover":  adjustHex(accentColor, 30),
    "--accent-active": adjustHex(accentColor, -20),
    // Override --primary so all existing CSS classes (button, pill.active, etc.) inherit the game colour
    "--primary":        accentColor,
    "--primary-hover":  adjustHex(accentColor, 30),
    "--primary-active": adjustHex(accentColor, -20),
  } as React.CSSProperties : {};

  const themeBgGradient = THEME_BG[themeCode] ?? "";
  const leftPanelBg     = themeBgGradient ? `${themeBgGradient}, var(--bg-soft)` : "var(--bg-soft)";
  const patternStyle    = ACCENT_PATTERN[accentStyle] ?? null;
  // ─────────────────────────────────────────────────────────────────────────

  const currentStepIndex = Math.min(completedStepsCount, steps.length - 1);
  const currentStep = steps[currentStepIndex];
  const activeStepProgress = stepProgress.find((item) => item.stepId === currentStep?.id);
  const openedHintLevel = activeStepProgress?.lastHintLevelOpened ?? 0;
  const openedHints = currentStep?.hints.slice(0, openedHintLevel) ?? [];
  // Count <hint-block> elements in description (inline hints)
  const inlineHintCount = currentStep?.description
    ? (currentStep.description.match(/<hint-block/gi) ?? []).length
    : 0;
  // Total available hints = inline blocks OR legacy DB hints
  const totalAvailableHints = inlineHintCount > 0 ? inlineHintCount : (currentStep?.hints.length ?? 0);
  const progressPercent = initialProgress.totalStepsCount
    ? (completedStepsCount / initialProgress.totalStepsCount) * 100
    : 0;
  const isCompleted = completedStepsCount >= steps.length;
  const joinHref = childSession?.joinCode ? `/join/${childSession.joinCode}` : "/";
  const helpRequested = activeStepProgress?.needsHelpFlag ?? false;
  const totalHintsOpened = stepProgress.reduce((sum, item) => sum + item.hintsOpenedCount, 0);
  const helpRequestsCount = stepProgress.filter((item) => item.needsHelpAt).length;
  const hardestStep = getHardestStep(stepProgress);
  const hardestStepTitle = hardestStep
    ? steps.find((step) => step.id === hardestStep.stepId)?.title
    : undefined;

  const missionSummary = useMemo(() => {
    const helpPart = helpRequestsCount > 0 ? `запросов помощи: ${helpRequestsCount}` : "без запросов помощи";
    return `${version.snapshotJson.game.title}: ${steps.length} этапов, ${xpTotal} XP, ${totalHintsOpened} подсказок, ${helpPart}.`;
  }, [helpRequestsCount, totalHintsOpened, version, xpTotal, steps]);

  useEffect(() => {
    if (!isCompleted || attemptSavedRef.current) return;
    saveChildAttempt({
      participantId,
      joinCode: childSession?.joinCode ?? "",
      jamTitle: version.snapshotJson.game.title,
      completedAt: new Date().toISOString(),
      xpTotal,
      hintsOpenedCount: totalHintsOpened,
      helpRequestsCount
    });
    attemptSavedRef.current = true;
  }, [childSession?.joinCode, helpRequestsCount, isCompleted, participantId, totalHintsOpened, version, xpTotal]);

  useEffect(() => {
    if (!helpRequested && !reviewRequestedAt) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const sync = async () => {
      try {
        const fresh = await getParticipantProgress(participantId);
        if (!cancelled && !actionInFlight.current && fresh.progress?.gameVersionId === version.id) {
          setStepProgress(ensureLocalStepProgress(version, fresh.stepProgress ?? [], participantId, version.id));
          setReviewRequestedAt(fresh.progress.reviewRequestedAt);
          setReviewedAt(fresh.progress.reviewedAt);
        }
      } catch { /* Keep confirmed server state and retry on the next tick. */ }
      finally { if (!cancelled) timer = setTimeout(() => void sync(), 10000); }
    };
    timer = setTimeout(() => void sync(), 10000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [helpRequested, reviewRequestedAt, participantId, version]);

  async function handleRequestReview() {
    if (actionInFlight.current || reviewRequestedAt || reviewedAt) return;
    actionInFlight.current = true;
    setPending("review");
    setError(null);
    try {
      const progress = await requestParticipantReview(participantId);
      setReviewRequestedAt(progress.reviewRequestedAt);
      setReviewedAt(progress.reviewedAt);
    } catch {
      setError("Не удалось уведомить тренера. Попробуй ещё раз.");
    } finally {
      actionInFlight.current = false;
      setPending(null);
    }
  }

  async function handleCompleteStep() {
    if (!currentStep || actionInFlight.current) return;
    actionInFlight.current = true;
    setPending("complete");
    setError(null);
    try {
      const finishedStep = currentStep;
      const nextProgress = await completeParticipantStep(currentStep.id, participantId);
      setCompletedStepsCount(nextProgress.completedStepsCount);
      const xpGained = nextProgress.xpTotal - xpTotal;
      setXpTotal(nextProgress.xpTotal);
      setStepProgress((current) =>
        current.map((item) => {
          if (item.stepId === finishedStep.id) return { ...item, status: "completed", completedAt: new Date().toISOString(), needsHelpFlag: false };
          if (item.stepId === nextProgress.currentStepId && item.status === "locked") return { ...item, status: "active", startedAt: new Date().toISOString() };
          return item;
        })
      );
      // 🎉 Конфетти
      if (canvasRef.current) launchConfetti(canvasRef.current, isValidHex ? accentColor : undefined);
      // +XP floating badge
      if (xpGained > 0) {
        const id = ++floatIdRef.current;
        setFloatingXp({ id, amount: xpGained });
        setTimeout(() => setFloatingXp((cur) => cur?.id === id ? null : cur), 1500);
      }
      setSuccessStep(finishedStep);
    } catch {
      setError("Не удалось отметить этап выполненным.");
    } finally {
      actionInFlight.current = false;
      setPending(null);
    }
  }

  async function handleRequestHint() {
    if (!currentStep || hintPending) return;
    setPending("hint");
    setError(null);
    try {
      await requestParticipantHintOpen(currentStep.id, participantId);
      setHintPending(true);
      // Poll progress every 3 s until trainer approves (lastHintLevelOpened increases)
      const prevLevel = activeStepProgress?.lastHintLevelOpened ?? 0;
      let attempts = 0;
      const poll = window.setInterval(async () => {
        attempts += 1;
        if (attempts > 40) { // ~2 min timeout
          clearInterval(poll);
          setHintPending(false);
          setError("Тренер пока не одобрил подсказку. Попробуйте позже.");
          return;
        }
        try {
          const fresh = await getParticipantProgress(participantId);
          const freshStep = fresh.stepProgress?.find((s) => s.stepId === currentStep.id);
          if (freshStep && freshStep.lastHintLevelOpened > prevLevel) {
            clearInterval(poll);
            setHintPending(false);
            setStepProgress((cur) =>
              cur.map((item) =>
                item.stepId === currentStep.id
                  ? { ...item, hintsOpenedCount: freshStep.hintsOpenedCount, lastHintLevelOpened: freshStep.lastHintLevelOpened }
                  : item
              )
            );
          }
        } catch { /* ignore poll errors */ }
      }, 3000);
    } catch {
      setError("Не удалось запросить подсказку.");
    } finally {
      actionInFlight.current = false;
      setPending(null);
    }
  }

  async function handleNeedHelp() {
    if (!currentStep || actionInFlight.current || helpRequested) return;
    actionInFlight.current = true;
    setPending("help");
    setError(null);
    try {
      await requestParticipantHelp(currentStep.id, participantId);
      setStepProgress((current) =>
        current.map((item) =>
          item.stepId === currentStep.id
            ? { ...item, needsHelpFlag: true, needsHelpAt: item.needsHelpAt ?? new Date().toISOString() }
            : item
        )
      );
    } catch {
      setError("Не удалось отправить запрос помощи.");
    } finally {
      actionInFlight.current = false;
      setPending(null);
    }
  }

  // ── Layout calculations ──
  const showInfo = panelMode === "split" || panelMode === "info-only";
  const showEditor = panelMode === "split" || panelMode === "editor-full";
  const editorFull = panelMode === "editor-full";

  function startDrag(e: React.MouseEvent) {
    if (panelMode !== "split") return;
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartWidth.current = leftWidth;
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onMove(ev: MouseEvent) {
      const delta = ev.clientX - dragStartX.current;
      const next = Math.max(240, Math.min(window.innerWidth - 300, dragStartWidth.current + delta));
      setLeftWidth(next);
    }
    function onUp() {
      setDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  const colLeft  = editorFull ? "0px" : panelMode === "info-only" ? "100%" : `${leftWidth}px`;
  const gridStyle: React.CSSProperties = {
    ...accentVars,
    position: "fixed",
    inset: 0,
    zIndex: 10,
    display: "grid",
    gridTemplateColumns: `${colLeft} 5px 1fr`,
    overflow: "hidden",
    transition: panelMode !== "split" ? "grid-template-columns 250ms ease" : "none"
  };

  return (
    <>
      <div className="mission-workspace" style={gridStyle}>
        {/* ── LEFT: Mission info ── */}
        <div style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderRight: "1px solid var(--panel-border)",
          background: leftPanelBg,
          opacity: editorFull ? 0 : 1,
          transition: "opacity 250ms ease",
          pointerEvents: editorFull ? "none" : "auto"
        }}>
          {/* Accent style pattern overlay */}
          {patternStyle ? (
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0, ...patternStyle }} />
          ) : null}
          {/* Left header */}
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--panel-border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, gap: 8 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "var(--muted)", textTransform: "uppercase" }}>Миссия</div>
              <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {version.snapshotJson.game.title}
              </div>
            </div>
            <div className="button-row" style={{ gap: 6, flexShrink: 0 }}>
              <span className="pill" style={{ fontSize: 11 }}>Этап {Math.min(completedStepsCount + 1, steps.length)}/{steps.length}</span>
              <span className="pill active" style={{ fontSize: 11 }}>{xpDisplay} XP</span>
              {panelMode === "info-only" ? (
                <button
                  className="button"
                  style={{ fontSize: 11, padding: "3px 8px" }}
                  onClick={() => setPanelMode("split")}
                  title="Открыть GDevelop"
                >
                  GDevelop ▶
                </button>
              ) : null}
            </div>
          </div>

          {/* Progress bar with shimmer */}
          <div style={{ height: 3, background: "var(--bg-tertiary)", flexShrink: 0 }}>
            <div className="progress-shimmer" style={{ height: "100%", width: `${Math.min(progressPercent, 100)}%`, transition: "width 600ms ease", borderRadius: 999 }} />
          </div>

          {/* Scrollable content */}
          <div className="mission-instructions" style={{ overflowY: "auto", flex: 1, minWidth: 0, padding: 16 }}>
            {isCompleted ? (
              /* ── FINAL SCREEN ── */
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div className="card accent-card" style={{ padding: 20, textAlign: "center" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🏆</div>
                  <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 700 }}>{version.snapshotJson.finalScreen.title}</h2>
                  <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 13 }}>{version.snapshotJson.finalScreen.description}</p>
                  <div className="button-row" style={{ justifyContent: "center" }}>
                    <span className="pill active" style={{ fontSize: 14, padding: "6px 16px" }}>+{version.snapshotJson.finalScreen.rewardXp} XP</span>
                  </div>
                </div>
                <div className="grid grid-2" style={{ gap: 8 }}>
                  {[
                    ["Этапов", steps.length],
                    ["XP", xpTotal],
                    ...(STEP_HINTS_ENABLED ? [["Подсказок", totalHintsOpened]] : []),
                    ["Запросов помощи", helpRequestsCount]
                  ].map(([label, value]) => (
                    <div key={label as string} className="card" style={{ padding: 12, textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>{label}</div>
                    </div>
                  ))}
                </div>
                {hardestStepTitle ? (
                  <div className="card" style={{ padding: 12 }}>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>СЛОЖНЕЕ ВСЕГО</div>
                    <strong style={{ fontSize: 13 }}>{hardestStepTitle}</strong>
                  </div>
                ) : null}
                <ChildAttemptHistoryPanel title="История миссий" />
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <button className="button" onClick={() => void handleRequestReview()}
                    disabled={pending !== null || Boolean(reviewRequestedAt) || Boolean(reviewedAt)}>
                    {reviewedAt ? "Тренер проверил результат" : reviewRequestedAt ? "Запрос отправлен тренеру" : pending === "review" ? "Отправляю…" : "Показать тренеру"}
                  </button>
                  {reviewRequestedAt && !reviewedAt ? <p role="status">Тренер получил запрос на проверку. Результат остаётся здесь.</p> : null}
                  {error ? <p role="alert" style={{ color: "var(--danger)" }}>{error}</p> : null}
                  <Link className="button-secondary" href={`/participant/${participantId}/jams` as Route} style={{ textAlign: "center" }}>
                    Попробовать ещё
                  </Link>
                  <button className="button-ghost" style={{ fontSize: 13 }} onClick={() => { clearChildSession(); router.push(joinHref as Route); }}>
                    Завершить сессию
                  </button>
                </div>
              </div>
            ) : (
              /* ── ACTIVE STEP ── */
              <div key={currentStepIndex} className="slide-in" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Step counter mini-map */}
                <div style={{ display: "flex", gap: 4 }}>
                  {steps.map((step, i) => {
                    const done = i < completedStepsCount;
                    const active = i === currentStepIndex;
                    return (
                      <div key={step.id} title={step.title} className={active ? "step-active-pulse" : ""} style={{
                        flex: 1, height: 4, borderRadius: 999,
                        background: done ? "var(--success)" : active ? "var(--primary)" : "var(--bg-tertiary)",
                        transition: "background 400ms"
                      }} />
                    );
                  })}
                </div>

                {/* Step title */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "var(--muted)", textTransform: "uppercase", marginBottom: 6 }}>
                    Этап {currentStepIndex + 1} из {steps.length}
                  </div>
                  <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, lineHeight: 1.3 }}>{currentStep.title}</h2>
                </div>

                {/* Description — renders inline hint-block spoilers if present */}
                <DescriptionWithHints
                  html={currentStep.description ?? ""}
                  openedCount={openedHintLevel}
                  hintPending={hintPending}
                  onRequest={() => void handleRequestHint()}
                />

                {/* Task media */}
                {(currentStep.taskImageUrl || currentStep.taskVideoUrl) ? (
                  <div>
                    {currentStep.taskImageUrl ? renderMedia(currentStep.taskImageUrl, "image", "task") : null}
                    {currentStep.taskVideoUrl ? renderMedia(currentStep.taskVideoUrl, "video", "task") : null}
                  </div>
                ) : null}

                {/* Goal */}
                <div style={{ background: "color-mix(in srgb, var(--accent) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 22%, transparent)", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--primary-hover)", marginBottom: 4, letterSpacing: "0.05em" }}>ЦЕЛЬ ЭТАПА</div>
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{currentStep.goalText}</p>
                </div>

                {/* Result media */}
                {(currentStep.resultImageUrl || currentStep.resultVideoUrl) ? (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 6, letterSpacing: "0.05em" }}>ПРИМЕР РЕЗУЛЬТАТА</div>
                    {currentStep.resultImageUrl ? renderMedia(currentStep.resultImageUrl, "image", "result") : null}
                    {currentStep.resultVideoUrl ? renderMedia(currentStep.resultVideoUrl, "video", "result") : null}
                  </div>
                ) : null}

                {/* Actions */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <button className="button" disabled={pending !== null} onClick={handleCompleteStep} style={{ width: "100%", justifyContent: "center" }}>
                    {pending === "complete" ? "Сохраняю..." : "✓ Я сделал!"}
                  </button>
                  {/* Legacy DB hints — show button only when step has no inline hint-blocks */}
                  {STEP_HINTS_ENABLED && inlineHintCount === 0 && totalAvailableHints > 0 ? (
                    <div className="button-row">
                      <button
                        className="button-secondary"
                        style={{ flex: 1, justifyContent: "center", fontSize: 13 }}
                        disabled={pending !== null || hintPending || openedHintLevel >= totalAvailableHints}
                        onClick={() => void handleRequestHint()}
                      >
                        {hintPending
                          ? "⏳ Ожидаем тренера..."
                          : pending === "hint"
                            ? "..."
                            : openedHintLevel >= totalAvailableHints
                              ? "Все подсказки открыты"
                              : `Подсказка ${openedHintLevel + 1} из ${totalAvailableHints}`}
                      </button>
                      <button className="button-secondary" style={{ flex: 1, justifyContent: "center", fontSize: 13 }} disabled={pending !== null || helpRequested} onClick={handleNeedHelp}>
                        {pending === "help" ? "Отправляю…" : helpRequested ? "Запрос помощи отправлен" : "Нужна помощь"}
                      </button>
                    </div>
                  ) : (
                    <div className="button-row">
                      <button className="button-secondary" style={{ flex: 1, justifyContent: "center", fontSize: 13 }} disabled={pending !== null || helpRequested} onClick={handleNeedHelp}>
                        {pending === "help" ? "Отправляю…" : helpRequested ? "Запрос помощи отправлен" : "Нужна помощь"}
                      </button>
                    </div>
                  )}
                </div>

                {error ? <p style={{ color: "var(--danger)", margin: 0, fontSize: 13 }}>{error}</p> : null}

                {/* Legacy DB hints — shown at bottom only when no inline hint-blocks */}
                {STEP_HINTS_ENABLED && inlineHintCount === 0 && openedHints.length > 0 ? (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 8, letterSpacing: "0.05em" }}>
                      ПОДСКАЗКИ ({openedHints.length} из {totalAvailableHints})
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {openedHints.map((hint) => <HintCard key={hint.id} hint={hint} />)}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {/* ── DIVIDER ── */}
        <div
          onMouseDown={startDrag}
          style={{
            cursor: panelMode === "split" ? "col-resize" : "default",
            background: "var(--panel-border)",
            flexShrink: 0,
            position: "relative",
            transition: "background 150ms",
            zIndex: 1
          }}
          onMouseEnter={(e) => { if (panelMode === "split") (e.currentTarget as HTMLDivElement).style.background = "var(--accent)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--panel-border)"; }}
          title="Потяни чтобы изменить размер"
        >
          {/* Drag handle dots */}
          {panelMode === "split" ? (
            <div style={{
              position: "absolute", top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              display: "flex", flexDirection: "column", gap: 3
            }}>
              {[0,1,2].map(i => (
                <div key={i} style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--muted)" }} />
              ))}
            </div>
          ) : null}
        </div>

        {/* ── RIGHT: GDevelop editor ── */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", background: "#1a1a2e" }}>
          {/* Editor toolbar */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "8px 12px", background: "var(--bg-soft)", borderBottom: "1px solid var(--panel-border)",
            flexShrink: 0, gap: 8
          }}>
            {/* Left: title + status */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>GDevelop</span>
              {!editorLoaded ? (
                <span className="pill" style={{ fontSize: 11, color: "var(--muted)" }}>загрузка…</span>
              ) : (
                <span className="pill status-published" style={{ fontSize: 11 }}>готов</span>
              )}
              {editorFull && !isCompleted ? (
                <span className="pill" style={{ fontSize: 11, background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent-hover)" }}>
                  Этап {currentStepIndex + 1}/{steps.length}: {currentStep?.title}
                </span>
              ) : null}
            </div>
            {/* Right: controls */}
            <div className="button-row" style={{ gap: 6, flexShrink: 0 }}>
              {editorFull ? (
                <>
                  <button
                    className="button-secondary"
                    style={{ fontSize: 12, padding: "4px 10px" }}
                    onClick={() => setPanelMode("split")}
                    title="Показать задание"
                  >
                    ← Задание
                  </button>
                  <button
                    className="button-ghost"
                    style={{ fontSize: 12, padding: "4px 10px" }}
                    onClick={() => setPanelMode("info-only")}
                    title="Только задание"
                  >
                    Только задание
                  </button>
                </>
              ) : null}
              {panelMode === "split" ? (
                <>
                  <button
                    className="button-ghost"
                    style={{ fontSize: 12, padding: "4px 10px" }}
                    onClick={() => setPanelMode("info-only")}
                    title="Скрыть редактор"
                  >
                    Скрыть ✕
                  </button>
                  <button
                    className="button"
                    style={{ fontSize: 12, padding: "4px 10px" }}
                    onClick={() => setPanelMode("editor-full")}
                    title="Развернуть на весь экран"
                  >
                    На весь экран ⤢
                  </button>
                </>
              ) : null}
              {panelMode === "info-only" ? (
                <button
                  className="button-secondary"
                  style={{ fontSize: 12, padding: "4px 10px" }}
                  onClick={() => setPanelMode("split")}
                >
                  Показать редактор ▶
                </button>
              ) : null}
            </div>
          </div>

          {/* iframe wrapper — position:relative для оверлея */}
          <div style={{ flex: 1, position: "relative", display: showEditor ? "flex" : "none", flexDirection: "column" }}>
            {/* iframe — всегда в DOM, никогда не размонтируется */}
            <iframe
              src={GDEVELOP_URL}
              style={{ flex: 1, border: "none", width: "100%", height: "100%" }}
              allow="clipboard-read; clipboard-write"
              title="GDevelop Editor"
              onLoad={() => setEditorLoaded(true)}
            />
            {/* Прозрачный оверлей во время drag'а — блокирует iframe от перехвата событий мыши */}
            {dragging ? (
              <div style={{ position: "absolute", inset: 0, zIndex: 100, cursor: "col-resize" }} />
            ) : null}
          </div>

          {/* Placeholder when editor hidden */}
          {!showEditor ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
              <span style={{ fontSize: 32 }}>🎮</span>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>Редактор скрыт</p>
              <button className="button-secondary" onClick={() => setPanelMode("split")}>Показать GDevelop</button>
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Success overlay ── */}
      {successStep ? (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="card accent-card stack overlay-card card-bounce">
            <div className="eyebrow">Этап выполнен</div>
            <h2 className="section-title" style={{ fontSize: 28 }}>{successStep.successTitle}</h2>
            <p className="subtle">{successStep.successText}</p>
            {(successStep.resultImageUrl || successStep.resultVideoUrl) ? (
              <div>
                {successStep.resultImageUrl ? renderMedia(successStep.resultImageUrl, "image", "success") : null}
                {successStep.resultVideoUrl ? renderMedia(successStep.resultVideoUrl, "video", "success") : null}
              </div>
            ) : null}
            <div className="button-row">
              <span className="pill active">+{successStep.successXp} XP</span>
              <span className="pill">{completedStepsCount >= steps.length ? "Миссия завершена!" : "Следующий этап открыт"}</span>
            </div>
            <button className="button" onClick={() => setSuccessStep(null)} style={{ width: "100%", justifyContent: "center" }}>
              {completedStepsCount >= steps.length ? "Смотреть итог" : "Продолжить →"}
            </button>
          </div>
        </div>
      ) : null}

      {/* ── Confetti canvas (pointer-events:none чтобы не мешать кликам) ── */}
      <canvas
        ref={canvasRef}
        style={{ position: "fixed", inset: 0, zIndex: 9999, pointerEvents: "none" }}
      />

      {/* ── Floating +XP badge ── */}
      {floatingXp ? (
        <div
          key={floatingXp.id}
          className="xp-float"
          style={{
            position: "fixed",
            bottom: 120,
            left: `${leftWidth / 2}px`,
            transform: "translateX(-50%)",
            zIndex: 9998,
            pointerEvents: "none",
            background: "linear-gradient(135deg, var(--accent), var(--accent-hover))",
            color: "#fff",
            fontWeight: 800,
            fontSize: 22,
            borderRadius: 999,
            padding: "8px 22px",
            boxShadow: "0 4px 24px color-mix(in srgb, var(--accent) 50%, transparent)",
            whiteSpace: "nowrap",
            letterSpacing: "0.02em"
          }}
        >
          +{floatingXp.amount} XP
        </div>
      ) : null}
    </>
  );
}
