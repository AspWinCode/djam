"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { STEP_HINTS_ENABLED } from "../lib/features";
import { io } from "socket.io-client";
import type {
  HintApprovedRealtimePayload,
  HintRequestPendingRealtimePayload,
  ParticipantHelpRealtimePayload,
  ParticipantProgress,
  ParticipantProgressRealtimePayload,
  RealtimeEvent,
  SessionSnapshotRealtimePayload,
  JamDetail,
  TrainerParticipantDetail,
  TrainerParticipantView
} from "@game-game/shared";
import {
  approveParticipantHint,
  createTrainerParticipantNote,
  deleteTrainerParticipantNote,
  getTrainerParticipantDetail,
  getTrainerJam,
  markTrainerParticipantReviewed,
  resolveParticipantHelp
} from "../lib/api";

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000";

const statusLabel: Record<string, string> = {
  active: "В работе", needs_help: "Нужна помощь", completed: "Завершил", stuck: "Нет активности", offline: "Не в сети"
};
const statusTone: Record<string, string> = {
  active: "#06b6d4",
  needs_help: "#ec4899",
  completed: "#22c55e",
  stuck: "#f59e0b",
  offline: "#94a3b8"
};

const timelineTone: Record<string, string> = {
  joined: "#94a3b8",
  selected_jam: "#8b5cf6",
  step_started: "#06b6d4",
  hint_opened: "#f59e0b",
  requested_help: "#ec4899",
  help_resolved: "#22c55e",
  step_completed: "#84cc16",
  completed_jam: "#22c55e"
};

type StatusFilter = "all" | TrainerParticipantView["participant"]["status"];
type SortMode = "help_first" | "activity_desc" | "progress_desc" | "name_asc";

