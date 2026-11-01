import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(240 4% 90%)",
        background: "hsl(0 0% 100%)",
        foreground: "hsl(240 3% 12%)",
        muted: "hsl(240 5% 96%)",
        "muted-foreground": "hsl(240 3% 40%)",
        primary: "hsl(210 100% 40%)",
        "primary-foreground": "hsl(0 0% 100%)"
      }
    }
  },
  plugins: []
} satisfies Config;
