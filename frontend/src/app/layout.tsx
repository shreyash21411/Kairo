import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { ThemeProvider } from "@/providers/theme-provider"
import { AuthProvider } from "@/providers/auth-provider"
import { ProjectProvider } from "@/providers/project-provider"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
})

export const metadata: Metadata = {
  title: {
    default: "Kairo — Persistent Memory for AI",
    template: "%s | Kairo",
  },
  description:
    "Kairo provides persistent memory infrastructure for AI applications and agents. Create, retrieve, and semantically search memories that outlast any single session.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "https://kairo.ai"
  ),
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Kairo",
    title: "Kairo — Persistent Memory for AI",
    description:
      "Persistent memory infrastructure for AI applications and agents.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Kairo — Persistent Memory for AI",
    description:
      "Persistent memory infrastructure for AI applications and agents.",
  },
  robots: {
    index: true,
    follow: true,
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090f" },
  ],
  width: "device-width",
  initialScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider>
            <ProjectProvider>{children}</ProjectProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
