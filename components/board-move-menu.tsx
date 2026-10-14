"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { Fragment } from "@/lib/fragment-schema";
import { movableStatuses } from "@/lib/fragments/board";
import { statusLabels } from "@/lib/fragments/presentation";

type Status = Fragment["status"];

type BoardMoveMenuProps = {
  /** DOM id of the trigger, so the board can refocus it after a move. */
  triggerId: string;
  title: string;
  /** The card's current (possibly locally changed) status. */
  status: Status;
  disabled: boolean;
  onMove: (status: Status) => void;
};

/**
 * Keyboard/touch fallback for drag and drop in edit mode, built as a
 * disclosure (button + list of buttons), not an ARIA menu. Choosing an option
 * only changes local state; nothing is written until the batch is saved.
 * The board moves focus after a move, because the card re-renders elsewhere.
 */
export function BoardMoveMenu({
  triggerId,
  title,
  status,
  disabled,
  onMove,
}: BoardMoveMenuProps) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const options = movableStatuses.filter((value) => value !== status);

  useEffect(() => {
    if (!open) return;

    function handlePointer(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointer);
    return () => document.removeEventListener("pointerdown", handlePointer);
  }, [open]);

  function choose(next: Status) {
    setOpen(false);
    onMove(next);
  }

  // Keep pointer/touch/key events away from the card's drag listeners.
  const stop = (event: { stopPropagation: () => void }) =>
    event.stopPropagation();

  return (
    <div
      className="moveMenu"
      ref={wrapperRef}
      onMouseDown={stop}
      onTouchStart={stop}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && open) {
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        id={triggerId}
        className="moveTrigger"
        type="button"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`移動「${title}」的狀態`}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        移到 ▸
      </button>

      {open ? (
        <ul className="moveOptions" id={menuId}>
          {options.map((value) => (
            <li key={value}>
              <button type="button" onClick={() => choose(value)}>
                {statusLabels[value]}
              </button>
            </li>
          ))}
          {status !== "archived" ? (
            <li className="moveOptionArchive">
              <button type="button" onClick={() => choose("archived")}>
                封存
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
