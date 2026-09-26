import { AmbientBackground } from "@/components/layout/ambient-background"
import { FloatingNavbar } from "@/components/layout/floating-navbar"
import { Footer } from "@/components/layout/footer"
import { HeroSection } from "@/components/marketing/hero-section"
import { ItRemembersSection } from "@/components/marketing/it-remembers-section"
import { MemoryOverTimeSection } from "@/components/marketing/memory-over-time-section"
import { AskNaturallySection } from "@/components/marketing/ask-naturally-section"
import { RightPersonSection } from "@/components/marketing/right-person-section"
import { MemoryLifecycleSection } from "@/components/marketing/memory-lifecycle-section"
import { SeeKairoSection } from "@/components/marketing/see-kairo-section"
import { SimpleToAddSection } from "@/components/marketing/simple-to-add-section"
import { HumanUseCasesSection } from "@/components/marketing/human-use-cases-section"
import { FaqSection } from "@/components/marketing/faq-section"
import { CtaSection } from "@/components/marketing/cta-section"

export default function Home() {
  return (
    <div className="relative min-h-screen bg-background text-foreground flex flex-col selection:bg-primary/20 selection:text-foreground">
      {/* Global Ambient Background */}
      <AmbientBackground />

      {/* Floating Navigation Bar */}
      <FloatingNavbar />

      {/* Main Marketing Story Flow */}
      <main className="relative z-10 flex-1">
        {/* Section 01: Hero + Signature Story Animation */}
        <HeroSection />

        {/* Section 02: "It remembers." — Conversational Capture */}
        <ItRemembersSection />

        {/* Section 03: "Every conversation adds context." — Timeline Accumulation */}
        <MemoryOverTimeSection />

        {/* Section 04: "Ask naturally." — Semantic Recall */}
        <AskNaturallySection />

        {/* Section 05: "The right memory, for the right person." — Actor Isolation */}
        <RightPersonSection />

        {/* Section 06: Memory Lifecycle — Ingest, Classify, Retrieve, Expire */}
        <MemoryLifecycleSection />

        {/* Section 07: See Kairo in Action — Interactive Live Walkthrough */}
        <SeeKairoSection />

        {/* Section 08: "Simple to add." — REST, Python, Node, MCP */}
        <SimpleToAddSection />

        {/* Section 09: "What you can build." — Real-World Human Use Cases */}
        <HumanUseCasesSection />

        {/* Section 10: Architecture & Product FAQ */}
        <FaqSection />

        {/* Section 11: Final Call to Action */}
        <CtaSection />
      </main>

      {/* Footer */}
      <Footer />
    </div>
  )
}
