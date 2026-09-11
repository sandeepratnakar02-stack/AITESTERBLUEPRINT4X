import type { Config } from "tailwindcss";

/**
 * Design tokens for the VWO QA Downtime Tracker.
 * Light mode only - restrained palette, soft borders, no gradients.
 */
const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1600px" },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        canvas: "hsl(var(--canvas))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        /** Health-state palette: green = healthy, red = down, amber = degraded/retrying, blue = info */
        status: {
          healthy: {
            DEFAULT: "#16A34A",
            strong: "#15803D",
            soft: "#F0FDF4",
            border: "#BBF7D0",
          },
          down: {
            DEFAULT: "#DC2626",
            strong: "#B91C1C",
            soft: "#FEF2F2",
            border: "#FECACA",
          },
          degraded: {
            DEFAULT: "#D97706",
            strong: "#B45309",
            soft: "#FFFBEB",
            border: "#FDE68A",
          },
          info: {
            DEFAULT: "#2563EB",
            strong: "#1D4ED8",
            soft: "#EFF6FF",
            border: "#BFDBFE",
          },
          unknown: {
            DEFAULT: "#64748B",
            strong: "#475569",
            soft: "#F8FAFC",
            border: "#E2E8F0",
          },
        },
      },
      borderRadius: {
        lg: "0.625rem",
        md: "0.5rem",
        sm: "0.375rem",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "Segoe UI", "system-ui", "-apple-system", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "SFMono-Regular", "Consolas", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(16 24 40 / 0.04), 0 1px 3px -1px rgb(16 24 40 / 0.06)",
        panel: "0 1px 2px 0 rgb(16 24 40 / 0.03)",
        drawer: "-1px 0 24px -8px rgb(16 24 40 / 0.18)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
      },
      animation: {
        "fade-in": "fade-in 150ms ease-out",
        "slide-in-right": "slide-in-right 200ms cubic-bezier(0.32, 0.72, 0, 1)",
        "pulse-soft": "pulse-soft 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
