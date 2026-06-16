import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import Replicate from "replicate";
import sharp from "sharp";

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST"], allowedHeaders: ["Content-Type"] }));
app.use(express.json({ limit: "50mb" }));

const replicate = new Replicate({ auth: process.env.REPLICATE_API_KEY });

app.get("/", (req, res) => {
  res.json({
    status: "Pooja Textiles AI Try-On Backend 🚀",
    apiKeySet: !!process.env.REPLICATE_API_KEY,
  });
});

// ── Preprocess image ──────────────────────────────────────────────────────────
// IDM-VTON works best at exactly 768x1024 (portrait)
// We keep portrait for processing, result comes out portrait matching customer pose
const preprocessImage = async (dataUrl, type) => {
  try {
    const base64 = dataUrl.split(",")[1];
    const buffer = Buffer.from(base64, "base64");

    const processedBuffer = await sharp(buffer)
      .resize(768, 1024, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
        withoutEnlargement: false,
        position: "center",
      })
      .sharpen({ sigma: type === "garment" ? 1.4 : 1.0 })
      .jpeg({ quality: 100, progressive: false })
      .toBuffer();

    return `data:image/jpeg;base64,${processedBuffer.toString("base64")}`;
  } catch (e) {
    console.log("Preprocess failed, using original:", e.message);
    return dataUrl;
  }
};

// ── Upload image to Replicate file storage ────────────────────────────────────
const uploadToReplicate = async (dataUrl) => {
  try {
    const base64   = dataUrl.split(",")[1];
    const mimeType = dataUrl.split(";")[0].split(":")[1] || "image/jpeg";
    const buffer   = Buffer.from(base64, "base64");

    const res = await fetch("https://api.replicate.com/v1/files", {
      method: "POST",
      headers: {
        Authorization: `Token ${process.env.REPLICATE_API_KEY}`,
        "Content-Type": mimeType,
        "Content-Length": buffer.length,
      },
      body: buffer,
    });

    if (!res.ok) return dataUrl;
    const file = await res.json();
    const url = file.urls?.get || file.url || dataUrl;
    console.log("✓ Uploaded:", url.substring(0, 55) + "...");
    return url;
  } catch (e) {
    console.log("Upload failed, using base64");
    return dataUrl;
  }
};

// ── Garment descriptions ──────────────────────────────────────────────────────
// Detailed prompts help IDM-VTON preserve garment details accurately
const buildGarmentDescription = (garment) => {
  const map = {
    "T-Shirt":
  "upper body t-shirt. Preserve exact sleeve length (short or half sleeve), exact neckline (V-neck, crew neck), exact fit (slim, regular, oversized), fabric texture, colors, logos, prints, graphics, full sleeves, half sleeves stitching and every design detail exactly as shown in the garment image.",

"Shirt":
`Professional formal or casual button-up shirt.

Supported collar styles:

• Shirt Collar
• Spread Collar
• Button-Up Collar
• Button-Down Collar
• Band Collar
• Chinese Collar
• Mandarin Collar
• Regular Collar

Supported shirt styles:

• Formal Shirt
• Casual Shirt
• Office Shirt
• Oxford Shirt
• Linen Shirt
• Cotton Shirt
• Denim Shirt

Preserve exactly:

• Collar shape
• Collar size
• Collar stiffness
• Button placket
• Buttons
• Chest pocket
• Sleeve length
• Half sleeve
• Full sleeve
• Cuffs
• Shoulder seams
• Shirt length
• Slim Fit
• Regular Fit
• Relaxed Fit
• Oversized Fit
• Cotton fabric
• Linen fabric
• Denim fabric
• Oxford fabric
• Stripes
• Checks
• Prints
• Embroidery
• Logos
• Stitching
• Fabric texture
• Color accuracy

This is ALWAYS a collared button-up shirt.

Never convert it into:

• T-Shirt
• Polo T-Shirt
• Round Neck
• Crew Neck
• V-Neck
• Sweatshirt
• Hoodie

Always preserve the original collar, buttons, cuffs, pockets, shirt construction, fabric, texture and design exactly as shown in the uploaded garment image while preserving the customer's body shape and pose.`,
    "Pants / Jeans":
      "lower body clothing item - pants or jeans. Preserve exact length (full/cropped/ankle), exact fit (slim/straight/wide-leg), waistband style, all colors, wash, and design details exactly as shown.",
    "Dress / Gown":
      "full body clothing item - dress or gown. Preserve exact length (mini/midi/maxi), sleeve style (sleeveless/short/long), neckline, silhouette (A-line/fitted/flowy), all colors and design details exactly as shown.",
    "Jacket / Coat":
      "outerwear - jacket or coat. Preserve open or closed front, exact sleeve length, lapel and collar style, length (cropped/regular/long), all buttons, zippers and design details exactly as shown.",
    "Lehenga":
      "Indian ethnic lehenga. Preserve all embroidery, mirror work, colors, patterns, dupatta, and design details exactly as shown.",
    "Kurta / Kurti":
      "Indian ethnic kurta or kurti. Preserve neckline style, sleeve length, embroidery, prints, colors and all design details exactly as shown.",
    "Ethnic Jacket":
      "Indian ethnic jacket or nehru jacket. Preserve embroidery, colors, buttons, collar, length and all design details exactly as shown.",
  };
  return (
    map[garment?.label] ||
    `${garment?.label || "clothing"} - preserve all design details, colors, patterns, sleeve length, collar and fit exactly as shown in the garment image.`
  );
};

