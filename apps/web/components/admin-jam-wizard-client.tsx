"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RichTextEditor } from "./rich-text-editor";
import type { AdminGameDetail, HintType, Game, GameEditLock, GameVersion, MediaAsset, StepHint, UpdateGameDto, UpdateStepDto } from "@game-game/shared";
import {
  acquireAdminGameEditLock,
  createAdminHint,
  createAdminStep,
  deleteAdminHint,
  deleteAdminStep,
  heartbeatAdminGameEditLock,
  publishAdminGame,
  releaseAdminGameEditLock,
  reorderAdminSteps,
  restoreAdminGameVersion,
  updateAdminHint,
  updateAdminGame,
  updateAdminStep,
  uploadAdminMediaFile
} from "../lib/api";

type WizardStep = "info" | "media" | "steps" | "final" | "review";
type StepWithHints = AdminGameDetail["steps"][number];
type LockState = "acquiring" | "owned" | "blocked" | "error";
type SaveState = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error";

const WIZARD_STEPS: { key: WizardStep; label: string }[] = [
  { key: "info", label: "Основное" },
  { key: "media", label: "Медиа и стиль" },
  { key: "steps", label: "Структура миссии" },
  { key: "final", label: "Финальный экран" },
  { key: "review", label: "Проверка" }
];

function isConflictError(error: unknown) {
  return Boolean(error && typeof error === "object" && "status" in error && error.status === 409);
}

