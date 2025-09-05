import { z } from "zod";

export const StepSchema = z.object({
  id: z.string(),
  kind: z.enum(["tool", "llm", "train", "graph"]),
  name: z.string().optional(),
  input: z.record(z.any()).optional(),
  modelKey: z.string().optional(),
});

export const PlanSchema = z.object({
  goal: z.string(),
  steps: z.array(StepSchema).min(1).max(8),
});

export type Plan = z.infer<typeof PlanSchema>;
export type Step = z.infer<typeof StepSchema>;
