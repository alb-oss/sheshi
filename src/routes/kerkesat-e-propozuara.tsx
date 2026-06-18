import { createFileRoute } from "@tanstack/react-router";
import { ProposalsPage } from "@/components/ProposalsPage";

export const Route = createFileRoute("/kerkesat-e-propozuara")({
  head: () => ({
    meta: [
      { title: "Kërkesat e Propozuara — Sheshi" },
      {
        name: "description",
        content: "Propozimet qytetare të hapura për votim — mbështet ose kundërshto.",
      },
    ],
  }),
  component: () => <ProposalsPage status="proposed" />,
});
