import { AppNav } from "@/components/app-nav";
import { requireSession } from "@/lib/auth";

// The layout check only feeds the nav. It is NOT the access gate: Next.js
// renders page segments in parallel with this layout, so every page under
// app/(private) must call requireSession() itself before touching data.
export default async function PrivateLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await requireSession();

  return (
    <>
      <AppNav session={session} />
      {children}
    </>
  );
}
