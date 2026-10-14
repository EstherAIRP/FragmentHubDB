"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  domainLabel,
  domainOptions,
  fieldLabels,
  levelLabels,
  scopeLabels,
  statusLabels,
  typeLabels,
} from "@/lib/fragments/presentation";

const filterKeys = [
  "q",
  "scope",
  "type",
  "status",
  "priority",
  "urgency",
  "domain",
  "tag",
] as const;

type FilterKey = (typeof filterKeys)[number];

const advancedKeys = ["type", "priority", "urgency", "domain", "tag"] as const;

const filterNames: Record<FilterKey, string> = {
  q: "搜尋",
  scope: fieldLabels.scope,
  type: fieldLabels.type,
  status: fieldLabels.status,
  priority: fieldLabels.priority,
  urgency: fieldLabels.urgency,
  domain: fieldLabels.domains,
  tag: fieldLabels.tags,
};

function lookup(labels: Record<string, string>, value: string) {
  return labels[value] ?? value;
}

function valueLabel(key: FilterKey, value: string) {
  switch (key) {
    case "q":
      return `「${value}」`;
    case "scope":
      return lookup(scopeLabels, value);
    case "type":
      return lookup(typeLabels, value);
    case "status":
      return lookup(statusLabels, value);
    case "priority":
    case "urgency":
      return lookup(levelLabels, value);
    case "domain":
      return domainLabel(value);
    case "tag":
      return `#${value}`;
  }
}

const debounceMs = 300;

type TextFilters = { q: string; tag: string };

function textFrom(params: URLSearchParams): TextFilters {
  return { q: params.get("q") ?? "", tag: params.get("tag") ?? "" };
}