// ── Main try-on route ─────────────────────────────────────────────────────────
app.post("/tryon", async (req, res) => {
  const t0 = Date.now();
  console.log("\n── New Try-On Request ──────────────────────────────");

  try {
    if (!process.env.REPLICATE_API_KEY) {
      return res.status(500).json({ success: false, error: "REPLICATE_API_KEY not set on server." });
    }

    const { personImg, clothImg, garment } = req.body;

    if (!personImg || !clothImg) {
      return res.status(400).json({ success: false, error: "personImg and clothImg are required." });
    }

    // ── STEP 1: Preprocess both images in parallel ────────────────────────
    console.log("⚡ Step 1: Preprocessing both images in parallel...");
    const [processedPerson, processedCloth] = await Promise.all([
      preprocessImage(personImg, "person"),
      preprocessImage(clothImg, "garment"),
    ]);
    console.log(`✓ Preprocessed in ${Date.now() - t0}ms`);

    // ── STEP 2: Upload BOTH to Replicate in parallel ──────────────────────
    // Uploading gives Replicate a stable URL = faster model loading
    console.log("⚡ Step 2: Uploading both images to Replicate in parallel...");
    const t1 = Date.now();
    const [personUrl, garmentUrl] = await Promise.all([
      uploadToReplicate(processedPerson),
      uploadToReplicate(processedCloth),
    ]);
    console.log(`✓ Both uploaded in ${Date.now() - t1}ms`);

    // ── STEP 3: Run IDM-VTON ──────────────────────────────────────────────
    console.log("⚡ Step 3: Running IDM-VTON AI...");
    const t2 = Date.now();

    const category = garment?.category || "upper_body";

    const output = await replicate.run(
      "cuuupid/idm-vton:0513734a452173b8173e907e3a59d19a36266e55b48528559432bd21c7d7e985",
      {
        input: {
          // ✅ KEY: person image — preserved body, pose, face, skin tone
          human_img: personUrl,

          // ✅ Garment image
          garm_img: garmentUrl,

          // ✅ Detailed description helps preserve garment details
          garment_des: buildGarmentDescription(garment),

          // ✅ Category — tells model which body part to dress
          category: category,

          // ✅ is_checked: true = model auto-detects masking area
          // This is critical for body preservation
          is_checked: true,

          // ✅ is_checked_crop: true = handles partial body / half body photos
          is_checked_crop: true,

          // ✅ Speed vs Quality balance:
          // 30 steps = fastest with acceptable quality
          // 40 steps = good balance (recommended)
          // 50 steps = best quality, slower
          denoise_steps: 35,

          // ✅ guidance_scale:
          // 2.0 = fastest, softer garment transfer
          // 2.5 = good balance — garment details clearer
          guidance_scale: 2.8,

          // ✅ Random seed = different result each time (avoids repetition)
          seed: Math.floor(Math.random() * 999999),
        },
      }
    );

    console.log(`✓ IDM-VTON done in ${Date.now() - t2}ms`);
    console.log("Raw output:", JSON.stringify(output).substring(0, 120));

    // ── STEP 4: Extract image URL from output ─────────────────────────────
    let imageUrl = null;

    if (Array.isArray(output)) {
      for (const item of output) {
        const str = String(item);
        if (str.startsWith("http")) { imageUrl = str; break; }
        if (item?.url) { imageUrl = String(item.url); break; }
      }
    } else if (output) {
      const str = String(output);
      if (str.startsWith("http")) imageUrl = str;
    }

    if (!imageUrl?.startsWith("http")) {
      console.error("No valid image URL in output:", output);
      return res.status(500).json({ success: false, error: "AI did not return a valid image. Please try again." });
    }

    console.log(`✅ TOTAL: ${Date.now() - t0}ms`);
    console.log("Final URL:", imageUrl.substring(0, 70) + "...");

    return res.json({ success: true, image: imageUrl });

  } catch (err) {
    console.error("❌ Error:", err.message);

    // ── Friendly error messages ───────────────────────────────────────────
    if (err.message?.includes("list index out of range")) {
      return res.status(400).json({
        success: false,
        error: "Could not detect the person clearly in the photo. Please use a well-lit photo where the full person is visible and standing straight.",
      });
    }

    if (err.message?.includes("NSFW")) {
      return res.status(400).json({
        success: false,
        error: "Photo was flagged. Please use a clear, appropriate photo.",
      });
    }

    if (err.message?.includes("insufficient")) {
      return res.status(402).json({
        success: false,
        error: "AI service credits exhausted. Please contact support.",
      });
    }

    return res.status(500).json({
      success: false,
      error: err.message || "Something went wrong. Please try again.",
    });
  }
});

// ── Health check with timing ──────────────────────────────────────────────────
app.get("/ping", (req, res) => {
  res.json({ pong: true, ts: Date.now() });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n✅ Pooja Textiles Backend running on port ${PORT}`);
  console.log(`✅ Replicate API key: ${process.env.REPLICATE_API_KEY ? "SET ✓" : "NOT SET ✗"}`);
  console.log(`✅ Ready to serve try-on requests\n`);
});