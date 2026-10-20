"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminGameDetail, HintType, MediaAsset, StepHint, UpdateStepDto } from "@game-game/shared";
import {
  createAdminHint,
  deleteAdminHint,
  deleteAdminStep,
  reorderAdminSteps,
  updateAdminHint,
  updateAdminStep
} from "../lib/api";
import { AdminMediaPickerField } from "./admin-media-picker-field";

type StepWithHints = AdminGameDetail["steps"][number];

function isConflictError(error: unknown) {
  return Boolean(error && typeof error === "object" && "status" in error && error.status === 409);
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function hintTypeLabel(type: HintType) {
  if (type === "text") return "Текст";
  if (type === "image") return "Изображение";
  return "Видео";
}

function HintEditor({
  hint,
  disabled,
  onSave,
  onDelete,
  recentAssets
}: {
  hint: StepHint;
  disabled: boolean;
  onSave: (hintId: string, payload: { text: string; level: number; hintType: HintType; mediaUrl?: string }) => Promise<void>;
  onDelete: (hintId: string) => Promise<void>;
  recentAssets: MediaAsset[];
}) {
  const [text, setText] = useState(hint.text);
  const [hintType, setHintType] = useState<HintType>(hint.hintType);
  const [mediaUrl, setMediaUrl] = useState(hint.mediaUrl ?? "");

  useEffect(() => {
    setText(hint.text);
    setHintType(hint.hintType);
    setMediaUrl(hint.mediaUrl ?? "");
  }, [hint.hintType, hint.mediaUrl, hint.text]);

  return (
    <div className="card stack" style={{ padding: 14 }}>
      <div className="button-row" style={{ justifyContent: "space-between" }}>
        <strong>Подсказка L{hint.level}</strong>
        <span className="pill">{hintTypeLabel(hintType)}</span>
      </div>

      <label className="stack">
        <span>Тип подсказки</span>
        <select className="input" value={hintType} onChange={(event) => setHintType(event.target.value as HintType)} disabled={disabled}>
          <option value="text">Текст</option>
          <option value="image">Изображение</option>
          <option value="video">Видео</option>
        </select>
      </label>

      <label className="stack">
        <span>Текст подсказки</span>
        <textarea className="textarea" rows={4} value={text} onChange={(event) => setText(event.target.value)} disabled={disabled} />
      </label>

      {hintType !== "text" ? (
        <AdminMediaPickerField
          label="Адрес медиа"
          value={mediaUrl}
          onChange={setMediaUrl}
          placeholder={hintType === "image" ? "/uploads/manual/hint-image.png" : "/uploads/manual/hint-video.mp4"}
          recentAssets={recentAssets}
          allowedTypes={hintType === "image" ? ["image"] : ["video"]}
          disabled={disabled}
        />
      ) : null}

      <div className="button-row">
        <button
          className="button-secondary"
          type="button"
          disabled={disabled}
          onClick={() =>
            void onSave(hint.id, {
              level: hint.level,
              text: text.trim(),
              hintType,
              mediaUrl: hintType === "text" ? undefined : mediaUrl.trim() || undefined
            })
          }
        >
          Сохранить подсказку
        </button>
        <button className="button-secondary" type="button" disabled={disabled} onClick={() => void onDelete(hint.id)}>
          Удалить подсказку
        </button>
      </div>
    </div>
  );
}

export function AdminStepCardClient({
  jamId,
  step,
  orderedStepIds,
  recentAssets,
  canEdit
}: {
  jamId: string;
  step: StepWithHints;
  orderedStepIds: string[];
  recentAssets: MediaAsset[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(step.title);
  const [description, setDescription] = useState(step.description);
  const [goalText, setGoalText] = useState(step.goalText);
  const [taskImageUrl, setTaskImageUrl] = useState(step.taskImageUrl ?? "");
  const [taskVideoUrl, setTaskVideoUrl] = useState(step.taskVideoUrl ?? "");
  const [successTitle, setSuccessTitle] = useState(step.successTitle);
  const [successText, setSuccessText] = useState(step.successText);
  const [successXp, setSuccessXp] = useState(String(step.successXp));
  const [resultImageUrl, setResultImageUrl] = useState(step.resultImageUrl ?? "");
  const [resultVideoUrl, setResultVideoUrl] = useState(step.resultVideoUrl ?? "");
  const [pending, setPending] = useState<"hint" | "delete" | "reorder" | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "conflict" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const expectedUpdatedAtRef = useRef(step.updatedAt);
  const firstRenderRef = useRef(true);
  const currentIndex = orderedStepIds.indexOf(step.id);
  const canMoveUp = currentIndex > 0;
  const canMoveDown = currentIndex >= 0 && currentIndex < orderedStepIds.length - 1;

  const payload = useMemo<UpdateStepDto>(
    () => ({
      title: title.trim(),
      description: description.trim(),
      goalText: goalText.trim(),
      taskImageUrl: taskImageUrl.trim() || undefined,
      taskVideoUrl: taskVideoUrl.trim() || undefined,
      successTitle: successTitle.trim(),
      successText: successText.trim(),
      successXp: Number(successXp),
      resultImageUrl: resultImageUrl.trim() || undefined,
      resultVideoUrl: resultVideoUrl.trim() || undefined
    }),
    [description, goalText, taskImageUrl, taskVideoUrl, resultImageUrl, resultVideoUrl, successText, successTitle, successXp, title]
  );

  async function saveStep(manual = false) {
    if (!canEdit) {
      return;
    }

    setSaveState("saving");
    setError(null);

    try {
      const updated = await updateAdminStep(step.id, {
        ...payload,
        expectedUpdatedAt: expectedUpdatedAtRef.current
      });
      expectedUpdatedAtRef.current = updated.updatedAt;
      setSaveState("saved");
      if (manual) {
        router.refresh();
      }
    } catch (saveError) {
      setError(getErrorMessage(saveError, "Не удалось сохранить этап."));
      setSaveState(isConflictError(saveError) ? "conflict" : "error");
    }
  }

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }

    if (!canEdit) {
      return;
    }

    setSaveState("dirty");
    const timeout = window.setTimeout(() => {
      void saveStep(false);
    }, 900);

    return () => window.clearTimeout(timeout);
  }, [canEdit, payload]);

  async function handleDeleteStep() {
    if (!canEdit) {
      return;
    }

    setPending("delete");
    setError(null);
    try {
      await deleteAdminStep(step.id);
      router.refresh();
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, "Не удалось удалить этап."));
    } finally {
      setPending(null);
    }
  }

  async function handleAddHint() {
    if (!canEdit || step.hints.length >= 9) {
      return;
    }

    const nextLevel = step.hints.length + 1;
    setPending("hint");
    setError(null);
    try {
      await createAdminHint(step.id, {
        level: nextLevel,
        text: `Подсказка уровня ${nextLevel}`,
        hintType: "text"
      });
      router.refresh();
    } catch (hintError) {
      setError(getErrorMessage(hintError, "Не удалось добавить подсказку."));
    } finally {
      setPending(null);
    }
  }

  async function handleSaveHint(hintId: string, nextPayload: { text: string; level: number; hintType: HintType; mediaUrl?: string }) {
    if (!canEdit) {
      return;
    }

    setPending("hint");
    setError(null);
    try {
      await updateAdminHint(hintId, nextPayload);
      router.refresh();
    } catch (hintError) {
      setError(getErrorMessage(hintError, "Не удалось сохранить подсказку."));
    } finally {
      setPending(null);
    }
  }

  async function handleDeleteHint(hintId: string) {
    if (!canEdit) {
      return;
    }

    setPending("hint");
    setError(null);
    try {
      await deleteAdminHint(hintId);
      router.refresh();
    } catch (hintError) {
      setError(getErrorMessage(hintError, "Не удалось удалить подсказку."));
    } finally {
      setPending(null);
    }
  }

  async function handleReorder(direction: -1 | 1) {
    if (!canEdit || (direction === -1 && !canMoveUp) || (direction === 1 && !canMoveDown)) {
      return;
    }

    const nextIds = [...orderedStepIds];
    const swapIndex = currentIndex + direction;
    [nextIds[currentIndex], nextIds[swapIndex]] = [nextIds[swapIndex], nextIds[currentIndex]];

    setPending("reorder");
    setError(null);
    try {
      await reorderAdminSteps(jamId, { stepIds: nextIds });
      router.refresh();
    } catch (reorderError) {
      setError(getErrorMessage(reorderError, "Не удалось поменять порядок этапов."));
    } finally {
      setPending(null);
    }
  }

  const saveLabel =
    saveState === "saving"
      ? "Автосохранение..."
      : saveState === "saved"
        ? "Этап сохранён"
        : saveState === "dirty"
          ? "Есть изменения"
          : saveState === "conflict"
            ? "Нужно обновить страницу"
            : saveState === "error"
              ? "Ошибка сохранения"
              : "Черновик этапа";

  return (
    <div className="card stack" style={{ padding: 18, opacity: canEdit ? 1 : 0.72 }}>
      <div className="button-row" style={{ justifyContent: "space-between" }}>
        <strong>
          {step.orderIndex}. {step.title}
        </strong>
        <div className="button-row">
          <span className="pill">{saveLabel}</span>
          <button className="button-secondary" onClick={() => void handleReorder(-1)} disabled={!canEdit || pending !== null || !canMoveUp}>
            Выше
          </button>
          <button className="button-secondary" onClick={() => void handleReorder(1)} disabled={!canEdit || pending !== null || !canMoveDown}>
            Ниже
          </button>
          <span className="pill">XP {step.successXp}</span>
        </div>
      </div>

      {!canEdit ? (
        <div className="card" style={{ padding: 14 }}>
          <strong>Редактирование заблокировано</strong>
          <p className="subtle" style={{ marginBottom: 0 }}>
            Сначала получите блокировку на всю игру, затем продолжайте правки.
          </p>
        </div>
      ) : null}

      <label className="stack">
        <span>Название этапа</span>
        <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} disabled={!canEdit} />
      </label>

      <label className="stack">
        <span>Описание этапа</span>
        <textarea className="textarea" value={description} rows={3} onChange={(event) => setDescription(event.target.value)} disabled={!canEdit} />
      </label>

      <label className="stack">
        <span>Цель этапа</span>
        <textarea className="textarea" value={goalText} rows={2} onChange={(event) => setGoalText(event.target.value)} disabled={!canEdit} />
      </label>

      <div className="eyebrow" style={{ fontSize: 11, letterSpacing: 1, color: "var(--muted)", marginBottom: -8 }}>
        Медиа задания
      </div>
      <div className="grid grid-2">
        <AdminMediaPickerField
          label="Изображение / GIF задания"
          value={taskImageUrl}
          onChange={setTaskImageUrl}
          placeholder="/uploads/manual/task.png"
          recentAssets={recentAssets}
          allowedTypes={["image"]}
          disabled={!canEdit}
        />
        <AdminMediaPickerField
          label="Видео задания"
          value={taskVideoUrl}
          onChange={setTaskVideoUrl}
          placeholder="/uploads/manual/task.mp4"
          recentAssets={recentAssets}
          allowedTypes={["video"]}
          disabled={!canEdit}
        />
      </div>

      <div className="grid grid-2">
        <label className="stack">
          <span>Заголовок после успеха</span>
          <input className="input" value={successTitle} onChange={(event) => setSuccessTitle(event.target.value)} disabled={!canEdit} />
        </label>
        <label className="stack">
          <span>XP за этап</span>
          <input className="input" value={successXp} onChange={(event) => setSuccessXp(event.target.value)} inputMode="numeric" disabled={!canEdit} />
        </label>
      </div>

      <label className="stack">
        <span>Текст после успеха</span>
        <textarea className="textarea" value={successText} rows={2} onChange={(event) => setSuccessText(event.target.value)} disabled={!canEdit} />
      </label>

      <div className="grid grid-2">
        <AdminMediaPickerField
          label="Адрес итогового изображения"
          value={resultImageUrl}
          onChange={setResultImageUrl}
          placeholder="/uploads/manual/result.png"
          recentAssets={recentAssets}
          allowedTypes={["image"]}
          disabled={!canEdit}
        />
        <AdminMediaPickerField
          label="Адрес итогового видео"
          value={resultVideoUrl}
          onChange={setResultVideoUrl}
          placeholder="/uploads/manual/result.mp4"
          recentAssets={recentAssets}
          allowedTypes={["video"]}
          disabled={!canEdit}
        />
      </div>

      <div className="button-row">
        <button className="button" onClick={() => void saveStep(true)} disabled={!canEdit || pending !== null || saveState === "saving"}>
          Сохранить сейчас
        </button>
        <button className="button-secondary" onClick={() => void handleAddHint()} disabled={!canEdit || pending !== null || step.hints.length >= 9}>
          {pending === "hint" ? "Обновляю..." : `Добавить подсказку (${step.hints.length})`}
        </button>
        <button className="button-secondary" onClick={() => router.refresh()} disabled={pending !== null}>
          Обновить
        </button>
        <button className="button-secondary" onClick={() => void handleDeleteStep()} disabled={!canEdit || pending !== null}>
          {pending === "delete" ? "Удаляю..." : "Удалить этап"}
        </button>
      </div>

      {taskImageUrl || taskVideoUrl || resultImageUrl || resultVideoUrl ? (
        <div className="button-row">
          {taskImageUrl ? <span className="pill">медиа задания: изображение</span> : null}
          {taskVideoUrl ? <span className="pill">медиа задания: видео</span> : null}
          {resultImageUrl ? <span className="pill">итог: изображение</span> : null}
          {resultVideoUrl ? <span className="pill">итог: видео</span> : null}
        </div>
      ) : null}

      <div className="stack">
        {step.hints.map((hint) => (
          <HintEditor
            key={hint.id}
            hint={hint}
            disabled={!canEdit || pending !== null}
            onDelete={handleDeleteHint}
            onSave={handleSaveHint}
            recentAssets={recentAssets}
          />
        ))}
      </div>

      {error ? <p style={{ color: "#fda4af", margin: 0 }}>{error}</p> : null}
    </div>
  );
}
