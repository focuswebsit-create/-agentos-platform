"use client";

import * as React from "react";
import { MenuIcon } from "lucide-react";
import { LogoMark } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { AppNavList, type AppSidebarLabels } from "./app-sidebar";

export function AppMobileNav({
  labels,
  brand,
  openLabel,
  closeLabel,
}: {
  labels: AppSidebarLabels;
  brand: string;
  openLabel: string;
  closeLabel: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label={openLabel}>
          <MenuIcon aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent closeLabel={closeLabel} className="bg-sidebar">
        <SheetHeader className="border-b border-sidebar-border">
          <SheetTitle className="flex items-center gap-2 font-latin">
            <LogoMark className="size-7" />
            {brand}
          </SheetTitle>
          <SheetDescription className="sr-only">{labels.ariaLabel}</SheetDescription>
        </SheetHeader>
        <div className="overflow-y-auto px-3 pb-6">
          <AppNavList labels={labels} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
