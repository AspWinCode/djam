"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";
import type { TrainerNotification } from "@game-game/shared";
import { getTrainerNotifications } from "../lib/api";

export function TrainerNotificationBell({ organizationId }: { organizationId: string }) {
  const [items, setItems] = useState<TrainerNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      clearTimeout(timer);
      try {
        const notifications = await getTrainerNotifications();
        if (!cancelled) { setItems(notifications); setError(false); setLoaded(true); }
      } catch {
        // Keep previous tasks visible if the network is temporarily unavailable.
        if (!cancelled) setError(true);
      } finally {
        inFlight = false;
        if (!cancelled) timer = setTimeout(() => void refresh(), 10000);
      }
    };
    const onRefresh = () => { if (!document.hidden) void refresh(); };
    void refresh();
    window.addEventListener("trainer-notifications-changed", onRefresh);
    window.addEventListener("focus", onRefresh);
    document.addEventListener("visibilitychange", onRefresh);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("trainer-notifications-changed", onRefresh);
      window.removeEventListener("focus", onRefresh);
      document.removeEventListener("visibilitychange", onRefresh);
    };
  }, [organizationId]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  return (
    <div className="trainer-notifications">
      <button type="button" className="button-secondary" aria-expanded={open}
        aria-controls="trainer-notification-list" onClick={() => setOpen(value => !value)}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        Уведомления <span className="pill" aria-live="polite">{loaded ? items.length : "…"}</span>
        {error ? <span aria-label="Не удалось обновить уведомления">⚠</span> : null}
      </button>
      {open ? (
        <section id="trainer-notification-list" className="card stack trainer-notification-list" aria-label="Запросы учеников">
          <strong>Запросы учеников</strong>
          <p className="subtle" style={{ margin: 0 }}>Задачи исчезают после помощи ученику или проверки результата.</p>
          {error ? <p role="alert">Не удалось обновить список. Повторяем подключение…</p> : null}
          {!loaded && !error ? <p role="status">Загружаю уведомления…</p> : null}
          {loaded && !items.length && !error ? <p>Новых запросов нет.</p> : null}
          <div aria-live="polite" className="sr-only">{loaded ? `Необработанных запросов: ${items.length}` : ""}</div>
          {items.map(item => (
            <Link key={item.id} className="card stack notification-item"
              href={`/trainer/jams/${item.jamId}?participant=${encodeURIComponent(item.participantId)}${item.progressId ? `&progress=${encodeURIComponent(item.progressId)}` : ""}` as Route}
              onClick={() => setOpen(false)}>
              <strong>{item.participantName}: {item.kind === "help" ? "нужна помощь" : "проверь результат"}</strong>
              <span className="subtle">{item.jamTitle}{item.stepTitle ? ` · ${item.stepTitle}` : ""}</span>
              <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString("ru-RU")}</time>
            </Link>
          ))}
        </section>
      ) : null}
    </div>
  );
}
