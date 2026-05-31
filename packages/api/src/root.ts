import { router } from "./trpc";
import { accountsRouter } from "./routers/accounts";
import { authRouter } from "./routers/auth";
import { importsRouter } from "./routers/imports";
import { portfolioRouter } from "./routers/portfolio";

export const appRouter = router({
  auth: authRouter,
  accounts: accountsRouter,
  imports: importsRouter,
  portfolio: portfolioRouter,
});

export type AppRouter = typeof appRouter;
