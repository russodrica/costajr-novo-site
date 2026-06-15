import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel";

export default defineConfig({
  site: "https://costajr.com.br",
  output: "server",
  adapter: vercel({
    webAnalytics: { enabled: true },
    maxDuration: 60 // relatório de localização busca AFD mobile + mapas + PDF
  }),
  server: { port: 4321 },
  vite: {
    define: {
      "import.meta.env.PUBLIC_BUILD_TIME": JSON.stringify(new Date().toISOString())
    }
  }
});
