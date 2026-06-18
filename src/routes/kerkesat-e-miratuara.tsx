import { createFileRoute } from "@tanstack/react-router";
import { ProposalsPage } from "@/components/ProposalsPage";

export const Route = createFileRoute("/kerkesat-e-miratuara")({
  head: () => ({
    meta: [
      { title: "Kërkesat e Miratuara — Sheshi" },
      {
        name: "description",
        content: "Kërkesat qytetare që kaluan votimin me shumicë — vendime të miratuara.",
      },
    ],
  }),
  component: () => <ProposalsPage status="approved" />,
});
