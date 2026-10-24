import type { Config } from "tailwindcss";

// Design tokens live in src/app/globals.css as CSS variables so the brand
// (colours, radius) can be changed without touching components.
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        subtle: "rgb(var(--subtle) / <alpha-value>)",
        primary: { DEFAULT: "rgb(var(--primary) / <alpha-value>)", fg: "rgb(var(--primary-fg) / <alpha-value>)", soft: "rgb(var(--primary-soft) / <alpha-value>)" },
        success: { DEFAULT: "rgb(var(--success) / <alpha-value>)", soft: "rgb(var(--success-soft) / <alpha-value>)" },
        warning: { DEFAULT: "rgb(var(--warning) / <alpha-value>)", soft: "rgb(var(--warning-soft) / <alpha-value>)" },
        danger: { DEFAULT: "rgb(var(--danger) / <alpha-value>)", soft: "rgb(var(--danger-soft) / <alpha-value>)" },
        accent: { DEFAULT: "rgb(var(--accent) / <alpha-value>)", soft: "rgb(var(--accent-soft) / <alpha-value>)" },
      },
      borderRadius: { DEFAULT: "var(--radius)", lg: "calc(var(--radius) + 4px)", xl: "calc(var(--radius) + 8px)" },
      fontFamily: {
        sans: ["var(--font-sans)"],
        display: ["var(--font-display)"],
      },
      boxShadow: { card: "0 1px 2px rgb(15 23 42 / 0.04), 0 1px 1px rgb(15 23 42 / 0.03)", pop: "0 10px 30px -10px rgb(15 23 42 / 0.25)" },
    },
  },
  plugins: [],
} satisfies Config;
