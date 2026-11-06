import { createHash } from "node:crypto";
import { requireRole } from "@/lib/auth-server";
import { buildProductSearchText } from "@/lib/product-search";
import {
  createEmbeddingProvider,
  embeddingConfigFromEnv,
  formatVectorLiteral,
} from "@/lib/search-embeddings";

type ProductForSearch = {
  id: number;
  name: string;
  brand: string | null;
  part_number: string | null;
  description: string | null;
  short_description: string | null;
};

export async function POST() {
  const { client } = await requireRole("admin");
  const config = embeddingConfigFromEnv(process.env);
  if (!config) {
    return Response.json(
      { error: "سرویس embedding تنظیم نشده است", code: "embedding_provider_not_configured" },
      { status: 503 },
    );
  }

  const { data, error } = await client
    .from("products")
    .select("id,name,brand,part_number,description,short_description")
    .eq("is_active", true)
    .order("id", { ascending: true });
  if (error) return Response.json({ error: "محصولات قابل دریافت نیستند" }, { status: 503 });

  const products = (data ?? []) as ProductForSearch[];
  const provider = createEmbeddingProvider(config);
  let indexed = 0;
  const failures: number[] = [];
  const batchSize = 32;

  for (let start = 0; start < products.length; start += batchSize) {
    const batch = products.slice(start, start + batchSize);
    const documents = batch.map((product) => buildProductSearchText(product));
    let vectors: number[][];
    try {
      vectors = await provider.embed(documents);
    } catch {
      failures.push(...batch.map((product) => product.id));
      continue;
    }

    for (let index = 0; index < batch.length; index += 1) {
      const product = batch[index];
      const vector = vectors[index];
      const contentHash = createHash("sha256").update(documents[index], "utf8").digest("hex");
      const result = await client.rpc("admin_upsert_product_embedding", {
        p_product_id: product.id,
        p_provider: "openai-compatible",
        p_model: config.model,
        p_dimensions: vector.length,
        p_content_hash: contentHash,
        p_embedding: formatVectorLiteral(vector),
        p_status: "ready",
        p_error_message: null,
      });
      if (result.error) failures.push(product.id);
      else indexed += 1;
    }
  }

  return Response.json({ indexed, failed: failures.length, failed_product_ids: failures });
}
