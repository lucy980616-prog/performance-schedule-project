import { fetchAllShowIds } from "@/lib/data";
import { ShowDetailClient } from "./show-detail-client";

export async function generateStaticParams() {
  const ids = await fetchAllShowIds();
  return ids.map((id) => ({ id: String(id) }));
}

export default async function ShowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ShowDetailClient id={Number(id)} />;
}
