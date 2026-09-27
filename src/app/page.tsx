import { Nav } from "@/components/landing/Nav";
import { Hero } from "@/components/landing/Hero";
import { Problem } from "@/components/landing/Problem";
import { Features } from "@/components/landing/Features";
import { GovernanceSection } from "@/components/landing/GovernanceSection";
import { Proof } from "@/components/landing/Proof";
import { FinalCta } from "@/components/landing/FinalCta";
import { Footer } from "@/components/landing/Footer";

export default function LandingPage() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Problem />
        <Features />
        <GovernanceSection />
        <Proof />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