function getErr(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function levelLabel(level: string) {
  if (level === "beginner") return "Начальный";
  if (level === "intermediate") return "Средний";
  if (level === "advanced") return "Продвинутый";
  return level;
}

// ─── Hint Editor ───

function HintEditor({
  hint,
  disabled,
  onSave,
  onDelete
}: {
  hint: StepHint;
  disabled: boolean;
  onSave: (id: string, p: { text: string; level: number; hintType: HintType; mediaUrl?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [text, setText] = useState(hint.text);
  const [hintType, setHintType] = useState<HintType>(hint.hintType);
  const [mediaUrl, setMediaUrl] = useState(hint.mediaUrl ?? "");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const firstRef = useRef(true);
  const savingRef = useRef(false);

  // Sync from server when hint data changes externally (e.g. after router.refresh)
  useEffect(() => {
    if (savingRef.current) return; // don't overwrite while we're mid-save
    setText(hint.text);
    setHintType(hint.hintType);
    setMediaUrl(hint.mediaUrl ?? "");
  }, [hint.text, hint.hintType, hint.mediaUrl]);

  // Autosave with 900ms debounce
  useEffect(() => {
    if (firstRef.current) { firstRef.current = false; return; }
    if (disabled) return;
    setSaveState("dirty");
    const t = window.setTimeout(async () => {
      savingRef.current = true;
      setSaveState("saving");
      try {
        await onSave(hint.id, {
          level: hint.level,
          text: text.trim(),
          hintType,
          mediaUrl: hintType === "text" ? undefined : mediaUrl.trim() || undefined
        });
        setSaveState("saved");
      } catch {
        setSaveState("error");
      } finally {
        savingRef.current = false;
      }
    }, 900);
    return () => window.clearTimeout(t);
  }, [text, hintType, mediaUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveIcon = saveState === "saving" ? "сохраняю..." : saveState === "saved" ? "✓" : saveState === "dirty" ? "•" : saveState === "error" ? "!" : "";
  const saveColor = saveState === "saved" ? "var(--success)" : saveState === "error" ? "var(--danger)" : "var(--dim)";

  return (
    <div className="card stack-sm" style={{ padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong style={{ fontSize: 13 }}>Подсказка L{hint.level}</strong>
          {saveIcon ? <span style={{ fontSize: 11, color: saveColor }}>{saveIcon}</span> : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <select className="input" style={{ width: "auto", padding: "4px 8px", fontSize: 12 }} value={hintType} onChange={(e) => setHintType(e.target.value as HintType)} disabled={disabled}>
            <option value="text">Текст</option>
            <option value="image">Изображение</option>
            <option value="video">Видео</option>
          </select>
          <button className="button-danger" style={{ fontSize: 12, padding: "4px 8px" }} disabled={disabled} onClick={() => void onDelete(hint.id)}>
            Удалить
          </button>
        </div>
      </div>
      <textarea className="textarea" rows={2} value={text} onChange={(e) => setText(e.target.value)} disabled={disabled} style={{ fontSize: 13 }} />
      {hintType !== "text" ? (
        <input className="input" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="URL медиа" disabled={disabled} style={{ fontSize: 13 }} />
      ) : null}
    </div>
  );
}

// ─── Step Editor ───

function StepEditor({
  jamId,
  step,
  orderedStepIds,
  canEdit
}: {
  jamId: string;
  step: StepWithHints;
  orderedStepIds: string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(step.title);
  const [description, setDescription] = useState(step.description);
  const [goalText, setGoalText] = useState(step.goalText);
  const [successTitle, setSuccessTitle] = useState(step.successTitle);
  const [successText, setSuccessText] = useState(step.successText);
  const [successXp, setSuccessXp] = useState(String(step.successXp));
  const [isBonus, setIsBonus] = useState(step.isBonus ?? false);
  const [pending, setPending] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const expectedRef = useRef(step.updatedAt);
  const firstRef = useRef(true);
  const stepConflictRef = useRef(false);
  const idx = orderedStepIds.indexOf(step.id);
  const [expanded, setExpanded] = useState(false);

  const payload = useMemo<UpdateStepDto>(() => ({
    title: title.trim(),
    description: description.trim(),
    goalText: goalText.trim(),
    successTitle: successTitle.trim(),
    successText: successText.trim(),
    successXp: Number(successXp),
    isBonus
  }), [title, description, goalText, successTitle, successText, successXp, isBonus]);

  async function save() {
    if (!canEdit) return;
    setSaveState("saving");
    setError(null);
    try {
      const u = await updateAdminStep(step.id, { ...payload, expectedUpdatedAt: expectedRef.current });
      expectedRef.current = u.updatedAt;
      setSaveState("saved");
    } catch (e) {
      const isConflict = isConflictError(e);
      if (isConflict) stepConflictRef.current = true;
      setError(getErr(e, "Не удалось сохранить этап."));
      setSaveState(isConflict ? "conflict" : "error");
    }
  }

  useEffect(() => {
    if (firstRef.current) { firstRef.current = false; return; }
    if (!canEdit || stepConflictRef.current) return;
    setSaveState("dirty");
    const t = window.setTimeout(() => void save(), 900);
    return () => window.clearTimeout(t);
  }, [canEdit, payload]);

  async function handleDelete() {
    if (!canEdit || !window.confirm("Удалить этот этап?")) return;
    setPending("delete");
    try { await deleteAdminStep(step.id); router.refresh(); } catch (e) { setError(getErr(e, "Ошибка.")); } finally { setPending(null); }
  }

  async function handleAddHint() {
    if (!canEdit || step.hints.length >= 9) return;
    const nextLevel = step.hints.length + 1;
    setPending("hint");
    try { await createAdminHint(step.id, { level: nextLevel, text: `Подсказка L${nextLevel}`, hintType: "text" }); router.refresh(); } catch (e) { setError(getErr(e, "Ошибка.")); } finally { setPending(null); }
  }

  async function handleSaveHint(hintId: string, p: { text: string; level: number; hintType: HintType; mediaUrl?: string }) {
    await updateAdminHint(hintId, p);
  }

  async function handleDeleteHint(hintId: string) {
    setPending("hint");
    try { await deleteAdminHint(hintId); router.refresh(); } catch (e) { setError(getErr(e, "Ошибка.")); } finally { setPending(null); }
  }

  async function handleReorder(dir: -1 | 1) {
    if (!canEdit) return;
    const next = [...orderedStepIds];
    const sw = idx + dir;
    [next[idx], next[sw]] = [next[sw], next[idx]];
    setPending("reorder");
    try { await reorderAdminSteps(jamId, { stepIds: next }); router.refresh(); } catch (e) { setError(getErr(e, "Ошибка.")); } finally { setPending(null); }
  }

  const saveIcon = saveState === "saving" ? "..." : saveState === "saved" ? "ok" : saveState === "dirty" ? "*" : "";

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      {/* Header - always visible */}
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", cursor: "pointer", background: expanded ? "var(--bg-tertiary)" : "transparent", transition: "background 150ms" }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "var(--dim)", fontSize: 13, fontWeight: 600, minWidth: 24 }}>{step.orderIndex}.</span>
          <span style={{ fontWeight: 500 }}>{step.title || "Без названия"}</span>
          {saveIcon ? <span style={{ color: "var(--dim)", fontSize: 11 }}>{saveIcon}</span> : null}
        </div>
        <div className="button-row" style={{ gap: 4 }}>
          {isBonus ? <span className="pill active" style={{ fontSize: 11 }}>⭐ Бонус</span> : null}
          <span className="pill" style={{ fontSize: 11 }}>{step.hints.length} подск.</span>
          <span className="pill" style={{ fontSize: 11 }}>{step.successXp} XP</span>
          <span style={{ color: "var(--dim)", fontSize: 16 }}>{expanded ? "\u25B2" : "\u25BC"}</span>
        </div>
      </div>

      {/* Body - expandable */}
      {expanded ? (
        <div className="stack" style={{ padding: 16, paddingTop: 8 }}>
          <div className="grid grid-2">
            <label className="stack-sm">
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Название</span>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canEdit} />
            </label>
            <label className="stack-sm">
              <span style={{ fontSize: 12, color: "var(--muted)" }}>XP за этап</span>
              <input className="input" value={successXp} onChange={(e) => setSuccessXp(e.target.value)} inputMode="numeric" disabled={!canEdit} />
            </label>
          </div>

          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input type="checkbox" checked={isBonus} onChange={(e) => setIsBonus(e.target.checked)} disabled={!canEdit} style={{ marginTop: 3 }} />
            <span style={{ fontSize: 13 }}>
              <strong>Бонусный этап</strong> — необязательный, для самых быстрых; не входит в прогресс игры, даёт дополнительный XP.
              Бонусные этапы должны идти после всех обязательных.
            </span>
          </label>

          <div className="stack-sm">
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Описание</span>
            <RichTextEditor
              value={description}
              onChange={setDescription}
              disabled={!canEdit}
              minHeight={100}
            />
          </div>

          <label className="stack-sm">
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Цель</span>
            <input className="input" value={goalText} onChange={(e) => setGoalText(e.target.value)} disabled={!canEdit} />
          </label>

          <div className="grid grid-2">
            <label className="stack-sm">
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Заголовок успеха</span>
              <input className="input" value={successTitle} onChange={(e) => setSuccessTitle(e.target.value)} disabled={!canEdit} />
            </label>
            <label className="stack-sm">
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Текст успеха</span>
              <input className="input" value={successText} onChange={(e) => setSuccessText(e.target.value)} disabled={!canEdit} />
            </label>
          </div>

          {/* Hints */}
          <div style={{ borderTop: "1px solid var(--panel-border)", paddingTop: 12, marginTop: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>ПОДСКАЗКИ ({step.hints.length})</span>
              <button className="button-ghost" style={{ fontSize: 12 }} onClick={() => void handleAddHint()} disabled={!canEdit || pending !== null || step.hints.length >= 9}>
                + Добавить
              </button>
            </div>
            <div className="stack-sm">
              {step.hints.map((hint) => (
                <HintEditor key={hint.id} hint={hint} disabled={!canEdit || pending !== null} onSave={handleSaveHint} onDelete={handleDeleteHint} />
              ))}
            </div>
          </div>

          {/* Actions */}
          <div style={{ borderTop: "1px solid var(--panel-border)", paddingTop: 12, display: "flex", justifyContent: "space-between" }}>
            <div className="button-row">
              <button className="button-ghost" style={{ fontSize: 12 }} onClick={() => void handleReorder(-1)} disabled={!canEdit || pending !== null || idx <= 0}>
                Выше
              </button>
              <button className="button-ghost" style={{ fontSize: 12 }} onClick={() => void handleReorder(1)} disabled={!canEdit || pending !== null || idx >= orderedStepIds.length - 1}>
                Ниже
              </button>
            </div>
            <button className="button-danger" style={{ fontSize: 12 }} onClick={() => void handleDelete()} disabled={!canEdit || pending !== null}>
              {pending === "delete" ? "Удаляю..." : "Удалить этап"}
            </button>
          </div>

          {error ? <p style={{ color: "var(--danger)", margin: 0, fontSize: 12 }}>{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── Media Upload Field ───

function MediaUploadField({
  label,
  value,
  onChange,
  accept,
  disabled,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  accept: string;
  disabled: boolean;
  placeholder?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isImage = accept.includes("image");

  async function handleFile(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const asset = await uploadAdminMediaFile(file);
      onChange(asset.url);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && !disabled) void handleFile(file);
  }

  return (
    <div className="stack-sm">
      <span style={{ fontSize: 12, color: "var(--muted)" }}>{label}</span>

      {/* Preview */}
      {value && isImage ? (
        <div style={{ position: "relative", display: "inline-block" }}>
          <img src={value} alt={label} style={{ maxHeight: 160, maxWidth: "100%", borderRadius: 8, objectFit: "cover", display: "block" }} />
          {!disabled ? (
            <button
              onClick={() => onChange("")}
              style={{ position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}
              title="Удалить"
            >×</button>
          ) : null}
        </div>
      ) : null}

      {value && !isImage ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "var(--bg-tertiary)", borderRadius: 8 }}>
          <span style={{ fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--muted)" }}>{value}</span>
          {!disabled ? (
            <button onClick={() => onChange("")} style={{ border: "none", background: "transparent", color: "var(--danger)", cursor: "pointer", fontSize: 13, flexShrink: 0 }}>Удалить</button>
          ) : null}
        </div>
      ) : null}

      {/* Drop zone + URL input */}
      {!value ? (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          style={{
            border: "2px dashed var(--panel-border)",
            borderRadius: 8,
            padding: 20,
            textAlign: "center",
            background: "var(--bg-tertiary)",
            cursor: disabled ? "default" : "pointer",
            transition: "border-color 150ms"
          }}
          onClick={() => !disabled && inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            style={{ display: "none" }}
            disabled={disabled}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ""; }}
          />
          {uploading ? (
            <span style={{ fontSize: 13, color: "var(--muted)" }}>Загружаю...</span>
          ) : (
            <>
              <div style={{ fontSize: 24, marginBottom: 6 }}>{isImage ? "🖼️" : "🎬"}</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>
                Перетащи файл или <span style={{ color: "var(--primary-hover)", textDecoration: "underline" }}>выбери</span>
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* URL fallback input */}
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "или вставь URL вручную"}
        disabled={disabled}
        style={{ fontSize: 12 }}
      />

      {uploadError ? <span style={{ fontSize: 12, color: "var(--danger)" }}>{uploadError}</span> : null}
    </div>
  );
}

// ─── Main Wizard ───

export function AdminJamWizardClient({
  detail,
  recentAssets,
  blockingChecks,
  advisoryChecks,
  publishReady,
  nextVersionNumber,
  isTemplate
}: {
  detail: AdminGameDetail;
  recentAssets: MediaAsset[];
  blockingChecks: { label: string; passed: boolean }[];
  advisoryChecks: { label: string; passed: boolean }[];
  publishReady: boolean;
  nextVersionNumber: number;
  isTemplate: boolean;
}) {
  const router = useRouter();
  const jam = detail.game;
  const jamId = jam.id;
  const steps = detail.steps;

  const [activeStep, setActiveStep] = useState<WizardStep>("info");

  // ─── Lock ───
  const [lockState, setLockState] = useState<LockState>("acquiring");
  const [lockError, setLockError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    async function acquire() {
      setLockState("acquiring");
      try {
        await acquireAdminGameEditLock(jamId);
        if (!disposed) setLockState("owned");
      } catch (e) {
        if (!disposed) { setLockError(getErr(e, "Блокировка")); setLockState(isConflictError(e) ? "blocked" : "error"); }
      }
    }
    void acquire();
    return () => { disposed = true; void releaseAdminGameEditLock(jamId); };
  }, [jamId]);

  useEffect(() => {
    if (lockState !== "owned") return;
    const iv = window.setInterval(() => { void heartbeatAdminGameEditLock(jamId).catch(() => {}); }, 60000);
    return () => window.clearInterval(iv);
  }, [jamId, lockState]);

  const canEdit = lockState === "owned";

  // ─── Jam fields ───
  const [slug, setSlug] = useState(jam.slug);
  const [title, setTitle] = useState(jam.title);
  const [shortDesc, setShortDesc] = useState(jam.shortDescription);
  const [fullDesc, setFullDesc] = useState(jam.fullDescription);
  const [themeCode, setThemeCode] = useState(jam.themeCode);
  const [level, setLevel] = useState(jam.level);
  const [accentStyle, setAccentStyle] = useState(jam.accentStyle);
  const [accentColor, setAccentColor] = useState(jam.accentColor);
  const [coverUrl, setCoverUrl] = useState(jam.coverImageUrl ?? "");
  const [previewUrl, setPreviewUrl] = useState(jam.previewVideoUrl ?? "");
  const [finalTitle, setFinalTitle] = useState(jam.finalTitle);
  const [finalDesc, setFinalDesc] = useState(jam.finalDescription);
  const [finalXp, setFinalXp] = useState(String(jam.finalRewardXp));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const expectedRef = useRef(jam.updatedAt);
  const firstRef = useRef(true);
  const conflictRef = useRef(false);

  const payload = useMemo<UpdateGameDto>(() => ({
    slug: slug.trim(), title: title.trim(), shortDescription: shortDesc.trim(), fullDescription: fullDesc.trim(),
    themeCode: themeCode.trim(), level: level.trim(),
    accentStyle: accentStyle.trim(), accentColor: accentColor.trim(),
    coverImageUrl: coverUrl.trim() || undefined, previewVideoUrl: previewUrl.trim() || undefined,
    finalTitle: finalTitle.trim(), finalDescription: finalDesc.trim(), finalRewardXp: Number(finalXp)
  }), [slug, title, shortDesc, fullDesc, themeCode, level, accentStyle, accentColor, coverUrl, previewUrl, finalTitle, finalDesc, finalXp]);

  async function saveDraft(manual = false) {
    if (!canEdit) return;
    setSaveState("saving"); setError(null);
    try {
      const u = await updateAdminGame(jamId, { ...payload, expectedUpdatedAt: expectedRef.current });
      expectedRef.current = u.updatedAt;
      setSaveState("saved");
      if (manual) router.refresh();
    } catch (e) {
      const isConflict = isConflictError(e);
      if (isConflict) conflictRef.current = true;
      setError(getErr(e, "Ошибка сохранения."));
      setSaveState(isConflict ? "conflict" : "error");
    }
  }

  useEffect(() => {
    if (firstRef.current) { firstRef.current = false; return; }
    if (!canEdit || conflictRef.current) return;
    setSaveState("dirty");
    const t = window.setTimeout(() => void saveDraft(false), 900);
    return () => window.clearTimeout(t);
  }, [canEdit, payload]);

  async function handleAddStep() {
    if (!canEdit) return;
    setBusyAction("step"); setError(null);
    try {
      await createAdminStep(jamId, { title: "Новый этап", description: "Описание этапа.", goalText: "Цель этапа.", successTitle: "Готово", successText: "Этап выполнен.", successXp: 20 });
      router.refresh();
    } catch (e) { setError(getErr(e, "Ошибка.")); }
    finally { setBusyAction(null); }
  }

  async function handlePublish() {
    setBusyAction("publish"); setError(null);
    try { await publishAdminGame(jamId); router.refresh(); } catch (e) { setError(getErr(e, "Не удалось опубликовать.")); }
    finally { setBusyAction(null); }
  }

  // ─── Step completion for sidebar ───
  // Default placeholder strings set by the API on game creation — if fields still equal
  // these values the section is considered "not yet edited" and won't show the ✓.
  const INFO_PLACEHOLDERS = [
    "Новая игра",
    "Новый шаблон игры",
    "Краткое описание новой игры.",
    "Шаблон для быстрой сборки новой игры.",
    "Подробное описание новой игры для прохождения.",
    "Рабочий шаблон для методиста: этапы, подсказки и финал."
  ];
  const FINAL_PLACEHOLDERS = [
    "Игра завершена",
    "Шаблон готов",
    "Покажи результат тренеру.",
    "Создайте на основе шаблона рабочую игру."
  ];

  const stepCompletion = useMemo(() => {
    // Info: filled AND not still a placeholder string
    const infoFilled = Boolean(title.trim() && shortDesc.trim() && fullDesc.trim());
    const infoEdited = !INFO_PLACEHOLDERS.includes(title.trim()) &&
      !INFO_PLACEHOLDERS.includes(shortDesc.trim()) &&
      !INFO_PLACEHOLDERS.includes(fullDesc.trim());
    const info = infoFilled && infoEdited;

    // Media: theme, style and colour all chosen
    const media = Boolean(themeCode.trim() && accentStyle.trim() && accentColor.trim());

    // Steps: at least one step with a real title
    const stepsOk = steps.length > 0 && steps.every((s) => s.title && s.title !== "Новый этап");

    // Final: filled AND not still a placeholder string
    const finalFilled = Boolean(finalTitle.trim() && finalDesc.trim() && Number(finalXp) > 0);
    const finalEdited = !FINAL_PLACEHOLDERS.includes(finalTitle.trim()) &&
      !FINAL_PLACEHOLDERS.includes(finalDesc.trim());
    const final = finalFilled && finalEdited;

    return { info, media, steps: stepsOk, final, review: publishReady };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, shortDesc, fullDesc, themeCode, accentStyle, accentColor, steps, finalTitle, finalDesc, finalXp, publishReady]);

  const passedCount = blockingChecks.filter((c) => c.passed).length;
  const totalChecks = blockingChecks.length;
  const progressPct = totalChecks > 0 ? Math.round((passedCount / totalChecks) * 100) : 0;

  const saveLabel = saveState === "saving" ? "Сохраняю..." : saveState === "saved" ? "Сохранено" : saveState === "dirty" ? "Не сохранено" : "";

  return (
    <div className="stack">
      {/* Top bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/admin" className="button-ghost" style={{ padding: "6px 10px", fontSize: 13 }}>
            &larr; Назад
          </Link>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{title || "Новая игра"}</h1>
          {isTemplate ? <span className="pill" style={{ fontSize: 11 }}>шаблон</span> : null}
        </div>
        <div className="button-row">
          {saveLabel ? <span style={{ fontSize: 12, color: saveState === "saved" ? "var(--success)" : "var(--muted)" }}>{saveLabel}</span> : null}
          {lockState === "blocked" ? <span className="pill" style={{ color: "var(--warning)", fontSize: 11 }}>Заблокирован</span> : null}
          <button className="button-secondary" onClick={() => void saveDraft(true)} disabled={!canEdit || saveState === "saving"}>
            Сохранить
          </button>
          {!isTemplate ? (
            <button className="button" onClick={() => void handlePublish()} disabled={!publishReady || busyAction !== null} style={{ opacity: publishReady ? 1 : 0.5 }}>
              {busyAction === "publish" ? "Публикую..." : "Опубликовать"}
            </button>
          ) : null}
        </div>
      </div>

      {lockError ? <p style={{ color: "var(--danger)", margin: 0, fontSize: 13 }}>{lockError}</p> : null}
      {error ? <p style={{ color: "var(--danger)", margin: 0, fontSize: 13 }}>{error}</p> : null}

      {/* Main layout */}
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20, alignItems: "start" }}>
        {/* Sidebar nav */}
        <div className="card stack-sm" style={{ padding: 8, position: "sticky", top: 24 }}>
          {WIZARD_STEPS.map((ws) => {
            const done = stepCompletion[ws.key];
            const isActive = activeStep === ws.key;
            return (
              <button
                key={ws.key}
                onClick={() => setActiveStep(ws.key)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", borderRadius: 8, border: "none",
                  background: isActive ? "var(--bg-tertiary)" : "transparent",
                  color: isActive ? "var(--text)" : "var(--muted)",
                  cursor: "pointer", fontSize: 14, fontWeight: isActive ? 600 : 400,
                  transition: "all 150ms", textAlign: "left", width: "100%"
                }}
              >
                <span style={{ width: 20, height: 20, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, background: done ? "rgba(34,197,94,0.15)" : "var(--bg-tertiary)", color: done ? "var(--success)" : "var(--dim)", flexShrink: 0, transition: "background 300ms, color 300ms" }}>
                  {done
                    ? <span key="check" className="check-pop">{"\u2713"}</span>
                    : <span key="dot">{"\u00B7"}</span>
                  }
                </span>
                {ws.label}
              </button>
            );
          })}
          <div style={{ padding: "8px 12px" }}>
            <div style={{ fontSize: 11, color: "var(--dim)", marginBottom: 4 }}>Готовность {progressPct}%</div>
            <div className="progress"><span style={{ width: `${progressPct}%` }} /></div>
          </div>
        </div>

        {/* Content area */}
        <div className="card stack" style={{ minHeight: 400 }}>
          {/* ─── INFO ─── */}
          {activeStep === "info" ? (
            <>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Основная информация</h2>
              <label className="stack-sm">
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Название</span>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canEdit} />
              </label>
              <label className="stack-sm">
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Краткое описание</span>
                <textarea className="textarea" rows={2} value={shortDesc} onChange={(e) => setShortDesc(e.target.value)} disabled={!canEdit} />
              </label>
              <label className="stack-sm">
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Полное описание</span>
                <textarea className="textarea" rows={4} value={fullDesc} onChange={(e) => setFullDesc(e.target.value)} disabled={!canEdit} />
              </label>
              <div className="grid grid-2">
                <label className="stack-sm">
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>Код</span>
                  <input className="input" value={slug} onChange={(e) => setSlug(e.target.value)} disabled={!canEdit} />
                </label>
                <label className="stack-sm">
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>Уровень</span>
                  <select className="input" value={level} onChange={(e) => setLevel(e.target.value)} disabled={!canEdit}>
                    <option value="beginner">Начальный</option>
                    <option value="intermediate">Средний</option>
                    <option value="advanced">Продвинутый</option>
                  </select>
                </label>
              </div>
            </>
          ) : null}

          {/* ─── MEDIA ─── */}
          {activeStep === "media" ? (
            <>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Медиа и стиль</h2>
              <MediaUploadField
                label="Обложка (изображение)"
                value={coverUrl}
                onChange={setCoverUrl}
                accept="image/*"
                disabled={!canEdit}
                placeholder="/uploads/cover.png"
              />
              <MediaUploadField
                label="Preview-видео"
                value={previewUrl}
                onChange={setPreviewUrl}
                accept="video/*"
                disabled={!canEdit}
                placeholder="/uploads/preview.mp4"
              />
              <div className="grid grid-2">
                <label className="stack-sm">
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>Тема игры</span>
                  <select className="input" value={themeCode} onChange={(e) => setThemeCode(e.target.value)} disabled={!canEdit}>
                    <option value="cyber-it">💻 Кибер / IT</option>
                    <option value="space">🚀 Космос</option>
                    <option value="nature">🌿 Природа</option>
                    <option value="retro">🕹️ Ретро</option>
                    <option value="minimal">✨ Минимализм</option>
                    <option value="adventure">🗺️ Приключение</option>
                    <option value="science">🔬 Наука</option>
                    <option value="art">🎨 Искусство</option>
                  </select>
                </label>
                <label className="stack-sm">
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>Визуальный стиль</span>
                  <select className="input" value={accentStyle} onChange={(e) => setAccentStyle(e.target.value)} disabled={!canEdit}>
                    <option value="neon-grid">Неон-сетка</option>
                    <option value="dots">Точки</option>
                    <option value="waves">Волны</option>
                    <option value="geometric">Геометрия</option>
                    <option value="clean">Чистый</option>
                    <option value="gradient">Градиент</option>
                  </select>
                </label>
              </div>
              <label className="stack-sm">
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Акцентный цвет</span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="color" value={accentColor || "#6366F1"} onChange={(e) => setAccentColor(e.target.value)} disabled={!canEdit} style={{ width: 40, height: 38, border: "none", background: "transparent", cursor: "pointer", flexShrink: 0 }} />
                  <input className="input" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} disabled={!canEdit} placeholder="#8B5CF6" />
                </div>
              </label>
            </>
          ) : null}

          {/* ─── STEPS ─── */}
          {activeStep === "steps" ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Структура миссии</h2>
                <button className="button" onClick={() => void handleAddStep()} disabled={!canEdit || busyAction !== null}>
                  {busyAction === "step" ? "Добавляю..." : "+ Добавить этап"}
                </button>
              </div>
              {steps.length === 0 ? (
                <div className="stack empty-state" style={{ minHeight: 200 }}>
                  <h3 style={{ margin: 0, fontSize: 16, color: "var(--muted)" }}>Нет этапов</h3>
                  <p className="subtle" style={{ margin: 0 }}>Добавьте первый этап для миссии.</p>
                  <button className="button" onClick={() => void handleAddStep()} disabled={!canEdit}>
                    + Добавить этап
                  </button>
                </div>
              ) : (
                <div className="stack">
                  {steps.map((step) => (
                    <StepEditor key={step.id} jamId={jamId} step={step} orderedStepIds={steps.map((s) => s.id)} canEdit={canEdit} />
                  ))}
                </div>
              )}
            </>
          ) : null}

          {/* ─── FINAL ─── */}
          {activeStep === "final" ? (
            <>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Финальный экран</h2>
              <p className="subtle" style={{ margin: 0 }}>Этот экран видит ребёнок после завершения всех этапов миссии.</p>
              <label className="stack-sm">
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Заголовок</span>
                <input className="input" value={finalTitle} onChange={(e) => setFinalTitle(e.target.value)} disabled={!canEdit} />
              </label>
              <label className="stack-sm">
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Описание</span>
                <textarea className="textarea" rows={3} value={finalDesc} onChange={(e) => setFinalDesc(e.target.value)} disabled={!canEdit} />
              </label>
              <label className="stack-sm">
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Награда XP</span>
                <input className="input" value={finalXp} onChange={(e) => setFinalXp(e.target.value)} inputMode="numeric" disabled={!canEdit} />
              </label>
              {/* Preview card */}
              <div className="card accent-card" style={{ padding: 20, textAlign: "center", marginTop: 8 }}>
                <div className="eyebrow" style={{ justifyContent: "center" }}>Предпросмотр</div>
                <h3 style={{ margin: "12px 0 8px", fontSize: 24 }}>{finalTitle || "..."}</h3>
                <p className="subtle">{finalDesc || "..."}</p>
                <span className="pill active" style={{ fontSize: 14, padding: "6px 16px" }}>+{finalXp || 0} XP</span>
              </div>
            </>
          ) : null}

          {/* ─── REVIEW ─── */}
          {activeStep === "review" ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Проверка{isTemplate ? " шаблона" : " и публикация"}</h2>
                <span className="pill active">{progressPct}% готово</span>
              </div>

              <div className="stack-sm">
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>ОБЯЗАТЕЛЬНЫЕ ПРОВЕРКИ</span>
                {blockingChecks.map((c) => (
                  <div key={c.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--panel-border)" }}>
                    <span style={{ fontSize: 14 }}>{c.label}</span>
                    <span className={`pill ${c.passed ? "status-published" : ""}`} style={{ fontSize: 11, color: c.passed ? "var(--success)" : "var(--danger)" }}>
                      {c.passed ? "Готово" : "Исправить"}
                    </span>
                  </div>
                ))}
              </div>

              <div className="stack-sm" style={{ marginTop: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>РЕКОМЕНДАЦИИ</span>
                {advisoryChecks.map((c) => (
                  <div key={c.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--panel-border)" }}>
                    <span style={{ fontSize: 14 }}>{c.label}</span>
                    <span className="pill" style={{ fontSize: 11, color: c.passed ? "var(--success)" : "var(--warning)" }}>
                      {c.passed ? "Готово" : "Рекомендуется"}
                    </span>
                  </div>
                ))}
              </div>

              {/* Quick nav to fix issues */}
              {!publishReady ? (
                <div className="card" style={{ padding: 14, marginTop: 8 }}>
                  <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>Исправьте обязательные пункты, чтобы разблокировать публикацию:</div>
                  <div className="button-row" style={{ flexWrap: "wrap", gap: 6 }}>
                    {/* checks[2] = название/описания → Основное */}
                    {(!blockingChecks[2]?.passed) ? <button className="button-ghost" style={{ fontSize: 12, padding: "2px 8px" }} onClick={() => setActiveStep("info")}>Основное</button> : null}
                    {/* checks[3] = тема/стиль/длительность → Медиа и стиль */}
                    {(!blockingChecks[3]?.passed) ? <button className="button-ghost" style={{ fontSize: 12, padding: "2px 8px" }} onClick={() => setActiveStep("media")}>Медиа и стиль</button> : null}
                    {/* checks[1,5,6,7] = этапы → Структура миссии */}
                    {(!blockingChecks[1]?.passed || !blockingChecks[5]?.passed || !blockingChecks[6]?.passed || !blockingChecks[7]?.passed) ? <button className="button-ghost" style={{ fontSize: 12, padding: "2px 8px" }} onClick={() => setActiveStep("steps")}>Этапы миссии</button> : null}
                    {/* checks[4] = финальный экран → Финальный экран */}
                    {(!blockingChecks[4]?.passed) ? <button className="button-ghost" style={{ fontSize: 12, padding: "2px 8px" }} onClick={() => setActiveStep("final")}>Финальный экран</button> : null}
                  </div>
                </div>
              ) : null}

              {!isTemplate ? (
                <div style={{ borderTop: "1px solid var(--panel-border)", paddingTop: 16, marginTop: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <strong>Версия v{nextVersionNumber}</strong>
                      <p className="subtle" style={{ margin: "4px 0 0", fontSize: 13 }}>{steps.length} этапов, {steps.reduce((s, st) => s + st.hints.length, 0)} подсказок</p>
                    </div>
                    <button className="button" onClick={() => void handlePublish()} disabled={!publishReady || busyAction !== null} style={{ opacity: publishReady ? 1 : 0.5 }}>
                      {busyAction === "publish" ? "Публикую..." : "Опубликовать"}
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
