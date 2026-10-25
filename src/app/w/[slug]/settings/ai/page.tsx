import { redirect } from "next/navigation";

/** Settings → AI Providers (deep link). */
export default async function AiProvidersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/w/${slug}/settings?tab=ai`);
}
