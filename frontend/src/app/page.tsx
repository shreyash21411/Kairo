import { Navbar }            from "@/components/layout/navbar"
import { Footer }            from "@/components/layout/footer"
import { HeroSection }       from "@/components/marketing/hero-section"
import { QuickstartSection }  from "@/components/marketing/quickstart-section"
import { HowItWorksSection }  from "@/components/marketing/how-it-works-section"
import { FeaturesSection }   from "@/components/marketing/features-section"
import { CtaSection }        from "@/components/marketing/cta-section"

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <HeroSection />
        <QuickstartSection />
        <HowItWorksSection />
        <FeaturesSection />
        <CtaSection />
      </main>
      <Footer />
    </>
  )
}
