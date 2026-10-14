import domainsConfig from "@/config/domains.json";
import type { Fragment } from "@/lib/fragment-schema";

export const scopeLabels = {
  personal: "個人",
  work: "工作",
} as const;

export const typeLabels = {
  idea: "靈感",
  task: "待辦",
  learning: "學習",
  requirement: "需求",
  project: "專案",
  question: "問題",
  decision: "決策",
  tracking: "追蹤",
  resource: "資源",
  note: "紀錄",
} as const;

export const statusLabels = {
  incubating: "醞釀中",
  inbox: "待處理",
  active: "進行中",
  waiting: "卡住",
  done: "完成",
  archived: "已封存",
} as const;

export const levelLabels = {
  high: "高",
  medium: "中",
  low: "低",
  none: "無",
} as const;

export const sourceChannelLabels = {
  chatgpt: "ChatGPT",
  web: "Web 手動",
} as const;

export const fieldLabels = {
  scope: "範圍",
  type: "類型",
  status: "狀態",
  priority: "優先度",
  urgency: "急迫度",
  domains: "領域",
  tags: "標籤",
  title: "標題",
  summary: "摘要",
  next_action: "下一步",
  original_input: "原始輸入",
  notes: "備註",
  project: "所屬專案",
  related: "相關",
  created_at: "建立時間",
  updated_at: "更新時間",
  source: "來源",
  interview: "提問紀錄",
} as const;

export function fieldLabel(path: string) {
  return fieldLabels[path as keyof typeof fieldLabels] ?? path;
}

/**
 * Status chip tone, expressed as the CSS class applied to `.statusChip`.
 */
export const statusTones = {
  incubating: "toneViolet",
  inbox: "toneBlue",
  active: "toneGreen",
  waiting: "toneAmber",
  done: "toneMuted",
  archived: "toneFaded",
} as const satisfies Record<Fragment["status"], string>;

export function isSettledStatus(status: Fragment["status"]) {
  return status === "done" || status === "archived";
}

const domainEntries: Record<string, { label: string }> = domainsConfig.domains;

export function domainLabel(id: string): string {
  return domainEntries[id]?.label ?? id;
}

export const domainOptions = Object.entries(domainEntries).map(
  ([id, value]) => ({
    id,
    label: value.label,
  }),
);

export function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}