export function TrainerLiveClient({ initialDetail }: { initialDetail: JamDetail }) {
  const searchParams = useSearchParams();
  const participantFromLink = searchParams.get("participant");
  const [actionError, setActionError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<TrainerParticipantView[]>(initialDetail.participants);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("help_first");
  const [actionableOnly, setActionableOnly] = useState(false);
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(
    participantFromLink ?? initialDetail.participants[0]?.participant.id ?? null
  );
  const selectedProgressId = selectedParticipantId === participantFromLink ? searchParams.get("progress") ?? undefined : undefined;
  const [detail, setDetail] = useState<TrainerParticipantDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [notePending, setNotePending] = useState<"create" | string | null>(null);
  const [copied, setCopied] = useState(false);
  const [helpCopied, setHelpCopied] = useState(false);
  const [actionableCopied, setActionableCopied] = useState(false);
  const [completedCopied, setCompletedCopied] = useState(false);
  const [socketStatus, setSocketStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [lastRealtimeAt, setLastRealtimeAt] = useState<string | null>(null);
  const [socketRoomSize, setSocketRoomSize] = useState<number>(1);
  const [pendingHintRequests, setPendingHintRequests] = useState<
    Record<string, { stepId: string; stepTitle: string; participantName: string }>
  >({});
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const socketStatusRef = useRef(socketStatus);

  useEffect(() => {
    if (participantFromLink) setSelectedParticipantId(participantFromLink);
  }, [participantFromLink]);

  useEffect(() => {
    socketStatusRef.current = socketStatus;
  }, [socketStatus]);

  useEffect(() => {
    const syncSession = async () => {
      try {
        const detail = await getTrainerJam(initialDetail.jam.id);
        setParticipants(detail.participants);
      } catch {
        return;
      }
    };

    const notify = () => {
      window.dispatchEvent(new Event("trainer-notifications-changed"));
      void syncSession();
    };
    const socket = io(SOCKET_URL, {
      transports: ["websocket"],
      reconnection: true
    });

    socket.on("connect", async () => {
      setSocketStatus("connected");
      setLastRealtimeAt(new Date().toISOString());
      socket.emit("session:join", { sessionId: initialDetail.jam.id }, (ack?: { roomSize?: number; serverTime?: string }) => {
        if (ack?.roomSize !== undefined) {
          setSocketRoomSize(ack.roomSize);
        }
        if (ack?.serverTime) {
          setLastRealtimeAt(ack.serverTime);
        }
      });
      await syncSession();
    });

    for (const event of ["participant_requested_help", "participant_requested_review", "trainer_resolved_help", "participant_completed_jam", "participant_status_changed", "participant_progress_updated"]) {
      socket.on(event, notify);
    }

    socket.on("connect_error", () => setSocketStatus("disconnected"));
    socket.on("disconnect", () => {
      setSocketStatus("disconnected");
    });

    socket.on("participant_joined", (event: RealtimeEvent<TrainerParticipantView["participant"]>) => {
      setLastRealtimeAt(event.emittedAt);
      setParticipants((current) => {
        if (current.some((item) => item.participant.id === event.payload.id)) {
          return current;
        }

        return [
          {
            participant: event.payload,
            progressPercent: 0,
            hintsOpenedCount: 0,
            lastActivityAt: event.payload.lastSeenAt
          },
          ...current
        ];
      });
    });

    socket.on("participant_progress_updated", (event: RealtimeEvent<ParticipantProgressRealtimePayload>) => {
      setLastRealtimeAt(event.emittedAt);
      setParticipants((current) =>
        current.map((item) =>
          item.participant.id === event.payload.participantId
            ? {
                ...item,
                participant: { ...item.participant, status: event.payload.progress.isCompleted ? "completed" : "active" },
                progressPercent: Math.round(
                  (event.payload.progress.completedStepsCount / event.payload.progress.totalStepsCount) * 100
                ),
                lastActivityAt: new Date().toISOString()
              }
            : item
        )
      );
    });

    socket.on("participant_completed_jam", (event: RealtimeEvent<ParticipantProgressRealtimePayload>) => {
      setLastRealtimeAt(event.emittedAt);
      setParticipants((current) =>
        current.map((item) =>
          item.participant.id === event.payload.participantId
            ? {
                ...item,
                participant: { ...item.participant, status: "completed" },
                progressPercent: 100,
                lastActivityAt: new Date().toISOString()
              }
            : item
        )
      );
    });

    socket.on("participant_requested_help", (event: RealtimeEvent<ParticipantHelpRealtimePayload>) => {
      setLastRealtimeAt(event.emittedAt);
      setParticipants((current) =>
        current.map((item) =>
          item.participant.id === event.payload.participantId
            ? {
                ...item,
                participant: { ...item.participant, status: "needs_help" },
                lastActivityAt: new Date().toISOString()
              }
            : item
        )
      );
    });

    socket.on("trainer_resolved_help", (event: RealtimeEvent<ParticipantHelpRealtimePayload>) => {
      setLastRealtimeAt(event.emittedAt);
      setParticipants((current) =>
        current.map((item) =>
          item.participant.id === event.payload.participantId
            ? {
                ...item,
                participant: { ...item.participant, status: "active" },
                lastActivityAt: new Date().toISOString()
              }
            : item
        )
      );
    });

    socket.on("hint_request_pending", (event: RealtimeEvent<HintRequestPendingRealtimePayload>) => {
      setLastRealtimeAt(event.emittedAt);
      const { participantId, stepId, stepTitle, participantName } = event.payload;
      setPendingHintRequests((current) => ({
        ...current,
        [participantId]: { stepId, stepTitle, participantName }
      }));
    });

    socket.on("hint_approved", (event: RealtimeEvent<HintApprovedRealtimePayload>) => {
      setLastRealtimeAt(event.emittedAt);
      const { participantId } = event.payload;
      setPendingHintRequests((current) => {
        const next = { ...current };
        delete next[participantId];
        return next;
      });
      setParticipants((current) =>
        current.map((item) =>
          item.participant.id === participantId
            ? { ...item, hintsOpenedCount: item.hintsOpenedCount + 1, lastActivityAt: new Date().toISOString() }
            : item
        )
      );
    });

    socket.on("participant_status_changed", (event: RealtimeEvent<{ participantId: string; progress?: ParticipantProgress }>) => {
      setLastRealtimeAt(event.emittedAt);
      setParticipants((current) =>
        current.map((item) =>
          item.participant.id === event.payload.participantId
            ? {
                ...item,
                reviewedAt: event.payload.progress?.reviewedAt ?? item.reviewedAt
              }
            : item
        )
      );
    });

    socket.on("session_snapshot", (event: RealtimeEvent<SessionSnapshotRealtimePayload>) => {
      setLastRealtimeAt(event.emittedAt);
      setSocketRoomSize(event.payload.participantsCount);
    });

    const heartbeatInterval = window.setInterval(() => {
      if (socket.connected) {
        socket.emit("session:heartbeat", { sessionId: initialDetail.jam.id }, (ack?: { roomSize?: number; serverTime?: string }) => {
          if (ack?.roomSize !== undefined) {
            setSocketRoomSize(ack.roomSize);
          }
          if (ack?.serverTime) {
            setLastRealtimeAt(ack.serverTime);
          }
        });
      }
    }, 15000);

    const fallbackInterval = window.setInterval(() => {
      void syncSession();
    }, 30000);

    return () => {
      socket.emit("session:leave", { sessionId: initialDetail.jam.id });
      window.clearInterval(heartbeatInterval);
      window.clearInterval(fallbackInterval);
      socket.disconnect();
    };
  }, [initialDetail.jam.id]);

  useEffect(() => {
    setNoteBody("");
    setDetail(null);
  }, [selectedParticipantId, selectedProgressId]);

  useEffect(() => {
    if (!selectedParticipantId) {
      setDetail(null);
      setNoteBody("");
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    getTrainerParticipantDetail(selectedParticipantId, selectedProgressId)
      .then((payload) => { if (!cancelled) setDetail(payload); })
      .catch(() => { if (!cancelled) setDetail(null); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedParticipantId, selectedProgressId, participants]);

  useEffect(() => {
    if (!selectedParticipantId) {
      return;
    }

    const row = rowRefs.current[selectedParticipantId];
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedParticipantId]);

  const metrics = useMemo(() => {
    const average =
      participants.length > 0
        ? Math.round(participants.reduce((sum, item) => sum + item.progressPercent, 0) / participants.length)
        : 0;

    return {
      count: participants.length,
      help: participants.filter((item) => item.participant.status === "needs_help").length,
      average
    };
  }, [participants]);

  const helpQueue = useMemo(
    () =>
      participants
        .filter((item) => item.participant.status === "needs_help")
        .sort((a, b) => +new Date(b.lastActivityAt) - +new Date(a.lastActivityAt)),
    [participants]
  );

  const completedSpotlight = useMemo(
    () =>
      participants
        .filter((item) => item.participant.status === "completed" && !item.reviewedAt)
        .sort((a, b) => +new Date(b.lastActivityAt) - +new Date(a.lastActivityAt)),
    [participants]
  );

  const stuckWatch = useMemo(
    () =>
      participants
        .filter((item) => item.participant.status === "stuck")
        .sort((a, b) => +new Date(b.lastActivityAt) - +new Date(a.lastActivityAt)),
    [participants]
  );

  const summary = useMemo(
    () => ({
      active: participants.filter((item) => item.participant.status === "active").length,
      stuck: participants.filter((item) => item.participant.status === "stuck").length,
      offline: participants.filter((item) => item.participant.status === "offline").length,
      completed: participants.filter((item) => item.participant.status === "completed").length,
      needsHelp: participants.filter((item) => item.participant.status === "needs_help").length,
      reviewed: participants.filter((item) => item.participant.status === "completed" && item.reviewedAt).length,
      awaitingReview: participants.filter((item) => item.participant.status === "completed" && !item.reviewedAt).length,
      actionable: participants.filter(
        (item) =>
          item.participant.status === "needs_help" ||
          item.participant.status === "stuck" ||
          (item.participant.status === "completed" && !item.reviewedAt)
      ).length
    }),
    [participants]
  );

  const exportText = useMemo(
    () => {
      const header = [
        `session:${initialDetail.jam.title}`,
        `participants:${participants.length}`,
        `active:${summary.active}`,
        `completed:${summary.completed}`,
        `reviewed:${summary.reviewed}`,
        `awaiting_review:${summary.awaitingReview}`,
        `needs_help:${summary.needsHelp}`,
        `stuck:${summary.stuck}`,
        `offline:${summary.offline}`
      ].join(" | ");

      const rows = participants.map((item) =>
        [
          item.participant.displayName,
          item.participant.status,
          item.gameTitle ?? "no-jam",
          item.currentStepTitle ?? "no-step",
          `${item.progressPercent}%`,
          `hints:${item.hintsOpenedCount}`,
          `reviewed:${item.reviewedAt ? "yes" : "no"}`,
          `last:${new Date(item.lastActivityAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
        ].join(" | ")
      );

      return [header, ...rows].join("\n");
    },
    [initialDetail.jam.title, participants, summary]
  );

  const helpQueueExportText = useMemo(() => {
    const header = [
      `session:${initialDetail.jam.title}`,
      `help_queue:${helpQueue.length}`
    ].join(" | ");

    const rows = helpQueue.map((item) =>
      [
        item.participant.displayName,
        item.participant.status,
        item.gameTitle ?? "no-jam",
        item.currentStepTitle ?? "no-step",
        `progress:${item.progressPercent}%`,
        `hints:${item.hintsOpenedCount}`,
        `last:${new Date(item.lastActivityAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
      ].join(" | ")
    );

    return [header, ...rows].join("\n");
  }, [helpQueue, initialDetail.jam.title]);

  const actionableQueueExportText = useMemo(() => {
    const actionableItems = participants
      .filter(
        (item) =>
          item.participant.status === "needs_help" ||
          item.participant.status === "stuck" ||
          (item.participant.status === "completed" && !item.reviewedAt)
      )
      .sort((a, b) => +new Date(b.lastActivityAt) - +new Date(a.lastActivityAt));

    const header = [
      `session:${initialDetail.jam.title}`,
      `actionable_queue:${actionableItems.length}`
    ].join(" | ");

    const rows = actionableItems.map((item) =>
      [
        item.participant.displayName,
        item.participant.status,
        item.gameTitle ?? "no-jam",
        item.currentStepTitle ?? "no-step",
        `progress:${item.progressPercent}%`,
        `hints:${item.hintsOpenedCount}`,
        `reviewed:${item.reviewedAt ? "yes" : "no"}`,
        `last:${new Date(item.lastActivityAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
      ].join(" | ")
    );

    return [header, ...rows].join("\n");
  }, [initialDetail.jam.title, participants]);

  const completedAwaitingReviewExportText = useMemo(() => {
    const completedItems = participants
      .filter((item) => item.participant.status === "completed" && !item.reviewedAt)
      .sort((a, b) => +new Date(b.lastActivityAt) - +new Date(a.lastActivityAt));

    const header = [
      `session:${initialDetail.jam.title}`,
      `completed_awaiting_review:${completedItems.length}`
    ].join(" | ");

    const rows = completedItems.map((item) =>
      [
        item.participant.displayName,
        item.participant.status,
        item.gameTitle ?? "no-jam",
        item.currentStepTitle ?? "no-step",
        `progress:${item.progressPercent}%`,
        `hints:${item.hintsOpenedCount}`,
        `last:${new Date(item.lastActivityAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
      ].join(" | ")
    );

    return [header, ...rows].join("\n");
  }, [initialDetail.jam.title, participants]);

  const visibleParticipants = useMemo(() => {
    const filtered =
      statusFilter === "all"
        ? participants
        : participants.filter((item) => item.participant.status === statusFilter);

    const actionableFiltered = actionableOnly
      ? filtered.filter(
          (item) =>
            item.participant.status === "needs_help" ||
            item.participant.status === "stuck" ||
            (item.participant.status === "completed" && !item.reviewedAt)
        )
      : filtered;

    const sorted = [...actionableFiltered];
    sorted.sort((a, b) => {
      if (sortMode === "help_first") {
        const helpWeight = Number(b.participant.status === "needs_help") - Number(a.participant.status === "needs_help");
        if (helpWeight !== 0) {
          return helpWeight;
        }

        return +new Date(b.lastActivityAt) - +new Date(a.lastActivityAt);
      }

      if (sortMode === "activity_desc") {
        return +new Date(b.lastActivityAt) - +new Date(a.lastActivityAt);
      }

      if (sortMode === "progress_desc") {
        return b.progressPercent - a.progressPercent;
      }

      return a.participant.displayName.localeCompare(b.participant.displayName, "ru");
    });

    return sorted;
  }, [actionableOnly, participants, sortMode, statusFilter]);

  const latestTimelineEvent = detail?.timeline[0];
  const latestHelpEvent = detail?.timeline.find(
    (event) => event.type === "requested_help" || event.type === "help_resolved"
  );

  async function handleResolve(participantId: string) {
    setResolvingId(participantId);
    try {
      await resolveParticipantHelp(participantId);
      setParticipants((current) =>
        current.map((currentItem) =>
          currentItem.participant.id === participantId
            ? {
                ...currentItem,
                participant: { ...currentItem.participant, status: "active" },
                lastActivityAt: new Date().toISOString()
              }
            : currentItem
        )
      );

      if (detail?.participant.id === participantId) {
        const refreshed = await getTrainerParticipantDetail(participantId, participantId === selectedParticipantId ? selectedProgressId : undefined);
        setDetail(refreshed);
      }
      window.dispatchEvent(new Event("trainer-notifications-changed"));
      setActionError(null);
    } catch {
      setActionError("Не удалось сохранить действие. Попробуйте ещё раз.");
    } finally {
      setResolvingId(null);
    }
  }

  async function handleApproveHint(participantId: string) {
    const req = pendingHintRequests[participantId];
    if (!req) return;
    try {
      await approveParticipantHint(participantId, req.stepId);
      // UI update handled by hint_approved socket event
    } catch {
      // leave pending visible so trainer can retry
    }
  }

  async function handleCopySummary() {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  async function handleCopyHelpQueue() {
    try {
      await navigator.clipboard.writeText(helpQueueExportText);
      setHelpCopied(true);
      window.setTimeout(() => setHelpCopied(false), 1600);
    } catch {
      setHelpCopied(false);
    }
  }

  async function handleCopyActionableQueue() {
    try {
      await navigator.clipboard.writeText(actionableQueueExportText);
      setActionableCopied(true);
      window.setTimeout(() => setActionableCopied(false), 1600);
    } catch {
      setActionableCopied(false);
    }
  }

  async function handleCopyCompletedAwaitingReview() {
    try {
      await navigator.clipboard.writeText(completedAwaitingReviewExportText);
      setCompletedCopied(true);
      window.setTimeout(() => setCompletedCopied(false), 1600);
    } catch {
      setCompletedCopied(false);
    }
  }

  async function handleMarkReviewed(participantId: string) {
    setReviewingId(participantId);
    try {
      await markTrainerParticipantReviewed(participantId, participantId === selectedParticipantId ? selectedProgressId : undefined);
      const refreshedJam = await getTrainerJam(initialDetail.jam.id);
      setParticipants(refreshedJam.participants);

      if (detail?.participant.id === participantId) {
        const refreshed = await getTrainerParticipantDetail(participantId, participantId === selectedParticipantId ? selectedProgressId : undefined);
        setDetail(refreshed);
      }
      window.dispatchEvent(new Event("trainer-notifications-changed"));
      setActionError(null);
    } catch {
      setActionError("Не удалось сохранить действие. Попробуйте ещё раз.");
    } finally {
      setReviewingId(null);
    }
  }

  async function handleCreateNote() {
    if (!detail || !noteBody.trim()) {
      return;
    }

    setNotePending("create");
    try {
      await createTrainerParticipantNote(detail.participant.id, { body: noteBody.trim() });
      const refreshed = await getTrainerParticipantDetail(detail.participant.id, selectedProgressId);
      setDetail(refreshed);
      setNoteBody("");
    } finally {
      setNotePending(null);
    }
  }

  async function handleDeleteNote(noteId: string) {
    if (!detail) {
      return;
    }

    setNotePending(noteId);
    try {
      await deleteTrainerParticipantNote(noteId);
      const refreshed = await getTrainerParticipantDetail(detail.participant.id, selectedProgressId);
      setDetail(refreshed);
    } finally {
      setNotePending(null);
    }
  }

  async function handleQuickHelpNote(participantId: string, body: string) {
    setNotePending(`quick-${participantId}`);
    try {
      await createTrainerParticipantNote(participantId, { body });
      if (detail?.participant.id === participantId) {
        const refreshed = await getTrainerParticipantDetail(participantId, participantId === selectedParticipantId ? selectedProgressId : undefined);
        setDetail(refreshed);
      }
      setSelectedParticipantId(participantId);
      setNoteBody("");
    } finally {
      setNotePending(null);
    }
  }

  function handlePrepareQuickNote(participantId: string, template: string) {
    setSelectedParticipantId(participantId);
    setNoteBody(template);
  }

  return (
    <>
      {actionError ? <p role="alert" style={{ color: "var(--danger)" }}>{actionError}</p> : null}
      <section className="card stack">
        <div className="button-row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div className="button-row" style={{ flexWrap: "wrap" }}>
            <span className="pill">активных: {summary.active}</span>
            <span className="pill">завершили: {summary.completed}</span>
            <span className="pill" style={{ color: summary.needsHelp > 0 ? "#ec4899" : undefined }}>помощь: {summary.needsHelp}</span>
            <span className="pill" style={{ color: summary.stuck > 0 ? "#f59e0b" : undefined }}>зависли: {summary.stuck}</span>
            <span className="pill">ждут разбора: {summary.awaitingReview}</span>
            <span className="pill">не в сети: {summary.offline}</span>
          </div>
          <div className="button-row">
            <button className="button-secondary" onClick={handleCopySummary}>
              {copied ? "✓ Скопировано" : "Скопировать сводку"}
            </button>
            <button className="button-secondary" onClick={handleCopyActionableQueue}>
              {actionableCopied ? "✓ Скопировано" : "Требуют действия"}
            </button>
            <button className="button-secondary" onClick={handleCopyCompletedAwaitingReview}>
              {completedCopied ? "✓ Скопировано" : "Завершили без разбора"}
            </button>
          </div>
        </div>
      </section>

      <section className="card stack">
        <div className="button-row" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="eyebrow">Очередь помощи</div>
            <h2 className="section-title" style={{ fontSize: 28, marginTop: 10 }}>Кому нужна помощь</h2>
          </div>
          <div className="button-row">
            <span className="pill">В очереди: {helpQueue.length}</span>
            <button className="button-secondary" onClick={handleCopyHelpQueue}>
              {helpCopied ? "Скопировано" : "Скопировать очередь помощи"}
            </button>
          </div>
        </div>

        {helpQueue.length ? (
          <div className="grid grid-2">
            {helpQueue.map((item) => (
              <div key={item.participant.id} className="card accent-card stack" style={{ padding: 18 }}>
                <div className="button-row" style={{ justifyContent: "space-between" }}>
                  <strong>{item.participant.displayName}</strong>
                  <span className="pill" style={{ color: statusTone[item.participant.status] ?? "#fff" }}>
                    {statusLabel[item.participant.status] ?? item.participant.status}
                  </span>
                </div>
                <p className="subtle">
                  {item.gameTitle ?? "Игра не выбрана"} · {item.currentStepTitle ?? "Этап не определён"}
                </p>
                <div className="button-row">
                  {STEP_HINTS_ENABLED ? <span className="pill">Подсказки: {item.hintsOpenedCount}</span> : null}
                  <span className="pill">
                    Активность: {new Date(item.lastActivityAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {STEP_HINTS_ENABLED && pendingHintRequests[item.participant.id] ? (
                    <span className="pill" style={{ color: "#f59e0b" }}>⚡ Запрос подсказки</span>
                  ) : null}
                </div>
                <div className="button-row">
                  <button className="button-secondary" onClick={() => setSelectedParticipantId(item.participant.id)}>
                    Открыть
                  </button>
                  {STEP_HINTS_ENABLED && pendingHintRequests[item.participant.id] ? (
                    <button
                      className="button"
                      onClick={() => void handleApproveHint(item.participant.id)}
                    >
                      ✓ Одобрить подсказку
                    </button>
                  ) : null}
                  <button
                    className="button-secondary"
                    disabled={notePending === `quick-${item.participant.id}`}
                    onClick={() =>
                      void handleQuickHelpNote(
                        item.participant.id,
                        `Помощь: ${item.participant.displayName} | ${item.currentStepTitle ?? "текущий этап"}`
                      )
                    }
                  >
                    {notePending === `quick-${item.participant.id}` ? "Сохраняю..." : "Быстрая заметка"}
                  </button>
                  <button
                    className="button-secondary"
                    disabled={resolvingId === item.participant.id}
                    onClick={() => handleResolve(item.participant.id)}
                  >
                    {resolvingId === item.participant.id ? "Обрабатываю..." : "Помощь обработана"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="subtle">Сейчас очередь помощи пуста.</p>
        )}

      </section>

      <section className="card stack">
        <div className="button-row" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="eyebrow">ГОТОВЫ ПОКАЗАТЬ РЕЗУЛЬТАТ</div>
            <h2 className="section-title" style={{ fontSize: 28, marginTop: 10 }}>Готовы показать результат</h2>
          </div>
          <span className="pill">Завершили: {completedSpotlight.length}</span>
        </div>

        {completedSpotlight.length ? (
          <div className="grid grid-2">
            {completedSpotlight.map((item) => (
              <div
                key={item.participant.id}
                className="card accent-card stack"
                style={{ padding: 18, textAlign: "left", cursor: "pointer" }}
                onClick={() => setSelectedParticipantId(item.participant.id)}
              >
                <div className="button-row" style={{ justifyContent: "space-between" }}>
                  <strong>{item.participant.displayName}</strong>
                  <span className="pill" style={{ color: statusTone.completed }}>
                    завершил
                  </span>
                </div>
                <p className="subtle">
                  {item.gameTitle ?? "Игра не выбрана"} · {item.progressPercent}% готово
                </p>
                <div className="button-row">
                  {STEP_HINTS_ENABLED ? <span className="pill">Подсказки: {item.hintsOpenedCount}</span> : null}
                  <span className="pill">
                    Финал: {new Date(item.lastActivityAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <div className="button-row">
                  <button className="button-secondary" onClick={() => setSelectedParticipantId(item.participant.id)}>
                    Открыть
                  </button>
                  <button
                    className="button-secondary"
                    disabled={reviewingId === item.participant.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleMarkReviewed(item.participant.id);
                    }}
                  >
                    {reviewingId === item.participant.id ? "Сохраняю..." : "Показано тренеру"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="subtle">Пока никто не завершил миссию.</p>
        )}
      </section>

      <section className="card stack">
        <div className="button-row" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="eyebrow">Кто завис</div>
            <h2 className="section-title" style={{ fontSize: 28, marginTop: 10 }}>Кто завис без запроса помощи</h2>
          </div>
          <span className="pill">Зависли: {stuckWatch.length}</span>
        </div>

        {stuckWatch.length ? (
          <div className="grid grid-2">
            {stuckWatch.map((item) => (
              <button
                key={item.participant.id}
                type="button"
                className="card stack"
                style={{ padding: 18, textAlign: "left" }}
                onClick={() => setSelectedParticipantId(item.participant.id)}
              >
                <div className="button-row" style={{ justifyContent: "space-between" }}>
                  <strong>{item.participant.displayName}</strong>
                  <span className="pill" style={{ color: statusTone.stuck }}>
                    завис
                  </span>
                </div>
                <p className="subtle">
                  {item.gameTitle ?? "Игра не выбрана"} · {item.currentStepTitle ?? "Этап не определён"}
                </p>
                <div className="button-row">
                  {STEP_HINTS_ENABLED ? <span className="pill">Подсказки: {item.hintsOpenedCount}</span> : null}
                  <span className="pill">
                    Последняя активность: {new Date(item.lastActivityAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="subtle">Сейчас нет участников в статусе «завис».</p>
        )}
      </section>

      <section className="trainer-live-layout">
        <div className="card stack">
          <div className="button-row" style={{ justifyContent: "space-between" }}>
            <div>
              <div className="eyebrow">Живая таблица</div>
              <h2 className="section-title" style={{ fontSize: 28, marginTop: 10 }}>Участники в сессии</h2>
            </div>
            <details className="connection-diagnostics">
              <summary className="pill" style={{ cursor: "pointer" }}>
                {socketStatus === "connected" ? "● Онлайн" : socketStatus === "connecting" ? "○ Подключение…" : "○ Нет связи, обновляю по таймеру"}
              </summary>
              <div className="button-row" style={{ marginTop: 8 }}>
                <span className="pill">комната сокета: {initialDetail.jam.id}</span>
                <span className="pill">сокет: {socketStatus}</span>
                <span className="pill">участников в комнате: {socketRoomSize}</span>
                {lastRealtimeAt ? (
                  <span className="pill">
                    realtime: {new Date(lastRealtimeAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                ) : null}
              </div>
            </details>
          </div>

          <div className="button-row" style={{ flexWrap: "wrap" }}>
            <label className="stack" style={{ minWidth: 220 }}>
              <span>Фильтр статуса</span>
              <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
                <option value="all">Все статусы</option>
                <option value="needs_help">нужна помощь</option>
                <option value="active">активен</option>
                <option value="completed">завершил</option>
                <option value="stuck">завис</option>
                <option value="offline">не в сети</option>
              </select>
            </label>

            <label className="stack" style={{ minWidth: 220 }}>
              <span>Сортировка</span>
              <select className="input" value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                <option value="help_first">Сначала нужна помощь</option>
                <option value="activity_desc">По активности</option>
                <option value="progress_desc">По прогрессу</option>
                <option value="name_asc">По имени</option>
              </select>
            </label>

            <label className="stack" style={{ minWidth: 220 }}>
              <span>Быстрый режим</span>
              <button
                type="button"
                className={actionableOnly ? "button" : "button-secondary"}
                onClick={() => setActionableOnly((current) => !current)}
              >
                {actionableOnly ? "Только требующие действия" : "Показать требующие действия"}
              </button>
            </label>

            <span className="pill">Показано: {visibleParticipants.length}</span>
            {actionableOnly ? <span className="pill">нужна помощь + зависли + ждут разбора</span> : null}
          </div>

          <div className="trainer-table-scroll" role="region" aria-label="Ученики и их прогресс" tabIndex={0}>
          <table className="table trainer-participants-table">
            <thead>
              <tr>
                <th>Имя</th>
                <th>Игра</th>
                <th>Этап</th>
                <th>Прогресс</th>
                {STEP_HINTS_ENABLED ? <th>Подсказки</th> : null}
                <th>Статус</th>
                <th>Разбор</th>
                <th>Активность</th>
              </tr>
            </thead>
            <tbody>
              {visibleParticipants.map((item) => (
                <tr
                  key={item.participant.id}
                  ref={(node) => {
                    rowRefs.current[item.participant.id] = node;
                  }}
                  style={{
                    background: selectedParticipantId === item.participant.id ? "rgba(139, 92, 246, 0.08)" : undefined
                  }}
                >
                  <td>{item.participant.displayName}</td>
                  <td>{item.gameTitle ?? "Не выбран"}</td>
                  <td>{item.currentStepTitle ?? "Ожидает"}</td>
                  <td style={{ minWidth: 180 }}>
                    <div className="progress"><span style={{ width: `${item.progressPercent}%` }} /></div>
                  </td>
                  {STEP_HINTS_ENABLED ? <td>{item.hintsOpenedCount}</td> : null}
                  <td>
                    <span className="pill" style={{ color: statusTone[item.participant.status] ?? "#fff" }}>
                      {statusLabel[item.participant.status] ?? item.participant.status}
                    </span>
                  </td>
                  <td>
                    {item.reviewedAt ? (
                      <span className="pill">
                        разобрано {new Date(item.reviewedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    ) : item.participant.status === "completed" ? (
                      <span className="pill">ждёт разбора</span>
                    ) : (
                      <span className="subtle">-</span>
                    )}
                  </td>
                  <td>
                    <div className="button-row">
                      <span>{new Date(item.lastActivityAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span>
                      <button className="button-secondary" onClick={() => setSelectedParticipantId(item.participant.id)}>
                        Открыть
                      </button>
                      {item.participant.status === "needs_help" ? (
                        <button
                          className="button-secondary"
                          disabled={resolvingId === item.participant.id}
                          onClick={() => handleResolve(item.participant.id)}
                        >
                          {resolvingId === item.participant.id ? "Обрабатываю..." : "Помощь обработана"}
                        </button>
                      ) : null}
                      {STEP_HINTS_ENABLED && pendingHintRequests[item.participant.id] ? (
                        <button
                          className="button"
                          onClick={() => void handleApproveHint(item.participant.id)}
                        >
                          ✓ Подсказку
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        <div className="card stack">
          <div className="eyebrow">КАРТОЧКА УЧАСТНИКА</div>
          {detailLoading ? <p className="subtle">Загружаю детали участника...</p> : null}
          {!detailLoading && detail ? (
            <>
              <strong>{detail.participant.displayName}</strong>
              <div className="button-row">
                <span className="pill" style={{ color: statusTone[detail.participant.status] ?? "#fff" }}>{statusLabel[detail.participant.status] ?? detail.participant.status}</span>
                <span className="pill">{detail.participant.avatar}</span>
                {detail.currentVersionLabel ? <span className="pill">{detail.currentVersionLabel}</span> : null}
              </div>
              <p className="subtle">Код входа: {detail.jam.joinCode}</p>
              {detail.currentGameTitle ? <p className="subtle">Текущая игра: {detail.currentGameTitle}</p> : null}

              {detail.progress?.isCompleted ? (
                <div className="card accent-card stack" style={{ padding: 16 }}>
                  <div className="eyebrow">ГОТОВО К РАЗБОРУ</div>
                  <strong>Участник готов показать результат</strong>
                  <p className="subtle" style={{ marginBottom: 0 }}>
                    Это завершённая миссия. Можно подойти, посмотреть итоговый экран ребёнка и обсудить самый сложный этап.
                  </p>
                  <div className="button-row">
                    {detail.progress?.reviewedAt ? (
                      <span className="pill">
                        Разобрано: {new Date(detail.progress.reviewedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    ) : (
                      <button
                        className="button-secondary"
                        disabled={reviewingId === detail.participant.id}
                        onClick={() => handleMarkReviewed(detail.participant.id)}
                      >
                        {reviewingId === detail.participant.id ? "Сохраняю..." : "Показано тренеру"}
                      </button>
                    )}
                  </div>
                </div>
              ) : null}

              <div className="button-row">
                {latestTimelineEvent ? <span className="pill">Последнее событие: {latestTimelineEvent.type}</span> : null}
                {latestHelpEvent ? (
                  <span className="pill">
                    Событие помощи: {latestHelpEvent.type} в {new Date(latestHelpEvent.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                ) : null}
                <button className="button-secondary" onClick={() => setSelectedParticipantId(detail.participant.id)}>
                  Показать в таблице
                </button>
              </div>

              {detail.progress ? (
                <div className="grid grid-2">
                  <div className="card" style={{ padding: 16 }}>
                    <strong>Этапов завершено</strong>
                    <p className="subtle">{detail.progress.completedStepsCount}/{detail.progress.totalStepsCount}</p>
                  </div>
                  <div className="card" style={{ padding: 16 }}>
                    <strong>XP</strong>
                    <p className="subtle">{detail.progress.xpTotal}</p>
                  </div>
                </div>
              ) : (
                <p className="subtle">Участник ещё не выбрал игру.</p>
              )}

              {detail.resultSummary ? (
                <div className="card accent-card stack" style={{ padding: 16 }}>
                  <div className="eyebrow">Сводка результата</div>
                  <div className="grid grid-2">
                    <div className="card" style={{ padding: 14 }}>
                      <strong>Итог миссии</strong>
                      <p className="subtle">
                        {detail.resultSummary.completedSteps}/{detail.resultSummary.totalSteps} этапов, {detail.resultSummary.xpTotal} XP
                      </p>
                    </div>
                    <div className="card" style={{ padding: 14 }}>
                      <strong>{STEP_HINTS_ENABLED ? "Подсказки / помощь" : "Помощь тренера"}</strong>
                      <p className="subtle">
                        {STEP_HINTS_ENABLED ? `Подсказок: ${detail.resultSummary.hintsOpenedCount}, ` : ""}Запросов помощи: {detail.resultSummary.helpRequestsCount}
                      </p>
                    </div>
                  </div>
                  <div className="button-row">
                    <span className="pill">
                      {detail.resultSummary.hardestStepTitle
                        ? `Самый сложный этап: ${detail.resultSummary.hardestStepTitle}`
                        : "Сложный этап не выделен"}
                    </span>
                    {detail.resultSummary.completedAt ? (
                      <span className="pill">
                        Завершил: {new Date(detail.resultSummary.completedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    ) : null}
                    {detail.resultSummary.reviewedAt ? (
                      <span className="pill">
                        Разобрано: {new Date(detail.resultSummary.reviewedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    ) : null}
                  </div>
                  <div className="card" style={{ padding: 14 }}>
                    <strong>Итог для тренера</strong>
                    <p className="subtle" style={{ marginBottom: 0 }}>
                      {STEP_HINTS_ENABLED
                        ? detail.resultSummary.summaryText
                        : detail.resultSummary.summaryText.split(" | ").filter(part => !/hints?$/i.test(part)).join(" | ")}
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="stack">
                <strong>Заметки тренера</strong>
                <div className="card" style={{ padding: 14 }}>
                  <label className="stack">
                    <span>Заметка по участнику</span>
                    <textarea
                      className="textarea"
                      rows={3}
                      value={noteBody}
                      onChange={(event) => setNoteBody(event.target.value)}
                      placeholder="Что важно не забыть по этому ребёнку, текущему этапу или разбору результата?"
                    />
                  </label>
                  <div className="button-row">
                    <button className="button-secondary" onClick={() => void handleCreateNote()} disabled={notePending === "create" || !noteBody.trim()}>
                      {notePending === "create" ? "Сохраняю..." : "Добавить заметку"}
                    </button>
                  </div>
                </div>
                {detail.notes.length ? (
                  detail.notes.map((note) => (
                    <div key={note.id} className="card" style={{ padding: 14 }}>
                      <div className="button-row" style={{ justifyContent: "space-between" }}>
                        <strong>{note.authorDisplayName}</strong>
                        <div className="button-row">
                          <span className="pill">
                            {new Date(note.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <button className="button-secondary" onClick={() => void handleDeleteNote(note.id)} disabled={notePending === note.id}>
                            {notePending === note.id ? "Удаляю..." : "Удалить"}
                          </button>
                        </div>
                      </div>
                      <p className="subtle" style={{ marginBottom: 0 }}>{note.body}</p>
                    </div>
                  ))
                ) : (
                  <p className="subtle">Заметок пока нет.</p>
                )}
              </div>

              <div className="stack">
                <strong>Этапы участника</strong>
                {detail.steps.length ? detail.steps.map((step) => (
                  <div key={step.id} className="card" style={{ padding: 16 }}>
                    <div className="button-row" style={{ justifyContent: "space-between" }}>
                      <strong>{detail.stepTitles[step.stepId] ?? step.stepId}</strong>
                      <span className="pill">{step.status}</span>
                    </div>
                    <div className="button-row">
                      {STEP_HINTS_ENABLED ? <span className="pill">Подсказки: {step.hintsOpenedCount}</span> : null}
                      <span className="pill">Последняя подсказка: L{step.lastHintLevelOpened}</span>
                    </div>
                    <div className="button-row">
                      {step.needsHelpAt ? (
                        <span className="pill">Запрос помощи: {new Date(step.needsHelpAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span>
                      ) : null}
                      {step.helpResolvedAt ? (
                        <span className="pill">Помощь обработана: {new Date(step.helpResolvedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span>
                      ) : null}
                    </div>
                  </div>
                )) : <p className="subtle">Поэтаповый прогресс пока не сформирован.</p>}
              </div>

              <div className="stack">
                <strong>Хронология действий</strong>
                {detail.timeline.length ? detail.timeline.map((event) => (
                  <div
                    key={event.id}
                    className="card"
                    style={{
                      padding: 16,
                      borderColor:
                        latestTimelineEvent?.id === event.id
                          ? "rgba(139, 92, 246, 0.55)"
                          : latestHelpEvent?.id === event.id
                            ? "rgba(236, 72, 153, 0.45)"
                            : undefined,
                      boxShadow:
                        latestTimelineEvent?.id === event.id
                          ? "0 0 0 1px rgba(139, 92, 246, 0.35) inset"
                          : undefined
                    }}
                  >
                    <div className="button-row" style={{ justifyContent: "space-between" }}>
                      <strong>{event.title}</strong>
                      <span className="pill" style={{ color: timelineTone[event.type] ?? "#fff" }}>{event.type}</span>
                    </div>
                    <div className="button-row">
                      <span className="pill">
                        {new Date(event.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    {event.description ? <p className="subtle" style={{ marginBottom: 0 }}>{event.description}</p> : null}
                  </div>
                )) : <p className="subtle">Хронология действий пока не сформирована.</p>}
              </div>
            </>
          ) : null}
          {!detailLoading && !detail ? <p className="subtle">Выберите участника в таблице, чтобы увидеть детали.</p> : null}
        </div>
      </section>
    </>
  );
}
