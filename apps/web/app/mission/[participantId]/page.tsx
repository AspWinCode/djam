import type { Route } from "next";
import { ChildEmptyState } from "../../../components/child-empty-state";
import { ChildSessionSync } from "../../../components/child-session-sync";
import { MissionClient } from "../../../components/mission-client";
import { getParticipantProgress } from "../../../lib/api";

export default async function MissionPage({ params }: { params: Promise<{ participantId: string }> }) {
  const { participantId } = await params;

  try {
    const payload = await getParticipantProgress(participantId);
    const version = payload.version;
    const progress = payload.progress;
    const jam = payload.jam;

    if (!version || !progress || !jam) {
      return (
        <main className="shell">
          <ChildEmptyState
            title="Миссия пока не выбрана"
            description="Для этого участника ещё не выбрана игра. Сначала открой экран выбора игры, а затем вернись сюда."
            primaryHref={`/participant/${participantId}/jams` as Route}
            primaryLabel="К выбору игры"
            secondaryHref={"/" as Route}
            secondaryLabel="На главную"
          />
        </main>
      );
    }

    return (
      <main className="shell">
        <ChildSessionSync
          session={{
            participantId,
            joinCode: jam.joinCode,
            sessionTitle: jam.title,
            displayName: payload.participant.displayName,
            avatar: payload.participant.avatar
          }}
        />
        <MissionClient
          version={version}
          initialProgress={progress}
          initialStepProgress={payload.stepProgress ?? []}
          initialParticipant={payload.participant}
          participantId={participantId}
        />
      </main>
    );
  } catch {
    return (
      <main className="shell">
        <ChildEmptyState
          title="Не удалось открыть миссию"
          description="Мы не смогли загрузить прогресс участника. Попробуй обновить страницу или вернуться по join-ссылке."
          primaryHref={"/" as Route}
          primaryLabel="На главную"
        />
      </main>
    );
  }
}
