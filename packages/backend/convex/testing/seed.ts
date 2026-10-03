import { internalMutation } from "../_generated/server";
import { ensureUserProvisioned } from "../model/users";

export const fakeDevelopmentData = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (
      process.env.APP_ENV !== "development" &&
      process.env.APP_ENV !== "test"
    ) {
      throw new Error("Fake seed is disabled outside development and test");
    }

    const userId = await ensureUserProvisioned(ctx, {
      clerkSubject: "user_fake_development_owner",
      email: "fake-owner@example.invalid",
    });

    return { userId };
  },
});
