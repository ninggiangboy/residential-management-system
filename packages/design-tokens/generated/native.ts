// Generated from tokens.json (Hiên v1) by `bun run tokens:build`. Do not edit.

/** Colors and shadows per theme, by the canvas names. Shadows are CSS strings for the `boxShadow` style. */
export const themes = {
  "light": {
    "ground": "#EEF1EF",
    "surface": "#FFFFFF",
    "fill": "#E1E7E4",
    "line": "#D3DBD7",
    "line-strong": "#72827E",
    "ink": "#0F2A2B",
    "ink-muted": "#48605D",
    "ink-disabled": "#8D9B97",
    "teal": "#0A6B66",
    "teal-pressed": "#07534F",
    "on-teal": "#FFFFFF",
    "teal-soft": "#D5EBE7",
    "on-teal-soft": "#07534F",
    "lamp": "#FFC53D",
    "on-lamp": "#2A1C00",
    "lamp-soft": "#FFF0C7",
    "on-lamp-soft": "#644400",
    "plate": "#0F2A2B",
    "on-plate": "#F4F7F5",
    "danger": "#B3261E",
    "on-danger": "#FFFFFF",
    "danger-soft": "#FBE2DF",
    "on-danger-soft": "#8F1B15",
    "info": "#2B4FCB",
    "info-soft": "#E0E7FC",
    "on-info-soft": "#1F3BA0",
    "success": "#0A6B66",
    "success-soft": "#D5EBE7",
    "on-success-soft": "#07534F",
    "glow": "#FFE9B0",
    "hero-from": "#0C7068",
    "hero-to": "#053634",
    "on-hero": "#FFFFFF",
    "on-hero-muted": "#CFE9E5",
    "gold-from": "#FFD86B",
    "gold-to": "#FFB22E",
    "on-gold": "#2A1C00",
    "coral-soft": "#FFE4DA",
    "on-coral-soft": "#9A3412",
    "violet-soft": "#EAE4FB",
    "on-violet-soft": "#4B37A6",
    "focus": "#0F2A2B",
    "scrim": "rgba(15, 42, 43, 0.5)",
    "line-control": "#80868D",
    "line-input": "#D9DCE0",
    "surface-muted": "#F9FAFA",
    "paper": "#FFFFFF",
    "paper-ink": "#000000",
    "shadow-card": "0 1px 2px rgba(15, 42, 43, 0.05), 0 8px 24px rgba(15, 42, 43, 0.07)",
    "shadow-glow": "0 10px 24px rgba(10, 107, 102, 0.34)",
    "shadow-bar": "0 -2px 20px rgba(15, 42, 43, 0.09)",
    "shadow-float": "0 8px 24px rgba(15, 42, 43, 0.14), 0 1px 2px rgba(15, 42, 43, 0.08)",
    "shadow-sheet": "0 -6px 32px rgba(15, 42, 43, 0.16)",
    "shadow-raised": "0 1px 2px rgba(15, 42, 43, 0.06)",
    "shadow-panel": "0 0 0 1px rgba(15, 42, 43, 0.02), 0 1px 2px rgba(15, 42, 43, 0.05), 0 4px 12px -2px rgba(15, 42, 43, 0.07), 0 16px 32px -16px rgba(15, 42, 43, 0.14)",
    "shadow-primary": "inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 1px 2px rgba(7, 83, 79, 0.3), 0 4px 12px -4px rgba(11, 115, 109, 0.5)",
    "shadow-field": "0 1px 2px rgba(15, 42, 43, 0.05)",
    "shadow-focus": "0 0 0 3px rgba(11, 115, 109, 0.22)",
    "shadow-invalid": "0 0 0 3px rgba(179, 38, 30, 0.14)"
  },
  "dark": {
    "ground": "#0C1413",
    "surface": "#152120",
    "fill": "#1E2C2A",
    "line": "#293735",
    "line-strong": "#71837F",
    "ink": "#EAF1EF",
    "ink-muted": "#A6B7B3",
    "ink-disabled": "#5C6C69",
    "teal": "#5AD4C6",
    "teal-pressed": "#8BE4D9",
    "on-teal": "#06211F",
    "teal-soft": "#12332F",
    "on-teal-soft": "#8BE4D9",
    "lamp": "#FFC53D",
    "on-lamp": "#2A1C00",
    "lamp-soft": "#3A2C06",
    "on-lamp-soft": "#FFD874",
    "plate": "#EAF1EF",
    "on-plate": "#0F2A2B",
    "danger": "#FF9C91",
    "on-danger": "#3A0A06",
    "danger-soft": "#40140F",
    "on-danger-soft": "#FFB4AB",
    "info": "#A5B7FF",
    "info-soft": "#1B2652",
    "on-info-soft": "#BFCBFF",
    "success": "#5AD4C6",
    "success-soft": "#12332F",
    "on-success-soft": "#8BE4D9",
    "glow": "#2E2609",
    "hero-from": "#1A6E67",
    "hero-to": "#0A2E2C",
    "on-hero": "#F2F8F6",
    "on-hero-muted": "#CFE6E2",
    "gold-from": "#FFD86B",
    "gold-to": "#FFB22E",
    "on-gold": "#2A1C00",
    "coral-soft": "#43201A",
    "on-coral-soft": "#FFB59E",
    "violet-soft": "#2A2350",
    "on-violet-soft": "#C9BEFF",
    "focus": "#FFC53D",
    "scrim": "rgba(0, 0, 0, 0.62)",
    "line-control": "#667773",
    "line-input": "#344440",
    "surface-muted": "#192624",
    "paper": "#FFFFFF",
    "paper-ink": "#000000",
    "shadow-card": "0 0 0 1px rgba(234, 241, 239, 0.07)",
    "shadow-glow": "0 10px 28px rgba(90, 212, 198, 0.22)",
    "shadow-bar": "0 -1px 0 rgba(234, 241, 239, 0.08)",
    "shadow-float": "0 8px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(234, 241, 239, 0.08)",
    "shadow-sheet": "0 -6px 32px rgba(0, 0, 0, 0.55), 0 -1px 0 rgba(234, 241, 239, 0.08)",
    "shadow-raised": "0 1px 2px rgba(0, 0, 0, 0.32)",
    "shadow-panel": "0 1px 2px rgba(0, 0, 0, 0.3), 0 12px 32px -12px rgba(0, 0, 0, 0.5)",
    "shadow-primary": "inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 4px 14px -4px rgba(90, 212, 198, 0.35)",
    "shadow-field": "0 1px 2px rgba(0, 0, 0, 0.3)",
    "shadow-focus": "0 0 0 3px rgba(90, 212, 198, 0.3)",
    "shadow-invalid": "0 0 0 3px rgba(255, 156, 145, 0.24)"
  }
} as const

