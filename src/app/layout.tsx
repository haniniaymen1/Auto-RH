import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // MODIFIÉ (Task 15) : nom « Service RH » retiré ; (v0.2.105) renommage
  // ServiceRH ; (v0.2.208) REBRANDING « Auto RH » (l'application couvre
  // fiches de paie ET demandes administratives).
  title: "Auto RH | Fiches de paie et demandes RH",
  description:
    "Portail Auto RH : importez et consultez les fiches de paie par CIN, suivez les demandes administratives (congés, autorisations, attestations, parrainage) et les documents signés.",
  keywords: ["Auto RH", "fiche de paie", "Sage", "paie", "CIN", "recherche", "bulletin de paie", "demandes RH", "congé", "attestation"],
  // MODIFIÉ (Task 15) : favicon « Z » remplacé par l'icône FICHE (carré vert
  // + document blanc, identique au logo de l'interface). Fichiers locaux :
  // public/fiche-icon.svg + public/fiche-icon.png.
  // MODIFIÉ (Task 115) : favicon remplacé par le LOGO TRAILMIX fourni par
  // l'utilisateur (dégradé orange-rose-violet « T ») — barre de favoris :
  // public/favicon.ico (16/32/48) + icône 192 + apple-touch-icon 180.
  // MODIFIÉ (v0.2.208) : favicon remplacé par le LOGO « AUTO RH » (engrenage
  // + personnage, dégradé indigo-violet) — mêmes fichiers/noms, nouveaux visuels :
  // public/favicon.ico (16/32/48) + icône 192 + apple-touch-icon 180.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48", type: "image/x-icon" },
      { url: "/icon-trailmix-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
