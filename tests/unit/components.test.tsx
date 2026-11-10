import { render, screen, within } from "@testing-library/react";
import { BotIcon } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { DemoBadge } from "@/components/shared/demo-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { PricingTable } from "@/components/marketing/pricing-table";
import { getDictionary } from "@/i18n";

vi.mock("next/navigation", () => ({ usePathname: () => "/app" }));

const t = getDictionary("he");

describe("<EmptyState />", () => {
  it("renders title, body and phase label", () => {
    render(<EmptyState icon={BotIcon} title="אין סוכנים" body="הסבר" phaseLabel="P2" />);
    const region = screen.getByRole("region", { name: "אין סוכנים" });
    expect(within(region).getByText("הסבר")).toBeInTheDocument();
    expect(within(region).getByText("P2")).toBeInTheDocument();
  });
});

describe("<DemoBadge />", () => {
  it("is visibly marked as demo", () => {
    render(<DemoBadge label={t.common.demo} />);
    const badge = screen.getByText(t.common.demo);
    expect(badge.closest("[data-demo='true']")).not.toBeNull();
  });
});

describe("<PricingTable />", () => {
  it("renders three planned plans with ILS prices and VAT disclosure", () => {
    render(<PricingTable t={t} locale="he" />);
    for (const code of ["starter", "business", "pro"]) {
      const card = screen.getByTestId(`plan-${code}`);
      expect(card).toHaveAttribute("data-availability", "planned");
      expect(within(card).getByText(t.pricing.vatNote)).toBeInTheDocument();
      expect(within(card).getByText(/₪/)).toBeInTheDocument();
    }
    expect(within(screen.getByTestId("plan-business")).getByText(/799/)).toBeInTheDocument();
    expect(within(screen.getByTestId("plan-pro")).getByText(/1,990/)).toBeInTheDocument();
  });

  it("offers no working purchase action", () => {
    render(<PricingTable t={t} locale="he" />);
    const buttons = screen.getAllByRole("button", { name: t.pricing.cta });
    expect(buttons).toHaveLength(3);
    for (const b of buttons) expect(b).toBeDisabled();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows the AI budget as a provider-cost ceiling in USD", () => {
    render(<PricingTable t={t} locale="he" />);
    expect(within(screen.getByTestId("plan-starter")).getByText(/\$/)).toBeInTheDocument();
  });
});
