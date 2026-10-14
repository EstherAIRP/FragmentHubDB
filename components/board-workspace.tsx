"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
  type SyntheticEvent,
} from "react";

import { BoardCard, BoardCardDetails } from "@/components/board-card";
import { BoardMoveMenu } from "@/components/board-move-menu";
import type { Fragment } from "@/lib/fragment-schema";
import {
  activeSoftLimit,
  boardColumns,
  listIncubating,
} from "@/lib/fragments/board";
import {
  boardDraftStorageKey,
  buildStatusBatchRequest,
  editZones,
  effectiveStatus,
  groupEditZones,
  interpretStatusBatchResponse,
  isEditZone,
  listPendingChanges,
  maxBatchChanges,
  moveCard,
  parseBoardDraft,
  rebasePendingChanges,
  revertChange,
  serializeBoardDraft,
  type BoardCardData,
  type EditZone,
  type PendingChange,
  type PendingChanges,
  type StatusBatchOutcome,
} from "@/lib/fragments/board-edit";
import { statusLabels } from "@/lib/fragments/presentation";

type Status = Fragment["status"];

type BoardWorkspaceProps = {
  view: "board" | "incubating";
  /** Current scope filter; unsaved drafts are kept per scope. */
  scope: string;
  /** Scope-filtered incubating/inbox/active/waiting cards in board order. */
  cards: BoardCardData[];
  showScope: boolean;
  remoteConfigured: boolean;
  recentlyDone: number;
  doneHref: string;
  viewTabs: ReactNode;
  scopeTabs: ReactNode;
};

type SaveMessage = {
  title: string;
  items?: string[];
  login?: boolean;
};

const noChanges: PendingChanges = {};

