import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist)"],
        mono: ["var(--font-geist-mono)"],
        host: ["var(--font-host-grotesk)"],
      },
      screens: {
        "toast-mobile": "600px",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        // Shadcn UI compatibility (mapped to Stacks AI colors)
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
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
        // MIDL orange brand scale
        orange: {
          950: '#431407',
          900: '#7c2d12',
          800: '#9a3412',
          700: '#c2410c',
          600: '#ea580c',
          500: '#f97316',
          400: '#fb923c',
          300: '#fdba74',
          200: '#fed7aa',
          100: '#ffedd5',
          50:  '#fff7ed',
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },

        // ── Design system tokens (CSS var backed, theme-aware) ──
        'stx-accent': 'var(--stx-accent)',
        'stx-accent-hover': 'var(--stx-accent-hover)',
        'stx-accent-muted': 'var(--stx-accent-muted)',
        'stx-secondary': 'var(--stx-secondary)',
        'stx-secondary-muted': 'var(--stx-secondary-muted)',
        'stx-tertiary': 'var(--stx-tertiary)',
        'stx-tertiary-muted': 'var(--stx-tertiary-muted)',
        'stx-bg': 'var(--stx-bg)',
        'stx-bg-secondary': 'var(--stx-bg-secondary)',
        'stx-bg-tertiary': 'var(--stx-bg-tertiary)',
        'stx-border': 'var(--stx-border)',

        // Stacks AI Brand Colors
        stacks: {
          purple: {
            DEFAULT: '#5546FF',
            light: '#6B5FFF',
            dark: '#4435EE',
          },
          cyan: {
            DEFAULT: '#00D4FF',
            light: '#33DDFF',
            dark: '#00A8CC',
          },
          coral: {
            DEFAULT: '#FF6B6B',
            light: '#FF8585',
            dark: '#FF5252',
          },
        },
        bitcoin: {
          DEFAULT: '#F7931A',
          light: '#FC8D36',
          dark: '#E8830F',
        },

        // Background Colors
        bg: {
          primary: '#0A0A0A',
          secondary: '#121212',
          tertiary: '#1A1A1A',
          elevated: '#242424',
          highlight: '#2E2E2E',
        },

        // Surface Colors
        surface: {
          DEFAULT: '#1A1A1A',
          elevated: '#242424',
          highlight: '#2E2E2E',
          glass: 'rgba(26, 26, 26, 0.8)',
        },

        // Text Colors
        text: {
          primary: '#FFFFFF',
          secondary: '#E0E0E0',
          muted: '#A0A0A0',
          disabled: '#6B6B6B',
        },

        // Semantic Colors
        success: {
          DEFAULT: '#4CAF50',
          light: '#66BB6A',
          dark: '#388E3C',
          bg: 'rgba(76, 175, 80, 0.1)',
        },
        warning: {
          DEFAULT: '#FF9800',
          light: '#FFB74D',
          dark: '#F57C00',
          bg: 'rgba(255, 152, 0, 0.1)',
        },
        error: {
          DEFAULT: '#F44336',
          light: '#EF5350',
          dark: '#D32F2F',
          bg: 'rgba(244, 67, 54, 0.1)',
        },
        info: {
          DEFAULT: '#2196F3',
          light: '#42A5F5',
          dark: '#1976D2',
          bg: 'rgba(33, 150, 243, 0.1)',
        },
      },

      // Background Images / Gradients
      backgroundImage: {
        'gradient-hero': 'linear-gradient(135deg, #0A0A0A 0%, #1A1A1A 50%, #0D0D1F 100%)',
        'gradient-purple': 'linear-gradient(135deg, #5546FF 0%, #6B5FFF 100%)',
        'gradient-accent': 'linear-gradient(90deg, #5546FF 0%, #00D4FF 100%)',
        'gradient-bitcoin': 'linear-gradient(135deg, #F7931A 0%, #FC8D36 100%)',
        'gradient-card-glow': 'radial-gradient(circle at top, rgba(85, 70, 255, 0.1) 0%, transparent 70%)',
        'gradient-mesh': 'radial-gradient(at 40% 20%, rgba(85, 70, 255, 0.15) 0%, transparent 50%), radial-gradient(at 80% 0%, rgba(0, 212, 255, 0.1) 0%, transparent 50%), radial-gradient(at 0% 50%, rgba(247, 147, 26, 0.1) 0%, transparent 50%)',
      },

      // Box Shadow
      boxShadow: {
        'glow-purple': '0 0 20px rgba(85, 70, 255, 0.3)',
        'glow-cyan': '0 0 20px rgba(0, 212, 255, 0.3)',
        'glow-bitcoin': '0 0 20px rgba(247, 147, 26, 0.3)',
        'card': '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)',
        'card-hover': '0 10px 15px -3px rgba(85, 70, 255, 0.2), 0 4px 6px -2px rgba(85, 70, 255, 0.1)',
      },

      // Animation
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'slide-in-right': 'slide-in-right 0.4s ease-out both',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(85, 70, 255, 0.2)' },
          '100%': { boxShadow: '0 0 20px rgba(85, 70, 255, 0.6)' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 8px rgba(249, 115, 22, 0.15)' },
          '50%': { boxShadow: '0 0 24px rgba(249, 115, 22, 0.35)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
};
export default config;
