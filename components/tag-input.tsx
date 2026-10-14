"use client";

import { useId, useRef, useState } from "react";

import { normalizeTag, normalizeTags } from "@/lib/fragments/tags";

type TagInputProps = {
  name: string;
  label: string;
  defaultValue: readonly string[];
  suggestions: readonly string[];
  onChange?: (tags: string[]) => void;
};

const maxSuggestions = 8;

// ASCII comma, full-width comma and ideographic enumeration comma.
const separators = /[,，、]/;

export function TagInput({
  name,
  label,
  defaultValue,
  suggestions,
  onChange,
}: TagInputProps) {
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-list`;
  const hintId = `${baseId}-hint`;
  const inputRef = useRef<HTMLInputElement>(null);

  const [tags, setTags] = useState<string[]>(() => normalizeTags(defaultValue));
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [listOpen, setListOpen] = useState(true);
  const [activeIndex, setActiveIndex] = useState(-1);

  const needle = normalizeTag(text);
  const matches = suggestions
    .filter((tag) => !tags.includes(tag) && tag.includes(needle))
    .slice(0, maxSuggestions);
  const expanded = focused && listOpen && matches.length > 0;
  const activeMatch = expanded && activeIndex >= 0 ? matches[activeIndex] : null;

  function updateTags(next: string[]) {
    setTags(next);
    onChange?.(next);
  }

  function commit(raw: string) {
    setText("");
    setActiveIndex(-1);

    const additions = normalizeTags(raw.split(separators)).filter(
      (tag) => !tags.includes(tag),
    );
    if (additions.length === 0) return;

    updateTags([...tags, ...additions]);
  }

  function remove(tag: string) {
    updateTags(tags.filter((item) => item !== tag));
  }

  function moveActive(step: 1 | -1) {
    setListOpen(true);
    if (matches.length === 0) return;
    setActiveIndex((current) => {
      if (current < 0) return step === 1 ? 0 : matches.length - 1;
      return (current + step + matches.length) % matches.length;
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    // Keys pressed while an IME is composing belong to the IME.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;

    switch (event.key) {
      case "Enter":
        if (activeMatch) {
          event.preventDefault();
          commit(activeMatch);
        } else if (text.trim()) {
          event.preventDefault();
          commit(text);
        }
        break;
      case ",":
      case "，":
      case "、":
        event.preventDefault();
        commit(text);
        break;
      case "Tab":
        // Commit and let focus move on as usual.
        if (activeMatch) commit(activeMatch);
        else if (text.trim()) commit(text);
        break;
      case "Backspace":
        if (!text && tags.length > 0) {
          event.preventDefault();
          remove(tags[tags.length - 1]);
        }
        break;
      case "ArrowDown":
        event.preventDefault();
        moveActive(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveActive(-1);
        break;
      case "Escape":
        if (expanded) {
          event.preventDefault();
          setListOpen(false);
          setActiveIndex(-1);
        }
        break;
    }
  }

  // Commits everything before the last separator; keeps the rest as text.
  // Handles typed full-width separators and pasted lists.
  function splitPending(value: string) {
    const parts = value.split(separators);
    if (parts.length === 1) {
      setText(value);
      return;
    }

    const rest = parts.pop() ?? "";
    commit(parts.join(","));
    setText(rest);
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setListOpen(true);
    setActiveIndex(-1);

    if ((event.nativeEvent as InputEvent).isComposing) {
      setText(value);
      return;
    }

    splitPending(value);
  }

  return (
    <div className="wideField tagField">
      <label className="fieldLabel" htmlFor={inputId}>
        {label}
      </label>

      <div className="tagCombobox">
        <div
          className="tagInput"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              inputRef.current?.focus();
            }
          }}
        >
          {tags.map((tag) => (
            <span className="tagToken" key={tag}>
              #{tag}
              <button
                type="button"
                aria-label={`移除標籤 ${tag}`}
                onClick={() => {
                  remove(tag);
                  inputRef.current?.focus();
                }}
              >
                ×
              </button>
              <input type="hidden" name={name} value={tag} />
            </span>
          ))}

          <input
            ref={inputRef}
            id={inputId}
            className="tagTextInput"
            type="text"
            role="combobox"
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-activedescendant={
              activeMatch ? `${listId}-${activeIndex}` : undefined
            }
            aria-describedby={hintId}
            value={text}
            placeholder={tags.length === 0 ? "例如 文件撰寫、ocr" : ""}
            onChange={handleChange}
            onCompositionEnd={(event) =>
              splitPending(event.currentTarget.value)
            }
            onKeyDown={handleKeyDown}
            onFocus={() => {
              setFocused(true);
              setListOpen(true);
            }}
            onBlur={() => {
              setFocused(false);
              setActiveIndex(-1);
              commit(text);
            }}
          />
        </div>

        <ul
          className="tagSuggestions"
          id={listId}
          role="listbox"
          aria-label={`${label}建議`}
          hidden={!expanded}
        >
          {expanded
            ? matches.map((tag, index) => (
                <li
                  id={`${listId}-${index}`}
                  key={tag}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={index === activeIndex ? "active" : undefined}
                  onMouseDown={(event) => {
                    // Keep focus in the input so blur does not commit raw text.
                    event.preventDefault();
                    commit(tag);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  #{tag}
                </li>
              ))
            : null}
        </ul>
      </div>

      <small id={hintId}>
        按 Enter、逗號或 Tab 加入；Backspace 移除最後一個。支援中文；英文轉小寫、空白轉連字號。
      </small>
    </div>
  );
}
