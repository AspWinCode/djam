import type { ReactNode } from "react";
import { TrainerNotificationBell } from "../../components/trainer-notification-bell";
import { getServerSessionUser } from "../../lib/server-auth";

export default async function TrainerLayout({ children }: { children: ReactNode }) {
  const user = await getServerSessionUser();
  const canTrain = user?.role === "trainer" || user?.role === "admin";
  return <>
    {canTrain && user.currentOrganizationId ? (
      <header className="trainer-toolbar container">
        <TrainerNotificationBell key={user.currentOrganizationId} organizationId={user.currentOrganizationId} />
      </header>
    ) : null}
    {children}
  </>;
}
