"use node";

import { randomBytes } from "node:crypto";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { digest } from "../model/importLimits";

export const create = action({
  args: { email: v.string() },
  returns: v.object({ token: v.string() }),
  handler: async (ctx, args) => {
    const token = randomBytes(32).toString("hex");
    await ctx.runMutation(internal.households.issueInvite, {
      email: args.email,
      tokenHash: digest(token),
    });

    return { token };
  },
});
