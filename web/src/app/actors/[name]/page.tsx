import { fetchAllActorNames } from "@/lib/data";
import { ActorClient } from "./actor-client";

export async function generateStaticParams() {
  const names = await fetchAllActorNames();
  return names.map((name) => ({ name: encodeURIComponent(name) }));
}

export default async function ActorPage({ params }: { params: Promise<{ name: string }> }) {
  const { name: encoded } = await params;
  return <ActorClient name={decodeURIComponent(encoded)} />;
}