export function BoardWorkspace({
  view,
  scope,
  cards,
  showScope,
  remoteConfigured,
  recentlyDone,
  doneHref,
  viewTabs,
  scopeTabs,
}: BoardWorkspaceProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogStatusRef = useRef<HTMLParagraphElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const savedRef = useRef<HTMLParagraphElement>(null);
  // Mirrors `saving` for native event handlers that must not see stale state.
  const savingRef = useRef(false);
  // Card whose 移到 trigger should get focus once the move has re-rendered.
  const focusAfterMoveRef = useRef<string | null>(null);
  // Focus targets after the restore banner closes.
  const focusCountRef = useRef(false);
  const focusEditButtonRef = useRef(false);
  const [refreshing, startRefresh] = useTransition();
  const [editing, setEditing] = useState(false);
  const [changes, setChanges] = useState<PendingChanges>(noChanges);
  // Changes just saved, shown until the refreshed server data arrives.
  const [settled, setSettled] = useState<PendingChanges>(noChanges);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<SaveMessage | null>(null);
  const [droppedNotice, setDroppedNotice] = useState<PendingChange[]>([]);
  const [savedCount, setSavedCount] = useState(0);
  const [baseCards, setBaseCards] = useState(cards);
  // A draft left over from an interrupted edit session, offered for restore.
  const [restorable, setRestorable] = useState<{
    changes: PendingChanges;
    dropped: PendingChange[];
  } | null>(null);

  // Re-base local changes whenever the server sends fresh cards.
  if (baseCards !== cards) {
    setBaseCards(cards);
    setSettled(noChanges);
    const rebased = rebasePendingChanges(changes, cards);
    setChanges(rebased.changes);
    if (rebased.dropped.length > 0) setDroppedNotice(rebased.dropped);
  }

  const pending = listPendingChanges(changes);
  const count = pending.length;
  const shownChanges = editing ? changes : settled;

  useUnsavedChangesGuard(editing && count > 0, count);

  // Keep unsaved changes in sessionStorage so Back/forward, reloads and
  // links can't silently lose them; they are cleared only by an explicit
  // 取消, 捨棄, or a successful save.
  useEffect(() => {
    if (!editing) return;
    if (count > 0) writeDraft(scope, serializeBoardDraft(scope, changes));
    else clearDraft(scope);
  }, [editing, changes, count, scope]);

  // Offer to restore a draft from an interrupted session (once per mount).
  useEffect(() => {
    const draft = parseBoardDraft(readDraft(scope));
    if (!draft || draft.scope !== scope) return;

    const rebased = rebasePendingChanges(draft.changes, cards);
    if (listPendingChanges(rebased.changes).length === 0) {
      clearDraft(scope);
      return;
    }
    // Show the cards' current titles, not whatever was stored.
    const titles = new Map(cards.map((card) => [card.id, card.title]));
    setRestorable({
      changes: Object.fromEntries(
        listPendingChanges(rebased.changes).map((change) => [
          change.id,
          { ...change, title: titles.get(change.id) ?? change.title },
        ]),
      ),
      dropped: rebased.dropped.map((change) => ({
        ...change,
        title: titles.get(change.id) ?? change.title,
      })),
    });
    // Only the initial cards matter; later refreshes don't re-offer.
  }, [scope]);

  // Saved changes stay visible until the refreshed server data has landed.
  useEffect(() => {
    if (!refreshing) setSettled(noChanges);
  }, [refreshing]);

  useEffect(() => {
    if (saving) dialogStatusRef.current?.focus();
  }, [saving]);

  useEffect(() => {
    if (saveMessage) noticeRef.current?.focus();
  }, [saveMessage]);

  useEffect(() => {
    if (savedCount > 0) savedRef.current?.focus();
  }, [savedCount]);

  useEffect(() => {
    const id = focusAfterMoveRef.current;
    if (!id) return;
    focusAfterMoveRef.current = null;
    // Archived cards leave the board; fall back to the change counter.
    (
      document.getElementById(moveTriggerId(id)) ??
      document.getElementById("board-edit-count")
    )?.focus();
  }, [changes]);

  useEffect(() => {
    if (focusCountRef.current && editing) {
      focusCountRef.current = false;
      document.getElementById("board-edit-count")?.focus();
    }
    if (focusEditButtonRef.current && !restorable) {
      focusEditButtonRef.current = false;
      document.getElementById("board-edit-button")?.focus();
    }
  }, [editing, restorable]);

  function refreshData() {
    startRefresh(() => router.refresh());
  }

  function restoreDraft() {
    if (!restorable || refreshing) return;
    setSavedCount(0);
    setSaveMessage(null);
    setDroppedNotice(restorable.dropped);
    setChanges(restorable.changes);
    setRestorable(null);
    focusCountRef.current = true;
    setEditing(true);
  }

  function discardDraft() {
    clearDraft(scope);
    setRestorable(null);
    focusEditButtonRef.current = true;
  }

  function enterEditMode() {
    if (refreshing) return;
    if (restorable) {
      const restoreCount = listPendingChanges(restorable.changes).length;
      if (
        !window.confirm(
          `要捨棄上次尚未儲存的 ${restoreCount} 項變更，重新開始調整嗎？`,
        )
      ) {
        return;
      }
      clearDraft(scope);
      setRestorable(null);
    }
    setSavedCount(0);
    setSaveMessage(null);
    setDroppedNotice([]);
    setChanges(noChanges);
    setEditing(true);
  }

  function cancelEditMode() {
    if (saving) return;
    if (count > 0 && !window.confirm(`要捨棄 ${count} 項未儲存的變更嗎？`)) {
      return;
    }
    clearDraft(scope);
    setChanges(noChanges);
    setSaveMessage(null);
    setDroppedNotice([]);
    setEditing(false);
  }

  function move(card: BoardCardData, to: Status, refocus = false) {
    if (saving) return;
    if (refocus) focusAfterMoveRef.current = card.id;
    setChanges((current) => moveCard(current, card, to));
  }

  function revert(id: string) {
    if (saving) return;
    focusAfterMoveRef.current = id;
    setChanges((current) => revertChange(current, id));
  }

  function openSaveDialog() {
    if (count === 0 || count > maxBatchChanges || saving) return;
    setSaveMessage(null);
    dialogRef.current?.showModal();
  }

  async function confirmSave() {
    if (saving) return;

    const request = buildStatusBatchRequest(changes);
    if (request.changes.length === 0) return;

    savingRef.current = true;
    setSaving(true);
    setSaveMessage(null);
    setDroppedNotice([]);

    let outcome: StatusBatchOutcome;
    try {
      const response = await fetch("/api/fragments/status-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const body: unknown = await response.json().catch(() => null);
      outcome = interpretStatusBatchResponse(response.status, body);
    } catch {
      outcome = { kind: "error", message: "儲存失敗，請檢查網路連線後再試。" };
    }

    savingRef.current = false;
    setSaving(false);
    dialogRef.current?.close();

    switch (outcome.kind) {
      case "ok":
        clearDraft(scope);
        setSettled(changes);
        setSavedCount(count);
        setChanges(noChanges);
        setEditing(false);
        refreshData();
        return;
      case "conflict": {
        if (outcome.ids.length === 0) {
          // The server could not pin down which items conflicted; keep
          // every change so the user can simply try again.
          setSaveMessage({
            title: "儲存衝突，沒有寫入任何變更。變更仍保留，請再試一次。",
          });
          refreshData();
          return;
        }
        setSaveMessage({
          title: "以下項目已在別處更新，已移除這些變更；其他變更仍保留，請確認後再儲存：",
          items: outcome.ids.map((id) => describeId(id, changes)),
        });
        setChanges((current) =>
          outcome.ids.reduce((next, id) => revertChange(next, id), current),
        );
        refreshData();
        return;
      }
      case "missing":
        setSaveMessage({
          title: "找不到以下項目，沒有寫入任何變更：",
          items: outcome.ids.map((id) => describeId(id, changes)),
        });
        return;
      case "invalid":
        setSaveMessage({
          title: "以下項目無法更新，沒有寫入任何變更：",
          // Server validation details are English; show a zh-TW hint instead.
          items: outcome.items.map(
            (item) =>
              `${describeId(item.id, changes)}：資料驗證未通過，請到編輯頁檢查這筆 Fragment。`,
          ),
        });
        return;
      case "unauthorized":
        setSaveMessage({
          title: "登入已過期，沒有寫入任何變更。請重新登入後再試。",
          login: true,
        });
        return;
      case "error":
        setSaveMessage({
          title: `${outcome.message}沒有寫入任何變更，變更仍保留。`,
        });
        return;
    }
  }

  const zones = groupEditZones(cards, shownChanges);

  return (
    <>
      <section className="boardHeader">
        <h1>看板</h1>

        <div className="boardControls">
          {editing ? null : viewTabs}
          {scopeTabs}
          {editing ? null : (
            <button
              id="board-edit-button"
              className="secondaryButton boardEditButton"
              type="button"
              onClick={enterEditMode}
              disabled={!remoteConfigured || refreshing}
              title={
                !remoteConfigured
                  ? "GitHub Remote Store 尚未設定"
                  : refreshing
                    ? "正在載入最新資料…"
                    : undefined
              }
            >
              調整狀態
            </button>
          )}
        </div>
      </section>

      {!editing && savedCount > 0 ? (
        <p
          ref={savedRef}
          className="boardSavedNotice"
          role="status"
          tabIndex={-1}
        >
          已儲存 {savedCount} 項狀態變更。{refreshing ? "正在載入最新資料…" : ""}
        </p>
      ) : null}

      {!editing && restorable ? (
        <div className="notice boardNotice boardRestoreNotice" role="status">
          <strong>
            有 {listPendingChanges(restorable.changes).length}{" "}
            項上次尚未儲存的狀態變更。
          </strong>
          {restorable.dropped.length > 0 ? (
            <p>
              另有 {restorable.dropped.length} 項已在別處更新，無法恢復。
            </p>
          ) : null}
          <div className="boardRestoreActions">
            <button
              className="primaryButton"
              type="button"
              onClick={restoreDraft}
              disabled={!remoteConfigured || refreshing}
            >
              恢復並繼續編輯
            </button>
            <button
              className="secondaryButton"
              type="button"
              onClick={discardDraft}
            >
              捨棄
            </button>
          </div>
        </div>
      ) : null}

      {editing ? (
        <BoardEditor
          cards={cards}
          zones={zones}
          changes={changes}
          showScope={showScope}
          saving={saving}
          onMove={move}
          notices={
            <>
              {saveMessage ? (
                <div
                  ref={noticeRef}
                  className="notice danger boardNotice"
                  role="alert"
                  tabIndex={-1}
                >
                  <strong>{saveMessage.title}</strong>
                  {saveMessage.items?.length ? (
                    <ul>
                      {saveMessage.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                  {saveMessage.login ? (
                    <p>
                      <Link className="textLink" href="/login">
                        前往登入 →
                      </Link>
                    </p>
                  ) : null}
                </div>
              ) : null}
              {droppedNotice.length > 0 ? (
                <div className="notice boardNotice" role="status">
                  <strong>以下項目已在別處更新，已移除對應的變更：</strong>
                  <ul>
                    {droppedNotice.map((change) => (
                      <li key={change.id}>
                        {change.id} {change.title}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          }
        />
      ) : view === "board" ? (
        <BoardColumns
          zones={zones}
          showScope={showScope}
          recentlyDone={recentlyDone}
          doneHref={doneHref}
        />
      ) : (
        <IncubatingList cards={zones.incubating} showScope={showScope} />
      )}

      {editing ? (
        <div className="boardEditBar" aria-busy={saving}>
          <div className="boardEditBarInner">
            <p
              className="boardEditCount"
              id="board-edit-count"
              aria-live="polite"
              tabIndex={-1}
            >
              {count} 項變更
              {count > maxBatchChanges ? (
                <span className="boardEditLimit">
                  一次最多 {maxBatchChanges} 項
                </span>
              ) : null}
            </p>

            {count > 0 ? (
              <details className="boardEditList">
                <summary>檢視變更</summary>
                <ul>
                  {pending.map((change) => (
                    <li key={change.id}>
                      <span>{describeChange(change)}</span>
                      <button
                        className="textButton"
                        type="button"
                        disabled={saving}
                        onClick={() => revert(change.id)}
                        aria-label={`復原 ${change.id} ${change.title}`}
                      >
                        復原
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            <div className="boardEditActions">
              <button
                className="secondaryButton"
                type="button"
                onClick={cancelEditMode}
                disabled={saving}
              >
                取消
              </button>
              <button
                className="primaryButton"
                type="button"
                onClick={openSaveDialog}
                disabled={saving || count === 0 || count > maxBatchChanges}
              >
                {saving ? "儲存中…" : "儲存"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <dialog
        ref={dialogRef}
        className="moveDialog boardSaveDialog"
        aria-labelledby="board-save-title"
        onKeyDown={(event) => {
          // Esc's default action is what triggers the dialog's close watcher.
          if (savingRef.current && event.key === "Escape") event.preventDefault();
        }}
        onCancel={(event) => {
          if (savingRef.current) event.preventDefault();
        }}
        onClose={() => {
          // Chromium lets a repeated Esc close a modal even after cancel was
          // prevented; never let the dialog disappear while a save is running.
          const dialog = dialogRef.current;
          if (savingRef.current && dialog && !dialog.open) {
            dialog.showModal();
            dialogStatusRef.current?.focus();
          }
        }}
      >
        <p className="moveDialogTitle" id="board-save-title">
          確認寫入以下 {count} 項狀態變更？
        </p>
        <ul className="boardSaveList">
          {pending.map((change) => (
            <li key={change.id}>{describeChange(change)}</li>
          ))}
        </ul>
        <p className="boardSaveHint">
          所有變更會在同一次提交中寫入；任何一項失敗時都不會寫入。
        </p>
        <p
          ref={dialogStatusRef}
          className="boardSaveStatus"
          role="status"
          tabIndex={-1}
        >
          {saving ? "儲存中…請稍候，完成前無法關閉。" : ""}
        </p>

        <div className="moveDialogActions">
          <button
            className="secondaryButton"
            type="button"
            onClick={() => dialogRef.current?.close()}
            disabled={saving}
          >
            返回
          </button>
          <button
            className="primaryButton"
            type="button"
            onClick={confirmSave}
            disabled={saving || count === 0}
          >
            {saving ? "儲存中…" : "確認"}
          </button>
        </div>
      </dialog>
    </>
  );
}

function moveTriggerId(cardId: string) {
  return `board-move-${cardId}`;
}

function describeChange(change: PendingChange) {
  return `${change.id} ${change.title}：${statusLabels[change.from]} → ${statusLabels[change.to]}`;
}

function describeId(id: string, changes: PendingChanges) {
  const title = changes[id]?.title;
  return title ? `${id} ${title}` : id;
}

// sessionStorage can be unavailable (private mode, blocked site data); the
// draft is a convenience, so failures are ignored.
function draftKey(scope: string) {
  return `${boardDraftStorageKey}:${scope}`;
}

function readDraft(scope: string): string | null {
  try {
    return window.sessionStorage.getItem(draftKey(scope));
  } catch {
    return null;
  }
}

function writeDraft(scope: string, value: string) {
  try {
    window.sessionStorage.setItem(draftKey(scope), value);
  } catch {
    // Ignore: unsaved changes simply won't survive leaving the page.
  }
}

function clearDraft(scope: string) {
  try {
    window.sessionStorage.removeItem(draftKey(scope));
  } catch {
    // Ignore.
  }
}

/** Warns before leaving the page (reload, close, in-app links) with unsaved changes. */
function useUnsavedChangesGuard(active: boolean, count: number) {
  useEffect(() => {
    if (!active) return;

    const message = `還有 ${count} 項變更尚未儲存。離開後，回到看板時可以選擇恢復。確定要離開嗎？`;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      // Legacy browsers need returnValue set to show the prompt.
      event.returnValue = "";
    }

    // Capture phase runs before Next.js <Link> handlers on the React root.
    function handleClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      const anchor =
        target instanceof Element ? target.closest("a[href]") : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      ) {
        return;
      }

      // A link to the page we're already on (e.g. the active scope tab)
      // doesn't leave, so there is nothing to warn about.
      const url = new URL(anchor.href, window.location.href);
      if (
        url.origin === window.location.origin &&
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      ) {
        return;
      }

      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleClick, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleClick, true);
    };
  }, [active, count]);
}

function BoardColumns({
  zones,
  showScope,
  recentlyDone,
  doneHref,
}: {
  zones: Record<EditZone, BoardCardData[]>;
  showScope: boolean;
  recentlyDone: number;
  doneHref: string;
}) {
  return (
    <>
      <div className="boardGrid">
        {boardColumns.map((status) => {
          const cards = zones[status];
          const headingId = `board-column-${status}`;

          return (
            <section
              className="boardColumn"
              key={status}
              aria-labelledby={headingId}
            >
              <ZoneHeader status={status} count={cards.length} headingId={headingId} />

              {cards.length === 0 ? (
                <p className="boardEmpty">目前沒有項目</p>
              ) : (
                <div className="boardCards">
                  {cards.map((card) => (
                    <BoardCard key={card.id} card={card} showScope={showScope} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <p className="boardFooter">
        <Link className="textLink" href={doneHref}>
          近 7 天完成 {recentlyDone} 件 →
        </Link>
      </p>
    </>
  );
}

function IncubatingList({
  cards,
  showScope,
}: {
  cards: BoardCardData[];
  showScope: boolean;
}) {
  const items = listIncubating(cards.map((card) => ({ ...card, status: "incubating" as const })));

  return (
    <section className="incubatingList" aria-label={statusLabels.incubating}>
      {items.length === 0 ? (
        <p className="boardEmpty">
          目前沒有醞釀中的想法。還沒準備好開始的想法可以先放在這裡。
        </p>
      ) : (
        items.map((card) => (
          <BoardCard key={card.id} card={card} showScope={showScope} />
        ))
      )}
    </section>
  );
}

function ZoneHeader({
  status,
  count,
  headingId,
}: {
  status: EditZone;
  count: number;
  headingId: string;
}) {
  return (
    <header className="boardColumnHeader">
      <h2 id={headingId}>
        {statusLabels[status]}
        <span className="boardCount">{count}</span>
      </h2>
      {status === "active" && count > activeSoftLimit ? (
        <p className="boardHint">超過 {activeSoftLimit} 件，考慮先收尾</p>
      ) : null}
    </header>
  );
}

/* ---------- Edit mode ---------- */

const zoneEmptyText: Record<EditZone, string> = {
  incubating: "拖曳卡片到這裡放回醞釀中",
  inbox: "拖曳卡片到這裡",
  active: "拖曳卡片到這裡",
  waiting: "拖曳卡片到這裡",
  done: "拖曳卡片到這裡標記完成",
};

// Pointer first (drop where the pointer is); keyboard has no pointer, so fall
// back to the zone the dragged card overlaps most.
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

// Arrow keys jump between whole drop zones instead of moving a few pixels.
const zoneKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { active, context },
) => {
  const forward = event.code === "ArrowRight" || event.code === "ArrowDown";
  const backward = event.code === "ArrowLeft" || event.code === "ArrowUp";
  if (!forward && !backward) return undefined;

  event.preventDefault();

  const { collisionRect, droppableRects, over } = context;
  if (!collisionRect) return undefined;

  const startZone =
    over && isEditZone(over.id)
      ? over.id
      : (context.active?.data.current?.zone as EditZone | undefined);
  const index = startZone ? editZones.indexOf(startZone) : -1;
  if (index < 0 || !active) return undefined;

  const step = forward ? 1 : -1;
  for (
    let next = index + step;
    next >= 0 && next < editZones.length;
    next += step
  ) {
    const rect = droppableRects.get(editZones[next]);
    if (!rect) continue;

    return {
      x: rect.left + Math.max(0, (rect.width - collisionRect.width) / 2),
      y: rect.top + 8,
    };
  }

  return undefined;
};

function BoardEditor({
  cards,
  zones,
  changes,
  showScope,
  saving,
  onMove,
  notices,
}: {
  cards: BoardCardData[];
  zones: Record<EditZone, BoardCardData[]>;
  changes: PendingChanges;
  showScope: boolean;
  saving: boolean;
  onMove: (card: BoardCardData, to: Status, refocus?: boolean) => void;
  notices: ReactNode;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const cardsById = useMemo(
    () => new Map(cards.map((card) => [card.id, card])),
    [cards],
  );

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // A short press-and-hold keeps normal page scrolling on touch screens.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: zoneKeyboardCoordinates }),
  );

  const titleOf = (id: string | number) =>
    cardsById.get(String(id))?.title ?? String(id);
  const zoneLabel = (id: string | number | undefined) =>
    id !== undefined && isEditZone(id) ? statusLabels[id] : "";

  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `已拿起「${titleOf(active.id)}」，目前在${zoneLabel(active.data.current?.zone)}。`,
    onDragOver: ({ active, over }) =>
      over
        ? `「${titleOf(active.id)}」移到${zoneLabel(over.id)}上方。`
        : `「${titleOf(active.id)}」目前不在任何狀態區上。`,
    onDragEnd: ({ active, over }) =>
      over
        ? `已把「${titleOf(active.id)}」放到${zoneLabel(over.id)}，尚未儲存。`
        : `已放下「${titleOf(active.id)}」，狀態沒有變更。`,
    onDragCancel: ({ active }) =>
      `已取消拖曳，「${titleOf(active.id)}」維持原狀態。`,
  };

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const card = cardsById.get(String(event.active.id));
    const target = event.over?.id;
    if (!card || target === undefined || !isEditZone(target)) return;
    if (effectiveStatus(card, changes) === target) return;
    onMove(card, target);
  }

  const activeCard = activeId ? cardsById.get(activeId) : undefined;

  const renderZone = (zone: EditZone, variant: "tray" | "column") => (
    <EditDropZone
      key={zone}
      zone={zone}
      variant={variant}
      count={zones[zone].length}
      disabled={saving}
    >
      {zones[zone].map((card) => (
        <EditableCard
          key={card.id}
          card={card}
          zone={zone}
          change={changes[card.id]}
          showScope={showScope}
          disabled={saving}
          onMove={(to) => onMove(card, to, true)}
        />
      ))}
    </EditDropZone>
  );

  return (
    <div className="boardEditor">
      <p className="boardEditIntro">
        拖曳卡片，或用「移到 ▸」改變狀態。按「儲存」並確認後，才會一次寫入。
      </p>

      {notices}

      <DndContext
        id="board-edit"
        sensors={sensors}
        collisionDetection={collisionDetection}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              "按空白鍵或 Enter 拿起卡片，用方向鍵在狀態區之間移動，再按空白鍵或 Enter 放下；按 Esc 取消。",
          },
        }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        {renderZone("incubating", "tray")}
        <div className="boardGrid">
          {boardColumns.map((zone) => renderZone(zone, "column"))}
        </div>
        {renderZone("done", "tray")}

        <DragOverlay dropAnimation={null}>
          {activeCard ? (
            <div className="boardCard boardCardOverlay" aria-hidden="true">
              <h3>{activeCard.title}</h3>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function EditDropZone({
  zone,
  variant,
  count,
  disabled,
  children,
}: {
  zone: EditZone;
  variant: "tray" | "column";
  count: number;
  disabled: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver, active } = useDroppable({ id: zone, disabled });
  const headingId = `board-edit-zone-${zone}`;
  const className = [
    "boardColumn",
    "boardDropZone",
    variant === "tray" ? "boardTray" : "",
    active ? "boardDropReady" : "",
    isOver ? "boardDropOver" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section ref={setNodeRef} className={className} aria-labelledby={headingId}>
      <ZoneHeader status={zone} count={count} headingId={headingId} />
      {count === 0 ? (
        <p className="boardEmpty boardDropHint">{zoneEmptyText[zone]}</p>
      ) : (
        <div className="boardCards">{children}</div>
      )}
    </section>
  );
}

type Listener = (event: SyntheticEvent) => void;

function EditableCard({
  card,
  zone,
  change,
  showScope,
  disabled,
  onMove,
}: {
  card: BoardCardData;
  zone: EditZone;
  change: PendingChange | undefined;
  showScope: boolean;
  disabled: boolean;
  onMove: (to: Status) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    isDragging,
  } = useDraggable({ id: card.id, data: { zone }, disabled });

  // Mouse/touch start a drag anywhere on the card; the keyboard sensor is
  // bound to the handle button so the card itself is not a nested control.
  const { onKeyDown, ...pointerListeners } = (listeners ?? {}) as Record<
    string,
    Listener
  >;

  const className = [
    "boardCard",
    "boardCardEditable",
    change ? "boardCardChanged" : "",
    isDragging ? "boardCardDragging" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article ref={setNodeRef} className={className} {...pointerListeners}>
      <div className="boardCardTitleRow">
        <button
          ref={setActivatorNodeRef}
          className="dragHandle"
          type="button"
          {...attributes}
          aria-roledescription="可拖曳的卡片"
          aria-label={`拖曳「${card.title}」，目前在${statusLabels[zone]}`}
          onKeyDown={onKeyDown}
        >
          <span aria-hidden="true">⠿</span>
        </button>
        <h3>{card.title}</h3>
      </div>

      {change ? (
        <p className="boardChangeBadge">
          <span className="visuallyHidden">已變更：</span>
          {statusLabels[change.from]} → {statusLabels[change.to]}
        </p>
      ) : null}

      <BoardCardDetails
        card={card}
        showScope={showScope}
        actions={
          <BoardMoveMenu
            triggerId={moveTriggerId(card.id)}
            title={card.title}
            status={zone}
            disabled={disabled}
            onMove={onMove}
          />
        }
      />
    </article>
  );
}
