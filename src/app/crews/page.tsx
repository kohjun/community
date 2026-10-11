import { permanentRedirect } from "next/navigation";
type Query = Record<string, string | string[] | undefined>;
export default async function Page({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams,
    params = new URLSearchParams({ tab: "crews" });
  for (const key of ["q", "category", "mine", "page"]) {
    const value = query[key];
    if (typeof value === "string" && value) params.set(key, value);
  }
  permanentRedirect("/players?" + params);
}
