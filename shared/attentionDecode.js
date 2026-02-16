function normalizePrecision(value) {
  const raw = (value || "auto").toString().trim().toLowerCase();
  if (raw === "auto") return "auto";
  if (raw === "fp32" || raw === "float32") return "fp32";
  if (raw === "int8" || raw === "int8_phs_v1") return "int8";
  if (raw === "int4" || raw === "int4_phq_v1") return "int4";
  return "auto";
}

function toVariantKey(requested, sceneJson) {
  if (requested === "fp32") return "fp32";
  if (requested === "int8") return "int8_phs_v1";
  if (requested === "int4") return "int4_phq_v1";

  const metadata = sceneJson?.metadata || {};
  const variants = sceneJson?.attn_variants || {};

  const preferred = typeof metadata.attn_precision_default === "string"
    ? metadata.attn_precision_default
    : "";
  if (preferred && variants[preferred]) return preferred;
  if (variants.int4_phq_v1) return "int4_phq_v1";
  if (variants.int8_phs_v1) return "int8_phs_v1";
  if (variants.fp32) return "fp32";
  return "";
}

function ensureShape(sceneJson) {
  const shape = sceneJson?.attn_weights_shape;
  if (!Array.isArray(shape) || shape.length !== 4) {
    throw new Error("Missing or invalid attn_weights_shape in scene manifest.");
  }
  return shape.map((x) => Number(x));
}

function prod(nums) {
  return nums.reduce((a, b) => a * b, 1);
}

