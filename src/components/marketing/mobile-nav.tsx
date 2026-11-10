"use client";

import * as React from "react";
import Link from "next/link";
import { MenuIcon } from "lucide-react";
import { LogoMark } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export function MobileNav({
  links,
  brand,
  openLabel,
  closeLabel,
  ctaLabel,
  ctaNote,
}: {
  links: { href: string; label: string }[];
  brand: string;
  openLabel: string;
  closeLabel: string;
  ctaLabel: string;
  ctaNote: string;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label={openLabel}>
          <MenuIcon aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent closeLabel={closeLabel}>
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2 font-latin">
            <LogoMark className="size-7" />
            {brand}
          </SheetTitle>
          <SheetDescription className="sr-only">{openLabel}</SheetDescription>
        </SheetHeader>
        <nav className="flex flex-col gap-1 px-3">
          {links.map((l) => (
            <SheetClose asChild key={l.href}>
              <Link
                href={l.href}
                className="rounded-lg px-3 py-2.5 text-base font-medium hover:bg-accent"
              >
                {l.label}
              </Link>
            </SheetClose>
          ))}
        </nav>
        <div className="mt-auto space-y-2 border-t p-4">
          <SheetClose asChild>
            <Button asChild variant="brand" className="w-full">
              <Link href="/app">{ctaLabel}</Link>
            </Button>
          </SheetClose>
          <p className="text-xs text-muted-foreground">{ctaNote}</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
