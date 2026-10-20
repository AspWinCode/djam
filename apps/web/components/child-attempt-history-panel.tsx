"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useState } from "react";
import {
  clearChildAttemptHistory,
  type ChildAttemptRecord,
  readChildAttemptHistory
} from "./child-attempt-history";
import { STEP_HINTS_ENABLED } from "../lib/features";

function formatAttemptDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Недавно";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function AttemptRow({ item }: { item: ChildAttemptRecord }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="button-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className="stack" style={{ gap: 8 }}>
          <strong>{item.jamTitle}</strong>
          <span className="subtle">Завершено: {formatAttemptDate(item.completedAt)}</span>
        </div>
        <span className="pill">{item.xpTotal} XP</span>
      </div>
      <div className="button-row" style={{ marginTop: 12 }}>
        {STEP_HINTS_ENABLED ? <span className="pill">Подсказок: {item.hintsOpenedCount}</span> : null}
        <span className="pill">Запросов помощи: {item.helpRequestsCount}</span>
        <Link className="button-secondary" href={`/join/${item.joinCode}` as Route}>
          Повторить
        </Link>
      </div>
    </div>
  );
}

export function ChildAttemptHistoryPanel({
  title = "История попыток",
  compact = false
}: {
  title?: string;
  compact?: boolean;
}) {
  const [items, setItems] = useState<ChildAttemptRecord[]>([]);

  // Читаем localStorage только на клиенте, после гидрации
  useEffect(() => {
    setItems(readChildAttemptHistory());
  }, []);

  const visibleItems = useMemo(() => (compact ? items.slice(0, 3) : items), [compact, items]);

  if (!items.length) {
    return null;
  }

  return (
    <section className="card stack" aria-labelledby="child-attempt-history-title">
      <div className="button-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">Replay</div>
          <h2 id="child-attempt-history-title" className="section-title" style={{ fontSize: 24 }}>
            {title}
          </h2>
        </div>
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            clearChildAttemptHistory();
            setItems([]);
          }}
        >
          Очистить историю
        </button>
      </div>

      <div className="stack">
        {visibleItems.map((item) => (
          <AttemptRow key={`${item.participantId}-${item.completedAt}`} item={item} />
        ))}
      </div>
    </section>
  );
}