async function fetchArrayBufferOrThrow(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load ${url.toString()}: ${res.status} ${res.statusText}`);
  }
  return await res.arrayBuffer();
}

function buildLegacyFp32Variant(sceneJson) {
  if (!sceneJson?.attn_weights_file) return null;
  return {
    file: sceneJson.attn_weights_file,
    dtype: "float32",
    encoding: "raw",
  };
}

export function resolveAttentionVariant(sceneJson, urlPrecision = "auto") {
  const requested = normalizePrecision(urlPrecision);
  const variants = sceneJson?.attn_variants || null;

  if (!variants || typeof variants !== "object") {
    if (requested === "int8" || requested === "int4") {
      throw new Error(`This scene does not provide ${requested} attention variants.`);
    }
    const legacy = buildLegacyFp32Variant(sceneJson);
    if (!legacy) {
      throw new Error("Scene manifest does not contain an attention binary reference.");
    }
    return {
      key: "fp32",
      variant: legacy,
      fallbackUsed: requested !== "auto",
      requested,
    };
  }

  const key = toVariantKey(requested, sceneJson);
  if (!key) {
    const legacy = buildLegacyFp32Variant(sceneJson);
    if (!legacy) {
      throw new Error("No usable attention variants found in scene manifest.");
    }
    return {
      key: "fp32",
      variant: legacy,
      fallbackUsed: requested !== "auto",
      requested,
    };
  }

  const variant = variants[key];
  if (!variant) {
    if (requested === "int8" || requested === "int4") {
      throw new Error(`Requested ${requested} attention variant is missing for this scene.`);
    }
    const fallback = variants.fp32 || buildLegacyFp32Variant(sceneJson);
    if (!fallback) {
      throw new Error(`Requested attention variant '${key}' is unavailable.`);
    }
    return {
      key: "fp32",
      variant: fallback,
      fallbackUsed: true,
      requested,
    };
  }

  const fallbackUsed =
    (requested === "int8" && key !== "int8_phs_v1")
    || (requested === "int4" && key !== "int4_phq_v1");
  return { key, variant, fallbackUsed, requested };
}

async function loadRawFp32(variant, jsonUrl, shape) {
  const file = variant?.file;
  if (!file) {
    throw new Error("Attention fp32 variant is missing file path.");
  }
  const url = new URL(file, jsonUrl);
  const buffer = await fetchArrayBufferOrThrow(url);
  const out = new Float32Array(buffer);
  const expected = prod(shape);
  if (out.length !== expected) {
    throw new Error(
      `Attention fp32 size mismatch: got ${out.length} values, expected ${expected}.`
    );
  }
  return out;
}

async function loadInt8PerHead(variant, jsonUrl, shape) {
  const file = variant?.file;
  const scaleFile = variant?.scale_file;
  if (!file || !scaleFile) {
    throw new Error("Int8 attention variant requires file and scale_file.");
  }
  if (variant.encoding !== "symmetric_per_head") {
    throw new Error(`Unsupported int8 encoding '${variant.encoding}'.`);
  }

  const qUrl = new URL(file, jsonUrl);
  const sUrl = new URL(scaleFile, jsonUrl);
  const [qBuffer, sBuffer] = await Promise.all([
    fetchArrayBufferOrThrow(qUrl),
    fetchArrayBufferOrThrow(sUrl),
  ]);

  const q = new Int8Array(qBuffer);
  const scales = new Float32Array(sBuffer);

  const [b, h, qDim, kDim] = shape;
  if (b !== 1) {
    throw new Error(`Only batch size 1 is supported, got ${b}.`);
  }

  const expectedValues = b * h * qDim * kDim;
  if (q.length !== expectedValues) {
    throw new Error(
      `Int8 attention size mismatch: got ${q.length} values, expected ${expectedValues}.`
    );
  }

  const expectedScales = h;
  if (scales.length !== expectedScales) {
    throw new Error(
      `Int8 scales size mismatch: got ${scales.length} values, expected ${expectedScales}.`
    );
  }

  const out = new Float32Array(expectedValues);
  const headStride = qDim * kDim;
  for (let head = 0; head < h; head++) {
    const scale = scales[head];
    const base = head * headStride;
    for (let i = 0; i < headStride; i++) {
      out[base + i] = q[base + i] * scale;
    }
  }
  return out;
}

function nibbleToSigned(value) {
  return (value & 0x08) ? (value - 16) : value;
}

function int4At(packed, index) {
  const byte = packed[index >> 1];
  if ((index & 1) === 0) {
    return nibbleToSigned(byte & 0x0f);
  }
  return nibbleToSigned((byte >> 4) & 0x0f);
}

async function loadInt4Packed(variant, jsonUrl, shape) {
  const file = variant?.file;
  const scaleFile = variant?.scale_file;
  if (!file || !scaleFile) {
    throw new Error("Int4 attention variant requires file and scale_file.");
  }

  const qUrl = new URL(file, jsonUrl);
  const sUrl = new URL(scaleFile, jsonUrl);
  const [qBuffer, sBuffer] = await Promise.all([
    fetchArrayBufferOrThrow(qUrl),
    fetchArrayBufferOrThrow(sUrl),
  ]);

  const packed = new Uint8Array(qBuffer);
  const scales = new Float32Array(sBuffer);

  const [b, h, qDim, kDim] = shape;
  if (b !== 1) {
    throw new Error(`Only batch size 1 is supported, got ${b}.`);
  }

  const expectedValues = b * h * qDim * kDim;
  const expectedPacked = Math.ceil(expectedValues / 2);
  if (packed.length !== expectedPacked) {
    throw new Error(
      `Int4 packed size mismatch: got ${packed.length} bytes, expected ${expectedPacked}.`
    );
  }

  const expectedScales = h * qDim;
  if (scales.length !== expectedScales) {
    throw new Error(
      `Int4 scales size mismatch: got ${scales.length} values, expected ${expectedScales}.`
    );
  }

  const out = new Float32Array(expectedValues);
  for (let head = 0; head < h; head++) {
    for (let q = 0; q < qDim; q++) {
      const scale = scales[head * qDim + q];
      const base = (head * qDim + q) * kDim;
      for (let k = 0; k < kDim; k++) {
        const idx = base + k;
        out[idx] = int4At(packed, idx) * scale;
      }
    }
  }
  return out;
}

export async function loadAttentionAsFloat32(sceneJson, jsonUrl, urlPrecision = "auto") {
  const shape = ensureShape(sceneJson);
  const resolved = resolveAttentionVariant(sceneJson, urlPrecision);

  const variant = resolved.variant || {};
  const dtype = (variant.dtype || "").toLowerCase();
  const encoding = (variant.encoding || "").toLowerCase();

  let float32 = null;
  if (
    dtype === "int4"
    || encoding === "symmetric_per_head_query_packed_int4"
  ) {
    float32 = await loadInt4Packed(variant, jsonUrl, shape);
  } else if (dtype === "int8" || encoding === "symmetric_per_head") {
    float32 = await loadInt8PerHead(variant, jsonUrl, shape);
  } else {
    float32 = await loadRawFp32(variant, jsonUrl, shape);
  }

  return {
    float32,
    shape,
    selectedPrecision: resolved.key,
    fallbackUsed: resolved.fallbackUsed,
    requestedPrecision: resolved.requested,
  };
}