export const space = {
  "space-1": 4,
  "space-2": 8,
  "space-3": 12,
  "space-4": 16,
  "space-5": 20,
  "space-6": 24,
  "space-8": 32,
  "space-10": 40,
  "space-14": 56
} as const

export const radius = {
  "radius-plate": 8,
  "radius-control": 16,
  "radius-card": 24,
  "radius-sheet": 32,
  "radius-full": 999
} as const

export const size = {
  "tap-min": 48,
  "control-lg": 52,
  "control-md": 44,
  "control-sm": 36,
  "icon-sm": 20,
  "icon-md": 24,
  "icon-lg": 32,
  "gutter": 20,
  "topbar-height": 56,
  "tabbar-height": 64
} as const

/** `fontFamily` names the static file (and PostScript name) of the weight: React Native picks fonts by name. */
export const textStyles = {
  "display": {
    "fontFamily": "Geologica-Bold",
    "fontSize": 34,
    "lineHeight": 40,
    "letterSpacing": -0.68,
    "fontWeight": "700"
  },
  "title-1": {
    "fontFamily": "Geologica-SemiBold",
    "fontSize": 26,
    "lineHeight": 32,
    "letterSpacing": -0.39,
    "fontWeight": "600"
  },
  "title-2": {
    "fontFamily": "Geologica-SemiBold",
    "fontSize": 20,
    "lineHeight": 28,
    "letterSpacing": -0.2,
    "fontWeight": "600"
  },
  "title-3": {
    "fontFamily": "Geologica-SemiBold",
    "fontSize": 17,
    "lineHeight": 24,
    "letterSpacing": 0,
    "fontWeight": "600"
  },
  "body": {
    "fontFamily": "Geologica-Regular",
    "fontSize": 16,
    "lineHeight": 24,
    "letterSpacing": 0,
    "fontWeight": "400"
  },
  "body-strong": {
    "fontFamily": "Geologica-SemiBold",
    "fontSize": 16,
    "lineHeight": 24,
    "letterSpacing": 0,
    "fontWeight": "600"
  },
  "label": {
    "fontFamily": "Geologica-SemiBold",
    "fontSize": 15,
    "lineHeight": 20,
    "letterSpacing": 0,
    "fontWeight": "600"
  },
  "secondary": {
    "fontFamily": "Geologica-Regular",
    "fontSize": 14,
    "lineHeight": 20,
    "letterSpacing": 0,
    "fontWeight": "400"
  },
  "caption": {
    "fontFamily": "Geologica-Medium",
    "fontSize": 13,
    "lineHeight": 18,
    "letterSpacing": 0,
    "fontWeight": "500"
  },
  "micro": {
    "fontFamily": "Geologica-SemiBold",
    "fontSize": 12,
    "lineHeight": 16,
    "letterSpacing": 0,
    "fontWeight": "600"
  },
  "plate-xl": {
    "fontFamily": "BigShoulders-ExtraBold",
    "fontSize": 44,
    "lineHeight": 44,
    "letterSpacing": 0.44,
    "fontWeight": "800"
  },
  "plate-lg": {
    "fontFamily": "BigShoulders-Bold",
    "fontSize": 28,
    "lineHeight": 28,
    "letterSpacing": 0.56,
    "fontWeight": "700"
  },
  "plate-md": {
    "fontFamily": "BigShoulders-Bold",
    "fontSize": 20,
    "lineHeight": 20,
    "letterSpacing": 0.6,
    "fontWeight": "700"
  },
  "plate-sm": {
    "fontFamily": "BigShoulders-Bold",
    "fontSize": 15,
    "lineHeight": 16,
    "letterSpacing": 0.6,
    "fontWeight": "700"
  }
} as const

export const fontFiles = [
  "Geologica-Regular",
  "Geologica-Medium",
  "Geologica-SemiBold",
  "Geologica-Bold",
  "BigShoulders-Bold",
  "BigShoulders-ExtraBold"
] as const
