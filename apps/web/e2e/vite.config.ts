import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const localFile = (relative: string) =>
  fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  root: localFile("./fixture"),
  plugins: [react()],
  resolve: {
    alias: {
      "@clerk/nextjs": localFile("./fixture/auth.tsx"),
      "next/navigation": localFile("./fixture/navigation.tsx"),
      "next/link": localFile("./fixture/navigation.tsx"),
      "@": localFile("../src"),
    },
    dedupe: ["react", "react-dom", "convex"],
  },
  define: {
    "process.env.NEXT_PUBLIC_CONVEX_URL": JSON.stringify(
      "http://127.0.0.1:3218",
    ),
    "process.env.NEXT_PUBLIC_QUERY_CACHE_RETENTION_SECONDS":
      JSON.stringify("0"),
  },
  server: { host: "127.0.0.1", port: 4173, strictPort: true },
});
