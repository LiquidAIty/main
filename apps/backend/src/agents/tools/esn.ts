import { z } from "zod";

export const EsnSchema = z.object({
  symbol: z.string(),
  horizon: z.number().default(20),
  features: z.array(z.string()).default(["close", "rsi", "atr"]),
  trainBars: z.number().default(500),
});

type EsnInput = z.infer<typeof EsnSchema>;

type EsnResult = {
  ok: boolean;
  data: unknown;
  error: string | null;
};

export const esnTool = {
  name: "esn",
  run: async (raw: unknown): Promise<EsnResult> => {
    const params: EsnInput = EsnSchema.parse(raw);
    return {
      ok: true,
      data: {
        symbol: params.symbol,
        horizon: params.horizon,
        score: 0.18,
        direction: "up",
      },
      error: null,
    };
  },
};
