import type { Config } from "tailwindcss";

// Brand tokens mirror the iOS app's SwiftUI Color.sp* values so the web
// dashboard reads as the same product as the iPhone app.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Sacred Pathway brand
        sp: {
          gold:        "#D4AF37",
          goldLight:   "#E5C76B",
          black:       "#0A0A0A",
          background:  "#111111",
          card:        "#1A1A1A",
          cardLight:   "#2A2A2A",
          textPrimary: "#F5F5F5",
          textSecondary: "#9A9A9A",
          danger:      "#E5484D",
          success:     "#30A46C",
          warning:     "#F76808",
          greenAccent: "#2EBD85",
        },
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