export function FragmentFilters({ tags }: { tags: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const urlQuery = useSearchParams().toString();
  const [pending, startTransition] = useTransition();

  // Single source of truth for the query we have asked the router for.
  // It is updated synchronously on every apply, so successive updates
  // compose correctly even while a navigation is still in flight and
  // useSearchParams() reports the previous URL.
  const desiredRef = useRef(urlQuery);
  const [desired, setDesired] = useState(urlQuery);

  // Search/tag text: state for rendering, ref for the debounce timer.
  const [text, setTextState] = useState(() =>
    textFrom(new URLSearchParams(urlQuery)),
  );
  const textRef = useRef(text);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function setText(next: TextFilters) {
    textRef.current = next;
    setTextState(next);
  }

  function cancelTimer() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function apply(changes: Partial<Record<FilterKey, string>>) {
    const params = new URLSearchParams(desiredRef.current);

    for (const [key, value] of Object.entries(changes)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }

    const query = params.toString();
    if (query === desiredRef.current) return;

    desiredRef.current = query;
    setDesired(query);
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    });
  }

  // Applies both text filters in one replace, reading the latest values.
  function applyText() {
    cancelTimer();
    apply({
      q: textRef.current.q.trim(),
      tag: textRef.current.tag.trim(),
    });
  }

  function changeText(key: keyof TextFilters, value: string) {
    setText({ ...textRef.current, [key]: value });
    cancelTimer();
    timerRef.current = setTimeout(applyText, debounceMs);
  }

  // Clears the given keys and sends any pending (debounced) text in the same
  // replace, so removing a chip never drops what the user has typed.
  function clear(keys: readonly FilterKey[]) {
    cancelTimer();
    const next = {
      q: keys.includes("q") ? "" : textRef.current.q,
      tag: keys.includes("tag") ? "" : textRef.current.tag,
    };
    setText(next);
    apply({
      ...Object.fromEntries(keys.map((key) => [key, ""])),
      q: next.q.trim(),
      tag: next.tag.trim(),
    });
  }

  // Adopt URL changes we did not initiate (back/forward, links). While our
  // own navigation is pending the URL lags behind, so it is ignored.
  useEffect(() => {
    if (pending || urlQuery === desiredRef.current) return;

    cancelTimer();
    desiredRef.current = urlQuery;
    setDesired(urlQuery);
    setText(textFrom(new URLSearchParams(urlQuery)));
  }, [urlQuery, pending]);

  useEffect(() => cancelTimer, []);

  const desiredParams = new URLSearchParams(desired);
  const current = (key: FilterKey) => desiredParams.get(key) ?? "";

  const active = filterKeys
    .map((key) => ({ key, value: current(key) }))
    .filter((item) => item.value);
  const advancedCount = active.filter((item) =>
    (advancedKeys as readonly string[]).includes(item.key),
  ).length;

  const [advancedOpen, setAdvancedOpen] = useState(advancedCount > 0);

  useEffect(() => {
    if (advancedCount > 0) setAdvancedOpen(true);
  }, [advancedCount]);

  const scope = current("scope");

  return (
    <section
      className="panel filterPanel"
      aria-label="篩選 Fragment"
      aria-busy={pending}
    >
      <form
        className="filterBar"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          applyText();
        }}
      >
        <div className="filterPrimary">
          <label className="searchField">
            <span>搜尋</span>
            <input
              type="search"
              name="q"
              value={text.q}
              onChange={(event) => changeText("q", event.target.value)}
              placeholder="ID、標題、摘要、下一步、備註、領域、標籤"
              enterKeyHint="search"
            />
          </label>

          <div className="filterField">
            <span id="scope-filter-label">{fieldLabels.scope}</span>
            <div
              className="segmented"
              role="group"
              aria-labelledby="scope-filter-label"
            >
              {[["", "全部"] as const, ...Object.entries(scopeLabels)].map(
                ([value, label]) => (
                  <button
                    type="button"
                    key={value || "all"}
                    aria-pressed={scope === value}
                    onClick={() => apply({ scope: value })}
                  >
                    {label}
                  </button>
                ),
              )}
            </div>
          </div>

          <label>
            <span>{fieldLabels.status}</span>
            <select
              name="status"
              value={current("status")}
              onChange={(event) => apply({ status: event.target.value })}
            >
              <option value="">全部</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <details
          className="filterMore"
          open={advancedOpen}
          onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        >
          <summary>
            更多篩選
            {advancedCount > 0 ? (
              <span className="filterCount">{advancedCount}</span>
            ) : null}
          </summary>

          <div className="filterAdvanced">
            <label>
              <span>{fieldLabels.type}</span>
              <select
                name="type"
                value={current("type")}
                onChange={(event) => apply({ type: event.target.value })}
              >
                <option value="">全部</option>
                {Object.entries(typeLabels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>{fieldLabels.priority}</span>
              <select
                name="priority"
                value={current("priority")}
                onChange={(event) => apply({ priority: event.target.value })}
              >
                <option value="">全部</option>
                {Object.entries(levelLabels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>{fieldLabels.urgency}</span>
              <select
                name="urgency"
                value={current("urgency")}
                onChange={(event) => apply({ urgency: event.target.value })}
              >
                <option value="">全部</option>
                {Object.entries(levelLabels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>{fieldLabels.domains}</span>
              <select
                name="domain"
                value={current("domain")}
                onChange={(event) => apply({ domain: event.target.value })}
              >
                <option value="">全部</option>
                {domainOptions.map((domain) => (
                  <option value={domain.id} key={domain.id}>
                    {domain.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>{fieldLabels.tags}</span>
              <input
                name="tag"
                value={text.tag}
                onChange={(event) => changeText("tag", event.target.value)}
                onBlur={applyText}
                list="fragment-tags"
                placeholder="例如 文件交付、ocr"
                autoComplete="off"
              />
              <datalist id="fragment-tags">
                {tags.map((item) => (
                  <option value={item} key={item} />
                ))}
              </datalist>
            </label>
          </div>
        </details>
      </form>

      {active.length > 0 ? (
        <div className="activeFilters" aria-label="目前篩選條件">
          {active.map(({ key, value }) => (
            <button
              type="button"
              className="filterChip"
              key={key}
              onClick={() => clear([key])}
              aria-label={`移除篩選 ${filterNames[key]}：${valueLabel(key, value)}`}
            >
              {filterNames[key]}：{valueLabel(key, value)}
              <span aria-hidden="true">×</span>
            </button>
          ))}
          <button
            type="button"
            className="textButton"
            onClick={() => clear(filterKeys)}
          >
            清除全部
          </button>
        </div>
      ) : null}
    </section>
  );
}
