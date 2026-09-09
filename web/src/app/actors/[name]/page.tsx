import { fetchAllActorNames } from "@/lib/data";
import { ActorClient } from "./actor-client";

export async function generateStaticParams() {
  const names = await fetchAllActorNames();
  return names.map((name) => ({ name }));
}

export default async function ActorPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  // 정적 export에서는 서버가 없어 URL 경로 세그먼트가 디코딩되지 않은 채로 온다.
  return <ActorClient name={decodeURIComponent(name)} />;
}
