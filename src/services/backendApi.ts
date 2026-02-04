const BACKEND_BASE = import.meta.env.VITE_BACKEND_BASE ?? "http://localhost:8000";

export type ResolveItem = {
  word?: string;
  category?: string;
  pose_filename: string;
  pose_url: string;
};

export async function resolveWord(word: string, category?: string) {
  const url = new URL(`${BACKEND_BASE}/api/resolve`);
  url.searchParams.set("word", word);
  if (category) url.searchParams.set("category", category);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as { count: number; files: ResolveItem[] };
}

export async function fetchPoseBlob(poseUrl: string) {
  const fullUrl = poseUrl.startsWith("http")
    ? poseUrl
    : `${BACKEND_BASE}${poseUrl.startsWith("/") ? "" : "/"}${poseUrl}`;

  const res = await fetch(fullUrl);
  if (!res.ok) throw new Error(await res.text());
  return await res.blob();
}

export function buildPoseUrl(poseFilename: string) {
  const url = new URL(`${BACKEND_BASE}/api/pose`);
  url.searchParams.set("name", poseFilename);
  return url.toString();
}
