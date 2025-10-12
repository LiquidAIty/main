import { z } from "zod";

export const MarketDataSchema = z.object({
  op: z.enum(["bars", "quote"]),
  symbol: z.string(),
  timeframe: z.string().default("1D"),
  limit: z.number().default(200),
});

type MarketDataInput = z.infer<typeof MarketDataSchema>;

type MarketDataResult = {
  ok: boolean;
  data: unknown;
  error: string | null;
};

export const marketDataTool = {
  name: "marketdata",
  run: async (raw: unknown): Promise<MarketDataResult> => {
    const params: MarketDataInput = MarketDataSchema.parse(raw);
    return {
      ok: true,
      data: {
        stub: true,
        op: params.op,
        symbol: params.symbol,
        timeframe: params.timeframe,
        limit: params.limit,
      },
      error: null,
    };
  },
};
