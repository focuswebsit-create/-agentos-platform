import Link from "next/link";
import { CompassIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getDictionary } from "@/i18n";

export default function NotFound() {
  const t = getDictionary();
  return (
    <main
      id="main"
      className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6 text-center"
    >
      <span className="flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
        <CompassIcon aria-hidden className="size-6" />
      </span>
      <div className="space-y-2">
        <p className="font-latin text-sm font-semibold text-primary">404</p>
        <h1 className="text-2xl font-bold">{t.notFound.title}</h1>
        <p className="text-muted-foreground">{t.notFound.body}</p>
      </div>
      <Button asChild variant="outline">
        <Link href="/">{t.notFound.home}</Link>
      </Button>
    </main>
  );
}
