import { z } from "zod";

export const fragmentIdSchema = z.string().regex(/^F-\d{6}$/);
export const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

// Tags support Unicode letters and digits; domain IDs remain ASCII-only.
export const tagSchema = z
  .string()
  .regex(/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u);

export const scopeSchema = z.enum(["work", "personal"]);

export const fragmentTypeSchema = z.enum([
  "idea",
  "task",
  "learning",
  "requirement",
  "project",
  "question",
  "decision",
  "tracking",
  "resource",
  "note",
]);

export const fragmentStatusSchema = z.enum([
  "incubating",
  "inbox",
  "active",
  "waiting",
  "done",
  "archived",
]);

export const levelSchema = z.enum(["high", "medium", "low", "none"]);

export const interviewItemSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});

export const fragmentSchema = z
  .object({
    schema_version: z.literal("0.1"),
    id: fragmentIdSchema,
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
    scope: scopeSchema,
    type: fragmentTypeSchema,
    status: fragmentStatusSchema,
    priority: levelSchema,
    urgency: levelSchema,
    domains: z.array(slugSchema).max(5),
    tags: z.array(tagSchema).max(12),
    project: fragmentIdSchema.nullable(),
    related: z.array(fragmentIdSchema),
    title: z.string().min(1).max(120),
    summary: z.string().max(2000),
    next_action: z.string().max(2000).nullable(),
    original_input: z.string().min(1),
    notes: z.string().nullable(),
    interview: z.array(interviewItemSchema),
    source: z.object({
      channel: z.enum(["chatgpt", "web"]),
    }),
    ai: z.object({
      classification_confirmed: z.literal(true),
      interview_used: z.boolean(),
    }),
  })
  .superRefine((fragment, ctx) => {
    if (fragment.project === fragment.id) {
      ctx.addIssue({
        code: "custom",
        path: ["project"],
        message: "project cannot reference the Fragment itself",
      });
    }

    if (fragment.related.includes(fragment.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["related"],
        message: "related cannot contain the Fragment itself",
      });
    }

    if (new Set(fragment.related).size !== fragment.related.length) {
      ctx.addIssue({
        code: "custom",
        path: ["related"],
        message: "related cannot contain duplicate IDs",
      });
    }

    if (new Set(fragment.domains).size !== fragment.domains.length) {
      ctx.addIssue({
        code: "custom",
        path: ["domains"],
        message: "domains cannot contain duplicate values",
      });
    }

    if (new Set(fragment.tags).size !== fragment.tags.length) {
      ctx.addIssue({
        code: "custom",
        path: ["tags"],
        message: "tags cannot contain duplicate values",
      });
    }

    if (fragment.ai.interview_used !== (fragment.interview.length > 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["ai", "interview_used"],
        message: "interview_used must match whether interview contains answers",
      });
    }

    if (
      new Date(fragment.created_at).getTime() >
      new Date(fragment.updated_at).getTime()
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["updated_at"],
        message: "updated_at cannot be earlier than created_at",
      });
    }
  });

export type Fragment = z.infer<typeof fragmentSchema>;
