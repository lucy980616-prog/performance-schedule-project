import { fetchAllActorNames } from "@/lib/data";
import { ActorClient } from "./actor-client";

export async function generateStaticParams() {
  const names = await fetchAllActorNames();
  return names.map((name) => ({ name }));
}

export default async function ActorPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return <ActorClient name={name} />;
}
