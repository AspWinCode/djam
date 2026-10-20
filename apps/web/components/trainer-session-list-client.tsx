"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Route } from "next";
import type { GameVersion, Jam } from "@game-game/shared";
import { attachTrainerJamGame, createTrainerJam, getTrainerPublishedGameVersions } from "../lib/api";
import { STEP_HINTS_ENABLED } from "../lib/features";

type HistoryFilter = "all" | "completed" | "cancelled";

const jamStatusLabel: Record<string, string> = {
  planned: "Запланирован",
  active: "Идёт сейчас",
  completed: "Завершён",
  cancelled: "Отменён"
};

function getVersionTitle(version: GameVersion) {
  const snapshot = version.snapshotJson as { game?: { title?: string } } | undefined;
  return snapshot?.game?.title ?? `Игра v${version.versionNumber}`;
}

function toggleSelection(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
}

export function TrainerSessionListClient({
  sessions,
  mode = "full",
  afterCreate
}: {
  sessions: Jam[];
  mode?: "full" | "create";
  /** Where to redirect after successful jam creation. Defaults to /trainer/jams/[id] */
  afterCreate?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("Новый джем");
  const [versions, setVersions] = useState<GameVersion[]>([]);
  const [selectedVersionIds, setSelectedVersionIds] = useState<string[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(true);
  const [search, setSearch] = useState("");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadVersions() {
      try {
        const items = await getTrainerPublishedGameVersions();
        if (!mounted) return;
        setVersions(items);
        setSelectedVersionIds(items[0] ? [items[0].id] : []);
      } catch {
        if (mounted) {
          setError("Не удалось загрузить опубликованные игры.");
        }
      } finally {
        if (mounted) {
          setLoadingVersions(false);
        }
      }
    }

    void loadVersions();
    return () => {
      mounted = false;
    };
  }, []);

  const selectedVersions = useMemo(
    () => selectedVersionIds.map((id) => versions.find((item) => item.id === id)).filter(Boolean) as GameVersion[],
    [selectedVersionIds, versions]
  );

  const filteredSessions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return sessions.filter((session) => {
      const matchesSearch =
        query.length === 0 ||
        session.title.toLowerCase().includes(query) ||
        session.joinCode.toLowerCase().includes(query);
      const matchesHistory =
        session.status === "completed" || session.status === "cancelled"
          ? historyFilter === "all" || session.status === historyFilter
          : true;
      return matchesSearch && matchesHistory;
    });
  }, [historyFilter, search, sessions]);

  const grouped = useMemo(
    () => ({
      active: filteredSessions.filter((session) => session.status === "active"),
      planned: filteredSessions.filter((session) => session.status === "planned"),
      history: filteredSessions.filter((session) => session.status === "completed" || session.status === "cancelled")
    }),
    [filteredSessions]
  );

  async function handleCreate() {
    // Если игры есть, но ни одна не выбрана — предупреждаем
    if (versions.length > 0 && selectedVersionIds.length === 0) {
      setError("Выберите хотя бы одну игру для джема.");
      return;
    }

    setPending(true);
    setError(null);

    try {
      const jam = await createTrainerJam({ title: title.trim() || "Новый джем" });
      for (let index = 0; index < selectedVersionIds.length; index += 1) {
        await attachTrainerJamGame(jam.id, {
          gameVersionId: selectedVersionIds[index],
          isDefault: index === 0
        });
      }
      router.push((afterCreate ?? `/trainer/jams/${jam.id}`) as never);
      router.refresh();
    } catch {
      setError("Не удалось создать джем и добавить выбранные игры.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card stack">
      <div className="button-row" style={{ justifyContent: "space-between" }}>
        <div>
          <div className="eyebrow">ДЖЕМЫ</div>
          <h2 className="section-title" style={{ fontSize: 28, marginTop: 10 }}>
            {mode === "create" ? "Создание джема" : "Тренерские джемы"}
          </h2>
        </div>
        {mode === "full" ? (
          <div className="button-row">
            <span className="pill">активных: {grouped.active.length}</span>
            <span className="pill">запланированных: {grouped.planned.length}</span>
            <span className="pill">в истории: {grouped.history.length}</span>
          </div>
        ) : null}
      </div>

      <label className="stack">
        <span>Название нового джема</span>
        <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>

      <div className="stack">
        <div className="button-row" style={{ justifyContent: "space-between" }}>
          <strong>Игры для джема</strong>
          {selectedVersions.length > 0 ? <span className="pill">выбрано: {selectedVersions.length}</span> : null}
        </div>
        {loadingVersions ? <p className="subtle">Загрузка опубликованных игр...</p> : null}
        {!loadingVersions && versions.length === 0 ? (
          <p className="subtle">Нет опубликованных игр. Сначала создайте и опубликуйте игру в админке.</p>
        ) : null}
        {!loadingVersions && versions.length > 0 ? (
          <div className="stack-sm">
            {versions.map((version) => {
              const isChecked = selectedVersionIds.includes(version.id);
              const orderIndex = selectedVersionIds.indexOf(version.id);
              return (
                <label
                  key={version.id}
                  className="card"
                  style={{
                    padding: 12,
                    borderColor: isChecked ? "rgba(99,102,241,0.4)" : "var(--panel-border)",
                    cursor: pending ? "not-allowed" : "pointer"
                  }}
                >
                  <div className="button-row" style={{ justifyContent: "space-between", width: "100%" }}>
                    <div className="button-row">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={pending}
                        onChange={() => setSelectedVersionIds((prev) => toggleSelection(prev, version.id))}
                      />
                      <span>{getVersionTitle(version)}</span>
                      <span className="pill">v{version.versionNumber}</span>
                    </div>
                    {isChecked ? (
                      <span className={`pill ${orderIndex === 0 ? "active" : ""}`}>
                        {orderIndex === 0 ? "по умолчанию" : `№${orderIndex + 1}`}
                      </span>
                    ) : null}
                  </div>
                </label>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="button-row">
        <button className="button" onClick={handleCreate} disabled={pending || loadingVersions}>
          {pending ? "Создаю..." : "Создать джем"}
        </button>
      </div>

      {mode === "full" ? (
        <>
          <div className="grid grid-2">
            <label className="stack">
              <span>Поиск по названию или join-коду</span>
              <input
                className="input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Например, cyber или ZA96Q3"
              />
            </label>
            <label className="stack">
              <span>Фильтр истории</span>
              <select className="input" value={historyFilter} onChange={(event) => setHistoryFilter(event.target.value as HistoryFilter)}>
                <option value="all">вся история</option>
                <option value="completed">только завершённые</option>
                <option value="cancelled">только отменённые</option>
              </select>
            </label>
          </div>

          <SessionGroup title="Активные сейчас" sessions={grouped.active} />
          <SessionGroup title="Запланированные" sessions={grouped.planned} />
          <SessionGroup title="История джемов" sessions={grouped.history} showArchiveSummary />

          {!filteredSessions.length ? <p className="subtle">По текущему фильтру джемы не найдены.</p> : null}
        </>
      ) : null}

      {error ? <p style={{ color: "#fda4af", margin: 0 }}>{error}</p> : null}
    </div>
  );
}

function SessionGroup({
  title,
  sessions,
  showArchiveSummary = false
}: {
  title: string;
  sessions: Jam[];
  showArchiveSummary?: boolean;
}) {
  if (!sessions.length) return null;

  return (
    <div className="stack">
      <strong>{title}</strong>
      {sessions.map((session) => (
        <div key={session.id} className="card accent-card stack" style={{ padding: 18 }}>
          <div className="button-row" style={{ justifyContent: "space-between" }}>
            <div>
              <strong>{session.title}</strong>
              <p className="subtle" style={{ margin: "8px 0 0" }}>
                Join-код: {session.joinCode}
              </p>
            </div>
            <div className="button-row">
              <span className="pill">{jamStatusLabel[session.status] ?? session.status}</span>
            </div>
          </div>

          <div className="button-row">
            <span className="pill">{session.joinUrl}</span>
            <span className="pill">{new Date(session.createdAt).toLocaleString("ru-RU")}</span>
            {session.startedAt ? <span className="pill">Запущен: {new Date(session.startedAt).toLocaleString("ru-RU")}</span> : null}
            {session.endedAt ? <span className="pill">Завершён: {new Date(session.endedAt).toLocaleString("ru-RU")}</span> : null}
          </div>

          {showArchiveSummary && session.archiveSummary ? (
            <div className="grid grid-3">
              <div className="card" style={{ padding: 14 }}>
                <strong>Участники</strong>
                <p className="subtle" style={{ marginBottom: 0 }}>
                  {session.archiveSummary.participantsCount} всего, {session.archiveSummary.completedCount} завершили
                </p>
              </div>
              <div className="card" style={{ padding: 14 }}>
                <strong>Проверка / прогресс</strong>
                <p className="subtle" style={{ marginBottom: 0 }}>
                  {session.archiveSummary.reviewedCount} проверено, средний прогресс {session.archiveSummary.averageProgressPercent}%
                </p>
              </div>
              <div className="card" style={{ padding: 14 }}>
                <strong>{STEP_HINTS_ENABLED ? "Подсказки / помощь" : "Помощь"}</strong>
                <p className="subtle" style={{ marginBottom: 0 }}>
                  {STEP_HINTS_ENABLED ? `${session.archiveSummary.hintsOpenedCount} подсказок, ` : ""}
                  {session.archiveSummary.helpRequestsCount} запросов помощи
                </p>
              </div>
            </div>
          ) : null}

          <div className="button-row">
            <Link className="button" href={`/trainer/jams/${session.id}`}>
              Открыть джем
            </Link>
            <Link className="button-secondary" href={session.joinUrl as Route}>
              Проверить join-flow
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
