import { Suspense } from "react";
import { TrainerLiveClient } from "../../../../components/trainer-live-client";
import { TrainerSessionControlsClient } from "../../../../components/trainer-session-controls-client";
import { getTrainerPublishedGameVersions, getTrainerJam } from "../../../../lib/api";
import { getServerCookieHeader, requireServerRole } from "../../../../lib/server-auth";

export default async function TrainerJamPage({ params }: { params: Promise<{ id: string }> }) {
  await requireServerRole(["trainer", "admin"], "/trainer");
  const cookieHeader = await getServerCookieHeader();
  const { id } = await params;
  const [detail, publishedGameVersions] = await Promise.all([
    getTrainerJam(id, cookieHeader ?? undefined),
    getTrainerPublishedGameVersions(cookieHeader ?? undefined)
  ]);

  const attachedGames = detail.jamGames
    .map((jamGame) => ({
      relation: jamGame,
      version: publishedGameVersions.find((version) => version.id === jamGame.gameVersionId)
    }))
    .filter((item) => item.version);

  return (
    <main className="shell">
      <div className="container stack">
        <section className="hero">
          <div className="eyebrow">ТРЕНЕРСКАЯ КОНСОЛЬ</div>
          <h1 style={{ fontSize: 48, marginTop: 16 }}>{detail.jam.title}</h1>
          <div className="button-row" style={{ marginTop: 20 }}>
            <span className="pill">
              Код: <span className="code">{detail.jam.joinCode}</span>
            </span>
            <span className="pill">Статус: {detail.jam.status}</span>
            <span className="pill">Игр: {detail.jamGames.length}</span>
            {detail.jam.startedAt ? <span className="pill">Запущен: {new Date(detail.jam.startedAt).toLocaleString("ru-RU")}</span> : null}
          </div>
        </section>

        <TrainerSessionControlsClient
          session={detail.jam}
          jamVersions={publishedGameVersions}
          attachedJamVersionIds={detail.jamGames.map((item) => item.gameVersionId)}
          analytics={detail.analytics}
        />

        <section className="card stack">
          <div className="button-row" style={{ justifyContent: "space-between" }}>
            <div>
              <div className="eyebrow">ПОДКЛЮЧЁННЫЕ ИГРЫ</div>
              <h2 className="section-title" style={{ fontSize: 28, marginTop: 10 }}>
                Подключённые игры
              </h2>
            </div>
            <span className="pill">Всего: {attachedGames.length}</span>
          </div>

          {attachedGames.length ? (
            <div className="grid grid-2">
              {attachedGames.map((item) => (
                <div key={item.relation.id} className="card accent-card stack" style={{ padding: 18 }}>
                  <div className="button-row" style={{ justifyContent: "space-between" }}>
                    <strong>{item.version?.snapshotJson.game.title}</strong>
                    <div className="button-row">
                      {item.relation.isDefault ? <span className="pill">default</span> : null}
                      <span className="pill">v{item.version?.versionNumber}</span>
                    </div>
                  </div>
                  <p className="subtle">{item.version?.snapshotJson.game.shortDescription}</p>
                  <div className="button-row">
                    <span className="pill">Этапов: {item.version?.snapshotJson.steps.length}</span>
                    <span className="pill">{item.version?.snapshotJson.game.estimatedDurationMin} мин.</span>
                    <span className="pill">Позиция: {item.relation.orderIndex}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="subtle">К джему пока не подключена ни одна опубликованная игра.</p>
          )}
        </section>

        <Suspense fallback={<p>Загружаю участников…</p>}><TrainerLiveClient initialDetail={detail} /></Suspense>
      </div>
    </main>
  );
}
